"""
Geocode California physicians in npi_profiles using pgeocode (offline GeoNames).

- Connects via DATABASE_URL from D:\\Mediclaim\\.env
- Selects CA physicians (practice_state = 'CA') that still need geocoding
  (practice_lat IS NULL)
- Looks up the centroid lat/lng for each 5-digit practice_zip
- Writes practice_lat / practice_lng back in batches of 1000
- Unrecognized zips are left NULL (skipped) and counted

CA only — non-CA rows are never touched.
"""

import os
import sys
import math

from dotenv import load_dotenv
import psycopg2
from psycopg2.extras import execute_values

# pgeocode should already be installed; install on the fly if missing.
try:
    import pgeocode
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "pgeocode==0.4.1"])
    import pgeocode

ENV_PATH = r"D:\Mediclaim\.env"
BATCH = 1000
PROGRESS_EVERY = 5000


def main():
    load_dotenv(ENV_PATH)
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        sys.exit("ERROR: DATABASE_URL not found in .env")

    nomi = pgeocode.Nominatim("US")

    conn = psycopg2.connect(database_url)
    conn.autocommit = False
    try:
        # Pull the CA rows that still need a geocode.
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT npi, practice_zip
                FROM npi_profiles
                WHERE practice_state = 'CA' AND practice_lat IS NULL
                """
            )
            rows = cur.fetchall()

        total = len(rows)
        print(f"CA physicians needing geocode: {total:,}")

        processed = 0
        matched = 0
        unrecognized = 0

        for start in range(0, total, BATCH):
            batch = rows[start:start + BATCH]
            updates = []  # (npi, lat, lng) for matched zips only

            for npi, zip_raw in batch:
                zip5 = (zip_raw or "").strip()[:5]
                lat = lng = None
                if len(zip5) == 5 and zip5.isdigit():
                    rec = nomi.query_postal_code(zip5)
                    la, lo = rec["latitude"], rec["longitude"]
                    if la is not None and lo is not None and not (
                        isinstance(la, float) and math.isnan(la)
                    ) and not (isinstance(lo, float) and math.isnan(lo)):
                        lat = round(float(la), 6)
                        lng = round(float(lo), 6)

                if lat is not None:
                    updates.append((npi, lat, lng))
                    matched += 1
                else:
                    unrecognized += 1  # leave practice_lat/lng NULL

                processed += 1
                if processed % PROGRESS_EVERY == 0:
                    print(f"  ...processed {processed:,}/{total:,} "
                          f"(matched {matched:,}, unrecognized {unrecognized:,})")

            # Apply this batch's updates in one round-trip.
            if updates:
                with conn.cursor() as cur:
                    execute_values(
                        cur,
                        """
                        UPDATE npi_profiles AS p
                        SET practice_lat = v.lat, practice_lng = v.lng
                        FROM (VALUES %s) AS v(npi, lat, lng)
                        WHERE p.npi = v.npi
                        """,
                        updates,
                        template="(%s, %s::numeric, %s::numeric)",
                    )
                conn.commit()

        print("\n" + "=" * 55)
        print("DONE — California physician geocoding")
        print(f"  Total CA physicians processed : {processed:,}")
        print(f"  Got valid lat/lng             : {matched:,}")
        print(f"  Unrecognized zips (left NULL) : {unrecognized:,}")
        print("=" * 55)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
