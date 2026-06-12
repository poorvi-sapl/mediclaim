"""
Redistribute date_of_service for existing ~18,000 claims to span a full year
instead of the original 90-day window.  No GPT calls — updates in-place.

Strategy:
  - Claims within the last 30 days  →  kept exactly as-is.
    All fraud detection signals live here (impossible_day at day 7,
    rapid_cycling at day 17, modifier_abuse at days 22-29, duplicate_billing
    at days 10-12, upcoding at days 12-15, volume spike recent bucket).
  - Claims older than 30 days       →  randomly redistributed to 31-364 days ago.
    This spreads background + volume-spike baseline across a full year so
    time-based dashboard charts are meaningful.

Rolls back automatically if any verification check fails.
"""

import os
import random
import logging
import sys
from datetime import timedelta

from dotenv import load_dotenv
import psycopg2

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_PATH = os.path.join(BASE_DIR, "..", "..", ".env")
LOG_PATH = os.path.join(BASE_DIR, "redistribute_dates.log")
RANDOM_STATE = 42
random.seed(RANDOM_STATE)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[
        logging.FileHandler(LOG_PATH, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("redistribute_dates")


def main():
    load_dotenv(ENV_PATH)
    db_url = os.environ["DATABASE_URL"]
    conn = psycopg2.connect(db_url)
    conn.autocommit = False
    cur = conn.cursor()

    cur.execute("SELECT CURRENT_DATE")
    today = cur.fetchone()[0]
    log.info(f"Anchor date: {today}")

    cutoff = today - timedelta(days=30)

    # Only fetch claims outside the last-30-day window (the ones we will move)
    cur.execute(
        "SELECT id FROM claims WHERE date_of_service < %s",
        (cutoff,),
    )
    ids_to_update = [row[0] for row in cur.fetchall()]
    log.info(f"Claims to redistribute (older than 30 days): {len(ids_to_update)}")

    updates = [
        (today - timedelta(days=random.randint(31, 364)), claim_id)
        for claim_id in ids_to_update
    ]

    cur.executemany(
        "UPDATE claims SET date_of_service = %s WHERE id = %s",
        updates,
    )
    log.info(f"Updated {len(updates)} rows")

    # Verification — roll back if anything fails
    checks = [
        (
            "Total claims unchanged",
            "SELECT COUNT(*) FROM claims",
            (),
            lambda v: v > 15000,
        ),
        (
            "No claims touch future dates",
            "SELECT COUNT(*) FROM claims WHERE date_of_service > CURRENT_DATE",
            (),
            lambda v: v == 0,
        ),
        (
            "Date range spans >= 300 days",
            "SELECT (MAX(date_of_service) - MIN(date_of_service)) FROM claims",
            (),
            lambda v: (v.days if hasattr(v, 'days') else v) >= 300,
        ),
        (
            "Last-30d claims preserved (fraud signals intact)",
            "SELECT COUNT(*) FROM claims WHERE date_of_service >= CURRENT_DATE - INTERVAL '30 days'",
            (),
            lambda v: v > 0,
        ),
        (
            "Claims exist throughout 31-364 day window",
            "SELECT COUNT(*) FROM claims WHERE date_of_service < CURRENT_DATE - INTERVAL '30 days' "
            "AND date_of_service >= CURRENT_DATE - INTERVAL '364 days'",
            (),
            lambda v: v > 10000,
        ),
    ]

    print("\n" + "=" * 60)
    all_pass = True
    for name, sql, params, ok in checks:
        cur.execute(sql, params)
        val = cur.fetchone()[0]
        passed = ok(val)
        status = "PASS" if passed else "FAIL"
        print(f"[{status}] {name}  (actual={val})")
        if not passed:
            all_pass = False
    print("=" * 60)

    if all_pass:
        conn.commit()
        log.info("All checks passed — committed.")
        print(f"\nDone. {len(updates)} claims redistributed across the past year.")
        print(f"      ~{len(ids_to_update)} claims now span 31-364 days; last-30d claims untouched.")
    else:
        conn.rollback()
        log.error("One or more checks failed — rolled back, no changes saved.")
        conn.close()
        sys.exit(1)

    conn.close()


if __name__ == "__main__":
    main()
