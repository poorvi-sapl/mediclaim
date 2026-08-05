"""Seed the OIG exclusion tables with the Tier-3 (flagged) supplier NPIs + names.

Runs before the rules engine so the OIG data model is consistent. (The oig_leie_hit
rule fires off claims.oig_flagged, which generate_expanded already set for Tier-3
supplier claims; this keeps oig_excluded_npis/names in sync — same pattern as the
existing fraud-supplier seed.)
"""
import os
import json

import psycopg2
from dotenv import load_dotenv

BASE = os.path.dirname(os.path.abspath(__file__))
ENV_PATH = r"D:\Mediclaim\.env"


def main():
    load_dotenv(ENV_PATH)
    with open(os.path.join(BASE, "tiered_npis.json"), encoding="utf-8") as f:
        supp = json.load(f)["suppliers"]
    tier3 = [s for s in supp if s.get("oig_leie_match")]

    conn = psycopg2.connect(os.environ["DATABASE_URL"]); conn.autocommit = True
    cur = conn.cursor()
    for s in tier3:
        cur.execute(
            "INSERT INTO oig_excluded_npis (npi, entity_name, exclusion_type, "
            "exclusion_date, state) VALUES (%s,%s,'1128(a)(1)',CURRENT_DATE,%s) "
            "ON CONFLICT (npi) DO NOTHING",
            (s["npi"], s["name"], s.get("state")))
        cur.execute(
            "INSERT INTO oig_excluded_names (entity_name, exclusion_type, "
            "exclusion_date, state) VALUES (%s,'1128(a)(1)',CURRENT_DATE,%s)",
            (s["name"], s.get("state")))

    # Demo case: one physician of an OIG-flagged vendor is ALSO on the LEIE list, so
    # the vendor's OIG-evidence popup can show the strongest signal — an excluded
    # provider billing through an excluded vendor. Kept in sync with
    # npi_profiles.oig_excluded so the physician reads as excluded everywhere.
    DEMO_EXCLUDED_PHYSICIANS = [
        ("1003106014", "SINAE ANGELA KANE", "CA"),  # bills the OIG-excluded vendor 1ST CALEBS
    ]
    for npi, name, state in DEMO_EXCLUDED_PHYSICIANS:
        cur.execute(
            "INSERT INTO oig_excluded_npis (npi, entity_name, exclusion_type, "
            "exclusion_date, state) VALUES (%s,%s,'1128(a)(1)',CURRENT_DATE,%s) "
            "ON CONFLICT (npi) DO NOTHING",
            (npi, name, state))
        cur.execute("UPDATE npi_profiles SET oig_excluded=TRUE WHERE npi=%s", (npi,))

    cur.close(); conn.close()
    print(f"oig_seed: inserted {len(tier3)} Tier-3 suppliers + "
          f"{len(DEMO_EXCLUDED_PHYSICIANS)} demo excluded physician(s) into OIG tables")


if __name__ == "__main__":
    main()
