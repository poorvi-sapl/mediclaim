"""
Generate 800 synthetic Medicare/Medicaid claims for ClaimLens and load them
into the claims table.

Design:
  * GPT-4o generates the realistic *content* (patient names + clinical service
    descriptions) in chunked, retried, JSON-mode calls.
  * All *structural* fields that the acceptance queries depend on (NPI
    distribution, supplier, service_category, codes, amounts, and dates anchored
    to the DB's CURRENT_DATE) are assigned deterministically in Python so the
    four verification queries pass reliably.

Resolved spec contradictions (in favor of the verification queries):
  * MedSupply Pro is billed under exactly 9 distinct NPIs (Query 1 == 9),
    not 15.
  * Batch 8 background is spread across the 14 non-Wilson NPIs so Dr. Wilson's
    baseline (31-90d) stays <= 15 (Query 3) while his recent volume drives
    Query 2 >= 40.
"""

import os
import re
import sys
import json
import uuid
import time
import random
import hashlib
import logging
from datetime import timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed

from dotenv import load_dotenv
import psycopg2
from psycopg2.extras import execute_values
import pgeocode
from rapidfuzz import process, fuzz
from openai import OpenAI

# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_PATH = os.path.join(BASE_DIR, "..", "..", ".env")
LOG_PATH = os.path.join(BASE_DIR, "generation.log")
MODEL = "gpt-4o"
GPT_CHUNK = 40
RANDOM_STATE = 42

random.seed(RANDOM_STATE)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[logging.FileHandler(LOG_PATH, encoding="utf-8"),
              logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("generate_synthetic")

WILSON = {
    "npi": "1234567890", "physician_name": "Dr. James Wilson",
    "specialty": "Internal Medicine", "practice_city": "San Francisco",
    "practice_state": "CA", "practice_zip": "94102",
    "practice_lat": 37.779026, "practice_lng": -122.419906,
}

FRAUD_SUPPLIERS = [
    {"supplier_name": "MedSupply Pro LLC", "npi": "9000000001", "state": "NY",
     "zip": "10001", "type": "DME Supplier", "oig_excluded": True},
    {"supplier_name": "QuickCare Equipment Inc", "npi": "9000000002", "state": "GA",
     "zip": "30301", "type": "DME Supplier", "oig_excluded": True},
    {"supplier_name": "Premier Home Solutions", "npi": "9000000003", "state": "AZ",
     "zip": "85001", "type": "Home Health Agency", "oig_excluded": False},
    # New fraud patterns (based on real OIG cases) — all CA, not OIG-excluded
    {"supplier_name": "Pacific Coast Home Health Inc", "npi": "9000000004",
     "state": "CA", "zip": "90001", "type": "Home Health Agency", "oig_excluded": False},
    {"supplier_name": "Valley Medical Supplies LLC", "npi": "9000000005",
     "state": "CA", "zip": "95814", "type": "DME Supplier", "oig_excluded": False},
    {"supplier_name": "Comprehensive Care Services LLC", "npi": "9000000006",
     "state": "CA", "zip": "94103", "type": "Outpatient Clinic", "oig_excluded": False},
    {"supplier_name": "Elite Home Health Services", "npi": "9000000007",
     "state": "CA", "zip": "92101", "type": "Home Health Agency", "oig_excluded": False},
]

# code pools by category (hcpcs for dme/drugs/hospice, cpt for home_health/hospital)
CODE_POOLS = {
    "dme":         {"hcpcs": ["E1390", "K0001", "E0260", "E0143", "E0601", "E1050"]},
    "home_health": {"cpt":   ["G0299", "G0300", "99509", "97110", "G0151"]},
    "hospice":     {"hcpcs": ["T2042", "T2043", "T2044", "Q5001"]},
    "drugs":       {"hcpcs": ["J1745", "J0135", "J2505", "J9035", "J1100"]},
    "hospital":    {"cpt":   ["99213", "99214", "99285", "99232", "99223"]},
}
AMOUNT_RANGES = {
    "dme": (300, 2000), "home_health": (1500, 2400), "hospice": (1000, 3000),
    "drugs": (150, 1400), "hospital": (500, 4500),
}
PLAN = "California Medi-Cal"

# Real US zips for batches with no geographic constraint ("any real US zip").
REAL_US_ZIPS = [
    "10016", "11201", "30309", "33139", "60614", "75201", "77002", "85004",
    "94103", "98101", "02118", "19103", "20009", "37203", "80202", "97205",
    "48226", "63101", "55401", "53202", "32801", "28202", "84101", "89101",
    "73102", "70112", "43215", "21201", "15222", "92101",
]

nomi = pgeocode.Nominatim("US")


# --------------------------------------------------------------------------
# GPT content generation (names + descriptions)
# --------------------------------------------------------------------------
def _strip_fences(text: str) -> str:
    text = text.strip()
    text = re.sub(r"^```(?:json)?", "", text).strip()
    text = re.sub(r"```$", "", text).strip()
    return text


def _gen_chunk(client, k, category, codes, batch_no, start):
    """Generate exactly k {patient_name, service_description} dicts for one chunk.
    Robust to failure (3 retries, fence-stripping, fallback content)."""
    prompt = (
        f"Generate {k} synthetic, realistic US healthcare insurance claim "
        f"content records for service category '{category}' "
        f"(typical procedure/supply codes: {', '.join(codes)}). "
        f'Return ONLY a JSON object of the form '
        f'{{"items": [{{"patient_name": "First Last", '
        f'"service_description": "concise realistic description"}}]}} '
        f"with exactly {k} items. Use diverse, realistic American patient "
        f"names and concise clinically-appropriate service descriptions. "
        f"No markdown, no commentary."
    )
    items = None
    raw = ""
    for attempt in range(1, 4):
        try:
            resp = client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": "You output only valid JSON."},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.8,
                response_format={"type": "json_object"},
                max_tokens=4000,
            )
            raw = resp.choices[0].message.content
            data = json.loads(_strip_fences(raw))
            items = data.get("items") or data.get("claims") or []
            if not isinstance(items, list) or not items:
                raise ValueError("no items array")
            log.info(f"batch {batch_no}: chunk {start}-{start+k} ok "
                     f"({len(items)} items, attempt {attempt})")
            break
        except Exception as e:
            log.warning(f"batch {batch_no}: chunk {start} attempt {attempt} "
                        f"failed: {e}")
            items = None
            time.sleep(1.5 * attempt)
    if items is None:
        fp = os.path.join(BASE_DIR, f"failed_batch_{batch_no}.txt")
        with open(fp, "a", encoding="utf-8") as f:
            f.write(f"\n--- chunk {start}-{start+k} ---\n{raw}\n")
        log.error(f"batch {batch_no}: chunk {start} failed 3x -> {fp}; "
                  f"using fallback content")
        items = []
    norm = []
    for it in items[:k]:
        norm.append({
            "patient_name": str(it.get("patient_name") or _fallback_name()),
            "service_description": str(it.get("service_description")
                                       or f"{category} service"),
        })
    while len(norm) < k:
        norm.append({"patient_name": _fallback_name(),
                     "service_description": f"{category} service"})
    return norm


_FN = ["James", "Maria", "Robert", "Linda", "David", "Patricia", "Michael",
       "Jennifer", "William", "Elizabeth", "Carlos", "Mei", "Aisha", "John"]
_LN = ["Smith", "Johnson", "Garcia", "Nguyen", "Patel", "Brown", "Lee",
       "Martinez", "Davis", "Khan", "Wong", "Lopez", "Clark", "Adams"]


def _fallback_name():
    return f"{random.choice(_FN)} {random.choice(_LN)}"


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
def code_for(category):
    pool = CODE_POOLS[category]
    if "hcpcs" in pool:
        return (None, random.choice(pool["hcpcs"]))
    return (random.choice(pool["cpt"]), None)


def amount_for(category, rng=None):
    lo, hi = rng if rng else AMOUNT_RANGES[category]
    return round(random.uniform(lo, hi), 2)


def dos(ref_date, lo_days, hi_days):
    """Random date with lo_days..hi_days ago from ref_date (inclusive)."""
    return ref_date - timedelta(days=random.randint(lo_days, hi_days))


def supplier_id_for(name, canonical_names):
    match = process.extractOne(name, canonical_names, scorer=fuzz.token_sort_ratio)
    canon = match[0] if match and match[1] >= 90 else name
    norm = canon.upper().strip()
    h = hashlib.sha1(norm.encode("utf-8")).hexdigest()[:12]
    return f"sup-{h}"


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------
def main():
    load_dotenv(ENV_PATH)
    db_url = os.environ["DATABASE_URL"]
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key or api_key.startswith("sk-your"):
        sys.exit("ERROR: real OPENAI_API_KEY not set in .env")
    client = OpenAI(api_key=api_key)

    conn = psycopg2.connect(db_url)
    conn.autocommit = False
    cur = conn.cursor()

    ref_date = cur.execute("SELECT CURRENT_DATE") or cur.fetchone()[0]
    log.info(f"Anchor CURRENT_DATE = {ref_date}")

    # ---- Step 1: physicians (exclude Wilson npi for stable sampling) ----
    import pandas as pd
    phys_df = pd.read_sql(
        "SELECT npi, physician_name, specialty, practice_city, practice_state, "
        "practice_zip, practice_lat, practice_lng FROM npi_profiles "
        "WHERE practice_state='CA' AND practice_lat IS NOT NULL AND npi <> %(w)s",
        conn, params={"w": WILSON["npi"]},
    )
    sampled = phys_df.sample(n=15, random_state=RANDOM_STATE).reset_index(drop=True)
    physicians = sampled.to_dict("records")
    physicians[0] = dict(WILSON)  # replace first sampled with Dr. Wilson
    log.info(f"Physicians: 15 (idx0 = Dr. Wilson {WILSON['npi']})")

    # upsert Dr. Wilson
    cur.execute(
        """INSERT INTO npi_profiles
           (npi, physician_name, specialty, practice_address, practice_city,
            practice_state, practice_zip, enrollment_date, last_update,
            oig_excluded, practice_lat, practice_lng)
           VALUES (%s,%s,%s,NULL,%s,%s,%s,'2015-01-01',CURRENT_DATE,false,%s,%s)
           ON CONFLICT (npi) DO NOTHING""",
        (WILSON["npi"], WILSON["physician_name"], WILSON["specialty"],
         WILSON["practice_city"], WILSON["practice_state"], WILSON["practice_zip"],
         WILSON["practice_lat"], WILSON["practice_lng"]),
    )

    # ---- Step 2: legit CA suppliers ----
    supp_df = pd.read_sql(
        "SELECT npi, supplier_name, state, zip FROM supplier_profiles "
        "WHERE state='CA'", conn,
    )
    legit = supp_df.sample(n=10, random_state=RANDOM_STATE).reset_index(drop=True)
    legit_suppliers = legit.to_dict("records")
    log.info(f"Legit CA suppliers: {len(legit_suppliers)}")

    # ---- Step 3: fraud suppliers ----
    for fs in FRAUD_SUPPLIERS:
        cur.execute(
            """INSERT INTO supplier_profiles
               (npi, supplier_name, supplier_type, address, city, state, zip,
                enrollment_date, last_update, oig_excluded)
               VALUES (%s,%s,%s,NULL,NULL,%s,%s,'2018-01-01',CURRENT_DATE,%s)
               ON CONFLICT (npi) DO NOTHING""",
            (fs["npi"], fs["supplier_name"], fs["type"],
             fs["state"], fs["zip"], fs["oig_excluded"]),
        )
    conn.commit()

    def _sup(name, npi, zip_, state):
        return {"name": name, "npi": npi, "zip": zip_, "state": state}

    medsupply     = _sup("MedSupply Pro LLC", "9000000001", "10001", "NY")
    quickcare     = _sup("QuickCare Equipment Inc", "9000000002", "30301", "GA")
    premier       = _sup("Premier Home Solutions", "9000000003", "85001", "AZ")
    pacific       = _sup("Pacific Coast Home Health Inc", "9000000004", "90001", "CA")
    valley        = _sup("Valley Medical Supplies LLC", "9000000005", "95814", "CA")
    comprehensive = _sup("Comprehensive Care Services LLC", "9000000006", "94103", "CA")
    elite         = _sup("Elite Home Health Services", "9000000007", "92101", "CA")

    def legit_pick(i=None):
        s = legit_suppliers[i % 10] if i is not None else random.choice(legit_suppliers)
        return {"name": s["supplier_name"], "npi": s["npi"],
                "zip": str(s["zip"]), "state": s["state"]}

    # ---- Build claim slots (structural fields only) ----
    claims = []  # each: dict with structural fields + placeholder content

    def add(npi, supplier, category, date, *, cpt=None, hcpcs=None, amount=None,
            patient_zip=None, patient_id=None, patient_name=None):
        if cpt is None and hcpcs is None:
            cpt, hcpcs = code_for(category)
        if amount is None:
            amount = amount_for(category)
        claims.append({
            "npi": npi, "supplier": supplier, "service_category": category,
            "cpt_code": cpt, "hcpcs_code": hcpcs, "date_of_service": date,
            "claim_amount": round(float(amount), 2),
            "patient_zip": patient_zip, "patient_id": patient_id,
            "patient_name": patient_name, "_batch": None,
        })

    P = [p["npi"] for p in physicians]  # P[0]=Wilson

    def zip_of(idx):
        return str(physicians[idx]["practice_zip"])

    TOTAL_TARGET = 2975  # +25 from augment_patterns = 3000
    MED_CODES = ["E1050", "E1070", "K0001", "K0005"]

    # PATTERN 1 — MedSupply Pro ring: 300 claims, exactly 9 NPIs
    n0 = len(claims)
    for _ in range(60):  # Dr. Wilson, recent (drives the spike)
        add(P[0], medsupply, "dme", dos(ref_date, 0, 29),
            hcpcs=random.choice(MED_CODES), amount=random.uniform(800, 2200))
    for idx in range(1, 9):  # 8 other NPIs x 30 = 240
        for _ in range(30):
            add(P[idx], medsupply, "dme", dos(ref_date, 0, 89),
                hcpcs=random.choice(MED_CODES), amount=random.uniform(800, 2200))
    _tag(claims, n0, 1)

    # PATTERN 2 — Dr. Wilson volume spike (non-MedSupply): 60 recent + 22 baseline
    n0 = len(claims)
    for j in range(60):  # recent spike
        add(P[0], legit_pick(j), random.choice(["home_health", "dme", "hospital"]),
            dos(ref_date, 0, 29))
    for j in range(22):  # baseline (31-90 days ago)
        add(P[0], legit_pick(j), random.choice(["home_health", "hospital"]),
            dos(ref_date, 31, 90))
    _tag(claims, n0, 2)

    # PATTERN 3 — geographic anomalies: 60 claims across 8 NPIs, distant patients
    n0 = len(claims)
    DISTANT = ["33101", "33125", "33401", "10001", "10016", "11201",
               "77001", "77002", "78201", "98101", "98103"]
    for j in range(60):
        add(P[1 + j % 8], legit_pick(j), random.choice(["dme", "home_health"]),
            dos(ref_date, 0, 89), patient_zip=DISTANT[j % len(DISTANT)])
    _tag(claims, n0, 3)

    # PATTERN 4 — QuickCare (OIG excluded): 45 claims, 5 NPIs, small amounts
    n0 = len(claims)
    QC_CODES = ["A4253", "A4570", "E0100"]
    for j in range(45):
        add(P[1 + j % 5], quickcare, "dme", dos(ref_date, 0, 89),
            hcpcs=random.choice(QC_CODES), amount=random.uniform(250, 800))
    _tag(claims, n0, 4)

    # PATTERN 5 — Premier (new high-value): 55 claims, last 15 days, 3 NPIs
    n0 = len(claims)
    PR_CODES = ["G0299", "G0300", "97110"]
    for j in range(55):
        add(P[4 + j % 3], premier, "home_health", dos(ref_date, 0, 14),
            cpt=random.choice(PR_CODES), amount=random.uniform(1800, 2400))
    _tag(claims, n0, 5)

    # PATTERN 6 — patient identity reuse: 25 claims, 3 reused IDs x 3 NPIs each
    n0 = len(claims)
    REUSE = [
        ("pat-FRAUD-001-REUSE", ["Robert Chen", "Roberto Chen", "R. Chen"],
         ["94105", "90210", "10001"], 9),
        ("pat-FRAUD-002-REUSE", ["Maria Garcia", "Mary Garcia", "M. Garcia"],
         ["92101", "75201", "33139"], 8),
        ("pat-FRAUD-003-REUSE", ["James Kim", "J. Kim", "Jimmy Kim"],
         ["98101", "60614", "20009"], 8),
    ]
    reuse_npis = [P[6], P[7], P[8]]
    for pid, names, zips, cnt in REUSE:
        for k in range(cnt):
            add(reuse_npis[k % 3], legit_pick(k), random.choice(["dme", "drugs"]),
                dos(ref_date, 0, 89), patient_zip=zips[k % 3],
                patient_id=pid, patient_name=names[k % 3])
    _tag(claims, n0, 6)

    # PATTERN 7 — Pacific Coast kickback cluster: 120 home_health, 4 dedicated NPIs,
    # near patients, 40%-inflated amounts, 100% referral concentration
    n0 = len(claims)
    PC_NPIS = [10, 11, 12, 13]
    PC_CODES = ["G0299", "G0300", "99509"]
    for j in range(120):
        idx = PC_NPIS[j % 4]
        add(P[idx], pacific, "home_health", dos(ref_date, 0, 89),
            cpt=random.choice(PC_CODES), amount=random.uniform(380, 450),
            patient_zip=zip_of(idx))
    _tag(claims, n0, 7)

    # PATTERN 8 — duplicate billing: 30 pairs (Valley duplicates a legit claim),
    # same npi+patient+date+hcpcs, different supplier (60 records, 5 NPIs)
    n0 = len(claims)
    DUP_CODES = ["E1390", "K0001", "E0260"]
    for j in range(30):
        idx = 1 + j % 5
        pid = f"pat-DUP-{j:03d}"
        d = dos(ref_date, 0, 89)
        code = random.choice(DUP_CODES)
        amt = round(random.uniform(400, 1500), 2)
        pz = zip_of(idx)
        add(P[idx], legit_pick(j), "dme", d, hcpcs=code, amount=amt,
            patient_id=pid, patient_zip=pz)          # original (legit supplier)
        add(P[idx], valley, "dme", d, hcpcs=code, amount=amt,
            patient_id=pid, patient_zip=pz)          # duplicate (Valley)
    _tag(claims, n0, 8)

    # PATTERN 9 — unbundling: ~13-14 visits split into 99201+99211+G0101 (40 records)
    n0 = len(claims)
    UNB = [("99201", 45.0), ("99211", 25.0), ("G0101", 55.0)]
    recs = 0
    for v in range(14):
        idx = 1 + v % 6
        pid = f"pat-UNB-{v:03d}"
        d = dos(ref_date, 0, 89)
        pz = zip_of(idx)
        for code, amt in UNB:
            if recs >= 40:
                break
            add(P[idx], comprehensive, "hospital", d, cpt=code, amount=amt,
                patient_id=pid, patient_zip=pz)
            recs += 1
        if recs >= 40:
            break
    _tag(claims, n0, 9)

    # PATTERN 10 — upcoding: 50 claims, 4 NPIs (high code billed, high amount)
    n0 = len(claims)
    for j in range(50):
        idx = 1 + j % 4
        if j % 2 == 0:
            add(P[idx], elite, "home_health", dos(ref_date, 0, 89),
                cpt="G0299", amount=380.0)      # billed RN when LPN given
        else:
            add(P[idx], elite, "dme", dos(ref_date, 0, 89),
                hcpcs="E1070", amount=2200.0)   # billed motorized chair vs cane
    _tag(claims, n0, 10)

    # PATTERN 11 — legitimate background: fill to TOTAL_TARGET across P[1..14]
    n0 = len(claims)
    remaining = TOTAL_TARGET - len(claims)
    cats = ["dme", "home_health", "hospice", "drugs", "hospital"]
    weights = [0.30, 0.25, 0.15, 0.10, 0.20]
    pc_set = set(PC_NPIS)
    for j in range(remaining):
        idx = 1 + j % 14  # P[1..14], never Dr. Wilson
        cat = random.choices(cats, weights=weights)[0]
        if idx in pc_set and cat == "home_health":
            cat = "dme"  # preserve Pacific Coast referral concentration
        add(P[idx], legit_pick(j), cat, dos(ref_date, 0, 89), patient_zip=zip_of(idx))
    _tag(claims, n0, 11)

    assert len(claims) == TOTAL_TARGET, f"expected {TOTAL_TARGET}, built {len(claims)}"
    log.info(f"Built {len(claims)} claim slots across 11 patterns")

    # Assign a real US zip to any slot without a geo-constrained zip.
    for c in claims:
        if c["patient_zip"] is None:
            c["patient_zip"] = random.choice(REAL_US_ZIPS)

    # ---- Step 4/5: GPT-4o content (all chunks run concurrently) ----
    batch_info = {}
    for b in sorted({c["_batch"] for c in claims}):
        idxs = [i for i, c in enumerate(claims) if c["_batch"] == b]
        cat0 = claims[idxs[0]]["service_category"]
        codes = list(CODE_POOLS[cat0].values())[0]
        batch_info[b] = (idxs, cat0, codes)

    tasks = []  # (batch_no, start, k, category, codes)
    for b, (idxs, cat0, codes) in batch_info.items():
        n = len(idxs)
        for start in range(0, n, GPT_CHUNK):
            tasks.append((b, start, min(GPT_CHUNK, n - start), cat0, codes))

    chunk_results = {}
    with ThreadPoolExecutor(max_workers=12) as ex:
        futs = {ex.submit(_gen_chunk, client, k, cat0, codes, b, start): (b, start)
                for (b, start, k, cat0, codes) in tasks}
        for fut in as_completed(futs):
            chunk_results[futs[fut]] = fut.result()

    for b, (idxs, cat0, codes) in batch_info.items():
        content = []
        for start in range(0, len(idxs), GPT_CHUNK):
            content.extend(chunk_results[(b, start)])
        for i, ci in zip(idxs, content):
            if claims[i]["patient_name"] is None:
                claims[i]["patient_name"] = ci["patient_name"]
            claims[i]["service_description"] = ci["service_description"][:512]

    # ---- Step 6: post-processing ----
    canonical = [s["supplier_name"] for s in legit_suppliers] + \
                [f["supplier_name"] for f in FRAUD_SUPPLIERS]
    # geocode all distinct patient zips once
    zips = sorted({c["patient_zip"] for c in claims if c["patient_zip"]})
    geo = {}
    if zips:
        gdf = nomi.query_postal_code(zips)
        for z, row in zip(zips, gdf.to_dict("records")):
            lat, lng, st = row["latitude"], row["longitude"], row["state_code"]
            geo[z] = (None if pd.isna(lat) else round(float(lat), 6),
                      None if pd.isna(lng) else round(float(lng), 6),
                      None if (isinstance(st, float) and pd.isna(st)) else st)

    oig_npi_set = set()
    cur.execute("SELECT npi FROM oig_excluded_npis")
    oig_npi_set = {r[0] for r in cur.fetchall()}

    rows = []
    for c in claims:
        sup = c["supplier"]
        pz = c["patient_zip"]
        lat = lng = None
        pstate = "CA"
        if pz and pz in geo:
            lat, lng, st = geo[pz]
            pstate = st or "CA"
        pid = c["patient_id"] or f"pat-{uuid.uuid4().hex[:10]}"
        oig = (sup["name"] in ("MedSupply Pro LLC", "QuickCare Equipment Inc")
               or sup["npi"] in oig_npi_set)
        rows.append((
            str(uuid.uuid4()), c["npi"], pid, c["patient_name"], pz or "00000",
            pstate, lat, lng, c["date_of_service"], c["cpt_code"], c["hcpcs_code"],
            c["service_description"], c["service_category"], sup["name"],
            supplier_id_for(sup["name"], canonical), sup["zip"], sup["state"],
            c["claim_amount"], PLAN, oig, False,
        ))

    # ---- Step 7: bulk insert ----
    execute_values(cur, """
        INSERT INTO claims
        (id, npi, patient_id, patient_name, patient_zip, patient_state,
         patient_lat, patient_lng, date_of_service, cpt_code, hcpcs_code,
         service_description, service_category, supplier_name, supplier_id,
         supplier_zip, supplier_state, claim_amount, plan_name, oig_flagged,
         reviewed, ingested_at, created_at)
        VALUES %s
        ON CONFLICT (id) DO NOTHING
    """, rows, template="(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,now(),now())")
    conn.commit()
    log.info(f"Inserted {len(rows)} claims")

    # ---- Step 8: verification ----
    checks = [
        ("Q1 distinct NPIs MedSupply == 9",
         "SELECT COUNT(DISTINCT npi) FROM claims WHERE supplier_name='MedSupply Pro LLC'",
         lambda v: v == 9),
        ("Q2 Wilson recent(<=30d) >= 100",
         "SELECT COUNT(*) FROM claims WHERE npi='1234567890' "
         "AND date_of_service >= CURRENT_DATE - INTERVAL '30 days'",
         lambda v: v >= 100),
        ("Q3 Wilson baseline(>30d) <= 25",
         "SELECT COUNT(*) FROM claims WHERE npi='1234567890' "
         "AND date_of_service < CURRENT_DATE - INTERVAL '30 days'",
         lambda v: v <= 25),
        ("Q4 oig_flagged >= 100",
         "SELECT COUNT(*) FROM claims WHERE oig_flagged = true",
         lambda v: v >= 100),
    ]
    print("\n" + "=" * 55)
    all_pass = True
    for name, sql, ok in checks:
        cur.execute(sql)
        val = cur.fetchone()[0]
        passed = ok(val)
        print(f"[{'PASS' if passed else 'FAIL'}] {name}  (actual={val})")
        if not passed:
            all_pass = False
            print(f"  -> FAILED: actual value = {val}")
            break
    print("=" * 55)
    conn.close()
    if all_pass:
        print(f"GENERATION COMPLETE — all 4 checks passed, {len(rows)} claims loaded.")
    else:
        sys.exit("Verification failed; stopping.")


def _tag(claims, start, b):
    for c in claims[start:]:
        if c["_batch"] is None:
            c["_batch"] = b


if __name__ == "__main__":
    main()
