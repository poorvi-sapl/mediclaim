"""Rule: supplier concentration — a single supplier accounts for >= 85% of a
physician's claims, an unusually exclusive arrangement suggestive of a kickback /
referral relationship. One flag per physician, placed on their most recent claim from
the dominant supplier.

rule_supplier_concentration(db, settings) -> [RuleFlagResult]
"""

from collections import defaultdict

from sqlalchemy import func

from .engine import RuleFlagResult
from ..models import Claim

CONCENTRATION_THRESHOLD = 0.85


def rule_supplier_concentration(db, settings) -> list:
    totals = dict(
        db.query(Claim.npi, func.count(Claim.id)).group_by(Claim.npi).all()
    )
    per_sup = (
        db.query(Claim.npi, Claim.supplier_id, Claim.supplier_name, func.count(Claim.id))
        .group_by(Claim.npi, Claim.supplier_id, Claim.supplier_name).all()
    )
    top = {}   # npi -> (count, supplier_id, supplier_name)
    for npi, sid, sname, cnt in per_sup:
        if npi not in top or cnt > top[npi][0]:
            top[npi] = (cnt, sid, sname)

    results = []
    for npi, (cnt, sid, sname) in top.items():
        total = totals.get(npi, 0)
        if total == 0:
            continue
        ratio = cnt / total
        if ratio >= CONCENTRATION_THRESHOLD:
            recent = (
                db.query(Claim.id)
                .filter(Claim.npi == npi, Claim.supplier_id == sid)
                .order_by(Claim.date_of_service.desc())
                .first()
            )
            if not recent:
                continue
            desc = (f"{ratio:.0%} of NPI {npi}'s claims flow through a single supplier "
                    f"'{sname}' ({cnt} of {total}) — exclusive arrangement consistent "
                    f"with a kickback / referral relationship")
            results.append(RuleFlagResult(recent[0], npi, sid, "supplier_concentration", desc, "high"))
    return results
