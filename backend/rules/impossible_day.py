"""Rule: impossible day — a physician billing an implausible number of claims on a
single date (>= 40/day ≈ one every 12 minutes). Flags every claim on the offending day.

rule_impossible_day(db, settings) -> [RuleFlagResult]
"""

from sqlalchemy import func

from .engine import RuleFlagResult
from ..models import Claim

MIN_CLAIMS_PER_DAY = 40


def rule_impossible_day(db, settings) -> list:
    days = (
        db.query(Claim.npi, Claim.date_of_service, func.count(Claim.id))
        .group_by(Claim.npi, Claim.date_of_service)
        .having(func.count(Claim.id) >= MIN_CLAIMS_PER_DAY)
        .all()
    )
    counts = {(npi, dos): n for npi, dos, n in days}
    if not counts:
        return []

    results = []
    rows = (
        db.query(Claim.id, Claim.npi, Claim.vendor_id, Claim.date_of_service)
        .filter(Claim.npi.in_({npi for npi, _ in counts}))
        .all()
    )
    for cid, npi, sid, dos in rows:
        n = counts.get((npi, dos))
        if n:
            desc = (f"NPI {npi} billed {n} claims on {dos} (threshold "
                    f"{MIN_CLAIMS_PER_DAY}) — physically implausible for one day")
            results.append(RuleFlagResult(cid, npi, sid, "impossible_day", desc, "high"))
    return results
