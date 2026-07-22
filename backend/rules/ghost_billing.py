"""Rule 16 — ghost_billing

Ghost billing: a supplier bills Medicare for a physician's services, but the
physician has no corresponding bill record on file.  We detect this by checking
whether each claim under an NPI has a matching PhysicianBill (same NPI, fuzzy
patient-name match >= 85, service_date within ±3 days).

Coverage by tier (set during seeding):
  Tier 1 — 95% of claims have bills  → ~5% flagged  (clean physicians)
  Tier 2 — 70% of claims have bills  → ~30% flagged (mid-risk)
  Tier 3 — 30% of claims have bills  → ~70% flagged (high-risk)
"""
from collections import defaultdict
from datetime import timedelta

from rapidfuzz import fuzz


def rule_ghost_billing_all(db, settings):
    """Pipeline-compatible wrapper: db + settings → list[RuleFlagResult]."""
    from .engine import RuleFlagResult
    from ..models import Claim, PhysicianBill

    # Load all physician bills into memory grouped by NPI for O(1) lookup
    bills_by_npi: dict[str, list] = defaultdict(list)
    for b in db.query(PhysicianBill).all():
        bills_by_npi[b.npi].append(b)

    # No reference data at all → the rule can't distinguish anything; flagging
    # 100% of claims is noise, not signal. Skip until bills are loaded.
    if not bills_by_npi:
        return []

    all_claims = db.query(Claim).all()
    results: list[RuleFlagResult] = []
    flagged_claims: list[Claim] = []

    # Idempotent recompute: clear stamps from prior runs so claims that gained
    # a matching bill since last run don't stay marked forever.
    for claim in all_claims:
        if claim.verification_status == "ghost_billing_suspected":
            claim.verification_status = "unverified"

    for claim in all_claims:
        npi_bills = bills_by_npi.get(claim.npi, [])
        # Narrow to ±3-day window before fuzzy matching
        candidates = [
            b for b in npi_bills
            if abs((b.service_date - claim.date_of_service).days) <= 3
        ]
        matched = any(
            fuzz.ratio(claim.patient_name, b.patient_name) >= 85
            for b in candidates
        )
        if not matched:
            desc = (
                f"No physician bill on file for patient '{claim.patient_name}' "
                f"under NPI {claim.npi} on or near {claim.date_of_service} — "
                f"possible ghost billing by supplier '{claim.vendor_name}'"
            )
            results.append(RuleFlagResult(
                claim.id, claim.npi, claim.vendor_id,
                "ghost_billing", desc, "high",
            ))
            claim.verification_status = "ghost_billing_suspected"
            flagged_claims.append(claim)

    # verification_status updates ride along with the engine's single
    # end-of-pipeline commit — committing here would also commit the engine's
    # pending rules_flags wipe before the new flags are inserted.

    # Best-effort SSE broadcast so the physician portal can show live alerts.
    # Silent on any error — this runs in a batch context with no active event loop.
    if results:
        try:
            from ..sse import broadcast_alert
            unique_npis = {r.npi for r in results}
            for npi in unique_npis:
                npi_count = sum(1 for r in results if r.npi == npi)
                broadcast_alert(
                    {"type": "ghost_billing", "npi": npi, "count": npi_count},
                    recipient="physician",
                )
        except Exception:
            pass

    return results
