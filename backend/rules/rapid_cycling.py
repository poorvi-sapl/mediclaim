"""Rule: rapid patient cycling — a physician seeing too many DISTINCT patients in one
day (>= 25 unique patients ≈ a new patient every 19 minutes with no repeat visits).
Distinct from impossible_day, which counts total claims. Flags every claim on that day.

rule_rapid_cycling(db, settings) -> [RuleFlagResult]
"""

from sqlalchemy import func, distinct

from .engine import RuleFlagResult
from ..models import Claim

MIN_DISTINCT_PATIENTS = 25


def rule_rapid_cycling(db, settings) -> list:
    days = (
        db.query(Claim.npi, Claim.date_of_service,
                 func.count(distinct(Claim.patient_id)))
        .group_by(Claim.npi, Claim.date_of_service)
        .having(func.count(distinct(Claim.patient_id)) >= MIN_DISTINCT_PATIENTS)
        .all()
    )
    distinct_patients = {(npi, dos): n for npi, dos, n in days}
    if not distinct_patients:
        return []

    results = []
    rows = (
        db.query(Claim.id, Claim.npi, Claim.supplier_id, Claim.date_of_service)
        .filter(Claim.npi.in_({npi for npi, _ in distinct_patients}))
        .all()
    )
    for cid, npi, sid, dos in rows:
        n = distinct_patients.get((npi, dos))
        if n:
            desc = (f"NPI {npi} billed {n} distinct patients on {dos} (threshold "
                    f"{MIN_DISTINCT_PATIENTS}) — unusually high patient turnover")
            results.append(RuleFlagResult(cid, npi, sid, "rapid_cycling", desc, "high"))
    return results
