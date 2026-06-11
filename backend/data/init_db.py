"""
One-shot database initialisation — safe to run on every deploy.

Steps:
  1. Seed demo users          (idempotent — upserts by email)
  2. Generate synthetic data  (DEMO/STAGING only — set SEED_SYNTHETIC=true in .env)
  3. Run rules engine         (always — wipes old flags and re-scores)

Run:
    python -m backend.data.init_db

Environment variables:
    SEED_SYNTHETIC=true   — generate fake claims (dev/staging only, never production)
"""

import logging
import os
import sys

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("data.init_db")


def main():
    # ------------------------------------------------------------------
    # Step 1 — seed demo users (idempotent)
    # ------------------------------------------------------------------
    log.info("=== Step 1/3: seeding demo users ===")
    from .seed_users import main as seed_users
    seed_users()

    # ------------------------------------------------------------------
    # Step 2 — generate synthetic claims (dev/staging only)
    # ------------------------------------------------------------------
    log.info("=== Step 2/3: checking synthetic data flag ===")
    if os.getenv("SEED_SYNTHETIC", "").lower() == "true":
        from ..database import SessionLocal
        from ..models import Claim

        db = SessionLocal()
        try:
            claim_count = db.query(Claim).count()
        finally:
            db.close()

        if claim_count > 0:
            log.info(f"Claims table already has {claim_count} rows — skipping generation.")
        else:
            log.info("SEED_SYNTHETIC=true and table is empty — generating synthetic data.")
            from .generate_synthetic import main as generate_synthetic
            generate_synthetic()
    else:
        log.info("SEED_SYNTHETIC not set — skipping synthetic data generation (production mode).")

    # ------------------------------------------------------------------
    # Step 3 — run rules engine (wipes old flags, re-scores everything)
    # ------------------------------------------------------------------
    log.info("=== Step 3/3: running rules engine ===")
    from ..database import SessionLocal as _SessionLocal
    from ..config import get_settings
    from ..rules.engine import run_all_rules

    db = _SessionLocal()
    try:
        flagged = run_all_rules(db, get_settings())
        log.info(f"Rules engine complete — {flagged} flag(s) created.")
    finally:
        db.close()

    log.info("=== init_db complete ===")


if __name__ == "__main__":
    main()
