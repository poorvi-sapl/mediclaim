"""
ClaimLens rules engine — 5 guardrail rules (RULES_ENGINE_SPEC.md).

Each rule is a function(db, settings) -> list[RuleFlagResult]. The orchestrator
run_all_rules() wipes rules_flags, runs all 5, and bulk-inserts the results.
All thresholds come from config.py (settings); all reads use SQLAlchemy.
"""

import time
import logging
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from math import radians, sin, cos, asin, sqrt
from statistics import median
from uuid import UUID, uuid4

from sqlalchemy import func, distinct, text, and_
from sqlalchemy.orm import Session

from ..models import Claim, NpiProfile, RulesFlag

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("rules.engine")


@dataclass
class RuleFlagResult:
    claim_id: UUID
    npi: str
    supplier_id: str
    rule_name: str
    rule_description: str
    severity: str


def haversine_miles(lat1, lng1, lat2, lng2) -> float:
    R = 3958.8
    lat1, lng1, lat2, lng2 = float(lat1), float(lng1), float(lat2), float(lng2)
    phi1, phi2 = radians(lat1), radians(lat2)
    dphi = radians(lat2 - lat1)
    dlng = radians(lng2 - lng1)
    a = sin(dphi / 2) ** 2 + cos(phi1) * cos(phi2) * sin(dlng / 2) ** 2
    return 2 * R * asin(sqrt(a))


def _ref_date(db: Session):
    """The DB's CURRENT_DATE — anchor all windows to it (matches verification)."""
    return db.execute(text("SELECT CURRENT_DATE")).scalar()


# ---------------------------------------------------------------------------
# RULE 1 — volume_spike
# ---------------------------------------------------------------------------
def rule_volume_spike(db: Session, settings) -> list[RuleFlagResult]:
    ref = _ref_date(db)
    recent_start = ref - timedelta(days=30)
    base_start = ref - timedelta(days=365)
    base_end = ref - timedelta(days=31)
    mult = settings.volume_spike_multiplier

    recent = dict(
        db.query(Claim.npi, func.count(Claim.id))
        .filter(Claim.date_of_service >= recent_start)
        .group_by(Claim.npi).all()
    )
    baseline = dict(
        db.query(Claim.npi, func.count(Claim.id))
        .filter(Claim.date_of_service >= base_start,
                Claim.date_of_service <= base_end)
        .group_by(Claim.npi).all()
    )

    flagged = {}
    for npi, recent_count in recent.items():
        baseline_count = baseline.get(npi, 0)
        if baseline_count == 0:
            continue  # SKIP — no baseline to compare against
        recent_rate = recent_count / 30
        baseline_rate = baseline_count / 60
        if recent_rate > baseline_rate * mult:
            ratio = recent_rate / baseline_rate
            flagged[npi] = (recent_count, recent_rate, baseline_count,
                            baseline_rate, ratio)

    results = []
    if flagged:
        rows = (
            db.query(Claim.id, Claim.npi, Claim.supplier_id)
            .filter(Claim.npi.in_(list(flagged)),
                    Claim.date_of_service >= recent_start)
            .all()
        )
        for cid, npi, sid in rows:
            rc, rr, bc, br, ratio = flagged[npi]
            desc = (f"NPI {npi} claim rate in last 30 days ({rc} claims, "
                    f"{rr:.1f}/day) is {ratio:.1f}x the prior 60-day baseline "
                    f"({bc} claims, {br:.1f}/day)")
            results.append(RuleFlagResult(cid, npi, sid, "volume_spike", desc, "high"))
    return results


# ---------------------------------------------------------------------------
# RULE 2 — geographic_anomaly
# ---------------------------------------------------------------------------
def rule_geographic_anomaly(db: Session, settings) -> list[RuleFlagResult]:
    threshold = settings.geographic_anomaly_miles
    rows = (
        db.query(Claim.id, Claim.npi, Claim.supplier_id, Claim.patient_zip,
                 Claim.patient_lat, Claim.patient_lng,
                 NpiProfile.practice_zip, NpiProfile.practice_lat,
                 NpiProfile.practice_lng)
        .join(NpiProfile, Claim.npi == NpiProfile.npi)
        .filter(Claim.patient_lat.isnot(None), Claim.patient_lng.isnot(None),
                NpiProfile.practice_lat.isnot(None),
                NpiProfile.practice_lng.isnot(None))
        .all()
    )
    results = []
    for (cid, npi, sid, pzip, plat, plng, prac_zip, prac_lat, prac_lng) in rows:
        dist = haversine_miles(plat, plng, prac_lat, prac_lng)
        if dist > threshold:
            desc = (f"Patient zip {pzip} is {dist:.0f} miles from physician "
                    f"practice zip {prac_zip} (threshold: {threshold:.0f} miles)")
            results.append(RuleFlagResult(cid, npi, sid, "geographic_anomaly",
                                          desc, "medium"))
    return results


# ---------------------------------------------------------------------------
# RULE 3 — cross_npi_supplier
# ---------------------------------------------------------------------------
def rule_cross_npi_supplier(db: Session, settings) -> list[RuleFlagResult]:
    threshold = settings.cross_npi_threshold
    counts = (
        db.query(Claim.supplier_id, func.count(distinct(Claim.npi)))
        .group_by(Claim.supplier_id).all()
    )
    flagged = {sid: cnt for sid, cnt in counts if cnt > threshold}

    results = []
    if flagged:
        rows = (
            db.query(Claim.id, Claim.npi, Claim.supplier_id, Claim.supplier_name)
            .filter(Claim.supplier_id.in_(list(flagged))).all()
        )
        for cid, npi, sid, sname in rows:
            desc = (f"Supplier '{sname}' is billing under {flagged[sid]} distinct "
                    f"physician NPIs (threshold: {threshold})")
            results.append(RuleFlagResult(cid, npi, sid, "cross_npi_supplier",
                                          desc, "critical"))
    return results


# ---------------------------------------------------------------------------
# RULE 4 — new_high_value_supplier
# ---------------------------------------------------------------------------
def rule_new_high_value_supplier(db: Session, settings) -> list[RuleFlagResult]:
    ref = _ref_date(db)
    cutoff = ref - timedelta(days=settings.new_supplier_days_lookback)
    amt_threshold = settings.new_supplier_amount_threshold

    pairs = (
        db.query(Claim.npi, Claim.supplier_id, func.min(Claim.date_of_service))
        .group_by(Claim.npi, Claim.supplier_id).all()
    )
    new_pairs = {(npi, sid) for npi, sid, first_seen in pairs if first_seen >= cutoff}

    results = []
    if new_pairs:
        rows = (
            db.query(Claim.id, Claim.npi, Claim.supplier_id, Claim.supplier_name,
                     Claim.claim_amount)
            .filter(Claim.claim_amount > amt_threshold).all()
        )
        for cid, npi, sid, sname, amount in rows:
            if (npi, sid) in new_pairs:
                desc = (f"Supplier '{sname}' appeared for the first time under NPI "
                        f"{npi} within the last {settings.new_supplier_days_lookback} "
                        f"days with claim amount ${float(amount):.2f} "
                        f"(threshold: ${amt_threshold:.2f})")
                results.append(RuleFlagResult(cid, npi, sid,
                                              "new_high_value_supplier", desc,
                                              "medium"))
    return results


# ---------------------------------------------------------------------------
# RULE 5 — oig_leie_hit
# ---------------------------------------------------------------------------
def rule_oig_leie_hit(db: Session, settings) -> list[RuleFlagResult]:
    rows = (
        db.query(Claim.id, Claim.npi, Claim.supplier_id, Claim.supplier_name)
        .filter(Claim.oig_flagged.is_(True)).all()
    )
    results = []
    for cid, npi, sid, sname in rows:
        desc = (f"Supplier '{sname}' appears on the OIG LEIE exclusion list. "
                f"Medicare/Medicaid cannot reimburse claims from excluded providers.")
        results.append(RuleFlagResult(cid, npi, sid, "oig_leie_hit", desc, "critical"))
    return results


# ---------------------------------------------------------------------------
# RULE 6 — duplicate_billing
# ---------------------------------------------------------------------------
def rule_duplicate_billing(db: Session, settings) -> list[RuleFlagResult]:
    """Same patient + same service (hcpcs) + same date under the same NPI billed
    by more than one supplier — classic duplicate-billing fraud."""
    dup = (
        db.query(
            Claim.npi, Claim.patient_id, Claim.date_of_service, Claim.hcpcs_code,
        )
        .filter(Claim.hcpcs_code.isnot(None))
        .group_by(Claim.npi, Claim.patient_id, Claim.date_of_service,
                  Claim.hcpcs_code)
        .having(func.count(func.distinct(Claim.supplier_id)) > 1)
        .subquery()
    )

    duplicate_claims = (
        db.query(Claim)
        .join(dup, and_(
            Claim.npi == dup.c.npi,
            Claim.patient_id == dup.c.patient_id,
            Claim.date_of_service == dup.c.date_of_service,
            Claim.hcpcs_code == dup.c.hcpcs_code,
        ))
        .all()
    )

    results = []
    for claim in duplicate_claims:
        desc = (f"Patient {claim.patient_id} received the same service "
                f"({claim.hcpcs_code}) from multiple suppliers on "
                f"{claim.date_of_service} under NPI {claim.npi} — "
                f"possible duplicate billing")
        results.append(RuleFlagResult(claim.id, claim.npi, claim.supplier_id,
                                      "duplicate_billing", desc, "high"))
    return results


# ---------------------------------------------------------------------------
# RULE 7 — identity_reuse  (same patient billed under many unrelated NPIs)
# ---------------------------------------------------------------------------
def rule_identity_reuse(db: Session, settings) -> list[RuleFlagResult]:
    threshold = settings.identity_reuse_min_npis
    counts = (
        db.query(Claim.patient_id, func.count(distinct(Claim.npi)))
        .group_by(Claim.patient_id)
        .having(func.count(distinct(Claim.npi)) >= threshold).all()
    )
    flagged = {pid: n for pid, n in counts}
    results = []
    if flagged:
        rows = (
            db.query(Claim.id, Claim.npi, Claim.supplier_id, Claim.patient_id)
            .filter(Claim.patient_id.in_(list(flagged))).all()
        )
        for cid, npi, sid, pid in rows:
            desc = (f"Patient ID {pid} is billed under {flagged[pid]} different "
                    f"physician NPIs (threshold {threshold}) — possible patient "
                    f"identity reuse / phantom billing")
            results.append(RuleFlagResult(cid, npi, sid, "identity_reuse", desc, "high"))
    return results


# ---------------------------------------------------------------------------
# RULE 8 — abnormal_hospice_duration  (hospice enrollment beyond threshold)
# ---------------------------------------------------------------------------
def rule_abnormal_hospice_duration(db: Session, settings) -> list[RuleFlagResult]:
    threshold = settings.hospice_duration_days
    rows = (
        db.query(Claim.patient_id, func.min(Claim.date_of_service),
                 func.max(Claim.date_of_service))
        .filter(Claim.
        service_category == "hospice")
        .group_by(Claim.patient_id).all()
    )
    flagged = {}
    for pid, mn, mx in rows:
        if mn and mx and (mx - mn).days > threshold:
            flagged[pid] = (mx - mn).days
    results = []
    if flagged:
        crows = (
            db.query(Claim.id, Claim.npi, Claim.supplier_id, Claim.patient_id)
            .filter(Claim.service_category == "hospice",
                    Claim.patient_id.in_(list(flagged))).all()
        )
        for cid, npi, sid, pid in crows:
            desc = (f"Hospice patient {pid} enrolled across {flagged[pid]} days "
                    f"(threshold {threshold}) — abnormally long hospice duration")
            results.append(RuleFlagResult(cid, npi, sid,
                                          "abnormal_hospice_duration", desc, "high"))
    return results


# ---------------------------------------------------------------------------
# RULE 9 — upcoding  (claim amount is a statistical outlier for its category)
# ---------------------------------------------------------------------------
def rule_upcoding(db: Session, settings) -> list[RuleFlagResult]:
    mult = settings.upcoding_amount_multiplier
    floor = settings.upcoding_amount_floor
    rows = db.query(Claim.id, Claim.npi, Claim.supplier_id,
                    Claim.service_category, Claim.claim_amount).all()
    by_cat = defaultdict(list)
    for _cid, _npi, _sid, cat, amt in rows:
        by_cat[cat].append(float(amt))
    med = {cat: median(v) for cat, v in by_cat.items() if v}

    results = []
    for cid, npi, sid, cat, amt in rows:
        amt = float(amt)
        m = med.get(cat, 0)
        if m > 0 and amt > floor and amt > mult * m:
            desc = (f"Claim amount ${amt:,.2f} is {amt / m:.1f}x the median for "
                    f"'{cat}' (${m:,.2f}) — possible upcoding")
            results.append(RuleFlagResult(cid, npi, sid, "upcoding", desc, "medium"))
    return results


# ---------------------------------------------------------------------------
# RULE 10 — unbundling  (many component codes split across one patient/date/NPI)
# ---------------------------------------------------------------------------
def rule_unbundling(db: Session, settings) -> list[RuleFlagResult]:
    min_codes = settings.unbundling_min_codes
    grp = (
        db.query(Claim.npi, Claim.patient_id, Claim.date_of_service, Claim.supplier_id)
        .filter(Claim.cpt_code.isnot(None))
        .group_by(Claim.npi, Claim.patient_id, Claim.date_of_service, Claim.supplier_id)
        .having(func.count(distinct(Claim.cpt_code)) >= min_codes)
        .subquery()
    )
    rows = (
        db.query(Claim).join(grp, and_(
            Claim.npi == grp.c.npi,
            Claim.patient_id == grp.c.patient_id,
            Claim.date_of_service == grp.c.date_of_service,
            Claim.supplier_id == grp.c.supplier_id,
        )).all()
    )
    results = []
    for c in rows:
        desc = (f"NPI {c.npi} billed {min_codes}+ separate procedure codes for patient "
                f"{c.patient_id} on {c.date_of_service} via '{c.supplier_name}' — "
                f"possible unbundling")
        results.append(RuleFlagResult(c.id, c.npi, c.supplier_id, "unbundling", desc, "high"))
    return results


# ---------------------------------------------------------------------------
# ORCHESTRATOR
# ---------------------------------------------------------------------------
def run_all_rules(db: Session, settings) -> int:
    # New rules live in their own modules (imported lazily to avoid a circular import,
    # since they import RuleFlagResult from this module).
    from .deceased_patient import rule_deceased_patient
    from .impossible_day import rule_impossible_day
    from .modifier_abuse import rule_modifier_abuse
    from .rapid_cycling import rule_rapid_cycling
    from .supplier_concentration import rule_supplier_concentration

    # 1. idempotency — wipe existing flags
    deleted = db.query(RulesFlag).delete()
    db.commit()
    log.info(f"Cleared {deleted} existing rules_flags rows")

    # 2. run rules in the specified order
    pipeline = [
        ("oig_leie_hit", rule_oig_leie_hit),
        ("cross_npi_supplier", rule_cross_npi_supplier),
        ("volume_spike", rule_volume_spike),
        ("geographic_anomaly", rule_geographic_anomaly),
        ("new_high_value_supplier", rule_new_high_value_supplier),
        ("duplicate_billing", rule_duplicate_billing),
        ("identity_reuse", rule_identity_reuse),
        ("abnormal_hospice_duration", rule_abnormal_hospice_duration),
        ("upcoding", rule_upcoding),
        ("unbundling", rule_unbundling),
        # --- new rules ---
        ("deceased_patient", rule_deceased_patient),
        ("impossible_day", rule_impossible_day),
        ("modifier_abuse", rule_modifier_abuse),
        ("rapid_cycling", rule_rapid_cycling),
        ("supplier_concentration", rule_supplier_concentration),
    ]

    all_results: list[RuleFlagResult] = []
    for name, fn in pipeline:
        t0 = time.time()
        res = fn(db, settings)
        elapsed = time.time() - t0
        log.info(f"{name}: {len(res)} flags ({elapsed:.2f}s)")
        all_results.extend(res)

    # 4. bulk insert
    mappings = [
        {
            "id": uuid4(),
            "claim_id": r.claim_id,
            "npi": r.npi,
            "supplier_id": r.supplier_id,
            "rule_name": r.rule_name,
            "rule_description": r.rule_description,
            "severity": r.severity,
            "fired_at": datetime.utcnow(),
        }
        for r in all_results
    ]
    if mappings:
        db.bulk_insert_mappings(RulesFlag, mappings)
        db.commit()

    log.info(f"Total flags written: {len(mappings)}")
    return len(mappings)
