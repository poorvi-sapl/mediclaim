"""
ClaimLens risk scoring (RISK_SCORING_SPEC).

Computes a 0-100 risk score per physician NPI and per supplier from the rule
flags + physician actions, and upserts them into npi_risk_scores. All weights
come from config.py settings — nothing is hardcoded.

Scope note: npi_profiles holds the full NPPES reference (~692k rows), but only
the NPIs that actually have claims are monitored entities. Per project decision,
NPI scoring covers npi_profiles rows that appear in the claims table (the
physicians under management), not the entire reference dump.
"""

import math
from collections import defaultdict
from datetime import datetime
from decimal import Decimal
from typing import NamedTuple

from sqlalchemy import and_, case, func, distinct
from sqlalchemy.orm import Session

from backend.database import SessionLocal
from backend.models import NpiProfile, Claim, Action, RulesFlag, NpiRiskScore
from backend.config import get_settings
from backend.schemas import RISK_BAND_BOUNDS, RISK_BAND_ORDER

FLAG_ACTIONS = ("flag_supplier", "unknown_patient", "deceased_patient")
# physician actions that contribute to the score (did_not_order weighs more)
SCORED_PHYS_ACTIONS = ("flag_supplier", "unknown_patient", "deceased_patient", "did_not_order")


def _fired_rules(db: Session, column, value) -> set:
    return {r[0] for r in
            db.query(RulesFlag.rule_name).filter(column == value).distinct().all()}


def _percentiles(values: list) -> list:
    """Population percentile rank in [0,1] for each value (ties share the midpoint).

    Used so continuous signals (volume, dollars, breadth) spread evenly across the
    monitored population regardless of the raw distribution's shape — this is what
    breaks up the old bimodal clustering.
    """
    n = len(values)
    if n <= 1:
        return [0.0] * n
    out = []
    for v in values:
        less = sum(1 for x in values if x < v)
        eq = sum(1 for x in values if x == v)
        out.append((less + 0.5 * eq) / n)
    return out


def _shape_score(raw_points: float, cont_norm: float, settings) -> int:
    """Blend rule/action 'risk points' (via a saturating curve) with the continuous
    signal (already normalized to [0,1]) into a 0-100 integer.

    severity   = score_severity_max * (1 - e^(-raw/K))   -> asymptotes, never a hard cap
    continuous = score_continuous_max * cont_norm
    """
    severity = settings.score_severity_max * (1 - math.exp(-raw_points / settings.score_curve_k))
    continuous = settings.score_continuous_max * cont_norm
    return int(round(min(severity + continuous, 100)))


class PhysicianFeedback(NamedTuple):
    count: int          # how many scored physician actions exist
    points: int         # what they contribute to the risk score, capped
    by_action: dict     # raw per-action-type counts, for labels like "3 flag x 5"


def physician_feedback(db: Session, column, value, settings=None) -> PhysicianFeedback:
    """Weighted physician contribution: flag/unknown/deceased each worth
    weight_per_physician_flag, did_not_order worth weight_did_not_order, total
    capped at max_physician_flag_contribution.

    The one definition of this arithmetic. The scorer calls it to build the stored
    risk_score, dashboard.get_npi_detail calls it for the "Physician feedback" row
    of the score breakdown, and chat_tools calls it so the assistant explains a
    score with the same number the screen shows. `column` lets it serve both
    physicians (Action.npi) and vendors (Action.vendor_id).
    """
    settings = settings or get_settings()
    rows = (
        db.query(Action.action_type, func.count(Action.id))
        .filter(column == value, Action.action_type.in_(SCORED_PHYS_ACTIONS))
        .group_by(Action.action_type).all()
    )
    counts = {a: c for a, c in rows}
    weighted = (
        (counts.get("flag_supplier", 0) + counts.get("unknown_patient", 0) + counts.get("deceased_patient", 0))
        * settings.weight_per_physician_flag
        + counts.get("did_not_order", 0) * settings.weight_did_not_order
    )
    return PhysicianFeedback(
        count=sum(counts.values()),
        points=min(weighted, settings.max_physician_flag_contribution),
        by_action=counts,
    )


def band_counts(db: Session, entity_type: str = "npi") -> dict:
    """How many scored entities sit in each risk band, keyed by band name (plus
    "total"). The one band-bucketing query — the plan summary, the analytics
    risk-distribution chart and the assistant's plan_overview all read this, so
    their numbers cannot drift."""
    buckets = {
        band: func.sum(case((and_(NpiRiskScore.risk_score >= lo,
                                  NpiRiskScore.risk_score <= hi), 1), else_=0)).label(band)
        for band, (lo, hi) in RISK_BAND_BOUNDS.items()
    }
    row = (db.query(func.count(NpiRiskScore.id).label("total"), *buckets.values())
           .filter(NpiRiskScore.entity_type == entity_type).one())
    out = {band: int(getattr(row, band) or 0) for band in RISK_BAND_ORDER}
    out["total"] = int(row.total or 0)
    return out


# ---------------------------------------------------------------------------
# FUNCTION 1 — NPI scores
# ---------------------------------------------------------------------------
def _npi_rule_points(fired: set, settings) -> float:
    pts = 0.0
    if "volume_spike" in fired:              pts += settings.weight_volume_spike
    if "geographic_anomaly" in fired:        pts += settings.weight_geo_anomaly
    if "cross_npi_supplier" in fired:        pts += settings.weight_cross_npi
    if "oig_leie_hit" in fired:              pts += settings.weight_oig_hit
    if "new_high_value_supplier" in fired:   pts += settings.weight_new_vendor
    if "duplicate_billing" in fired:         pts += settings.weight_duplicate_billing
    if "identity_reuse" in fired:            pts += settings.weight_identity_reuse
    if "abnormal_hospice_duration" in fired: pts += settings.weight_hospice_duration
    if "upcoding" in fired:                  pts += settings.weight_upcoding
    if "unbundling" in fired:                pts += settings.weight_unbundling
    return pts


def calculate_npi_scores(db: Session, settings) -> None:
    npis = (
        db.query(NpiProfile.npi, NpiProfile.physician_name)
        .filter(NpiProfile.npi.in_(db.query(Claim.npi).distinct()))
        .all()
    )
    total = len(npis)

    # --- new-rule contributions (per-unit with caps), batched ---
    # flag counts per (npi, rule) — used for deceased_patient (per flag) and
    # modifier_abuse (per pair = 2 flags).
    _fc = defaultdict(dict)
    for npi, rule, n in (
        db.query(RulesFlag.npi, RulesFlag.rule_name, func.count(RulesFlag.id))
        .filter(RulesFlag.rule_name.in_(
            ("deceased_patient", "modifier_abuse", "supplier_concentration", "ghost_billing")))
        .group_by(RulesFlag.npi, RulesFlag.rule_name).all()
    ):
        _fc[npi][rule] = n
    # distinct flagged DAYS per (npi, rule) for impossible_day / rapid_cycling
    _dc = defaultdict(dict)
    for npi, rule, d in (
        db.query(RulesFlag.npi, RulesFlag.rule_name, func.count(distinct(Claim.date_of_service)))
        .join(Claim, Claim.id == RulesFlag.claim_id)
        .filter(RulesFlag.rule_name.in_(("impossible_day", "rapid_cycling")))
        .group_by(RulesFlag.npi, RulesFlag.rule_name).all()
    ):
        _dc[npi][rule] = d
    # dominant-supplier share per npi (for the >95% concentration tier)
    _tot, _topc = defaultdict(int), defaultdict(int)
    for npi, sid, c in (
        db.query(Claim.npi, Claim.vendor_id, func.count(Claim.id))
        .group_by(Claim.npi, Claim.vendor_id).all()
    ):
        _tot[npi] += c
        if c > _topc[npi]:
            _topc[npi] = c

    def _new_rule_points(npi):
        fc, dc = _fc.get(npi, {}), _dc.get(npi, {})
        p = 0.0
        p += min(fc.get("deceased_patient", 0) * 15, 20)
        p += min(dc.get("impossible_day", 0) * 15, 30)
        p += min(dc.get("rapid_cycling", 0) * 15, 30)
        p += min((fc.get("modifier_abuse", 0) // 2) * 6, 12)
        if fc.get("supplier_concentration", 0) > 0:
            share = (_topc[npi] / _tot[npi]) if _tot.get(npi) else 0
            p += 12 if share > 0.95 else 8
        # Ghost billing: proportional to fraction of claims flagged.
        # T3 (~70% flagged) → ~20 pts; T2 (~30%) → ~8 pts; T1 (~5%) → ~1.4 pts (noise).
        ghost_count = fc.get("ghost_billing", 0)
        if ghost_count > 0:
            ghost_frac = ghost_count / max(_tot.get(npi, 1), 1)
            p += min(ghost_frac * 28, settings.weight_ghost_billing)
        return p

    # PASS 1 — gather raw rule/action + continuous signals per NPI.
    recs = []
    for npi, physician_name in npis:
        fired = _fired_rules(db, RulesFlag.npi, npi)
        feedback = physician_feedback(db, Action.npi, npi, settings)
        physician_flag_count, flag_contribution = feedback.count, feedback.points

        claim_count = db.query(func.count(Claim.id)).filter(Claim.npi == npi).scalar() or 0
        claim_amount = db.query(
            func.coalesce(func.sum(Claim.claim_amount), 0)
        ).filter(Claim.npi == npi).scalar()
        supplier_count = (
            db.query(func.count(distinct(Claim.vendor_id))).filter(Claim.npi == npi).scalar()
        ) or 0
        oig_claims = db.query(func.count(Claim.id)).filter(
            Claim.npi == npi, Claim.oig_flagged.is_(True)
        ).scalar() or 0
        flagged_frac = (oig_claims / claim_count) if claim_count else 0.0

        top = (
            db.query(Claim.vendor_id, Claim.vendor_name)
            .filter(Claim.npi == npi)
            .group_by(Claim.vendor_id, Claim.vendor_name)
            .order_by(func.count(Claim.id).desc())
            .first()
        )

        recs.append(dict(
            npi=npi, name=physician_name, fired=fired,
            physician_flag_count=physician_flag_count,
            raw_points=_npi_rule_points(fired, settings) + flag_contribution + _new_rule_points(npi),
            claim_count=claim_count, claim_amount=claim_amount,
            supplier_count=supplier_count, flagged_frac=flagged_frac,
            top_vendor_id=top[0] if top else None,
            top_vendor_name=top[1] if top else None,
        ))

    # Population percentiles for the continuous signals (spread the scores).
    vol_p = _percentiles([r["claim_count"] for r in recs])
    amt_p = _percentiles([float(r["claim_amount"] or 0) for r in recs])
    brd_p = _percentiles([r["supplier_count"] for r in recs])

    # PASS 2 — blend into a 0-100 score and upsert.
    for i, r in enumerate(recs, 1):
        cont_norm = (settings.score_w_volume * vol_p[i - 1]
                     + settings.score_w_amount * amt_p[i - 1]
                     + settings.score_w_breadth * brd_p[i - 1]
                     + settings.score_w_flagged * r["flagged_frac"])
        score = _shape_score(r["raw_points"], cont_norm, settings)
        fired = r["fired"]

        fields = dict(
            entity_name=r["name"],
            risk_score=score,
            volume_flag="volume_spike" in fired,
            geo_flag="geographic_anomaly" in fired,
            cross_npi_flag="cross_npi_supplier" in fired,
            oig_flag="oig_leie_hit" in fired,
            new_vendor_flag="new_high_value_supplier" in fired,
            identity_reuse_flag="identity_reuse" in fired,
            hospice_duration_flag="abnormal_hospice_duration" in fired,
            upcoding_flag="upcoding" in fired,
            unbundling_flag="unbundling" in fired,
            physician_flag_count=r["physician_flag_count"],
            total_claim_count=r["claim_count"],
            total_claim_amount=r["claim_amount"],
            top_vendor_id=r["top_vendor_id"],
            top_vendor_name=r["top_vendor_name"],
            distinct_npi_count=None,
            last_calculated=datetime.utcnow(),
        )
        existing = (
            db.query(NpiRiskScore)
            .filter_by(entity_type="npi", entity_id=r["npi"]).first()
        )
        if existing:
            for k, v in fields.items():
                setattr(existing, k, v)
        else:
            db.add(NpiRiskScore(entity_type="npi", entity_id=r["npi"], **fields))

        if i % 50 == 0 or i == total:
            db.commit()
            print(f"NPI scores: {i}/{total} complete")


# ---------------------------------------------------------------------------
# FUNCTION 2 — supplier scores
# ---------------------------------------------------------------------------
def _supplier_rule_points(fired: set, settings) -> float:
    # volume_spike and geographic_anomaly do NOT apply to suppliers
    pts = 0.0
    if "cross_npi_supplier" in fired:      pts += settings.weight_cross_npi
    if "oig_leie_hit" in fired:            pts += settings.weight_oig_hit
    if "new_high_value_supplier" in fired: pts += settings.weight_new_vendor
    if "duplicate_billing" in fired:       pts += settings.weight_duplicate_billing
    return pts


def calculate_supplier_scores(db: Session, settings) -> None:
    supplier_ids = [r[0] for r in db.query(Claim.vendor_id).distinct().all()]
    total = len(supplier_ids)

    # PASS 1 — gather raw rule/action + continuous signals per supplier.
    recs = []
    for supplier_id in supplier_ids:
        fired = _fired_rules(db, RulesFlag.vendor_id, supplier_id)
        feedback = physician_feedback(db, Action.vendor_id, supplier_id, settings)
        physician_flag_count, flag_contribution = feedback.count, feedback.points

        supplier_name = (
            db.query(Claim.vendor_name)
            .filter(Claim.vendor_id == supplier_id).first()[0]
        )
        claim_count = db.query(func.count(Claim.id)).filter(
            Claim.vendor_id == supplier_id).scalar() or 0
        claim_amount = db.query(
            func.coalesce(func.sum(Claim.claim_amount), 0)
        ).filter(Claim.vendor_id == supplier_id).scalar()
        distinct_npi_count = db.query(func.count(distinct(Claim.npi))).filter(
            Claim.vendor_id == supplier_id).scalar() or 0
        oig_claims = db.query(func.count(Claim.id)).filter(
            Claim.vendor_id == supplier_id, Claim.oig_flagged.is_(True)
        ).scalar() or 0
        flagged_frac = (oig_claims / claim_count) if claim_count else 0.0

        recs.append(dict(
            supplier_id=supplier_id, name=supplier_name, fired=fired,
            physician_flag_count=physician_flag_count,
            raw_points=_supplier_rule_points(fired, settings) + flag_contribution,
            claim_count=claim_count, claim_amount=claim_amount,
            distinct_npi_count=distinct_npi_count, flagged_frac=flagged_frac,
        ))

    vol_p = _percentiles([r["claim_count"] for r in recs])
    amt_p = _percentiles([float(r["claim_amount"] or 0) for r in recs])
    brd_p = _percentiles([r["distinct_npi_count"] for r in recs])

    # PASS 2 — blend + upsert.
    for i, r in enumerate(recs, 1):
        cont_norm = (settings.score_w_volume * vol_p[i - 1]
                     + settings.score_w_amount * amt_p[i - 1]
                     + settings.score_w_breadth * brd_p[i - 1]
                     + settings.score_w_flagged * r["flagged_frac"])
        score = _shape_score(r["raw_points"], cont_norm, settings)
        fired = r["fired"]

        fields = dict(
            entity_name=r["name"],
            risk_score=score,
            volume_flag=False,
            geo_flag=False,
            cross_npi_flag="cross_npi_supplier" in fired,
            oig_flag="oig_leie_hit" in fired,
            new_vendor_flag="new_high_value_supplier" in fired,
            physician_flag_count=r["physician_flag_count"],
            total_claim_count=r["claim_count"],
            total_claim_amount=r["claim_amount"],
            top_vendor_id=None,
            top_vendor_name=None,
            distinct_npi_count=r["distinct_npi_count"],
            last_calculated=datetime.utcnow(),
        )
        existing = (
            db.query(NpiRiskScore)
            .filter_by(entity_type="supplier", entity_id=r["supplier_id"]).first()
        )
        if existing:
            for k, v in fields.items():
                setattr(existing, k, v)
        else:
            db.add(NpiRiskScore(entity_type="supplier", entity_id=r["supplier_id"], **fields))

        if i % 50 == 0 or i == total:
            db.commit()
            print(f"Supplier scores: {i}/{total} complete")


# ---------------------------------------------------------------------------
# FUNCTION 3 — orchestrator
# ---------------------------------------------------------------------------
def calculate_all_scores(db: Session, settings) -> None:
    calculate_npi_scores(db, settings)
    print("NPI scoring complete")
    calculate_supplier_scores(db, settings)
    print("Supplier scoring complete")


# ---------------------------------------------------------------------------
# FUNCTION 4 — incremental supplier flag bump (used by POST /actions)
# ---------------------------------------------------------------------------
def increment_supplier_flag_count(db: Session, supplier_id: str, settings) -> None:
    score_row = (
        db.query(NpiRiskScore)
        .filter_by(entity_type="supplier", entity_id=supplier_id).first()
    )
    if not score_row:
        return

    score_row.physician_flag_count += 1
    # Live nudge: bump the existing (blended-scale) score by one per-flag weight,
    # capped at 100. The authoritative blended score is recomputed by the batch
    # calculate_supplier_scores run; this just reflects the new flag immediately.
    score_row.risk_score = min(
        (score_row.risk_score or 0) + settings.weight_per_physician_flag, 100)
    score_row.last_calculated = datetime.utcnow()
    db.commit()
