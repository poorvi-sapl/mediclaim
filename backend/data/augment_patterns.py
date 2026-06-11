"""
Augment the synthetic claims with two real-world fraud patterns the base
800-claim set doesn't cover (client request):

  Pattern A — long-duration hospice (15 claims)
      One patient on hospice across a 400+ day span. Sets up a future
      `abnormal_hospice_duration` rule (long hospice stays are a top OIG
      priority).

  Pattern B — specialty-drug / service-type mismatch (10 claims)
      A Family Medicine physician ordering HIV specialty drugs. Sets up a
      future `service_type_mismatch` rule.

Idempotent: claim ids are deterministic uuid5 values + ON CONFLICT DO NOTHING,
so re-running neither duplicates rows nor disturbs the base 800 claims.
"""

import os
import sys
import uuid
import math
import hashlib
from datetime import timedelta

from dotenv import load_dotenv
import psycopg2
from psycopg2.extras import execute_values
import pgeocode

ENV_PATH = r"D:\Mediclaim\.env"
PLAN = "California Medi-Cal"
NS = uuid.uuid5(uuid.NAMESPACE_DNS, "claimlens.augment.patterns")

nomi = pgeocode.Nominatim("US")


def supplier_id_for(name: str) -> str:
    h = hashlib.sha1(name.upper().strip().encode("utf-8")).hexdigest()[:12]
    return f"sup-{h}"


def geocode(zip5):
    rec = nomi.query_postal_code(str(zip5))
    lat, lng, st = rec["latitude"], rec["longitude"], rec["state_code"]
    lat = None if (isinstance(lat, float) and math.isnan(lat)) else round(float(lat), 6)
    lng = None if (isinstance(lng, float) and math.isnan(lng)) else round(float(lng), 6)
    st = "CA" if (isinstance(st, float)) else (st or "CA")
    return lat, lng, st


def pick_one(cur, sql, params=None):
    cur.execute(sql, params or ())
    return cur.fetchone()


def main():
    load_dotenv(ENV_PATH)
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    conn.autocommit = False
    cur = conn.cursor()
    ref_date = pick_one(cur, "SELECT CURRENT_DATE")[0]

    # ---- pick physicians ----
    hospice_phys = pick_one(cur,
        "SELECT npi, practice_zip FROM npi_profiles "
        "WHERE practice_state='CA' AND practice_lat IS NOT NULL "
        "AND specialty='Hospice & Palliative Medicine' ORDER BY npi LIMIT 1")
    if not hospice_phys:
        hospice_phys = pick_one(cur,
            "SELECT npi, practice_zip FROM npi_profiles "
            "WHERE practice_state='CA' AND practice_lat IS NOT NULL ORDER BY npi LIMIT 1")

    fm_phys = pick_one(cur,
        "SELECT npi, practice_zip, specialty FROM npi_profiles "
        "WHERE practice_state='CA' AND practice_lat IS NOT NULL "
        "AND specialty='Family Medicine' ORDER BY npi LIMIT 1")
    if not fm_phys:
        sys.exit("ERROR: no CA Family Medicine physician found")

    hospice_npi, hospice_zip = hospice_phys[0], str(hospice_phys[1])
    fm_npi, fm_zip, fm_spec = fm_phys[0], str(fm_phys[1]), fm_phys[2]
    print(f"Hospice physician NPI {hospice_npi} (zip {hospice_zip})")
    print(f"Family Medicine physician NPI {fm_npi} (specialty '{fm_spec}', zip {fm_zip})")

    # ---- dedicated hospice supplier (insert for consistency) ----
    hospice_supplier = "Evergreen Hospice Care LLC"
    cur.execute(
        """INSERT INTO supplier_profiles
           (npi, supplier_name, supplier_type, address, city, state, zip,
            enrollment_date, last_update, oig_excluded)
           VALUES ('9000000099',%s,'Hospice Care',NULL,NULL,'CA',%s,
                   '2016-01-01',CURRENT_DATE,false)
           ON CONFLICT (npi) DO NOTHING""",
        (hospice_supplier, hospice_zip),
    )
    pharmacy_supplier = "SpecialtyRx Pharmacy"  # drugs domain; not a DME/HH/hospice supplier

    rows = []

    # ===================== Pattern A — long hospice =====================
    h_lat, h_lng, h_state = geocode(hospice_zip)
    h_sid = supplier_id_for(hospice_supplier)
    h_codes = ["T2042", "T2043", "T2044", "T2045"]
    span_days = [10 + i * 29 for i in range(15)]  # 10 .. 416 days ago -> 406-day span
    for i, days_ago in enumerate(span_days):
        dos = ref_date - timedelta(days=days_ago)
        cid = uuid.uuid5(NS, f"hospice-long-{i}")
        rows.append((
            str(cid), hospice_npi, "pat-HOSPICE-LONG-001", "Harold Whitfield",
            hospice_zip, h_state, h_lat, h_lng, dos, None, h_codes[i % len(h_codes)],
            f"Routine home hospice care - continuous enrollment (visit {i+1})",
            "hospice", hospice_supplier, h_sid, hospice_zip, "CA",
            round(220.0 + (i % 5) * 35, 2), PLAN, False, False,
        ))

    # ============ Pattern B — specialty-drug mismatch ============
    d_lat, d_lng, d_state = geocode(fm_zip)
    d_sid = supplier_id_for(pharmacy_supplier)
    hiv_drugs = ["Biktarvy", "Truvada", "Genvoya", "Descovy", "Tivicay",
                 "Odefsey", "Dovato", "Symtuza", "Cabenuva", "Triumeq"]
    drug_names = ["Anthony Rivera", "Denise Park", "Marcus Hill", "Sofia Reyes",
                  "Kevin Tran", "Latoya Banks", "Omar Haddad", "Grace Liu",
                  "Brandon Cole", "Priya Nair"]
    for i in range(10):
        dos = ref_date - timedelta(days=5 + i * 6)  # last ~60d
        cid = uuid.uuid5(NS, f"drug-mismatch-{i}")
        rows.append((
            str(cid), fm_npi, f"pat-DRUGMM-{i:03d}", drug_names[i],
            fm_zip, d_state, d_lat, d_lng, dos, None, "J3490",
            f"HIV antiretroviral therapy - {hiv_drugs[i]} (specialty drug)",
            "drugs", pharmacy_supplier, d_sid, fm_zip, "CA",
            round(2200.0 + i * 180, 2), PLAN, False, False,
        ))

    execute_values(cur, """
        INSERT INTO claims
        (id, npi, patient_id, patient_name, patient_zip, patient_state,
         patient_lat, patient_lng, date_of_service, cpt_code, hcpcs_code,
         service_description, service_category, supplier_name, supplier_id,
         supplier_zip, supplier_state, claim_amount, plan_name, oig_flagged,
         reviewed, ingested_at, created_at)
        VALUES %s
        ON CONFLICT (id) DO NOTHING
    """, rows, template="(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,now(),now())")
    conn.commit()

    # ---- report ----
    cur.execute("SELECT count(*), max(date_of_service)-min(date_of_service) "
                "FROM claims WHERE patient_id='pat-HOSPICE-LONG-001'")
    h_count, h_span = cur.fetchone()
    cur.execute("SELECT count(*) FROM claims WHERE service_category='drugs' "
                "AND npi=%s AND service_description ILIKE '%%HIV%%'", (fm_npi,))
    d_count = cur.fetchone()[0]
    cur.execute("SELECT count(*) FROM claims")
    total = cur.fetchone()[0]

    print(f"\nPattern A (long hospice): {h_count} claims, span {h_span} days "
          f"(same patient pat-HOSPICE-LONG-001)")
    print(f"Pattern B (specialty-drug mismatch): {d_count} HIV-drug claims under "
          f"Family Medicine NPI {fm_npi}")
    print(f"Total claims now: {total}")
    conn.close()


if __name__ == "__main__":
    main()
