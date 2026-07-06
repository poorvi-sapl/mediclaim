"""
Pre-seed 5 physician actions so the plan dashboard shows existing alert
history from the start of a demo. Idempotent: re-running is a no-op once the
5 demo_seed actions exist.

Seed actions are backdated 2 days so they appear in total_physician_flags and
in the SSE replay, but NOT in "alerts today" (which should read 0 on a fresh
reset).
"""

import sys
from datetime import datetime, timedelta

from backend.database import SessionLocal
from backend.config import get_settings
from backend.models import Claim, Action, NpiProfile
from backend.scoring.risk_score import increment_supplier_flag_count

WILSON = "1234567890"
SEED_NOTE = "demo_seed"
SEED_AGE_DAYS = 2
MEDSUPPLY = "MedSupply Pro LLC"
QUICKCARE = "QuickCare Equipment Inc"
REUSE_PATIENT = "pat-FRAUD-001-REUSE"


def main() -> int:
    db = SessionLocal()
    settings = get_settings()
    try:
        if db.query(Action).filter(Action.note == SEED_NOTE).count() >= 5:
            print("Already seeded")
            return 0

        seeded_at = datetime.utcnow() - timedelta(days=SEED_AGE_DAYS)

        # 1: MedSupply under Dr. Wilson
        c1 = db.query(Claim).filter(
            Claim.vendor_name == MEDSUPPLY, Claim.npi == WILSON).first()
        # 2: MedSupply under a different NPI
        c2 = db.query(Claim).filter(
            Claim.vendor_name == MEDSUPPLY, Claim.npi != WILSON).first()
        npi2 = c2.npi if c2 else None
        # 3: MedSupply under a third NPI
        exclude = [n for n in (WILSON, npi2) if n]
        c3 = db.query(Claim).filter(
            Claim.vendor_name == MEDSUPPLY, Claim.npi.notin_(exclude)).first()
        # 4: QuickCare Equipment
        c4 = db.query(Claim).filter(Claim.vendor_name == QUICKCARE).first()
        # 5: patient-reuse claim (spec says "under Wilson"; reuse claims are
        #    non-Wilson by design — try Wilson first, then any reuse claim)
        c5 = db.query(Claim).filter(
            Claim.patient_id == REUSE_PATIENT, Claim.npi == WILSON).first()
        if not c5:
            c5 = db.query(Claim).filter(Claim.patient_id == REUSE_PATIENT).first()

        specs = [(c1, "flag_supplier"), (c2, "flag_supplier"),
                 (c3, "flag_supplier"), (c4, "flag_supplier"),
                 (c5, "unknown_patient")]
        missing = [i for i, (c, _) in enumerate(specs, 1) if c is None]
        if missing:
            raise RuntimeError(f"Could not find seed claims for action(s): {missing}")

        created = []
        for claim, atype in specs:
            action = Action(
                claim_id=claim.id, npi=claim.npi, action_type=atype,
                note=SEED_NOTE, vendor_id=claim.vendor_id,
                vendor_name=claim.vendor_name, patient_name=claim.patient_name,
                claim_amount=claim.claim_amount, broadcast=False,
                created_at=seeded_at,
            )
            db.add(action)
            claim.reviewed = True
            created.append((claim, atype))
        db.commit()  # all 5 actions + reviewed flags in one transaction

        # bump supplier risk scores for flag_supplier actions
        for claim, atype in created:
            if atype == "flag_supplier":
                increment_supplier_flag_count(db, claim.vendor_id, settings)

        for claim, atype in created:
            prof = db.query(NpiProfile.physician_name).filter(
                NpiProfile.npi == claim.npi).first()
            name = prof[0] if prof else claim.npi
            print(f"  seeded {atype:<15} | {name} -> {claim.vendor_name}")

        print("5 demo actions seeded successfully")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
