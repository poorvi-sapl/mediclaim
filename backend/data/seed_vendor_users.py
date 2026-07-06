"""
Seed 11 vendor user accounts (10 real + 1 demo).

Distribution:
  4 DME          — synthetic NPIs 1999000002, 1999000004, 1999000012, 1999000014
  3 HOME_HEALTH  — synthetic NPIs 1999000001, 1999000003, 1999000005
  3 HOSPICE      — synthetic 1999000008, 1999000015 + real 1003290032
  1 demo         — vendor@mediclaim.com, NPI 1999000002 (first DME)

Run from project root:
  python -m backend.data.seed_vendor_users
"""

import os
import sys
import psycopg2
from dotenv import load_dotenv

load_dotenv(r"D:\Mediclaim\.env")

# Dev password — same for all vendor accounts.
DEV_PASSWORD = "VendorPass123!"

# NPIs to seed (order: 4 DME, 3 HOME_HEALTH, 3 HOSPICE)
VENDOR_NPIS = [
    "1999000002",  # DME
    "1999000004",  # DME
    "1999000012",  # DME
    "1999000014",  # DME
    "1999000001",  # HOME_HEALTH
    "1999000003",  # HOME_HEALTH
    "1999000005",  # HOME_HEALTH
    "1999000008",  # HOSPICE
    "1999000015",  # HOSPICE
    "1003290032",  # HOSPICE (real)
]

DEMO_NPI   = "1999000002"   # first DME supplier
DEMO_EMAIL = "vendor@mediclaim.com"


def _hash(password: str) -> str:
    import bcrypt
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def main():
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("ERROR: DATABASE_URL not set", file=sys.stderr)
        sys.exit(1)

    conn = psycopg2.connect(db_url)
    cur  = conn.cursor()

    # Pull supplier details for the chosen NPIs.
    npi_placeholders = ",".join(["%s"] * len(VENDOR_NPIS))
    cur.execute(
        f"""
        SELECT npi, supplier_name, supplier_type, contact_email, contact_name
        FROM supplier_profiles
        WHERE npi IN ({npi_placeholders})
          AND contact_email IS NOT NULL
        """,
        VENDOR_NPIS,
    )
    suppliers = {row[0]: row for row in cur.fetchall()}

    missing = [n for n in VENDOR_NPIS if n not in suppliers]
    if missing:
        print(f"WARNING: {len(missing)} NPIs not found or missing contact_email: {missing}")

    pw_hash = _hash(DEV_PASSWORD)
    seeded  = []

    for npi in VENDOR_NPIS:
        if npi not in suppliers:
            continue
        _, supplier_name, supplier_type, contact_email, contact_name = suppliers[npi]

        cur.execute(
            """
            INSERT INTO users
              (id, email, password_hash, role, full_name, npi, created_at)
            VALUES
              (gen_random_uuid(), %s, %s, 'vendor', %s, %s, NOW())
            ON CONFLICT (email) DO NOTHING
            """,
            (contact_email, pw_hash, contact_name, npi),
        )
        seeded.append((supplier_name, contact_email, npi, supplier_type))

    # Demo row — vendor@mediclaim.com
    demo_supplier = suppliers.get(DEMO_NPI)
    demo_name     = demo_supplier[4] if demo_supplier else "Demo Vendor User"
    cur.execute(
        """
        INSERT INTO users
          (id, email, password_hash, role, full_name, npi, created_at)
        VALUES
          (gen_random_uuid(), %s, %s, 'vendor', %s, %s, NOW())
        ON CONFLICT (email) DO NOTHING
        """,
        (DEMO_EMAIL, pw_hash, demo_name, DEMO_NPI),
    )
    seeded.append(("Demo Vendor", DEMO_EMAIL, DEMO_NPI, "DME"))

    conn.commit()
    conn.close()

    print(f"Seeded {len(seeded)} vendor users:")
    for supplier_name, email, npi, stype in seeded:
        print(f"  {supplier_name:<40}  {email:<45}  NPI={npi}  ({stype})")


if __name__ == "__main__":
    main()
