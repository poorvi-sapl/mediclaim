"""
Seed Phase 3 supplier contact data.

Part A: Update 71 real suppliers (resolved via name+state match to claims)
        with generated contact_email, contact_name, contact_phone.

Part B: Insert 20 synthetic supplier rows (NPIs 1999000001-1999000020)
        for the 20 demo claims suppliers that did not resolve via name+state.

Idempotent: Part A uses UPDATE WHERE npi = %s.
            Part B uses ON CONFLICT (npi) DO NOTHING.
"""

import os
import re
import sys

from dotenv import load_dotenv
import psycopg2

ENV_PATH = r"D:\Mediclaim\.env"

# ---------------------------------------------------------------------------
# Contact generation
# ---------------------------------------------------------------------------

_PREFIXES = ["billing", "compliance", "info"]

_CONTACT_NAMES = [
    "James Whitfield",    "Maria Santos",       "Robert Chen",
    "Patricia Okafor",    "David Kim",           "Linda Ramirez",
    "Michael Thompson",   "Barbara Nguyen",      "William Jackson",
    "Susan Patel",        "Richard Martinez",    "Jessica Williams",
    "Thomas Anderson",    "Sarah Johnson",       "Charles Davis",
    "Karen Wilson",       "Joseph Taylor",       "Nancy Brown",
    "Christopher Moore",  "Lisa Garcia",         "Daniel Harris",
    "Margaret Jones",     "Paul White",          "Dorothy Miller",
    "Mark Robinson",      "Helen Clark",         "Donald Lewis",
    "Sandra Young",       "George Walker",       "Betty Hall",
    "Kenneth Allen",      "Ruth King",           "Steven Wright",
    "Sharon Scott",       "Edward Green",        "Michelle Baker",
    "Brian Adams",        "Donna Nelson",        "Ronald Carter",
    "Carol Mitchell",     "Anthony Perez",       "Amanda Roberts",
    "Kevin Turner",       "Melissa Phillips",    "Jason Campbell",
    "Deborah Parker",     "Matthew Evans",       "Stephanie Edwards",
    "Gary Collins",       "Rebecca Stewart",     "Timothy Sanchez",
    "Sharon Morris",      "Jose Rogers",         "Cynthia Reed",
    "Larry Cook",         "Kathleen Morgan",     "Jeffrey Bell",
    "Amy Murphy",         "Frank Bailey",        "Angela Rivera",
    "Scott Cooper",       "Brenda Richardson",   "Eric Cox",
    "Tammy Howard",       "Stephen Ward",        "Emma Torres",
    "Andrew Peterson",    "Christine Gray",      "Raymond James",
    "Janet Brooks",       "Gregory Kelly",       "Heather Price",
    "Joshua Bennett",     "Evelyn Coleman",      "Jerry Butler",
    "Rachel Washington",  "Dennis Foster",       "Carolyn Gonzales",
    "Walter Flores",      "Virginia Henderson",  "Peter Russell",
    "Maria Patterson",    "Harold Long",         "Diana Simmons",
    "Roger Hayes",        "Judith Griffin",      "Keith Hughes",
    "Kathryn Long",       "Terry Price",         "Alice Watson",
    "Sean Hayes",         "Frances Griffin",
]

_AREA_CODES = [212, 310, 312, 404, 415, 512, 602, 617, 702, 713,
               718, 805, 818, 901, 972]


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())[:15] or "supplier"


def _make_email(name: str, npi: str, index: int) -> str:
    prefix = _PREFIXES[index % 3]
    slug = _slug(name)
    # Last 2 NPI digits guarantee uniqueness when names produce the same slug
    domain = f"{slug}{npi[-2:]}"
    tld = ".net" if index % 5 == 0 else ".com"
    return f"{prefix}@{domain}{tld}"


def _make_phone(index: int) -> str:
    area = _AREA_CODES[index % len(_AREA_CODES)]
    exchange = 200 + ((index // len(_AREA_CODES)) * 7 + (index % 7) * 3) % 799
    line = 1000 + (index * 37 + 13) % 9000
    return f"({area}) {exchange:03d}-{line:04d}"


# ---------------------------------------------------------------------------
# 20 synthetic suppliers — the unresolved demo claims suppliers
# (name, npi, supplier_type, state, zip, city)
# ---------------------------------------------------------------------------

_SYNTHETIC = [
    ("0-HASSLE PERSONAL CARE SERVICES LLC",          "1999000001", "Home Health Agency", "TX", "00000", "HOUSTON"),
    ("101MOBILITY, LLC",                              "1999000002", "DME Supplier",       "NC", "00000", "CHARLOTTE"),
    ("10 COMMANDMENTS WOUND AND NURSING CARE PLLC",  "1999000003", "Home Health Agency", "TX", "00000", "DALLAS"),
    ("11 HEALTH AND TECHNOLOGIES INC.",               "1999000004", "DME Supplier",       "CA", "00000", "LOS ANGELES"),
    ("123 GA HOME HEALTHCARE, LLLP",                  "1999000005", "Home Health Agency", "GA", "00000", "ATLANTA"),
    ("1 ACCESS CARE OF AMERICA",                      "1999000006", "Home Health Agency", "TX", "00000", "HOUSTON"),
    ("1ACCURATE HEALTHCARE SERVICES, INC.",           "1999000007", "Home Health Agency", "TX", "00000", "AUSTIN"),
    ("1ACCURATE HOSPICE",                             "1999000008", "Hospice Care",       "TX", "00000", "SAN ANTONIO"),
    ("1 AMELIORATE HEALTHCARE SERVICES LLC",          "1999000009", "Home Health Agency", "VA", "00000", "RICHMOND"),
    ("1 AND ONLY HOME CARE LLC",                      "1999000010", "Home Health Agency", "NV", "00000", "LAS VEGAS"),
    ("1 BUSY BEE CARE SERVICES INC",                  "1999000011", "Home Health Agency", "MN", "00000", "MINNEAPOLIS"),
    ("1 CAPITAL SOLUTIONS PLLC",                      "1999000012", "DME Supplier",       "GA", "00000", "ATLANTA"),
    ("1 CARE PARTNERS LLC",                           "1999000013", "Home Health Agency", "MD", "00000", "BALTIMORE"),
    ("1 SOURCE SOLUTIONS, LLC",                       "1999000014", "DME Supplier",       "VA", "00000", "VIRGINIA BEACH"),
    ("1ST ACCURATE HOSPICE",                          "1999000015", "Hospice Care",       "TX", "00000", "HOUSTON"),
    ('"A" CLASS HOME HEALTH AGENCY, INC.',            "1999000016", "Home Health Agency", "FL", "00000", "MIAMI"),
    ('"C" CASTING CARE',                              "1999000017", "DME Supplier",       "VA", "00000", "NORFOLK"),
    ('"CHYNA CARES" HEALTH SERVICES',                 "1999000018", "Home Health Agency", "TX", "00000", "FORT WORTH"),
    ('"WE CARE" NURSES, INC.',                        "1999000019", "Home Health Agency", "PA", "00000", "PHILADELPHIA"),
    ('"WINGS OF TRINITY" HOME HEALTH CARE',           "1999000020", "Home Health Agency", "VA", "00000", "ARLINGTON"),
]


def main():
    load_dotenv(ENV_PATH)
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    conn.autocommit = False
    cur = conn.cursor()

    # ------------------------------------------------------------------
    # Part A — update 71 real suppliers
    # ------------------------------------------------------------------

    cur.execute("""
        SELECT DISTINCT ON (c.supplier_name)
            c.supplier_name,
            sp.npi,
            sp.supplier_type
        FROM claims c
        INNER JOIN supplier_profiles sp
            ON LOWER(TRIM(c.supplier_name)) = LOWER(TRIM(sp.supplier_name))
            AND c.supplier_state = sp.state
        WHERE sp.oig_excluded = FALSE
        ORDER BY c.supplier_name, sp.npi
    """)
    real_rows = cur.fetchall()

    updated = 0
    for idx, (sup_name, npi, _sup_type) in enumerate(real_rows):
        email = _make_email(sup_name, npi, idx)
        name  = _CONTACT_NAMES[idx]
        phone = _make_phone(idx)
        cur.execute("""
            UPDATE supplier_profiles SET
                contact_email        = %s,
                contact_name         = %s,
                contact_phone        = %s,
                npi_watch_registered = TRUE,
                is_synthetic         = FALSE
            WHERE npi = %s
        """, (email, name, phone, npi))
        if cur.rowcount:
            updated += 1

    # ------------------------------------------------------------------
    # Part B — insert 20 synthetic suppliers
    # ------------------------------------------------------------------

    inserted = 0
    for idx, (sup_name, npi, sup_type, state, zip_, city) in enumerate(_SYNTHETIC):
        real_idx = len(real_rows) + idx
        email = _make_email(sup_name, npi, real_idx)
        name  = _CONTACT_NAMES[real_idx]
        phone = _make_phone(real_idx)
        cur.execute("""
            INSERT INTO supplier_profiles
                (npi, supplier_name, supplier_type, city, state, zip,
                 contact_email, contact_name, contact_phone,
                 oig_excluded, npi_watch_registered, is_synthetic)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s,
                    FALSE, TRUE, TRUE)
            ON CONFLICT (npi) DO NOTHING
        """, (npi, sup_name, sup_type, city, state, zip_,
              email, name, phone))
        if cur.rowcount:
            inserted += 1

    conn.commit()

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------

    cur.execute("""
        SELECT npi, supplier_type, is_synthetic
        FROM supplier_profiles
        WHERE npi_watch_registered = TRUE
        ORDER BY npi
    """)
    all_reg = cur.fetchall()

    dme_count   = sum(1 for _, st, _ in all_reg if st and "dme" in st.lower())
    hh_count    = sum(1 for _, st, _ in all_reg if st and "home" in st.lower())
    hosp_count  = sum(1 for _, st, _ in all_reg if st and "hospice" in st.lower())
    synth_count = sum(1 for _, _, s in all_reg if s)
    real_count  = sum(1 for _, _, s in all_reg if not s)

    cur.execute("""
        SELECT COUNT(DISTINCT state)
        FROM supplier_profiles
        WHERE npi_watch_registered = TRUE
    """)
    state_count = cur.fetchone()[0]

    print("Supplier contacts seeded:")
    print(f" - {real_count} real suppliers updated")
    print(f" - {synth_count} synthetic suppliers inserted")
    print(f" - {len(all_reg)} total npi_watch_registered = TRUE")
    print(f" - Distribution: {dme_count} DME, {hh_count} HOME_HEALTH, {hosp_count} HOSPICE")
    print(f" - States covered: {state_count}")
    print()
    npi_list = [row[0] for row in all_reg]
    print("All registered NPIs:")
    print(npi_list)

    conn.close()


if __name__ == "__main__":
    main()
