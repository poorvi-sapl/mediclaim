"""Replace the header row of the cleaned CSVs with snake_case names.

Streams the file (copies the body byte-for-byte after swapping line 1) so we
never hold the whole file in memory, then atomically replaces the original.
"""
import os

SNAKE_HEADER = (
    "npi,entity_type_code,organization_name,last_name,first_name,middle_name,"
    "credential_text,practice_address,practice_city,practice_state,"
    "practice_postal_code,enumeration_date,last_update_date,deactivation_date,"
    "sex_code,taxonomy_code,primary_taxonomy_switch\n"
)

FILES = [
    r"D:\Mediclaim\data\physicians_clean.csv",
    r"D:\Mediclaim\data\suppliers_clean.csv",
]

for path in FILES:
    tmp = path + ".tmp"
    with open(path, "r", encoding="utf-8", newline="") as src, \
         open(tmp, "w", encoding="utf-8", newline="") as dst:
        old_header = src.readline()  # discard original header
        dst.write(SNAKE_HEADER)
        # copy the rest of the body in large blocks
        while True:
            block = src.read(8 * 1024 * 1024)  # 8 MB
            if not block:
                break
            dst.write(block)
    os.replace(tmp, path)
    print(f"rewrote header: {path}")
    print(f"  old: {old_header.strip()[:80]}...")
    print(f"  new: {SNAKE_HEADER.strip()[:80]}...")
