"""Rule: modifier abuse — same patient, same service category, near-identical (but not
identical) service descriptions billed within 7 days. Too similar to be different
services, too different to be exact duplicates: consistent with reworded line items
billed separately to bypass duplicate-detection.

rule_modifier_abuse(db, settings) -> [RuleFlagResult]
"""

from collections import defaultdict

from .engine import RuleFlagResult
from ..models import Claim

SIM_LOW = 0.40
SIM_HIGH = 0.85
WINDOW_DAYS = 7


def _similarity(a: str, b: str) -> float:
    """Word-overlap ratio: |common words| / |unique words across both|."""
    wa = {w for w in (a or "").lower().split() if w}
    wb = {w for w in (b or "").lower().split() if w}
    if not wa or not wb:
        return 0.0
    union = wa | wb
    return len(wa & wb) / len(union) if union else 0.0


def rule_modifier_abuse(db, settings) -> list:
    rows = (
        db.query(Claim.id, Claim.npi, Claim.vendor_id, Claim.patient_id,
                 Claim.date_of_service, Claim.service_category, Claim.service_description,
                 Claim.cpt_code, Claim.hcpcs_code)
        .all()
    )
    groups = defaultdict(list)   # (npi, patient_id, category) -> [(id, sid, date, desc, code)]
    for cid, npi, sid, pid, dos, cat, desc, cpt, hcpcs in rows:
        groups[(npi, pid, cat)].append((cid, sid, dos, desc, cpt or hcpcs))

    results = []
    flagged = set()
    for (npi, pid, cat), items in groups.items():
        if len(items) < 2:
            continue
        items.sort(key=lambda x: x[2])
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                cid1, sid1, d1, desc1, code1 = items[i]
                cid2, sid2, d2, desc2, code2 = items[j]
                if abs((d2 - d1).days) > WINDOW_DAYS:
                    continue
                # Modifier abuse = SAME billing code, reworded description. Different codes
                # are genuinely different services, not modifier abuse.
                if not code1 or code1 != code2:
                    continue
                sim = _similarity(desc1, desc2)
                if SIM_LOW < sim < SIM_HIGH:
                    detail = (f"Similar services for patient {pid} ({d2}): "
                              f"'{desc1}' vs '{desc2}' (similarity {sim:.0%}) — "
                              f"possible modifier abuse to bypass duplicate checks")
                    for cid, sid in ((cid1, sid1), (cid2, sid2)):
                        if cid not in flagged:
                            flagged.add(cid)
                            results.append(RuleFlagResult(cid, npi, sid, "modifier_abuse", detail, "medium"))
    return results
