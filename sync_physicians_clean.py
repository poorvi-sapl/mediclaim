"""Re-sync physicians_clean.csv oig_excluded to the strict values in
npi_profiles_seed.csv (the authoritative strict result)."""
import os
import csv

DATA_DIR = r"D:\Mediclaim\data"
SEED = os.path.join(DATA_DIR, "npi_profiles_seed.csv")
CLEAN = os.path.join(DATA_DIR, "physicians_clean.csv")

# 1. Collect strict-excluded NPIs from the seed file.
excluded = set()
with open(SEED, "r", encoding="utf-8", newline="") as f:
    r = csv.reader(f)
    h = next(r)
    i_npi, i_excl = h.index("npi"), h.index("oig_excluded")
    for row in r:
        if row[i_excl] == "True":
            excluded.add(row[i_npi].strip())
print(f"Strict-excluded NPIs from seed: {len(excluded):,}")

# 2. Patch physicians_clean.csv.
tmp = CLEAN + ".tmp"
rows = changed = true_ct = 0
with open(CLEAN, "r", encoding="utf-8", newline="") as fin, \
     open(tmp, "w", encoding="utf-8", newline="") as fout:
    r = csv.reader(fin)
    w = csv.writer(fout)
    h = next(r)
    i_npi, i_excl = h.index("npi"), h.index("oig_excluded")
    w.writerow(h)
    for row in r:
        rows += 1
        new = "True" if row[i_npi].strip() in excluded else "False"
        if new != row[i_excl]:
            changed += 1
        row[i_excl] = new
        if new == "True":
            true_ct += 1
        w.writerow(row)
os.replace(tmp, CLEAN)
print(f"physicians_clean.csv: {rows:,} rows, {changed:,} flags changed, {true_ct:,} now True")
