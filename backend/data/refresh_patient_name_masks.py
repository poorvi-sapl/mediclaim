"""
One-time data fix: regenerates ClaimNotification.patient_name_partial for every
row tied to a real Claim (claim_id IS NOT NULL), using the current
_mask_patient_name() format ("J. Smith" — first-initial + full surname).

Existing rows were masked under the old "J*** S***" convention (every word
reduced to initial+stars) before _mask_patient_name() was changed to keep the
surname in full. Rows with no linked Claim (external-ingest notifications,
claim_id IS NULL) have no source name to remask from, so they're left as-is.

Run:
    python -m backend.data.refresh_patient_name_masks
"""

from backend.database import SessionLocal
from backend.models import Claim, ClaimNotification
from backend.rules.trigger_engine import _mask_patient_name


def main():
    db = SessionLocal()
    try:
        rows = (
            db.query(ClaimNotification, Claim.patient_name)
            .join(Claim, Claim.id == ClaimNotification.claim_id)
            .filter(ClaimNotification.claim_id.isnot(None))
            .all()
        )
        updated = 0
        for notif, patient_name in rows:
            new_mask = _mask_patient_name(patient_name)
            if notif.patient_name_partial != new_mask:
                notif.patient_name_partial = new_mask
                updated += 1
        db.commit()
        print(f"Checked {len(rows)} notifications tied to a real claim, updated {updated}.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
