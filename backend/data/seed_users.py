"""Create the users table (via SQLAlchemy metadata) and seed the two demo users.

Run:  python -m backend.data.seed_users
Idempotent — upserts by email (new), migrates old claimlens.com emails on re-run.
"""

import logging

from ..database import SessionLocal, engine, Base
from ..models import User
from ..auth import hash_password

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("data.seed_users")

DEMO_USERS = [
    {
        "email": "physician@mediclaim.com",
        "old_email": "physician@claimlens.com",
        "password": "demo1234",
        "role": "physician",
        "npi": "1234567890",
        "full_name": "Dr. James Wilson",
    },
    {
        "email": "payer@mediclaim.com",
        "old_email": "plan@claimlens.com",
        "password": "demo1234",
        "role": "plan_investigator",
        "npi": None,
        "full_name": "Payer Investigator",
    },
]


def main():
    # ensure the users table exists
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        for u in DEMO_USERS:
            # look up by new email first, then fall back to old email (migration)
            existing = (
                db.query(User).filter(User.email == u["email"]).first()
                or db.query(User).filter(User.email == u["old_email"]).first()
            )
            if existing:
                existing.email = u["email"]
                existing.password_hash = hash_password(u["password"])
                existing.role = u["role"]
                existing.npi = u["npi"]
                existing.full_name = u["full_name"]
                log.info(f"Updated user -> {u['email']} ({u['role']})")
            else:
                db.add(User(
                    email=u["email"],
                    password_hash=hash_password(u["password"]),
                    role=u["role"],
                    npi=u["npi"],
                    full_name=u["full_name"],
                ))
                log.info(f"Created user {u['email']} ({u['role']})")
        db.commit()
        total = db.query(User).count()
        log.info(f"Users seeded. Total users: {total}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
