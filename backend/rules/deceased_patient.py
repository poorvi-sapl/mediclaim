"""Rule: billing for deceased patients (proxy).

Synthetic data has no death dates, so we use a reappearance proxy: a patient with no
activity anywhere for >180 days who then resurfaces under a DIFFERENT physician than
the one who last billed them — consistent with billing after death or identity reuse.

Same shape as the other engine rules: rule_deceased_patient(db, settings) -> [RuleFlagResult].
"""

from .engine import RuleFlagResult
from ..models import Claim

GAP_DAYS = 180


def rule_deceased_patient(db, settings) -> list:
    rows = (
        db.query(Claim.id, Claim.npi, Claim.vendor_id, Claim.patient_id,
                 Claim.date_of_service)
        .order_by(Claim.patient_id, Claim.date_of_service)
        .all()
    )
    results = []
    prev = {}   # patient_id -> (date, npi)
    for cid, npi, sid, pid, dos in rows:
        p = prev.get(pid)
        if p is not None:
            prev_date, prev_npi = p
            gap = (dos - prev_date).days
            if gap > GAP_DAYS and npi != prev_npi:
                desc = (f"Patient {pid} had no activity for {gap} days "
                        f"(last seen {prev_date} under NPI {prev_npi}); this {dos} claim "
                        f"resurfaces under a different physician — consistent with billing "
                        f"after patient death / identity reuse")
                results.append(RuleFlagResult(cid, npi, sid, "deceased_patient", desc, "high"))
        prev[pid] = (dos, npi)
    return results
