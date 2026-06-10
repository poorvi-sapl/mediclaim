"""
ClaimLens reference-data pipeline.

Runs all 5 tasks in sequence:
  T1  Analyze physicians_clean.csv, suppliers_clean.csv, UPDATED.csv (OIG LEIE)
  T2  Cross-reference each NPPES file against OIG (NPI exact + fuzzy name)
  T3  Emit 4 PostgreSQL-ready seed files
  T4  Emit CREATE TABLE + \copy SQL
  T5  Emit California-only subsets

Design notes:
  * NPPES files already carry snake_case headers from the prior step.
  * Files are streamed in 100k-row chunks; OIG (83k rows) is small -> in memory.
  * Fuzzy matching uses rapidfuzz token_sort_ratio >= 90, with first-character
    blocking on the name so the 692k x 83k space stays tractable. Blocking can
    miss a true match whose first normalized character differs (e.g. a typo in
    the leading letter); that trade-off is logged, not hidden.
"""

import os
import re
import csv
import sys
from collections import Counter, defaultdict

import numpy as np
import pandas as pd
from rapidfuzz import fuzz, process

DATA_DIR = r"D:\Mediclaim\data"
PHYS_IN = os.path.join(DATA_DIR, "physicians_clean.csv")
SUPP_IN = os.path.join(DATA_DIR, "suppliers_clean.csv")
OIG_IN = os.path.join(DATA_DIR, "UPDATED.csv")

CHUNK = 100_000
FUZZY_THRESHOLD = 90
QUERY_BATCH = 4000  # sub-batch size for cdist to bound memory

PHYS_TAXONOMY = {
    "207R00000X": "Internal Medicine",
    "207Q00000X": "Family Medicine",
    "208000000X": "Pediatrics",
    "207P00000X": "Emergency Medicine",
    "207V00000X": "Obstetrics & Gynecology",
    "207X00000X": "Orthopedic Surgery",
    "207RC0000X": "Cardiology",
    "2084N0400X": "Neurology",
    "208D00000X": "General Practice",
    "207RG0100X": "Gastroenterology",
    "207RH0000X": "Hematology & Oncology",
    "207RP1001X": "Pulmonary Disease",
    "207N00000X": "Dermatology",
    "207RN0300X": "Nephrology",
    "207T00000X": "Neurological Surgery",
    "207RH0003X": "Hospice & Palliative Medicine",
    "207RE0101X": "Endocrinology",
    "207RI0200X": "Infectious Disease",
    "207RR0500X": "Rheumatology",
    "207RS0010X": "Geriatric Medicine",
}

SUPP_TAXONOMY = {
    "332B00000X": "DME Supplier",
    "332BC3200X": "DME - Contact Lens",
    "332BN1400X": "DME - Nursing Facility",
    "332BP3500X": "DME - Prosthetics",
    "332BX2000X": "DME - Oxygen",
    "251E00000X": "Home Health Agency",
    "251G00000X": "Hospice Care",
    "251S00000X": "Community Hospice",
    "261QH0100X": "Home Health Clinic",
    "273R00000X": "Residential Treatment",
}

# coarse category for the supplier taxonomy report
SUPP_CATEGORY = {
    "332B00000X": "DME", "332BC3200X": "DME", "332BN1400X": "DME",
    "332BP3500X": "DME", "332BX2000X": "DME",
    "251E00000X": "Home Health", "261QH0100X": "Home Health",
    "251G00000X": "Hospice", "251S00000X": "Hospice",
    "273R00000X": "Residential Treatment",
}

_norm_re = re.compile(r"[^A-Z0-9 ]")


def norm_series(s: pd.Series) -> pd.Series:
    """Uppercase, drop punctuation, collapse whitespace."""
    return (
        s.str.upper()
        .str.replace(_norm_re, " ", regex=True)
        .str.replace(r"\s+", " ", regex=True)
        .str.strip()
    )


def build_blocks(norm_names):
    """Group normalized names into {first_char: np.array(names)} buckets."""
    blocks = defaultdict(list)
    for n in norm_names:
        if n:
            blocks[n[0]].append(n)
    return {k: np.array(v, dtype=object) for k, v in blocks.items()}


def fuzzy_any(query_norm: np.ndarray, blocks: dict) -> np.ndarray:
    """Boolean array: True where query has a token_sort_ratio >= 90 match."""
    res = np.zeros(len(query_norm), dtype=bool)
    groups = defaultdict(list)
    for i, q in enumerate(query_norm):
        if q:
            groups[q[0]].append(i)
    for k, idxs in groups.items():
        choices = blocks.get(k)
        if choices is None or len(choices) == 0:
            continue
        idxs = np.array(idxs)
        for start in range(0, len(idxs), QUERY_BATCH):
            sub = idxs[start:start + QUERY_BATCH]
            queries = [query_norm[i] for i in sub]
            scores = process.cdist(
                queries, choices,
                scorer=fuzz.token_sort_ratio,
                score_cutoff=FUZZY_THRESHOLD,
                dtype=np.uint8, workers=-1,
            )
            hit = scores.max(axis=1) > 0  # below-cutoff scores are zeroed
            res[sub[hit]] = True
    return res


def fmt_oig_date(d: str) -> str:
    """OIG YYYYMMDD -> YYYY-MM-DD; blanks/zeros -> ''."""
    d = (d or "").strip()
    if len(d) == 8 and d.isdigit() and d != "00000000":
        return f"{d[0:4]}-{d[4:6]}-{d[6:8]}"
    return ""


def append_csv(df: pd.DataFrame, path: str, written: dict):
    df.to_csv(path, mode="a", index=False,
              header=not written.get(path, False), encoding="utf-8",
              quoting=csv.QUOTE_MINIMAL)
    written[path] = True


def hr(title):
    print("\n" + "=" * 70)
    print(title)
    print("=" * 70)


# ===========================================================================
# OIG load + analysis (Task 1c) + build matching structures (Task 2)
# ===========================================================================
def load_oig():
    hr("TASK 1c — OIG LEIE (UPDATED.csv)")
    oig = pd.read_csv(OIG_IN, dtype=str, na_filter=False)
    total = len(oig)
    print(f"Total records : {total:,}")
    print(f"Columns ({len(oig.columns)}): {list(oig.columns)}")
    print("Sample rows:")
    print(oig.head(3).to_string())

    has_npi = (oig["NPI"].str.strip() != "") & (oig["NPI"].str.strip() != "0000000000")
    valid_npi = oig[has_npi]
    print(f"\nValid NPI (not 0000000000): {has_npi.sum():,}")
    print(f"Placeholder NPI 0000000000 : {(~has_npi).sum():,}")

    is_org = oig["BUSNAME"].str.strip() != ""
    print(f"Organization records (BUSNAME present): {is_org.sum():,}")
    print(f"Individual records  (LASTNAME present): {(oig['LASTNAME'].str.strip() != '').sum():,}")

    print("\nExclusion type (EXCLTYPE) breakdown:")
    for k, v in oig["EXCLTYPE"].value_counts().items():
        print(f"  {k:<10} {v:,}")

    print("\nTop 15 specialties (SPECIALTY) — fraud-relevant view:")
    for k, v in oig["SPECIALTY"].value_counts().head(15).items():
        print(f"  {str(k)[:45]:<45} {v:,}")

    print(f"\nCalifornia (STATE = CA): {(oig['STATE'].str.strip().str.upper() == 'CA').sum():,}")

    # matching structures (use full OIG set per entity kind)
    npi_set = set(valid_npi["NPI"].str.strip())
    org_blocks = build_blocks(norm_series(oig.loc[is_org, "BUSNAME"]))
    ind_mask = oig["LASTNAME"].str.strip() != ""
    ind_names = norm_series(
        oig.loc[ind_mask, "LASTNAME"].str.cat(oig.loc[ind_mask, "FIRSTNAME"], sep=" ")
    )
    ind_blocks = build_blocks(ind_names)
    return oig, has_npi, is_org, npi_set, org_blocks, ind_blocks


# ===========================================================================
# Generic NPPES pass: analyze + match + write seed + flagged + CA subset
# ===========================================================================
def process_nppes(kind, in_path, npi_set, name_blocks, written):
    is_phys = kind == "physician"
    label = "physicians" if is_phys else "suppliers"
    hr(f"TASK 1{'a' if is_phys else 'b'} — {label}_clean.csv  +  TASK 2 matching")

    seed_path = os.path.join(DATA_DIR, "npi_profiles_seed.csv" if is_phys else "supplier_profiles_seed.csv")
    flag_tmp = in_path + ".tmp"
    ca_path = os.path.join(DATA_DIR, "ca_physicians_seed.csv" if is_phys else "ca_suppliers_seed.csv")
    taxmap = PHYS_TAXONOMY if is_phys else SUPP_TAXONOMY

    state_col = "practice_state"
    tax_col = "taxonomy_code"

    total = 0
    npi_hits = 0
    fuzzy_hits = 0
    excluded = 0
    ca_count = 0
    state_ctr = Counter()
    tax_ctr = Counter()
    cat_ctr = Counter()  # suppliers only
    missing = Counter()
    sample = None

    for chunk in pd.read_csv(in_path, dtype=str, na_filter=False, chunksize=CHUNK):
        n = len(chunk)
        total += n
        if sample is None:
            sample = chunk.head(3).copy()

        # ---- Task 1 analysis ----
        state_ctr.update(chunk[state_col].str.strip().str.upper().values)
        tax_ctr.update(chunk[tax_col].values)
        if not is_phys:
            cat_ctr.update(chunk[tax_col].map(lambda t: SUPP_CATEGORY.get(t, "Other")).values)
        for c in ["npi", "practice_address", "practice_city", state_col,
                  "practice_postal_code", "enumeration_date"]:
            missing[c] += int((chunk[c].str.strip() == "").sum())
        if is_phys:
            missing["last_name"] += int((chunk["last_name"].str.strip() == "").sum())
            missing["first_name"] += int((chunk["first_name"].str.strip() == "").sum())
        else:
            missing["organization_name"] += int((chunk["organization_name"].str.strip() == "").sum())

        # ---- Task 2: NPI exact, then fuzzy on the remainder ----
        npi_match = chunk["npi"].str.strip().isin(npi_set).values
        if is_phys:
            qn = norm_series(chunk["last_name"].str.cat(chunk["first_name"], sep=" ")).values
        else:
            qn = norm_series(chunk["organization_name"]).values
        remaining = ~npi_match
        fuzzy_match = np.zeros(n, dtype=bool)
        if remaining.any():
            sub_q = np.where(remaining, qn, "")  # blank out already-matched
            fuzzy_match = fuzzy_any(sub_q, name_blocks)
        oig_excluded = npi_match | fuzzy_match

        npi_hits += int(npi_match.sum())
        fuzzy_hits += int(fuzzy_match.sum())
        excluded += int(oig_excluded.sum())

        excl_str = pd.Series(np.where(oig_excluded, "True", "False"), index=chunk.index)

        # ---- Task 3: seed file ----
        zip5 = chunk["practice_postal_code"].str.replace(r"\D", "", regex=True).str[:5]
        if is_phys:
            mid = chunk["middle_name"].str.strip()
            name = ("Dr. " + chunk["first_name"].str.strip()
                    + np.where(mid != "", " " + mid, "")
                    + " " + chunk["last_name"].str.strip())
            name = name.str.replace(r"\s+", " ", regex=True).str.strip()
            seed = pd.DataFrame({
                "npi": chunk["npi"],
                "physician_name": name,
                "specialty": chunk[tax_col].map(lambda t: taxmap.get(t, "Other")),
                "practice_address": chunk["practice_address"],
                "practice_city": chunk["practice_city"],
                "practice_state": chunk["practice_state"],
                "practice_zip": zip5,
                "enrollment_date": chunk["enumeration_date"],
                "last_update": chunk["last_update_date"],
                "oig_excluded": excl_str,
            })
            ca_state_col = "practice_state"
        else:
            seed = pd.DataFrame({
                "npi": chunk["npi"],
                "supplier_name": chunk["organization_name"],
                "supplier_type": chunk[tax_col].map(lambda t: taxmap.get(t, "Other")),
                "address": chunk["practice_address"],
                "city": chunk["practice_city"],
                "state": chunk["practice_state"],
                "zip": zip5,
                "enrollment_date": chunk["enumeration_date"],
                "last_update": chunk["last_update_date"],
                "oig_excluded": excl_str,
            })
            ca_state_col = "state"

        append_csv(seed, seed_path, written)

        # ---- Task 2 Step 3: original file + oig_excluded ----
        flagged = chunk.copy()
        flagged["oig_excluded"] = excl_str
        append_csv(flagged, flag_tmp, written)

        # ---- Task 5: California subset ----
        ca = seed[seed[ca_state_col].str.strip().str.upper() == "CA"]
        ca_count += len(ca)
        if not ca.empty:
            append_csv(ca, ca_path, written)

        if total % 500_000 == 0 or total == n:
            print(f"  ...processed {total:,} {label}")

    os.replace(flag_tmp, in_path)  # finalize the flagged in-place file

    # -------- report --------
    print(f"\nTotal records : {total:,}")
    print(f"Columns: {list(sample.columns)}")
    print("Sample rows:")
    print(sample.to_string())

    print("\nTop 10 states:")
    for st, c in state_ctr.most_common(10):
        print(f"  {st or '(blank)':<8} {c:,}")

    print("\nBreakdown by taxonomy code:")
    for t, c in tax_ctr.most_common():
        print(f"  {t:<12} {taxmap.get(t, '?'):<32} {c:,}")

    if not is_phys:
        print("\nBreakdown by category (DME / Home Health / Hospice):")
        for cat, c in cat_ctr.most_common():
            print(f"  {cat:<22} {c:,}")

    print(f"\nCalifornia {label}: {ca_count:,}")

    print("\nData quality (blank counts):")
    for c, v in missing.items():
        flag = "" if v == 0 else "  <-- attention" if v > total * 0.05 else ""
        print(f"  {c:<22} {v:,}{flag}")

    print(f"\nOIG cross-reference ({label}):")
    print(f"  NPI exact matches      : {npi_hits:,}")
    print(f"  Fuzzy name matches     : {fuzzy_hits:,}")
    print(f"  Total oig_excluded=True: {excluded:,}")

    return {"total": total, "npi_hits": npi_hits, "fuzzy_hits": fuzzy_hits,
            "excluded": excluded, "ca": ca_count, "seed": seed_path, "ca_path": ca_path}


# ===========================================================================
# Task 3 (files 3 & 4): OIG seed files
# ===========================================================================
def write_oig_seeds(oig, has_npi, is_org):
    hr("TASK 3 — oig_excluded_npis.csv  &  oig_excluded_names.csv")
    entity_name = np.where(
        is_org.values, oig["BUSNAME"].str.strip(),
        (oig["LASTNAME"].str.strip() + " " + oig["FIRSTNAME"].str.strip()).str.strip()
    )
    base = pd.DataFrame({
        "npi": oig["NPI"].str.strip(),
        "entity_name": entity_name,
        "exclusion_type": oig["EXCLTYPE"].str.strip(),
        "exclusion_date": oig["EXCLDATE"].map(fmt_oig_date),
        "specialty": oig["SPECIALTY"].str.strip(),
        "state": oig["STATE"].str.strip().str.upper(),
    })

    with_npi = base[has_npi.values].drop_duplicates(subset=["npi"])
    without_npi = base[~has_npi.values].drop(columns=["npi"])

    p1 = os.path.join(DATA_DIR, "oig_excluded_npis.csv")
    p2 = os.path.join(DATA_DIR, "oig_excluded_names.csv")
    with_npi.to_csv(p1, index=False, encoding="utf-8")
    without_npi.to_csv(p2, index=False, encoding="utf-8")
    print(f"oig_excluded_npis.csv  : {len(with_npi):,} rows (valid NPI, deduped)")
    print(f"oig_excluded_names.csv : {len(without_npi):,} rows (name-only)")
    return {"npis": len(with_npi), "names": len(without_npi)}


# ===========================================================================
# Task 4: SQL
# ===========================================================================
def write_sql():
    hr("TASK 4 — PostgreSQL schema + load script")
    sql = r"""-- ClaimLens seed load script (run with psql -f)
-- Source dates: NPPES enrollment/last_update are MM/DD/YYYY; OIG dates pre-converted to ISO.
SET datestyle TO 'ISO, MDY';

DROP TABLE IF EXISTS npi_profiles;
CREATE TABLE npi_profiles (
    npi              VARCHAR(10) PRIMARY KEY,
    physician_name   TEXT,
    specialty        TEXT,
    practice_address TEXT,
    practice_city    TEXT,
    practice_state   VARCHAR(2),
    practice_zip     VARCHAR(5),
    enrollment_date  DATE,
    last_update      DATE,
    oig_excluded     BOOLEAN
);

DROP TABLE IF EXISTS supplier_profiles;
CREATE TABLE supplier_profiles (
    npi             VARCHAR(10) PRIMARY KEY,
    supplier_name   TEXT,
    supplier_type   TEXT,
    address         TEXT,
    city            TEXT,
    state           VARCHAR(2),
    zip             VARCHAR(5),
    enrollment_date DATE,
    last_update     DATE,
    oig_excluded    BOOLEAN
);

DROP TABLE IF EXISTS oig_excluded_npis;
CREATE TABLE oig_excluded_npis (
    npi            VARCHAR(10) PRIMARY KEY,
    entity_name    TEXT,
    exclusion_type TEXT,
    exclusion_date DATE,
    specialty      TEXT,
    state          VARCHAR(2)
);

DROP TABLE IF EXISTS oig_excluded_names;
CREATE TABLE oig_excluded_names (
    entity_name    TEXT,
    exclusion_type TEXT,
    exclusion_date DATE,
    specialty      TEXT,
    state          VARCHAR(2)
);

\copy npi_profiles       FROM 'D:/Mediclaim/data/npi_profiles_seed.csv'      WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')
\copy supplier_profiles  FROM 'D:/Mediclaim/data/supplier_profiles_seed.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')
\copy oig_excluded_npis  FROM 'D:/Mediclaim/data/oig_excluded_npis.csv'      WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')
\copy oig_excluded_names FROM 'D:/Mediclaim/data/oig_excluded_names.csv'     WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')

-- Helpful indexes for fraud lookups
CREATE INDEX idx_npi_profiles_state    ON npi_profiles (practice_state);
CREATE INDEX idx_npi_profiles_excluded ON npi_profiles (oig_excluded);
CREATE INDEX idx_supplier_state        ON supplier_profiles (state);
CREATE INDEX idx_supplier_excluded     ON supplier_profiles (oig_excluded);
CREATE INDEX idx_oig_names_name        ON oig_excluded_names (entity_name);

SELECT 'npi_profiles' t, count(*) FROM npi_profiles
UNION ALL SELECT 'supplier_profiles', count(*) FROM supplier_profiles
UNION ALL SELECT 'oig_excluded_npis', count(*) FROM oig_excluded_npis
UNION ALL SELECT 'oig_excluded_names', count(*) FROM oig_excluded_names;
"""
    path = os.path.join(DATA_DIR, "claimlens_load.sql")
    with open(path, "w", encoding="utf-8") as f:
        f.write(sql)
    print(f"Wrote {path}")
    return path


def main():
    # fresh outputs
    for f in ["npi_profiles_seed.csv", "supplier_profiles_seed.csv",
              "oig_excluded_npis.csv", "oig_excluded_names.csv",
              "ca_physicians_seed.csv", "ca_suppliers_seed.csv"]:
        p = os.path.join(DATA_DIR, f)
        if os.path.exists(p):
            os.remove(p)

    written = {}
    oig, has_npi, is_org, npi_set, org_blocks, ind_blocks = load_oig()
    phys = process_nppes("physician", PHYS_IN, npi_set, ind_blocks, written)
    supp = process_nppes("supplier", SUPP_IN, npi_set, org_blocks, written)
    oig_counts = write_oig_seeds(oig, has_npi, is_org)
    write_sql()

    hr("FINAL SUMMARY")
    print(f"Physicians            : {phys['total']:,}  (CA: {phys['ca']:,})")
    print(f"  OIG excluded        : {phys['excluded']:,}  (NPI {phys['npi_hits']:,} + fuzzy {phys['fuzzy_hits']:,})")
    print(f"Suppliers             : {supp['total']:,}  (CA: {supp['ca']:,})")
    print(f"  OIG excluded        : {supp['excluded']:,}  (NPI {supp['npi_hits']:,} + fuzzy {supp['fuzzy_hits']:,})")
    print(f"oig_excluded_npis.csv : {oig_counts['npis']:,}")
    print(f"oig_excluded_names.csv: {oig_counts['names']:,}")
    print("\nOutput files in", DATA_DIR + ":")
    for f in ["npi_profiles_seed.csv", "supplier_profiles_seed.csv",
              "oig_excluded_npis.csv", "oig_excluded_names.csv",
              "ca_physicians_seed.csv", "ca_suppliers_seed.csv",
              "claimlens_load.sql", "physicians_clean.csv (now + oig_excluded)",
              "suppliers_clean.csv (now + oig_excluded)"]:
        print("  -", f)


if __name__ == "__main__":
    main()
