"""Generate ~18,000 synthetic claims across the 100 tiered physicians / 100 suppliers.

Uses the same claims schema and GPT-with-fallback descriptions as the original
synthetic generator, scaled up and driven by tiered_npis.json.

Fraud is planted so the rules engine fires ONLY for the intended tiers:
  * cross_npi_supplier — Tier 2/3 suppliers are shared across >=4 physicians; Tier 1
    suppliers are each used by <=2 physicians (below the threshold).
  * volume_spike — physicians with the pattern get ~60% of claims in the last 30 days;
    everyone else gets an even 0-90d spread (recent rate ~= baseline -> no spike).
  * oig_leie_hit — Tier 3 supplier claims set oig_flagged=True.
  * duplicate_billing — Tier 3 'duplicate' physicians get planted same-patient/date/hcpcs
    pairs billed by two suppliers.
  * geographic_anomaly — Tier 3 'geo' physicians get distant patient zips; everyone else's
    patients sit at the practice zip (distance ~0).
Combined with the blended scoring formula this yields ~60 clean (<30), ~30 mid (30-70),
~10 high (>70).
"""
import os
import re
import sys
import json
import time
import uuid
import random
import hashlib
import logging

import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv
import pgeocode
from datetime import timedelta

BASE = os.path.dirname(os.path.abspath(__file__))
ENV_PATH = r"D:\Mediclaim\.env"
RANDOM_STATE = 42
random.seed(RANDOM_STATE)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                    handlers=[logging.StreamHandler(sys.stdout)])
log = logging.getLogger("generate_expanded")

VOL = {1: (50, 120), 2: (150, 300), 3: (400, 650)}
CODE_POOLS = {
    "dme":         {"hcpcs": ["E1390", "K0001", "E0260", "E0143", "E0601", "E1050"]},
    "home_health": {"cpt":   ["G0299", "G0300", "99509", "97110", "G0151"]},
    "hospice":     {"hcpcs": ["T2042", "T2043", "T2044", "Q5001"]},
    "drugs":       {"hcpcs": ["J1745", "J0135", "J2505", "J9035", "J1100"]},
    "hospital":    {"cpt":   ["99213", "99214", "99232", "99223", "99285"]},
}
AMOUNT_RANGES = {"dme": (300, 1800), "home_health": (1500, 2300), "hospice": (1000, 2800),
                 "drugs": (150, 1300), "hospital": (500, 2400)}
PLAN = "California Medi-Cal"
DISTANT_ZIPS = ["33101", "10001", "11201", "77002", "98101", "02118", "33139", "60614"]
# Geo-anomaly patient zips — a spread of distant US metros so flagged patients show
# realistic distance VARIANCE instead of one identical value. (label + a rough
# CA-reference mileage for readability; the real flag uses the haversine distance from
# each PHYSICIAN's own practice — see geo_zips_for() below.)
GEO_ANOMALY_ZIPS = [
    ("33101", "Miami, FL",        2354),
    ("10001", "New York, NY",     2797),
    ("77001", "Houston, TX",      1547),
    ("60601", "Chicago, IL",      1749),
    ("30301", "Atlanta, GA",      2175),
    ("98101", "Seattle, WA",       190),  # close to a West-coast practice — varies by physician
    ("02101", "Boston, MA",       2983),
    ("85001", "Phoenix, AZ",       357),  # moderate distance
    ("80201", "Denver, CO",        844),
    ("37201", "Nashville, TN",    1988),
    ("45201", "Cincinnati, OH",   2184),
    ("55101", "Minneapolis, MN",  1560),
]
GEO_POOL_ZIPS = [z[0] for z in GEO_ANOMALY_ZIPS]
# A geo patient is only assigned a pool zip that is clearly distant (> this many miles)
# from THAT physician's practice, so every flagged geo claim shows a large, anomalous,
# and varied distance. (The geographic_anomaly rule itself fires above ~30 miles; this
# floor keeps the planted anomalies cross-country, matching the intended pattern.)
GEO_DISTANCE_FLOOR = 800


def _haversine_miles(lat1, lng1, lat2, lng2):
    import math
    R = 3958.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))
CANNED = {
    "dme": ["Standard wheelchair K0001 supply", "Hospital bed E0260 rental",
            "Oxygen concentrator E1390 monthly", "Walker E0143 with wheels",
            "CPAP device E0601 supply", "Power wheelchair E1050 fitting"],
    "home_health": ["Skilled nursing home visit G0299", "Home health aide visit G0300",
                    "In-home therapeutic exercise 97110", "Home nursing assessment 99509",
                    "Home health LPN visit G0151"],
    "hospice": ["Routine home hospice care T2042", "Continuous home hospice T2043",
                "Inpatient respite hospice T2044", "Hospice room and board Q5001"],
    "drugs": ["Infliximab injection J1745", "Adalimumab dose J0135",
              "Rituximab infusion J9035", "Hydrocortisone injection J1100"],
    "hospital": ["Office/outpatient E/M 99213", "Established patient visit 99214",
                 "Subsequent hospital care 99232", "Initial hospital care 99223"],
}
_FN = ["James", "Maria", "Robert", "Linda", "David", "Patricia", "Michael", "Jennifer",
       "William", "Elizabeth", "Carlos", "Mei", "Aisha", "John", "Sofia", "Daniel"]
_LN = ["Smith", "Johnson", "Garcia", "Nguyen", "Patel", "Brown", "Lee", "Martinez",
       "Davis", "Khan", "Wong", "Lopez", "Clark", "Adams", "Rivera", "Chen"]


def supplier_id_for(name, npi):
    h = hashlib.sha1(f"{name}|{npi}".upper().encode()).hexdigest()[:12]
    return f"sup-{h}"


def assign_supplier_volumes(total_claims, num_suppliers, physician_index):
    """Zipf-like long-tail split of a physician's claims across their suppliers.

    Each supplier's share is proportional to 1/rank, the ranks are shuffled per physician
    (so different physicians have different 'primary' suppliers), then small deterministic
    noise is added. Every supplier gets >=1 claim (so cross-NPI sharing still holds).
    """
    weights = [1.0 / (r + 1) for r in range(num_suppliers)]
    rng = random.Random(physician_index * 31337)
    rng.shuffle(weights)
    tot = sum(weights)
    weights = [w / tot for w in weights]
    counts = [round(w * total_claims) for w in weights]
    counts[-1] += total_claims - sum(counts)          # make pre-noise sum exact
    counts[-1] = max(1, counts[-1])
    for idx in range(num_suppliers):
        noise = (physician_index * 7 + idx * 13) % 17 - 8
        counts[idx] = max(1, counts[idx] + noise)
    return counts


def category_sequence(flags, n):
    """Deterministic category list of length n weighted by eligibility flags."""
    w = {}
    active = [c for c, on in (("home_health", flags["hha"]), ("dme", flags["dme"]),
                              ("hospice", flags["hospice"])) if on]
    if len(active) == 1:
        w[active[0]] = 0.70
    else:
        if flags["hha"]: w["home_health"] = 0.35
        if flags["dme"]: w["dme"] = 0.35
        if flags["hospice"]: w["hospice"] = 0.20
    rem = round(1.0 - sum(w.values()), 3)
    w["drugs"] = w.get("drugs", 0) + rem / 2
    w["hospital"] = w.get("hospital", 0) + rem / 2
    cats, weights = list(w.keys()), list(w.values())
    rng = random.Random(1000 + n)
    return rng.choices(cats, weights=weights, k=n)


def gpt_descriptions():
    """One GPT-4o call per category (50 descriptions); falls back to canned on any failure."""
    pools = {}
    try:
        from openai import OpenAI
        key = os.environ.get("OPENAI_API_KEY")
        if not key or key.startswith("sk-your"):
            raise RuntimeError("no key")
        client = OpenAI(api_key=key, timeout=20)
        for cat, codes in CODE_POOLS.items():
            code_list = list(codes.values())[0]
            try:
                resp = client.chat.completions.create(
                    model="gpt-4o",
                    messages=[{"role": "system", "content": "You output only valid JSON."},
                              {"role": "user", "content":
                               f"Generate 50 concise realistic US healthcare claim service "
                               f"descriptions for category '{cat}' (codes: {', '.join(code_list)}). "
                               f'Return ONLY {{"items":["...", ...]}} with 50 strings.'}],
                    temperature=0.8, response_format={"type": "json_object"}, max_tokens=2000)
                items = json.loads(resp.choices[0].message.content).get("items", [])
                pools[cat] = [str(x)[:512] for x in items if x] or list(CANNED[cat])
                log.info(f"GPT descriptions for {cat}: {len(pools[cat])}")
            except Exception as e:
                log.warning(f"GPT {cat} failed ({e}); canned"); pools[cat] = list(CANNED[cat])
    except Exception as e:
        log.warning(f"OpenAI unavailable ({e}); using canned descriptions for all categories")
        pools = {c: list(v) for c, v in CANNED.items()}
    return pools


def main():
    load_dotenv(ENV_PATH)
    with open(os.path.join(BASE, "tiered_npis.json"), encoding="utf-8") as f:
        tiered = json.load(f)
    phys = tiered["physicians"]
    supp = tiered["suppliers"]
    assert len(phys) == 100 and len(supp) == 100

    conn = psycopg2.connect(os.environ["DATABASE_URL"]); conn.autocommit = False
    cur = conn.cursor()
    ref = cur.execute("SELECT CURRENT_DATE") or cur.fetchone()[0]
    log.info(f"Anchor CURRENT_DATE = {ref}")

    # supplier lookups by tier (each carries a stable supplier_id + zip/state)
    for s in supp:
        s["supplier_id"] = supplier_id_for(s["name"], s["npi"])
        s["zip"] = (s.get("zip") or "00000")
    T1 = [s for s in supp if s["tier"] == 1]   # 60 clean
    T2 = [s for s in supp if s["tier"] == 2]   # 30 cross-NPI
    T3 = [s for s in supp if s["tier"] == 3]   # 10 OIG + cross

    # practice zips for patient placement (near practice -> no geo flag)
    npis = tuple(p["npi"] for p in phys)
    cur.execute("SELECT npi, practice_zip, practice_state FROM npi_profiles WHERE npi IN %s", (npis,))
    prow = {n: (z or "00000", st) for n, z, st in cur.fetchall()}
    pzip = {n: v[0] for n, v in prow.items()}

    # Geocode every patient zip we'll use once (patient_lat/lng + patient_state are
    # required: patient_state is NOT NULL, and the geo rule needs patient_lat/lng).
    nomi = pgeocode.Nominatim("US")
    all_zips = sorted({z for z in pzip.values()} | set(DISTANT_ZIPS) | set(GEO_POOL_ZIPS))
    GEO = {}
    if all_zips:
        gdf = nomi.query_postal_code(all_zips)
        recs = gdf.to_dict("records") if hasattr(gdf, "to_dict") else [gdf]
        for z, r in zip(all_zips, recs):
            la, lo, st = r.get("latitude"), r.get("longitude"), r.get("state_code")
            import math as _m
            lat = None if (la is None or (isinstance(la, float) and _m.isnan(la))) else round(float(la), 6)
            lng = None if (lo is None or (isinstance(lo, float) and _m.isnan(lo))) else round(float(lo), 6)
            state = None if (st is None or (isinstance(st, float))) else str(st)
            GEO[z] = (lat, lng, state)

    def geo_zips_for(npi):
        """Pool zips clearly distant (> GEO_DISTANCE_FLOOR) from this physician's practice,
        farthest first. Falls back to the farthest pool zips if none clear the floor (e.g.
        an unusual practice location), so a geo physician always has anomalous patients."""
        pc = GEO.get(pzip.get(npi))
        scored = []
        if pc and pc[0] is not None:
            for z in GEO_POOL_ZIPS:
                g = GEO.get(z)
                if g and g[0] is not None:
                    scored.append((_haversine_miles(pc[0], pc[1], g[0], g[1]), z))
        scored.sort(reverse=True)   # farthest first
        eligible = [z for d, z in scored if d > GEO_DISTANCE_FLOOR]
        return eligible or [z for _, z in scored]

    descs = gpt_descriptions()
    desc_ptr = {c: 0 for c in descs}

    def next_desc(cat):
        pool = descs.get(cat) or CANNED[cat]
        d = pool[desc_ptr[cat] % len(pool)]; desc_ptr[cat] += 1
        return d

    def code_amount(cat):
        pool = CODE_POOLS[cat]
        if "hcpcs" in pool:
            cpt, hcpcs = None, random.choice(pool["hcpcs"])
        else:
            cpt, hcpcs = random.choice(pool["cpt"]), None
        lo, hi = AMOUNT_RANGES[cat]
        return cpt, hcpcs, round(random.uniform(lo, hi), 2)

    def date_for(spike, k, n):
        # spike physicians: 60% in last 30d, 40% in 31-90d. others: even 0-90d.
        if spike:
            day = random.randint(0, 29) if (k / max(n, 1)) < 0.60 else random.randint(31, 90)
        else:
            day = random.randint(0, 90)
        return ref - __import__("datetime").timedelta(days=day)

    rows = []

    def emit(npi, sup, cat, date, patient_id, patient_zip, oig, phys_state, *,
             cpt=None, hcpcs=None, amount=None, desc=None):
        if cpt is None and hcpcs is None:
            cpt, hcpcs, amount = code_amount(cat)
        lat, lng, st = GEO.get(patient_zip, (None, None, None))
        patient_state = (st or phys_state or "CA")[:2]
        rows.append((
            str(uuid.uuid4()), npi, patient_id, f"{random.choice(_FN)} {random.choice(_LN)}",
            patient_zip, patient_state, lat, lng, date, cpt, hcpcs, desc or next_desc(cat), cat,
            sup["name"], sup["supplier_id"], sup["zip"], sup.get("state"),
            amount, PLAN, oig, False,
        ))

    for p in phys:
        i = p["index"]; npi = p["npi"]; tier = p["tier"]; pats = p["fraud_patterns"]
        lo, hi = VOL[tier]
        vol = lo + (i * 37) % (hi - lo)
        spike = "volume_spike" in pats
        home_zip = pzip.get(npi, "00000")

        # supplier list for this physician (controls which rules fire)
        if tier == 1:
            sup_list = [T1[i % 60], T1[(i + 30) % 60]]
        elif tier == 2:
            q = i - 60
            sup_list = [T2[(q - k) % 30] for k in range(4)]          # each T2 used by 4 phys
        else:
            q = i - 90
            # 1 T3 supplier (OIG + cross-NPI across all 10 T3 phys) + 5 T1 clean.
            # Reduces OLH/CNS blast radius by ~75% vs the original 4-T3 layout while
            # keeping each T3 physician high-risk (OIG + cross-NPI still fires).
            sup_list = [T3[q % 10]] + [T1[(q * 7 + k) % 60] for k in range(5)]

        # supplier_concentration plant: funnel 6 Tier-3 physicians (NOT the demo NPI at
        # index 90) through a single supplier → ~100% concentration. They are already
        # high-risk (OIG + cross-NPI), so this adds the flag without shifting bands.
        if 91 <= i <= 96:
            sup_list = [sup_list[0]]

        # Extra rare-rule physicians (by index, not from JSON fraud_patterns).
        # These spread underrepresented rules across T1/T2 without touching risk bands.
        EXTRA_GEO   = set(range(5, 55, 5))   # 10 T1 phys: geo anomaly patients
        EXTRA_IMP   = set(range(62, 70))      # 8 T2 phys: impossible day
        EXTRA_RAP   = set(range(62, 70))      # 8 T2 phys: rapid cycling
        EXTRA_MOD   = set(range(70, 78))      # 8 T2 phys: modifier abuse
        EXTRA_DEC   = set(range(70, 78))      # 8 T2 phys: deceased patient
        EXTRA_UB    = set(range(78, 86))      # 8 T2 phys: unbundling
        EXTRA_UC    = set(range(62, 72))      # 10 T2 phys: upcoding (extends 60-61)
        EXTRA_DB    = set(range(10, 30, 2))   # 10 T1 phys: duplicate billing
        EXTRA_NHVS  = set(range(80, 88))      # 8 T2 phys: new high value supplier

        geo = "geo_anomaly" in pats or i in EXTRA_GEO
        geo_pool = geo_zips_for(npi) if geo else []   # distant zips for this physician's geo patients
        phys_state = p.get("state") or prow.get(npi, ("", None))[1] or "CA"

        # Long-tail volume per supplier (primary supplier dominates, others taper off).
        counts = assign_supplier_volumes(vol, len(sup_list), i)
        cats = category_sequence(p, sum(counts))
        djit = random.Random(i * 7919)   # deterministic date jitter
        primary_idx = max(range(len(counts)), key=lambda x: counts[x])
        ck = 0
        geo_count = 0   # distinct distant patients placed so far for this geo physician
        for s, c in enumerate(counts):
            sup_s = sup_list[s]
            # Date spread scales with the supplier's share: the PRIMARY supplier spans the
            # full range; OCCASIONAL suppliers cluster in a short 2-4 week window placed in
            # the 31-90d baseline region — this keeps non-spike physicians from spuriously
            # tripping volume_spike / new_high_value_supplier (preserves the 10/30/60 split).
            if s == primary_idx:
                lo_d, hi_d = 0, 90
            else:
                window = max(14, min(28, round(90 * c / max(vol, 1))))
                start = 31 + ((i * 13 + s * 29) % max(1, 90 - window - 31 + 1))
                lo_d, hi_d = start, min(90, start + window)
            per_pat = max(1, c // 6)
            for j in range(c):
                cat = cats[ck % len(cats)]
                if spike:
                    # preserve the volume_spike signal: ~60% of claims in the last 30 days
                    day = djit.randint(0, 29) if djit.random() < 0.60 else djit.randint(31, 90)
                else:
                    day = djit.randint(lo_d, hi_d)
                date = ref - timedelta(days=day)
                # Patient stays within one supplier block (no cross-supplier same patient/date
                # -> no spurious duplicate_billing). Tier-3 dup pairs are planted below.
                pid = f"pat-{i:03d}-s{s}-{(j // per_pat):04d}"
                # Geo physicians get ONE distant patient per eligible zip (distinct
                # patient + distinct zip, farthest-first) → every flagged geo claim shows
                # a DIFFERENT distance, so the evidence list never repeats a distance.
                # All other claims sit at the practice zip (no geo flag).
                if geo and ck % 4 == 0 and geo_count < len(geo_pool):
                    pz = geo_pool[geo_count]
                    pid = f"pat-{i:03d}-GEO{geo_count:02d}"
                    geo_count += 1
                else:
                    pz = home_zip
                oig = (sup_s["tier"] == 3)
                emit(npi, sup_s, cat, date, pid, pz, oig, phys_state)
                ck += 1

        # duplicate_billing: plant 3 same-patient/date/hcpcs pairs across two suppliers
        if "duplicate_billing" in pats:
            for d in range(3):
                pid = f"pat-{i:03d}-DUP{d}"
                date = ref - __import__("datetime").timedelta(days=10 + d)
                hcpcs = random.choice(CODE_POOLS["dme"]["hcpcs"])
                amt = round(random.uniform(600, 1500), 2)
                emit(npi, sup_list[0], "dme", date, pid, home_zip, sup_list[0]["tier"] == 3,
                     phys_state, hcpcs=hcpcs, amount=amt)
                emit(npi, sup_list[1 % len(sup_list)], "dme", date, pid, home_zip,
                     sup_list[1 % len(sup_list)]["tier"] == 3, phys_state, hcpcs=hcpcs, amount=amt)

        # ---- planted patterns for the new fraud rules (deterministic) ----
        sup0 = sup_list[0]
        o3 = sup0["tier"] == 3
        # For T2 extra-rule plants use a per-physician synthetic supplier so the claims
        # are never shared across NPIs — cross_npi_supplier stays at 1 NPI per plant
        # supplier (well below the threshold). This prevents accidentally inflating CNS.
        # The rare rules (impossible_day, modifier_abuse, etc.) fire on claim patterns,
        # not on supplier tier, so they are unaffected by which supplier is used here.
        sup_plant = sup0 if tier == 3 else {
            "name": f"CliniPlant Logistics {i:03d}",
            "supplier_id": f"sup-plant-{i:04d}",
            "tier": 1,
            "zip": home_zip,
            "state": phys_state,
        }
        o_plant = sup_plant["tier"] == 3 if isinstance(sup_plant, dict) else o3

        # UPCODING: all Tier-3 + extended T2 set (EXTRA_UC covers 62-71, 60-61 already here).
        if tier == 3 or i in EXTRA_UC or (60 <= i <= 61):
            n_up = 4 if tier == 3 else 8   # more upcoded claims for T2 extra set
            for u in range(n_up):
                emit(npi, sup_plant, "home_health", ref - timedelta(days=12 + u),
                     f"pat-{i:03d}-UP{u}", home_zip, o_plant, phys_state,
                     cpt=random.choice(CODE_POOLS["home_health"]["cpt"]),
                     amount=round(7200 + u * 350, 2))

        # ---- IMPOSSIBLE DAY ----
        # T3: 45 claims on one date (~6 patients). Extra T2: same pattern, clean supplier.
        if tier == 3 or i in EXTRA_IMP:
            iday = ref - timedelta(days=7 + (i % 5))  # stagger dates per physician
            for k in range(45):
                emit(npi, sup_plant, "dme", iday, f"pat-{i:03d}-IMP{k % 6}", home_zip, o_plant, phys_state,
                     hcpcs=random.choice(CODE_POOLS["dme"]["hcpcs"]), amount=round(random.uniform(300, 1200), 2))

        # ---- RAPID CYCLING ----
        # T3: 30 distinct patients on one date. Extra T2: same pattern, different date offset.
        if tier == 3 or i in EXTRA_RAP:
            rday = ref - timedelta(days=17 + (i % 7))
            for k in range(30):
                emit(npi, sup_plant, "dme", rday, f"pat-{i:03d}-RAP{k}", home_zip, o_plant, phys_state,
                     hcpcs=random.choice(CODE_POOLS["dme"]["hcpcs"]), amount=round(random.uniform(300, 1200), 2))

        # ---- MODIFIER ABUSE ----
        # T3 + extra T2: same-patient/date pairs with nearly-identical descriptions.
        if tier == 3 or i in EXTRA_MOD:
            MOD_PAIRS = [
                ("Home health aide support visit", "Home health aide assistance visit"),
                ("Skilled nursing home visit follow up", "Skilled nursing home visit review"),
                ("In home therapeutic exercise session", "In home therapeutic exercise therapy"),
                ("Home nursing assessment initial intake", "Home nursing assessment initial review"),
            ]
            n_mod = 8 if tier == 3 else 12   # more pairs for extra T2 set
            for k in range(n_mod):
                d1, d2 = MOD_PAIRS[k % len(MOD_PAIRS)]
                pid = f"pat-{i:03d}-MOD{k}"
                mdate = ref - timedelta(days=22 + k)
                cpt = random.choice(CODE_POOLS["home_health"]["cpt"])
                emit(npi, sup_plant, "home_health", mdate, pid, home_zip, o_plant, phys_state,
                     cpt=cpt, amount=round(1850 + k, 2), desc=d1)
                emit(npi, sup_plant, "home_health", mdate, pid, home_zip, o_plant, phys_state,
                     cpt=cpt, amount=round(1860 + k, 2), desc=d2)

        # ---- DECEASED PATIENT ----
        # T3 + extra T2: a prior claim >180 days ago under a neighbour NPI, then this
        # physician bills the same patient recently (gap > 180 → flag fires).
        if tier == 3 or i in EXTRA_DEC:
            other_npi = phys[(i + 1) % len(phys)]["npi"]
            n_dec = 4 if tier == 3 else 8
            for k in range(n_dec):
                pid = f"pat-{i:03d}-DEC{k}"
                emit(other_npi, sup_plant, "dme", ref - timedelta(days=215 + k * 3), pid, home_zip,
                     False, phys_state, hcpcs=random.choice(CODE_POOLS["dme"]["hcpcs"]),
                     amount=round(random.uniform(400, 900), 2))
                emit(npi, sup_plant, "dme", ref - timedelta(days=3 + k), pid, home_zip, o_plant, phys_state,
                     hcpcs=random.choice(CODE_POOLS["dme"]["hcpcs"]), amount=round(random.uniform(400, 900), 2))

        # ---- UNBUNDLING ----
        # Extra T2: plant explicit groups of 4 distinct CPT codes for the same
        # patient/date/npi/supplier so the rule fires. Use clean T1 supplier.
        if i in EXTRA_UB:
            cpt_pool = CODE_POOLS["home_health"]["cpt"]
            for g in range(8):   # 8 groups × 4 CPTs = 32 claims per physician
                pid = f"pat-{i:03d}-UBG{g}"
                udate = ref - timedelta(days=30 + g * 4)
                for cpt_code in cpt_pool[:4]:
                    emit(npi, sup_plant, "home_health", udate, pid, home_zip, o_plant, phys_state,
                         cpt=cpt_code, amount=round(random.uniform(1200, 2000), 2))

        # ---- NEW HIGH VALUE SUPPLIER ----
        # T3 (existing: 91-96) + extra T2: brand-new supplier appearing only within the
        # lookback window with high-value claims. Use a unique synthetic supplier so
        # it's genuinely "first seen" for this NPI and never shared across NPIs.
        if (91 <= i <= 96) or i in EXTRA_NHVS:
            nhvs = T1[(i + 7) % len(T1)] if tier == 3 else {"name": f"PlantNHVS {i:03d}", "supplier_id": f"sup-nhvs-{i:04d}", "tier": 1, "zip": home_zip, "state": phys_state}
            for k in range(20):
                emit(npi, nhvs, "dme", ref - timedelta(days=2 + k), f"pat-{i:03d}-NHV{k}",
                     home_zip, False, phys_state,
                     hcpcs=random.choice(CODE_POOLS["dme"]["hcpcs"]),
                     amount=round(random.uniform(1500, 2500), 2))

        # ---- DUPLICATE BILLING (extra T1) ----
        # 3 same-patient/date/hcpcs pairs billed by two distinct synthetic suppliers
        # (unique to this physician) so CNS never fires.
        if "duplicate_billing" in pats or i in EXTRA_DB:
            sup_a = {"name": f"PlantDup-A {i:03d}", "supplier_id": f"sup-dupa-{i:04d}", "tier": 1, "zip": home_zip, "state": phys_state}
            sup_b = {"name": f"PlantDup-B {i:03d}", "supplier_id": f"sup-dupb-{i:04d}", "tier": 1, "zip": home_zip, "state": phys_state}
            for d in range(3):
                pid = f"pat-{i:03d}-DUP{d}"
                dup_date = ref - timedelta(days=10 + d)
                hcpcs_code = random.choice(CODE_POOLS["dme"]["hcpcs"])
                amt = round(random.uniform(600, 1500), 2)
                emit(npi, sup_a, "dme", dup_date, pid, home_zip, False, phys_state,
                     hcpcs=hcpcs_code, amount=amt)
                emit(npi, sup_b, "dme", dup_date, pid, home_zip, False, phys_state,
                     hcpcs=hcpcs_code, amount=amt)

    log.info(f"Built {len(rows)} claim rows across 100 physicians")

    execute_values(cur, """
        INSERT INTO claims
        (id, npi, patient_id, patient_name, patient_zip, patient_state,
         patient_lat, patient_lng, date_of_service, cpt_code, hcpcs_code,
         service_description, service_category, supplier_name, supplier_id,
         supplier_zip, supplier_state, claim_amount, plan_name, oig_flagged,
         reviewed, ingested_at, created_at)
        VALUES %s ON CONFLICT (id) DO NOTHING
    """, rows, template="(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,now(),now())")
    conn.commit()
    cur.execute("SELECT COUNT(*) FROM claims"); total = cur.fetchone()[0]
    log.info(f"Inserted claims; total now {total}")
    cur.close(); conn.close()
    print(f"GENERATE_EXPANDED COMPLETE — {len(rows)} claims for 100 physicians / 100 suppliers")


if __name__ == "__main__":
    main()
