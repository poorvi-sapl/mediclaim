"""
Stricter re-match of physicians against OIG LEIE, then patch the
oig_excluded column in npi_profiles_seed.csv and ca_physicians_seed.csv.

Fuzzy rules (in addition to NPI-exact identity match, which is kept as-is):
  1. physician STATE must equal OIG STATE
  2. token_sort_ratio on "LAST FIRST" must be >= 95
  3. first letter of physician first name must equal first letter of OIG FIRSTNAME
  4. OIG records with specialty NURSE/NURSES AIDE, PERSONAL CARE PROVID, or
     HEALTH CARE AIDE are not eligible (not physicians)

Constraints 1 and 3 are enforced via the blocking key (state, last_init,
first_init), so every candidate compared already satisfies them.
"""

import os
import re
import csv
from collections import defaultdict

import numpy as np
import pandas as pd
from rapidfuzz import fuzz, process

DATA_DIR = r"D:\Mediclaim\data"
PHYS_IN = os.path.join(DATA_DIR, "physicians_clean.csv")
OIG_IN = os.path.join(DATA_DIR, "UPDATED.csv")
SEED = os.path.join(DATA_DIR, "npi_profiles_seed.csv")
CA_SEED = os.path.join(DATA_DIR, "ca_physicians_seed.csv")

CHUNK = 100_000
THRESHOLD = 95
QUERY_BATCH = 4000
EXCLUDE_SPEC = {"NURSE/NURSES AIDE", "PERSONAL CARE PROVID", "HEALTH CARE AIDE"}

_norm_re = re.compile(r"[^A-Z0-9 ]")


def norm_series(s: pd.Series) -> pd.Series:
    return (s.str.upper()
             .str.replace(_norm_re, " ", regex=True)
             .str.replace(r"\s+", " ", regex=True)
             .str.strip())


def build_oig():
    oig = pd.read_csv(OIG_IN, dtype=str, na_filter=False)

    # NPI-exact set (unchanged from prior run)
    npi = oig["NPI"].str.strip()
    npi_set = set(npi[(npi != "") & (npi != "0000000000")])

    # eligible individuals for fuzzy: has last name, specialty not excluded
    spec = oig["SPECIALTY"].str.strip().str.upper()
    mask = (oig["LASTNAME"].str.strip() != "") & (~spec.isin(EXCLUDE_SPEC))
    sub = oig[mask]

    name = norm_series(sub["LASTNAME"].str.cat(sub["FIRSTNAME"], sep=" ")).values
    last_init = norm_series(sub["LASTNAME"]).str[:1].values
    first_init = norm_series(sub["FIRSTNAME"]).str[:1].values
    state = sub["STATE"].str.strip().str.upper().values

    blocks = defaultdict(list)
    for i in range(len(sub)):
        li, fi, st, nm = last_init[i], first_init[i], state[i], name[i]
        if li and fi and st and nm:
            blocks[(st, li, fi)].append(nm)
    blocks = {k: np.array(v, dtype=object) for k, v in blocks.items()}

    dropped = (oig["LASTNAME"].str.strip() != "").sum() - mask.sum()
    print(f"OIG valid NPIs                 : {len(npi_set):,}")
    print(f"OIG eligible individuals       : {mask.sum():,}")
    print(f"OIG individuals dropped (spec) : {dropped:,}")
    print(f"OIG blocking buckets           : {len(blocks):,}")
    return npi_set, blocks


def fuzzy_match(qname, qstate, qli, qfi, blocks):
    res = np.zeros(len(qname), dtype=bool)
    groups = defaultdict(list)
    for i in range(len(qname)):
        if qname[i] and qstate[i] and qli[i] and qfi[i]:
            groups[(qstate[i], qli[i], qfi[i])].append(i)
    for key, idxs in groups.items():
        choices = blocks.get(key)
        if choices is None or len(choices) == 0:
            continue
        idxs = np.array(idxs)
        for start in range(0, len(idxs), QUERY_BATCH):
            sub = idxs[start:start + QUERY_BATCH]
            queries = [qname[i] for i in sub]
            scores = process.cdist(queries, choices,
                                   scorer=fuzz.token_sort_ratio,
                                   score_cutoff=THRESHOLD,
                                   dtype=np.uint8, workers=-1)
            hit = scores.max(axis=1) > 0
            res[sub[hit]] = True
    return res


def main():
    print("=" * 60)
    print("Stricter physician OIG re-match (state + 95 + first-initial + specialty filter)")
    print("=" * 60)
    npi_set, blocks = build_oig()

    excluded = set()
    total = npi_hits = fuzzy_hits = both = 0

    for chunk in pd.read_csv(PHYS_IN, dtype=str, na_filter=False, chunksize=CHUNK):
        total += len(chunk)
        npi = chunk["npi"].str.strip()
        npi_match = npi.isin(npi_set).values

        qname = norm_series(chunk["last_name"].str.cat(chunk["first_name"], sep=" ")).values
        qstate = chunk["practice_state"].str.strip().str.upper().values
        qli = norm_series(chunk["last_name"]).str[:1].values
        qfi = norm_series(chunk["first_name"]).str[:1].values

        remaining = ~npi_match
        fz = np.zeros(len(chunk), dtype=bool)
        if remaining.any():
            qn = np.where(remaining, qname, "")
            fz = fuzzy_match(qn, qstate, qli, qfi, blocks)

        excl = npi_match | fz
        npi_hits += int(npi_match.sum())
        fuzzy_hits += int(fz.sum())
        both += int(excl.sum())
        excluded.update(npi[excl].values)

        if total % 200_000 == 0:
            print(f"  ...processed {total:,} physicians | excluded so far {len(excluded):,}")

    print(f"\nProcessed physicians   : {total:,}")
    print(f"  NPI exact matches    : {npi_hits:,}")
    print(f"  Fuzzy matches (strict): {fuzzy_hits:,}")
    print(f"  Total oig_excluded   : {both:,}")

    # ---- patch the two seed files ----
    for path, label in [(SEED, "npi_profiles_seed.csv"), (CA_SEED, "ca_physicians_seed.csv")]:
        tmp = path + ".tmp"
        rows = changed = 0
        with open(path, "r", encoding="utf-8", newline="") as fin, \
             open(tmp, "w", encoding="utf-8", newline="") as fout:
            r = csv.reader(fin)
            w = csv.writer(fout)
            header = next(r)
            w.writerow(header)
            i_npi = header.index("npi")
            i_excl = header.index("oig_excluded")
            for row in r:
                rows += 1
                new = "True" if row[i_npi].strip() in excluded else "False"
                if new != row[i_excl]:
                    changed += 1
                row[i_excl] = new
                w.writerow(row)
        os.replace(tmp, path)
        print(f"Patched {label}: {rows:,} rows, {changed:,} flags changed")

    print(f"\nFinal strict excluded physicians: {both:,}")


if __name__ == "__main__":
    main()
