import csv

for f in [r"D:\Mediclaim\data\physicians_clean.csv", r"D:\Mediclaim\data\suppliers_clean.csv"]:
    with open(f, encoding="utf-8", newline="") as fh:
        r = csv.reader(fh)
        header = next(r)
        first = next(r, None)
        n = 1 if first else 0
        n += sum(1 for _ in r)
    print(f"\n=== {f} ===")
    print(f"columns ({len(header)}): {header}")
    print(f"data rows: {n:,}")
    print(f"sample row: {first}")
