"""
Backfill / reconcile physician decisions across the three places the app records
them: Claim.reviewed, the Action logbook, and ClaimNotification.status.

Background — the drift this fixes
---------------------------------
A physician "decision" on a claim (confirm / dispute / report-fraud) is meant to
be written to all three at once, which POST /actions does. But some data paths
(demo seeds, and older notification-only flows) wrote the decision to the
ClaimNotification ONLY, leaving the Action logbook empty and — for some rows —
Claim.reviewed still false. The claims list papers over this by *synthesizing*
latest_action from the notification (see backend/routers/claims.py), but the
Oldest-Unreviewed queue (reads Claim.reviewed) and the Claim Detail timeline
(reads the Action logbook) don't, so one claim can read as unreviewed, decided,
and "awaiting review" simultaneously.

What this does
--------------
For every ClaimNotification with a decided status (CONFIRMED / DISPUTED /
FRAUD_REPORTED) that is linked to a real Claim (claim_id set), if that claim has
no matching Action row we materialize one from the notification (same fields a
real My-Claims action writes) and set Claim.reviewed=True. The decision's
timestamp is the notification's response time. Idempotent: claims that already
have an Action are skipped, so re-running is a no-op.

DRY-RUN by default (no writes). Pass --apply to commit.

Run:
    python -m backend.data.backfill_reconcile_decisions            # dry run
    python -m backend.data.backfill_reconcile_decisions --apply    # write
"""

import sys
from datetime import datetime

from backend.database import SessionLocal
from backend.models import Claim, Action, ClaimNotification

# Same mapping backend/routers/claims.py uses to fold notification status into a
# synthetic latest_action — kept identical so the backfilled action matches.
STATUS_TO_ACTION = {"CONFIRMED": "confirm", "DISPUTED": "dispute", "FRAUD_REPORTED": "fraud"}


def run(apply: bool) -> None:
    db = SessionLocal()
    try:
        notifs = (
            db.query(ClaimNotification)
            .filter(ClaimNotification.status.in_(STATUS_TO_ACTION.keys()),
                    ClaimNotification.claim_id.isnot(None))
            .all()
        )

        # One decision per claim — keep the most recent decided notification.
        def ts(n):
            return n.response_at or n.created_at or datetime.min

        best_by_claim = {}
        for n in notifs:
            cur = best_by_claim.get(n.claim_id)
            if cur is None or ts(n) > ts(cur):
                best_by_claim[n.claim_id] = n

        created = flipped = already_ok = missing_claim = 0
        samples = []

        for claim_id, n in best_by_claim.items():
            claim = db.query(Claim).filter(Claim.id == claim_id).first()
            if not claim:
                missing_claim += 1
                continue

            has_action = (
                db.query(Action.id)
                .filter(Action.claim_id == claim_id, Action.npi == claim.npi)
                .first() is not None
            )
            if has_action:
                already_ok += 1
                if not claim.reviewed:          # defensive: reviewed should already be set
                    flipped += 1
                    if apply:
                        claim.reviewed = True
                continue

            action_type = STATUS_TO_ACTION[n.status]
            when = n.response_at or n.created_at or datetime.utcnow()
            created += 1
            if not claim.reviewed:
                flipped += 1

            if len(samples) < 12:
                samples.append(f"claim {claim.ccn} npi={claim.npi} {n.status} "
                               f"-> '{action_type}' at {when}  (reviewed {claim.reviewed}->True)")

            if apply:
                db.add(Action(
                    claim_id=claim.id,
                    npi=claim.npi,
                    action_type=action_type,
                    note=f"Backfilled from notification #{n.notification_id} ({n.status}) "
                         f"— reconciled review state.",
                    vendor_id=claim.vendor_id,
                    vendor_name=claim.vendor_name,
                    patient_name=claim.patient_name,
                    claim_amount=claim.claim_amount,
                    broadcast=False,
                    created_at=when,
                ))
                claim.reviewed = True

        print("=" * 72)
        print("APPLY (writing)" if apply else "DRY RUN (no writes)")
        print("=" * 72)
        print(f"  decided notifications w/ claim_id: {len(notifs)}")
        print(f"  distinct claims:                   {len(best_by_claim)}")
        print(f"  already consistent (skipped):      {already_ok}")
        print(f"  claim row missing (skipped):       {missing_claim}")
        print(f"  Action rows to create:             {created}")
        print(f"  reviewed flags to flip -> True:    {flipped}")
        print("\n  samples:")
        for s in samples:
            print(f"    - {s}")

        if apply:
            db.commit()
            print("\n  COMMITTED.")
        else:
            db.rollback()
            print("\n  Nothing written (dry run). Re-run with --apply to commit.")
    finally:
        db.close()


if __name__ == "__main__":
    run(apply="--apply" in sys.argv)
