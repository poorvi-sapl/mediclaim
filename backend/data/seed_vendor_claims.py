"""
Seed the 5 vendor columns on claims from supplier_profiles.

For each distinct supplier_name in claims:
  Pass 1 — name + state match (covers 71 real suppliers)
  Pass 2 — name-only match fallback (covers the 20 synthetic ones
            whose state stored as '00000' zip, state varies)

All 91 unique supplier_names in claims should resolve.
"""

import sys
import os

# Allow running as: python -m backend.data.seed_vendor_claims
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

import psycopg2
from backend.config import get_settings
from backend.utils.supplier_utils import normalize_vendor_type

settings = get_settings()

conn = psycopg2.connect(settings.database_url)
conn.autocommit = False
cur = conn.cursor()

# ── Step A: get all distinct supplier_name + state combos from claims ──
cur.execute("""
    SELECT DISTINCT vendor_name, vendor_state, vendor_id
    FROM claims
    ORDER BY vendor_name
""")
claim_suppliers = cur.fetchall()
print(f"Found {len(claim_suppliers)} distinct vendor+state combinations in claims")

matched = 0
unmatched = []

# ── Pass 1: name + state match ──
for vendor_name, vendor_state, vendor_id in claim_suppliers:
    cur.execute("""
        SELECT DISTINCT ON (supplier_name)
            npi,
            supplier_type,
            contact_email,
            contact_name,
            contact_phone
        FROM supplier_profiles
        WHERE LOWER(TRIM(supplier_name)) = LOWER(TRIM(%s))
          AND state = %s
          AND npi_watch_registered = TRUE
        ORDER BY supplier_name, npi
        LIMIT 1
    """, (vendor_name, vendor_state))
    sp_row = cur.fetchone()

    if sp_row:
        npi, sp_type, email, name, phone = sp_row
        vendor_type = normalize_vendor_type(sp_type)
        cur.execute("""
            UPDATE claims SET
                vendor_npi    = %s,
                vendor_type   = %s,
                contact_email = %s,
                contact_name  = %s,
                contact_phone = %s
            WHERE vendor_name  = %s
              AND vendor_state = %s
        """, (npi, vendor_type, email, name, phone, vendor_name, vendor_state))
        matched += 1
    else:
        unmatched.append((vendor_name, vendor_state, vendor_id))

conn.commit()
print(f"Pass 1 (name+state): {matched} matched, {len(unmatched)} unmatched")

# ── Pass 2: name-only fallback for the unmatched (synthetic suppliers) ──
pass2_matched = 0
still_unmatched = []

for vendor_name, vendor_state, vendor_id in unmatched:
    cur.execute("""
        SELECT DISTINCT ON (supplier_name)
            npi,
            supplier_type,
            contact_email,
            contact_name,
            contact_phone
        FROM supplier_profiles
        WHERE LOWER(TRIM(supplier_name)) = LOWER(TRIM(%s))
          AND npi_watch_registered = TRUE
        ORDER BY supplier_name, npi
        LIMIT 1
    """, (vendor_name,))
    sp_row = cur.fetchone()

    if sp_row:
        npi, sp_type, email, name, phone = sp_row
        vendor_type = normalize_vendor_type(sp_type)
        cur.execute("""
            UPDATE claims SET
                vendor_npi    = %s,
                vendor_type   = %s,
                contact_email = %s,
                contact_name  = %s,
                contact_phone = %s
            WHERE vendor_name = %s
        """, (npi, vendor_type, email, name, phone, vendor_name))
        pass2_matched += 1
    else:
        still_unmatched.append((vendor_name, vendor_state, vendor_id))
        print(f"  UNMATCHED: {vendor_name!r} ({vendor_state}) — will need manual seed")

conn.commit()
print(f"Pass 2 (name-only): {pass2_matched} matched, {len(still_unmatched)} still unmatched")

cur.close()
conn.close()

# ── Verification ──
conn2 = psycopg2.connect(settings.database_url)
cur2 = conn2.cursor()
cur2.execute("""
    SELECT
        COUNT(*)              AS total,
        COUNT(vendor_npi)     AS has_npi,
        COUNT(contact_email)  AS has_email,
        COUNT(DISTINCT vendor_type) FILTER (WHERE vendor_type IS NOT NULL) AS vendor_types
    FROM claims
""")
row = cur2.fetchone()
cur2.close()
conn2.close()

print(f"\nSeeding complete:")
print(f"  Matched and updated: {matched + pass2_matched}")
print(f"  Unmatched:           {len(still_unmatched)}")
print(f"\nVerification:")
print(f"  Total claims:        {row[0]}")
print(f"  Claims with NPI:     {row[1]}")
print(f"  Claims with email:   {row[2]}")
print(f"  Distinct types:      {row[3]}")
