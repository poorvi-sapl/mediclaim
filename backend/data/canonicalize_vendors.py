"""
Canonicalize vendor identity to the supplier NPI.

ROOT FIX for the synthetic-seed artifact where one real vendor (one vendor_npi)
was split across several random `sup-<hash>` vendor_ids — so the same supplier
showed up as multiple separate cases in the watchlist.

In real Medicare/claims data the supplier's **NPI is its identity**, and the
ingest path already keys new claims by vendor_npi (routers/ingest.py). This makes
the demo data obey the same rule: vendor_id = vendor_npi everywhere. After that,
every existing query that groups/keys by vendor_id automatically treats
"one NPI = one vendor" — no query rewrites needed.

Idempotent. Two uses:
  • as a library — call canonicalize_vendor_ids(db) inside the demo-reset pipeline
    (before the rules engine runs), OR
  • standalone — `python -m backend.data.canonicalize_vendors` fixes an existing
    DB in place and re-runs the rules engine + scoring so flags/scores are
    recomputed on the merged, canonical vendor ids.
"""

import sys

from sqlalchemy import text

from backend.database import SessionLocal
from backend.config import get_settings


def canonicalize_vendor_ids(db) -> dict:
    """Set claims.vendor_id = vendor_npi (and realign actions to match) wherever a
    vendor_npi exists. Does NOT touch rules_flags / scores — those are regenerated
    by the rules engine + scorer that run after this. Returns before/after counts.
    Commits its own transaction."""
    before = db.execute(text("SELECT COUNT(DISTINCT vendor_id) FROM claims")).scalar()
    distinct_npis = db.execute(text(
        "SELECT COUNT(DISTINCT vendor_npi) FROM claims "
        "WHERE vendor_npi IS NOT NULL AND vendor_npi <> ''"
    )).scalar()

    # Realign physician actions FIRST, using the (still pre-canonical) claim join,
    # so a flag always points at the same canonical vendor as its claim.
    actions_updated = db.execute(text(
        "UPDATE actions a SET vendor_id = c.vendor_npi "
        "FROM claims c "
        "WHERE a.claim_id = c.id "
        "AND c.vendor_npi IS NOT NULL AND c.vendor_npi <> '' "
        "AND a.vendor_id IS DISTINCT FROM c.vendor_npi"
    )).rowcount

    # Canonicalize the claims themselves.
    claims_updated = db.execute(text(
        "UPDATE claims SET vendor_id = vendor_npi "
        "WHERE vendor_npi IS NOT NULL AND vendor_npi <> '' "
        "AND vendor_id IS DISTINCT FROM vendor_npi"
    )).rowcount

    db.commit()
    after = db.execute(text("SELECT COUNT(DISTINCT vendor_id) FROM claims")).scalar()
    return {
        "vendor_ids_before": before,
        "vendor_ids_after": after,
        "distinct_npis": distinct_npis,
        "claims_updated": claims_updated,
        "actions_updated": actions_updated,
    }


def main() -> int:
    settings = get_settings()
    db = SessionLocal()
    try:
        s = canonicalize_vendor_ids(db)
        print(f"Vendor identity canonicalized to NPI: "
              f"{s['vendor_ids_before']} vendor_ids -> {s['vendor_ids_after']} "
              f"(distinct NPIs in claims: {s['distinct_npis']}); "
              f"claims updated={s['claims_updated']}, actions updated={s['actions_updated']}")

        # Rules (cross_npi_supplier, supplier_concentration, supplier scores…) group by
        # vendor_id, so their output changes once fragments merge — regenerate them.
        from backend.rules.engine import run_all_rules
        from backend.scoring.risk_score import calculate_all_scores

        flags = run_all_rules(db, settings)
        print(f"Rules engine re-run: {flags} flags")

        # Drop stale supplier score rows keyed by the old sup-ids, then recompute so
        # the watchlist shows exactly the canonical vendors.
        db.execute(text("DELETE FROM npi_risk_scores WHERE entity_type='supplier'"))
        db.commit()
        calculate_all_scores(db, settings)
        print("Scoring re-run complete")

        vids = db.execute(text("SELECT COUNT(DISTINCT vendor_id) FROM claims")).scalar()
        srows = db.execute(text("SELECT COUNT(*) FROM npi_risk_scores WHERE entity_type='supplier'")).scalar()
        split = db.execute(text(
            "SELECT COUNT(*) FROM (SELECT vendor_name FROM claims GROUP BY vendor_name "
            "HAVING COUNT(DISTINCT vendor_id) > 1) t"
        )).scalar()
        print(f"Verify -> distinct vendor_ids={vids}, supplier score rows={srows}, "
              f"names still split across >1 vendor_id={split}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
