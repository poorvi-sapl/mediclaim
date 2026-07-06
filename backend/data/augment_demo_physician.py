"""Plant a few claims of each NEWER fraud pattern under the demo physician
(Dr. James Wilson, NPI 1234567890) so all 10 patterns are demonstrable from the
physician's own "My Claims" view — not just on other NPIs.

Patterns injected under Wilson:
  - upcoding         : DME claims billed far above the category norm
  - unbundling       : one visit split into 3 component CPT codes (same patient/date/supplier)
  - identity_reuse   : a patient also billed under two other NPIs (spans 3 NPIs)
  - hospice duration : a hospice patient enrolled > 180 days

Idempotent: removes any prior 'pat-WILSON-DEMO-*' claims first, then re-inserts.
Run:  python -m backend.data.augment_demo_physician
"""

import uuid
import logging
from datetime import date

from ..database import SessionLocal
from ..models import Claim

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("augment_demo_physician")

WILSON = "1234567890"
OTHER_NPIS = ["1013976174", "1427040922"]   # for the identity-reuse pattern
ZIP, STATE = "94103", "CA"
PLAN = "California Medi-Cal"
NS = uuid.uuid5(uuid.NAMESPACE_DNS, "claimlens.demo.physician")


def _claim(db, *, key, npi, patient_id, patient_name, category, supplier, supplier_id,
           amount, dos, desc, cpt=None, hcpcs=None):
    db.add(Claim(
        id=uuid.uuid5(NS, key),
        npi=npi, patient_id=patient_id, patient_name=patient_name,
        patient_zip=ZIP, patient_state=STATE, patient_lat=None, patient_lng=None,
        date_of_service=dos, cpt_code=cpt, hcpcs_code=hcpcs,
        service_description=desc, service_category=category,
        vendor_name=supplier, vendor_id=supplier_id, vendor_zip=ZIP, vendor_state=STATE,
        claim_amount=amount, plan_name=PLAN, oig_flagged=False, reviewed=False,
    ))


def main():
    db = SessionLocal()
    try:
        # idempotent reset of previously-planted demo claims
        db.query(Claim).filter(Claim.patient_id.like("pat-WILSON-DEMO-%")).delete(
            synchronize_session=False)
        db.commit()

        # 1) UPCODING — DME claims far above the norm
        for i, amt in enumerate([8900.00, 9650.00], 1):
            _claim(db, key=f"up-{i}", npi=WILSON, patient_id=f"pat-WILSON-DEMO-UP-{i}",
                   patient_name=f"Demo Upcode Patient {i}", category="dme",
                   supplier="Apex DME Solutions", supplier_id="sup-demo-apex",
                   amount=amt, dos=date(2026, 5, 12), hcpcs="E1399",
                   desc="Custom power wheelchair (high-end billing)")

        # 2) UNBUNDLING — one visit split into 3 component CPT codes
        for code, amt in [("99201", 210.00), ("99211", 185.00), ("99213", 240.00)]:
            _claim(db, key=f"unb-{code}", npi=WILSON, patient_id="pat-WILSON-DEMO-UNB",
                   patient_name="Demo Unbundle Patient", category="hospital",
                   supplier="Comprehensive Care Services LLC", supplier_id="sup-demo-comp",
                   amount=amt, dos=date(2026, 5, 16), cpt=code,
                   desc=f"Office visit component {code}")

        # 3) IDENTITY REUSE — same patient billed under Wilson + two other NPIs
        for npi in [WILSON] + OTHER_NPIS:
            _claim(db, key=f"reuse-{npi}", npi=npi, patient_id="pat-WILSON-DEMO-REUSE",
                   patient_name="Demo Reused Patient", category="home_health",
                   supplier="Statewide Home Care", supplier_id="sup-demo-state",
                   amount=620.00, dos=date(2026, 5, 18), hcpcs="G0156",
                   desc="Home health aide visit")

        # 4) ABNORMAL HOSPICE DURATION — enrolled > 180 days
        for i, dos in enumerate([date(2025, 8, 1), date(2026, 5, 1)], 1):
            _claim(db, key=f"hosp-{i}", npi=WILSON, patient_id="pat-WILSON-DEMO-HOSP",
                   patient_name="Demo Hospice Patient", category="hospice",
                   supplier="Evergreen Hospice Care LLC", supplier_id="sup-demo-ever",
                   amount=320.00, dos=dos, hcpcs="Q5001",
                   desc="Routine home hospice care")

        db.commit()
        n = db.query(Claim).filter(Claim.patient_id.like("pat-WILSON-DEMO-%")).count()
        log.info(f"Planted {n} demo-physician claims under NPI {WILSON} "
                 f"(upcoding, unbundling, identity_reuse, hospice).")
    finally:
        db.close()


if __name__ == "__main__":
    main()
