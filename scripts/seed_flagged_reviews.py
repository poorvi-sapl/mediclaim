"""Mark the 10 Tier-3 physicians as needs_manual_review (Tier-3 + lapsed revalidation).

The payer leaderboard's amber ⚠ icon and the NPI-detail Verification Status block read
users.needs_manual_review / users.verification_results joined by NPI. The 100 generated
physicians aren't login accounts, so we seed lightweight flagged user rows for the 10
high-risk NPIs (the demo physician account, already linked to the index-90 NPI, is
updated in place rather than duplicated).

Idempotent: prior flagged.* demo rows are removed first. Existing real accounts untouched.
"""
import os
import json
import uuid
from datetime import datetime, date, timedelta

import psycopg2
from dotenv import load_dotenv

import sys
sys.path.insert(0, r"D:\Mediclaim")
from backend.auth import hash_password

BASE = os.path.dirname(os.path.abspath(__file__))
ENV_PATH = r"D:\Mediclaim\.env"


def main():
    load_dotenv(ENV_PATH)
    phys = json.load(open(os.path.join(BASE, "tiered_npis.json"), encoding="utf-8"))["physicians"]
    tier3 = [p for p in phys if p["tier"] == 3]

    lapsed = (date.today() - timedelta(days=45)).isoformat()
    vr = json.dumps({
        "order_referring": {"eligible": True, "name": "TIER3 PROVIDER"},
        "revalidation": {"found": True, "status": "lapsed", "due_date": lapsed},
        "checked_at": datetime.utcnow().isoformat(),
    })

    conn = psycopg2.connect(os.environ["DATABASE_URL"]); conn.autocommit = True
    cur = conn.cursor()
    cur.execute("DELETE FROM users WHERE email LIKE 'flagged.%@claimlens.demo'")

    n = 0
    for p in tier3:
        npi = p["npi"]
        # If a real account already owns this NPI (e.g. the demo physician), flag it in place.
        cur.execute("SELECT email FROM users WHERE npi=%s LIMIT 1", (npi,))
        row = cur.fetchone()
        if row:
            cur.execute("UPDATE users SET needs_manual_review=TRUE, verification_results=%s "
                        "WHERE npi=%s", (vr, npi))
        else:
            cur.execute(
                "INSERT INTO users (id,email,password_hash,role,npi,full_name,created_at,"
                "mfa_enabled,needs_manual_review,verification_results) "
                "VALUES (%s,%s,%s,'physician',%s,%s,now(),FALSE,TRUE,%s)",
                (str(uuid.uuid4()), f"flagged.{npi}@claimlens.demo", hash_password(uuid.uuid4().hex),
                 npi, f"Tier3 Physician {npi}", vr))
        n += 1
    cur.close(); conn.close()
    print(f"seed_flagged_reviews: marked {n} Tier-3 physicians needs_manual_review")


if __name__ == "__main__":
    main()
