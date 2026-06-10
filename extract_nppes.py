"""
Extract & split the NPPES NPI Registry monthly file into clean PHYSICIAN and
SUPPLIER CSVs ready for PostgreSQL loading.

- Streams the ~11GB source in 100,000-row chunks (never loads it all at once).
- Reads every column as string to avoid dtype/parsing errors.
- Keeps only ACTIVE records (NPI Deactivation Date is null/blank).
- Splits by Entity Type Code + Healthcare Provider Taxonomy Code_1.
"""

import os
import sys
import pandas as pd

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
INPUT_FILE = r"D:\Mediclaim\data\npidata_pfile_20050523-20260510.csv"
OUT_DIR = os.path.dirname(INPUT_FILE)
PHYSICIANS_OUT = os.path.join(OUT_DIR, "physicians_clean.csv")
SUPPLIERS_OUT = os.path.join(OUT_DIR, "suppliers_clean.csv")

CHUNKSIZE = 100_000
PROGRESS_EVERY = 1_000_000  # rows

# ---------------------------------------------------------------------------
# Columns to keep (exact NPPES header names)
# ---------------------------------------------------------------------------
COLUMNS = [
    "NPI",
    "Entity Type Code",
    "Provider Organization Name (Legal Business Name)",
    "Provider Last Name (Legal Name)",
    "Provider First Name",
    "Provider Middle Name",
    "Provider Credential Text",
    "Provider First Line Business Practice Location Address",
    "Provider Business Practice Location Address City Name",
    "Provider Business Practice Location Address State Name",
    "Provider Business Practice Location Address Postal Code",
    "Provider Enumeration Date",
    "Last Update Date",
    "NPI Deactivation Date",
    "Provider Sex Code",
    "Healthcare Provider Taxonomy Code_1",
    "Healthcare Provider Primary Taxonomy Switch_1",
]

ENTITY_COL = "Entity Type Code"
TAXONOMY_COL = "Healthcare Provider Taxonomy Code_1"
DEACT_COL = "NPI Deactivation Date"

PHYSICIAN_TAXONOMIES = {
    "207R00000X", "208000000X", "207Q00000X", "207RC0000X", "207RG0100X",
    "207RH0000X", "207RP1001X", "208D00000X", "207P00000X", "207X00000X",
    "207N00000X", "207RN0300X", "207V00000X", "207T00000X", "2084N0400X",
    "207RH0003X", "207RE0101X", "207RI0200X", "207RR0500X", "207RS0010X",
}

SUPPLIER_TAXONOMIES = {
    "332B00000X", "332BC3200X", "332BN1400X", "332BP3500X", "332BX2000X",
    "251E00000X", "251G00000X", "251S00000X", "261QH0100X", "273R00000X",
}


def main():
    if not os.path.exists(INPUT_FILE):
        sys.exit(f"ERROR: input file not found: {INPUT_FILE}")

    total_rows = 0
    physician_count = 0
    supplier_count = 0
    physicians_header_written = False
    suppliers_header_written = False
    next_progress = PROGRESS_EVERY

    # Remove any stale outputs from a previous run so we start clean.
    for f in (PHYSICIANS_OUT, SUPPLIERS_OUT):
        if os.path.exists(f):
            os.remove(f)

    reader = pd.read_csv(
        INPUT_FILE,
        usecols=COLUMNS,
        dtype=str,
        chunksize=CHUNKSIZE,
        encoding="utf-8",
        encoding_errors="replace",
        na_filter=False,        # keep blanks as "" instead of NaN -> simpler, cleaner CSV
        low_memory=False,
    )

    print(f"Reading: {INPUT_FILE}")
    print(f"Output dir: {OUT_DIR}\n")

    for chunk in reader:
        total_rows += len(chunk)

        # Reorder columns to the requested order (usecols ignores order).
        chunk = chunk[COLUMNS]

        # ACTIVE only: NPI Deactivation Date is null/blank.
        deact = chunk[DEACT_COL].fillna("").str.strip()
        active = chunk[deact == ""]

        entity = active[ENTITY_COL].str.strip()
        taxonomy = active[TAXONOMY_COL].str.strip()

        # Physicians: Entity Type Code == 1 and taxonomy in physician set.
        phys = active[(entity == "1") & (taxonomy.isin(PHYSICIAN_TAXONOMIES))]
        if not phys.empty:
            phys.to_csv(
                PHYSICIANS_OUT,
                mode="a",
                index=False,
                header=not physicians_header_written,
                encoding="utf-8",
            )
            physicians_header_written = True
            physician_count += len(phys)

        # Suppliers: Entity Type Code == 2 and taxonomy in supplier set.
        supp = active[(entity == "2") & (taxonomy.isin(SUPPLIER_TAXONOMIES))]
        if not supp.empty:
            supp.to_csv(
                SUPPLIERS_OUT,
                mode="a",
                index=False,
                header=not suppliers_header_written,
                encoding="utf-8",
            )
            suppliers_header_written = True
            supplier_count += len(supp)

        # Progress every ~1M rows processed.
        if total_rows >= next_progress:
            print(
                f"  Processed {total_rows:,} rows | "
                f"physicians: {physician_count:,} | suppliers: {supplier_count:,}"
            )
            # advance to the next 1M boundary at/after total_rows
            while next_progress <= total_rows:
                next_progress += PROGRESS_EVERY

    # If a category produced zero rows, still emit a header-only file so the
    # PostgreSQL load step always has a well-formed CSV to point at.
    if not physicians_header_written:
        pd.DataFrame(columns=COLUMNS).to_csv(PHYSICIANS_OUT, index=False, encoding="utf-8")
    if not suppliers_header_written:
        pd.DataFrame(columns=COLUMNS).to_csv(SUPPLIERS_OUT, index=False, encoding="utf-8")

    print("\n" + "=" * 60)
    print("DONE")
    print(f"  Total rows processed : {total_rows:,}")
    print(f"  Physicians extracted : {physician_count:,}  -> {PHYSICIANS_OUT}")
    print(f"  Suppliers  extracted : {supplier_count:,}  -> {SUPPLIERS_OUT}")
    print("=" * 60)


if __name__ == "__main__":
    main()
