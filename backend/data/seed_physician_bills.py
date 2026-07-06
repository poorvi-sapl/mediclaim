"""Seed physician_bills from claims data, tiered by physician coverage rate.

For each physician (by NPI tier), a fraction of their claims get a matching
PhysicianBill record.  The ghost_billing rule then flags claims with no match.

Coverage by tier:
  Tier 1 → 95%  (clean physicians — almost every claim has a bill on file)
  Tier 2 → 70%  (mid-risk — some gaps)
  Tier 3 → 30%  (high-risk — most claims have no bill → many ghost flags)

SynPUF ZIP files are read if present to enrich diagnosis codes; otherwise
DIAGNOSIS_BY_CATEGORY provides realistic ICD-10 codes per service category.
"""
import os
import sys
import json
import random
import hashlib
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv

BASE = Path(__file__).resolve().parent.parent.parent
load_dotenv(BASE / ".env")

SYNPUF_FILES = [
    BASE / "DE1_0_2008_to_2010_Carrier_Claims_Sample_1A.zip",
    BASE / "DE1_0_2008_to_2010_Carrier_Claims_Sample_1B.zip",
]

COVERAGE_BY_TIER = {
    1: 1.00,   # Tier-1 clean: 100% → zero ghost billing noise
    2: 0.70,   # Tier-2 mid: 70%
    3: 0.30,   # Tier-3 high risk: 30% → 70% trigger ghost billing
}

DIAGNOSIS_BY_CATEGORY = {
    "dme":         ["M79.3", "G89.29", "M54.5", "R26.9", "Z87.39", "M81.0", "G20"],
    "home_health": ["I63.9", "G81.90", "R54",   "M62.81", "Z74.01", "I50.9", "G35"],
    "hospice":     ["C78.9", "I50.9",  "G35",   "J44.1",  "C80.1",  "N18.6", "C34.90"],
    "drugs":       ["M05.79", "K50.90", "C90.00", "L40.50", "M06.9", "C20",  "J45.50"],
    "hospital":    ["E11.9",  "I10",    "J18.9",  "R07.9",  "K92.1", "N39.0", "Z23"],
}

SOURCES = ["synpuf_1a", "synpuf_1b"]

random.seed(42)

_DATE_START = date(2025, 1, 1)
_DATE_CAP   = date(2026, 6, 17)


def normalize_date(raw):
    """
    Convert SynPUF YYYYMMDD to a date within Jan 2025 - Jun 17 2026.
    Keeps month/day from SynPUF for realistic spread, shifts year.
    Also accepts an existing Python date object (from the claims table).
    """
    if isinstance(raw, date):
        return min(raw, _DATE_CAP)
    try:
        d = datetime.strptime(str(int(float(raw))), '%Y%m%d').date()
        target_year = 2026 if d.month <= 6 else 2025
        result = d.replace(year=target_year)
        return min(result, _DATE_CAP)
    except Exception:
        delta = (_DATE_CAP - _DATE_START).days
        return _DATE_START + timedelta(days=random.randint(0, delta))


def _synpuf_id_for(npi: str, patient_id: str) -> str:
    """Deterministic SynPUF-style hex ID from NPI + patient_id."""
    h = hashlib.sha1(f"{npi}|{patient_id}".encode()).hexdigest()
    return h[:16].upper()


def _read_synpuf_icd9() -> list[str]:
    """Sample up to 3 000 ICD-9 diagnosis codes from SynPUF files (optional enrichment)."""
    codes: list[str] = []
    for zip_path in SYNPUF_FILES:
        if not zip_path.exists():
            continue
        try:
            import zipfile
            import pandas as pd
            with zipfile.ZipFile(zip_path) as zf:
                csv_name = next((n for n in zf.namelist() if n.endswith(".csv")), None)
                if not csv_name:
                    continue
                with zf.open(csv_name) as f:
                    df = pd.read_csv(
                        f,
                        usecols=["ICD9_DGNS_CD_1"],
                        nrows=3000,
                        dtype=str,
                        low_memory=False,
                    )
                    codes.extend(df["ICD9_DGNS_CD_1"].dropna().tolist())
        except Exception as exc:
            print(f"  [SYNPUF] Could not read {zip_path.name}: {exc}")
    return codes


def main() -> None:
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    conn.autocommit = False
    cur = conn.cursor()

    # Load physician tier map from tiered_npis.json
    tiered_path = BASE / "scripts" / "tiered_npis.json"
    with open(tiered_path, encoding="utf-8") as f:
        tiered = json.load(f)
    npi_tier: dict[str, int] = {p["npi"]: p["tier"] for p in tiered["physicians"]}

    # Fetch all claims that have an HCPCS code (the basis for bill matching)
    cur.execute("""
        SELECT npi, patient_name, patient_id, date_of_service,
               hcpcs_code, service_category, claim_amount
        FROM claims
        WHERE hcpcs_code IS NOT NULL
        ORDER BY npi, date_of_service
    """)
    claim_rows = cur.fetchall()
    print(f"Found {len(claim_rows)} HCPCS-coded claims across all NPIs")

    # SynPUF ICD-9 pool for optional diagnosis-code variety
    synpuf_codes = _read_synpuf_icd9()
    if synpuf_codes:
        print(f"  Loaded {len(synpuf_codes)} SynPUF ICD-9 codes for enrichment")

    # Group claims by NPI
    claims_by_npi: dict[str, list] = defaultdict(list)
    for row in claim_rows:
        claims_by_npi[row[0]].append(row)

    rows: list[tuple] = []
    now = datetime.utcnow()

    for npi, npi_claims in claims_by_npi.items():
        tier = npi_tier.get(npi, 1)
        coverage = COVERAGE_BY_TIER.get(tier, 0.95)

        # Deterministic shuffle per NPI so re-runs are reproducible
        rng = random.Random(int(hashlib.sha1(npi.encode()).hexdigest(), 16) & 0xFFFFFFFF)
        shuffled = list(npi_claims)
        rng.shuffle(shuffled)

        n_covered = round(len(shuffled) * coverage)
        covered_claims = shuffled[:n_covered]

        for npi_, pname, pid, dos, hcpcs, cat, claim_amt in covered_claims:
            # Pick a diagnosis code: prefer SynPUF if available, else DIAGNOSIS_BY_CATEGORY
            diag_pool = DIAGNOSIS_BY_CATEGORY.get(cat, ["Z99.89"])
            if synpuf_codes and rng.random() < 0.4:
                diag = rng.choice(synpuf_codes)[:10]
            else:
                diag = rng.choice(diag_pool)

            # Bill amount: 40–60% of claim amount, bell-curve
            mean_frac = 0.50
            std_frac = 0.08
            frac = max(0.40, min(0.60, rng.gauss(mean_frac, std_frac)))
            bill_amount = round(float(claim_amt) * frac, 2)

            source = rng.choice(SOURCES)
            synpuf_id = _synpuf_id_for(npi_, pid)

            rows.append((
                npi_, pname, synpuf_id, normalize_date(dos),
                diag, hcpcs, bill_amount, source, now,
            ))

    print(f"Inserting {len(rows)} physician bill records (batch size 500)...")
    batch_size = 500
    n_batches = (len(rows) + batch_size - 1) // batch_size
    for idx in range(0, len(rows), batch_size):
        batch = rows[idx : idx + batch_size]
        execute_values(
            cur,
            """
            INSERT INTO physician_bills
              (npi, patient_name, patient_synpuf_id, service_date,
               diagnosis_code, hcpcs_code, bill_amount, source, created_at)
            VALUES %s
            """,
            batch,
            template="(%s, %s, %s, %s, %s, %s, %s, %s, %s)",
        )
        conn.commit()
        bn = idx // batch_size + 1
        if bn % 10 == 0 or bn == n_batches:
            print(f"  Batch {bn}/{n_batches} committed")

    cur.execute("SELECT COUNT(*) FROM physician_bills")
    total = cur.fetchone()[0]
    print(f"SEED_PHYSICIAN_BILLS COMPLETE — {total} records")
    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
