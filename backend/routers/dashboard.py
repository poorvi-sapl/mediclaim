from datetime import datetime, date, time, timezone
from typing import Optional

import uuid as _uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.config import get_settings
from backend.models import NpiRiskScore, NpiProfile, Claim, Action, ActionStatusLog, RulesFlag, User, DisputeCase, DisputeCaseEvent, SupplierProfile, ClaimNotification, Physician
from backend.rules.trigger_engine import escalate_overdue_disputes, serialize_dispute_events, record_dispute_event, broadcast_dispute_event
from backend.schemas import (
    PlanSummaryResponse, NpiRiskRow, NpiRiskPageResponse,
    NpiDetailResponse, SupplierWatchlistRow, SupplierPageResponse,
    PlanActionDetail, AlertEvent, StatusLogEntry, get_risk_band,
)
from backend.auth import extract_token, decode_token
from backend.ai_summary import generate_npi_summary
from backend.routers.claims import build_claims_page

router = APIRouter()
FLAG_ACTIONS = ("flag_supplier", "unknown_patient", "did_not_order", "deceased_patient")
# pending → under_review → (acknowledged | case_opened | dismissed)
VALID_PLAN_STATUS = ("pending", "under_review", "acknowledged", "case_opened", "dismissed")
RESOLVED_STATUS = ("acknowledged", "case_opened", "dismissed")


def _case_ref(action) -> Optional[str]:
    return f"CASE-{str(action.id)[:6].upper()}" if action.plan_status == "case_opened" else None


def _investigator_email(request: Request) -> Optional[str]:
    tok = extract_token(request)
    if not tok:
        return None
    try:
        return decode_token(tok).get("email")
    except Exception:
        return None


def _build_action_detail(db: Session, a) -> PlanActionDetail:
    physician_name = (
        db.query(NpiProfile.physician_name).filter(NpiProfile.npi == a.npi).scalar()
    )
    logs = (
        db.query(ActionStatusLog).filter(ActionStatusLog.action_id == a.id)
        .order_by(ActionStatusLog.changed_at.asc()).all()
    )
    history = [StatusLogEntry(
        status=l.status, note=l.note, changed_by=l.changed_by,
        changed_at=l.changed_at.isoformat() if l.changed_at else None,
    ) for l in logs]
    return PlanActionDetail(
        action_id=str(a.id), npi=a.npi, physician_name=physician_name,
        vendor_name=a.vendor_name, vendor_id=a.vendor_id,
        claim_id=str(a.claim_id), action_type=a.action_type,
        amount=float(a.claim_amount), created_at=a.created_at,
        plan_status=a.plan_status or "pending", case_ref=_case_ref(a), history=history,
    )


# ---------------------------------------------------------------------------
# GET /plan/summary
# ---------------------------------------------------------------------------
@router.get("/plan/summary", response_model=PlanSummaryResponse)
def get_plan_summary(db: Session = Depends(get_db)):
    total_npis = db.query(func.count(NpiRiskScore.id)).filter(
        NpiRiskScore.entity_type == "npi"
    ).scalar() or 0

    high_risk_npis = db.query(func.count(NpiRiskScore.id)).filter(
        NpiRiskScore.entity_type == "npi",
        NpiRiskScore.risk_score > 70,
    ).scalar() or 0

    today_start = datetime.combine(date.today(), time.min)
    alerts_today = db.query(func.count(Action.id)).filter(
        Action.action_type.in_(FLAG_ACTIONS),
        Action.created_at >= today_start,
    ).scalar() or 0

    total_physician_flags = db.query(func.count(Action.id)).filter(
        Action.action_type.in_(FLAG_ACTIONS)
    ).scalar() or 0

    return PlanSummaryResponse(
        total_npis=total_npis,
        high_risk_npis=high_risk_npis,
        alerts_today=alerts_today,
        total_physician_flags=total_physician_flags,
    )


# ---------------------------------------------------------------------------
# GET /plan/npi-risk-list
# ---------------------------------------------------------------------------
@router.get("/plan/npi-risk-list", response_model=NpiRiskPageResponse)
def get_npi_risk_list(
    page: int = Query(0, ge=0),
    page_size: int = Query(50, ge=1, le=100),
    min_score: int = Query(0, ge=0),
    state: Optional[str] = None,
    specialty: Optional[str] = None,
    risk_band: Optional[str] = Query(None, regex="^(high|medium|low|all)$"),
    pattern_filter: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = (
        db.query(NpiRiskScore, NpiProfile)
        .join(NpiProfile, NpiProfile.npi == NpiRiskScore.entity_id)
        .filter(NpiRiskScore.entity_type == "npi",
                NpiRiskScore.risk_score >= min_score)
    )
    if state:
        q = q.filter(func.upper(NpiProfile.practice_state) == state.upper())
    if specialty:
        q = q.filter(NpiProfile.specialty.ilike(f"%{specialty}%"))
    if risk_band and risk_band != "all":
        if risk_band == "high":
            q = q.filter(NpiRiskScore.risk_score > 60)
        elif risk_band == "medium":
            q = q.filter(NpiRiskScore.risk_score > 30, NpiRiskScore.risk_score <= 60)
        else:  # low
            q = q.filter(NpiRiskScore.risk_score <= 30)

    # Only NPIs that have ≥1 rule_flag of the requested pattern (rule_flags.rule_name).
    if pattern_filter:
        q = q.filter(NpiRiskScore.entity_id.in_(
            db.query(RulesFlag.npi).filter(RulesFlag.rule_name == pattern_filter).distinct()
        ))

    total = q.count()
    total_pages = (total + page_size - 1) // page_size if page_size else 0

    rows = (
        q.order_by(NpiRiskScore.risk_score.desc(),
                   NpiRiskScore.physician_flag_count.desc())
        .offset(page * page_size).limit(page_size).all()
    )

    # Which NPIs on this page belong to a registered user flagged for manual review?
    page_npis = [score.entity_id for score, _ in rows]
    flagged_npis = set()
    if page_npis:
        flagged_npis = {
            r[0] for r in db.query(User.npi).filter(
                User.npi.in_(page_npis), User.needs_manual_review.is_(True)
            ).all()
        }

    items = []
    for score, profile in rows:
        items.append(NpiRiskRow(
            npi=score.entity_id,
            needs_manual_review=score.entity_id in flagged_npis,
            physician_name=profile.physician_name,
            specialty=profile.specialty,
            practice_state=profile.practice_state,
            practice_city=profile.practice_city,
            risk_score=score.risk_score,
            risk_band=get_risk_band(score.risk_score),
            total_claim_count=score.total_claim_count,
            total_claim_amount=float(score.total_claim_amount or 0),
            physician_flag_count=score.physician_flag_count,
            top_vendor_name=score.top_vendor_name,
            volume_flag=score.volume_flag,
            geo_flag=score.geo_flag,
            cross_npi_flag=score.cross_npi_flag,
            oig_flag=score.oig_flag,
            new_vendor_flag=score.new_vendor_flag,
            identity_reuse_flag=getattr(score, "identity_reuse_flag", False),
            hospice_duration_flag=getattr(score, "hospice_duration_flag", False),
            upcoding_flag=getattr(score, "upcoding_flag", False),
            unbundling_flag=getattr(score, "unbundling_flag", False),
        ))

    return NpiRiskPageResponse(
        items=items, total=total, page=page,
        page_size=page_size, total_pages=total_pages,
    )


# ---------------------------------------------------------------------------
# GET /plan/npi/{npi}/detail
# ---------------------------------------------------------------------------
@router.get("/plan/npi/{npi}/detail", response_model=NpiDetailResponse)
def get_npi_detail(npi: str, db: Session = Depends(get_db)):
    settings = get_settings()

    profile = db.query(NpiProfile).filter(NpiProfile.npi == npi).first()
    if not profile:
        raise HTTPException(status_code=404, detail={
            "error": "NPI not found", "code": "NPI_NOT_FOUND"})

    score = (
        db.query(NpiRiskScore)
        .filter_by(entity_type="npi", entity_id=npi).first()
    )

    profile_dict = {
        "npi": profile.npi,
        "physician_name": profile.physician_name,
        "specialty": profile.specialty,
        "practice_address": profile.practice_address,
        "practice_city": profile.practice_city,
        "practice_state": profile.practice_state,
        "practice_zip": profile.practice_zip,
        "enrollment_date": profile.enrollment_date.isoformat()
            if profile.enrollment_date else None,
        "last_update": profile.last_update.isoformat()
            if profile.last_update else None,
        "oig_excluded": profile.oig_excluded,
        "practice_lat": float(profile.practice_lat) if profile.practice_lat is not None else None,
        "practice_lng": float(profile.practice_lng) if profile.practice_lng is not None else None,
    }

    breakdown = []
    score_dict = {}
    if score:
        if score.volume_flag:
            breakdown.append({"factor": "Volume spike", "points": settings.weight_volume_spike, "rule": "volume_spike"})
        if score.geo_flag:
            breakdown.append({"factor": "Geographic anomaly", "points": settings.weight_geo_anomaly, "rule": "geographic_anomaly"})
        if score.cross_npi_flag:
            breakdown.append({"factor": "Cross-NPI vendor", "points": settings.weight_cross_npi, "rule": "cross_npi_supplier"})
        if score.oig_flag:
            breakdown.append({"factor": "OIG LEIE hit", "points": settings.weight_oig_hit, "rule": "oig_leie_hit"})
        if score.new_vendor_flag:
            breakdown.append({"factor": "New high-value vendor", "points": settings.weight_new_vendor, "rule": "new_high_value_supplier"})
        if getattr(score, "identity_reuse_flag", False):
            breakdown.append({"factor": "Patient identity reuse", "points": settings.weight_identity_reuse, "rule": "identity_reuse"})
        if getattr(score, "hospice_duration_flag", False):
            breakdown.append({"factor": "Abnormal hospice duration", "points": settings.weight_hospice_duration, "rule": "abnormal_hospice_duration"})
        if getattr(score, "upcoding_flag", False):
            breakdown.append({"factor": "Upcoding", "points": settings.weight_upcoding, "rule": "upcoding"})
        if getattr(score, "unbundling_flag", False):
            breakdown.append({"factor": "Unbundling", "points": settings.weight_unbundling, "rule": "unbundling"})
        # New rules have no NpiRiskScore boolean column — derive from rule_flags directly.
        present = {
            r[0] for r in db.query(RulesFlag.rule_name)
            .filter(RulesFlag.npi == npi,
                    RulesFlag.rule_name.in_([k for k, _, _ in NEW_RULE_BREAKDOWN]))
            .distinct().all()
        }
        for rule_key, factor, pts in NEW_RULE_BREAKDOWN:
            if rule_key in present:
                breakdown.append({"factor": factor, "points": pts, "rule": rule_key})
        if score.physician_flag_count > 0:
            prows = (db.query(Action.action_type, func.count(Action.id))
                     .filter(Action.npi == npi,
                             Action.action_type.in_(("flag_supplier", "unknown_patient", "did_not_order", "deceased_patient")))
                     .group_by(Action.action_type).all())
            pc = {a: c for a, c in prows}
            flags = pc.get("flag_supplier", 0) + pc.get("unknown_patient", 0) + pc.get("deceased_patient", 0)
            denials = pc.get("did_not_order", 0)
            pts = min(flags * settings.weight_per_physician_flag
                      + denials * settings.weight_did_not_order,
                      settings.max_physician_flag_contribution)
            parts = []
            if flags:
                parts.append(f"{flags} flag×{settings.weight_per_physician_flag}")
            if denials:
                parts.append(f"{denials} denial×{settings.weight_did_not_order}")
            breakdown.append({
                "factor": f"Physician feedback ({', '.join(parts)})",
                "points": pts, "rule": None,
            })
        score_dict = {
            "risk_score": score.risk_score,
            "risk_band": get_risk_band(score.risk_score),
            "volume_flag": score.volume_flag,
            "geo_flag": score.geo_flag,
            "cross_npi_flag": score.cross_npi_flag,
            "oig_flag": score.oig_flag,
            "new_vendor_flag": score.new_vendor_flag,
            "physician_flag_count": score.physician_flag_count,
            "total_claim_count": score.total_claim_count,
            "total_claim_amount": float(score.total_claim_amount or 0),
            "top_vendor_name": score.top_vendor_name,
            "score_breakdown": breakdown,
            "last_calculated": score.last_calculated.isoformat()
                if score.last_calculated else None,
        }

    # Load the NPI's FULL claim set (max ~761 claims/NPI). The detail page filters
    # claims client-side by flag ("View all distant patients", etc.); a 50-row cap
    # dropped the geo/older flagged claims out of the window, so those filters showed 0.
    claims_page = build_claims_page(db, npi, page=0, page_size=1000)

    actions = (
        db.query(Action).filter(Action.npi == npi)
        .order_by(Action.created_at.desc()).all()
    )
    physician_actions = [{
        "id": str(a.id),
        "action_type": a.action_type,
        "note": a.note,
        "vendor_id": a.vendor_id,
        "vendor_name": a.vendor_name,
        "patient_name": a.patient_name,
        "claim_amount": float(a.claim_amount),
        "created_at": a.created_at.isoformat() if a.created_at else None,
    } for a in actions]

    # Verification results, if this NPI was registered through /auth/register.
    reg_user = db.query(User).filter(User.npi == npi).first()
    verification = None
    if reg_user and reg_user.verification_results:
        vr = reg_user.verification_results
        if isinstance(vr, dict) and vr:  # non-empty JSONB
            verification = {**vr, "needs_manual_review": reg_user.needs_manual_review}

    return NpiDetailResponse(
        profile=profile_dict,
        score=score_dict,
        claims=claims_page,
        physician_actions=physician_actions,
        verification=verification,
    )


# ---------------------------------------------------------------------------
# GET /plan/npi/{npi}/summary  — LLM risk explanation (grounded in fired rules)
# ---------------------------------------------------------------------------
@router.get("/plan/npi/{npi}/summary")
def npi_risk_summary(npi: str, db: Session = Depends(get_db)):
    profile = db.query(NpiProfile).filter(NpiProfile.npi == npi).first()
    score = (db.query(NpiRiskScore)
             .filter_by(entity_type="npi", entity_id=npi).first())
    if not profile or not score:
        raise HTTPException(status_code=404, detail={
            "error": "NPI not found", "code": "NPI_NOT_FOUND"})
    text, source, cached = generate_npi_summary(profile, score)
    return {
        "npi": npi,
        "summary": text,
        "source": source,          # 'llm' (GPT-4o) or 'rules' (deterministic fallback)
        "cached": cached,
        "risk_band": get_risk_band(score.risk_score),
        "risk_score": score.risk_score,
    }


# ---------------------------------------------------------------------------
# GET /plan/npi/{npi}/rule/{rule_name}  — drill-down: what a rule means + evidence
# ---------------------------------------------------------------------------
RULE_INFO = {
    "volume_spike": ("Volume Spike",
        "This provider's claim rate in the last 30 days is far above their own prior baseline — a sign of sudden over-billing."),
    "geographic_anomaly": ("Geographic Anomaly",
        "Claims were filed for patients located far from the provider's practice address — unusual for legitimate care."),
    "cross_npi_supplier": ("Cross-NPI Vendor",
        "A vendor on these claims bills under many unrelated physician NPIs — the classic kickback-ring pattern."),
    "oig_leie_hit": ("OIG LEIE Hit",
        "A vendor on these claims appears on the federal OIG exclusion list — Medicare/Medicaid cannot reimburse excluded providers."),
    "new_high_value_supplier": ("New High-Value Vendor",
        "A brand-new vendor relationship appeared with unusually high-dollar claims."),
    "identity_reuse": ("Patient Identity Reuse",
        "The same patient is billed under multiple unrelated physician NPIs — a phantom-billing / identity-reuse signal."),
    "abnormal_hospice_duration": ("Abnormal Hospice Duration",
        "A hospice patient was kept enrolled far longer than is clinically typical — a known hospice fraud pattern."),
    "upcoding": ("Upcoding",
        "Claim amounts are far above the norm for the service category — a sign of billing a higher-paying code than warranted."),
    "unbundling": ("Unbundling",
        "A single service was split into multiple separately-billed component codes to inflate reimbursement."),
    "duplicate_billing": ("Duplicate Billing",
        "The same service was billed twice for one patient within a short window — a duplicate-billing signal."),
    "deceased_patient": ("Deceased Patient",
        "Claims were filed for patients with no prior activity in over six months, then resurfacing under a different physician — consistent with billing after patient death or identity reuse."),
    "impossible_day": ("Impossible Day",
        "The provider billed an implausible number of claims on a single day — more patients than is physically possible to see."),
    "modifier_abuse": ("Modifier Abuse",
        "Near-identical services were billed separately for the same patient on the same date — consistent with reworded line items to bypass duplicate checks."),
    "rapid_cycling": ("Rapid Patient Cycling",
        "The provider billed an unusually high number of distinct patients in one day — implausible patient turnover."),
    "supplier_concentration": ("Vendor Concentration",
        "An unusually large share of this provider's billing flows through a single vendor — consistent with a kickback or referral relationship."),
}

# New rules + their NPI-detail breakdown weight (the per-unit caps live in the scorer;
# these are the representative point values shown on the detail page).
NEW_RULE_BREAKDOWN = [
    ("deceased_patient", "Deceased patient", 30),
    ("impossible_day", "Impossible day", 40),
    ("modifier_abuse", "Modifier abuse", 24),
    ("rapid_cycling", "Rapid patient cycling", 30),
    ("supplier_concentration", "Vendor concentration", 18),
]


@router.get("/plan/npi/{npi}/rule/{rule_name}")
def rule_evidence(npi: str, rule_name: str, db: Session = Depends(get_db)):
    label, explanation = RULE_INFO.get(rule_name, (rule_name, "Fraud-detection rule."))
    # Practice location (for the geographic_anomaly map: physician pin + polylines).
    profile = db.query(NpiProfile).filter(NpiProfile.npi == npi).first()
    p_lat = float(profile.practice_lat) if profile and profile.practice_lat is not None else None
    p_lng = float(profile.practice_lng) if profile and profile.practice_lng is not None else None
    rows = (
        db.query(RulesFlag, Claim)
        .join(Claim, Claim.id == RulesFlag.claim_id)
        .filter(RulesFlag.npi == npi, RulesFlag.rule_name == rule_name)
        .order_by(Claim.date_of_service.desc())
        .all()
    )
    claims = [{
        "claim_id": str(c.id),
        "patient_name": c.patient_name,
        "date_of_service": c.date_of_service.isoformat() if c.date_of_service else None,
        "vendor_name": c.vendor_name,
        "service_description": c.service_description,
        "service_category": c.service_category,
        "claim_amount": float(c.claim_amount),
        "why": rf.rule_description,
        "severity": rf.severity,
        "patient_lat": float(c.patient_lat) if c.patient_lat is not None else None,
        "patient_lng": float(c.patient_lng) if c.patient_lng is not None else None,
        "practice_lat": p_lat,
        "practice_lng": p_lng,
    } for rf, c in rows]
    return {
        "npi": npi, "rule_name": rule_name, "label": label,
        "explanation": explanation, "count": len(claims), "claims": claims,
        "physician_name": profile.physician_name if profile else None,
        "practice_lat": p_lat, "practice_lng": p_lng,
    }


# ---------------------------------------------------------------------------
# POST /plan/npi/{npi}/run-fraud-check
# ---------------------------------------------------------------------------
@router.post("/plan/npi/{npi}/run-fraud-check")
def run_npi_fraud_check(npi: str, db: Session = Depends(get_db)):
    from rapidfuzz import fuzz
    from backend.models import PhysicianBill
    from backend.sse import broadcast_alert as _broadcast

    bills = db.query(PhysicianBill).filter(PhysicianBill.npi == npi).all()
    claims = db.query(Claim).filter(Claim.npi == npi).all()

    ghost_claims = []
    for claim in claims:
        candidates = [
            b for b in bills
            if abs((b.service_date - claim.date_of_service).days) <= 3
        ]
        matched = any(fuzz.ratio(claim.patient_name, b.patient_name) >= 85 for b in candidates)
        if not matched:
            claim.verification_status = "ghost_billing_suspected"
            ghost_claims.append(claim)

    ghost_count = len(ghost_claims)
    if ghost_claims:
        db.commit()

    if ghost_count > 0:
        _broadcast({"type": "ghost_billing", "npi": npi, "count": ghost_count}, recipient="physician")

    physician_name = db.query(NpiProfile.physician_name).filter(NpiProfile.npi == npi).scalar()
    return {
        "npi": npi,
        "physician_name": physician_name,
        "ghost_count": ghost_count,
        "checked_claims": len(claims),
    }


# ---------------------------------------------------------------------------
# GET /plan/suppliers
# ---------------------------------------------------------------------------
@router.get("/plan/suppliers", response_model=SupplierPageResponse)
def get_supplier_watchlist(
    page: int = Query(0, ge=0),
    page_size: int = Query(50, ge=1, le=100),
    oig_only: bool = False,
    min_flags: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    q = db.query(NpiRiskScore).filter(NpiRiskScore.entity_type == "supplier")
    if oig_only:
        q = q.filter(NpiRiskScore.oig_flag.is_(True))
    if min_flags:
        q = q.filter(NpiRiskScore.physician_flag_count >= min_flags)

    total = q.count()
    total_pages = (total + page_size - 1) // page_size if page_size else 0

    rows = (
        q.order_by(NpiRiskScore.physician_flag_count.desc(),
                   NpiRiskScore.risk_score.desc())
        .offset(page * page_size).limit(page_size).all()
    )

    # first_seen = MIN(claims.date_of_service) per supplier, for the page's suppliers
    supplier_ids = [r.entity_id for r in rows]
    first_seen_map = {}
    if supplier_ids:
        for sid, first_dt in (
            db.query(Claim.vendor_id, func.min(Claim.date_of_service))
            .filter(Claim.vendor_id.in_(supplier_ids))
            .group_by(Claim.vendor_id).all()
        ):
            first_seen_map[sid] = first_dt

    items = [SupplierWatchlistRow(
        vendor_id=r.entity_id,
        vendor_name=r.entity_name,
        oig_flag=r.oig_flag,
        distinct_npi_count=r.distinct_npi_count,
        physician_flag_count=r.physician_flag_count,
        total_claim_count=r.total_claim_count,
        total_claim_amount=float(r.total_claim_amount or 0),
        risk_score=r.risk_score,
        risk_band=get_risk_band(r.risk_score),
        first_seen=first_seen_map.get(r.entity_id),
    ) for r in rows]

    return SupplierPageResponse(
        items=items, total=total, page=page,
        page_size=page_size, total_pages=total_pages,
    )


# ---------------------------------------------------------------------------
# GET /plan/suppliers/{supplier_id}/physicians
# ---------------------------------------------------------------------------
@router.get("/plan/suppliers/{supplier_id}/physicians")
def get_supplier_physicians(supplier_id: str, db: Session = Depends(get_db)):
    npi_rows = (
        db.query(
            Claim.npi,
            func.count(Claim.id).label("claim_count"),
            func.sum(Claim.claim_amount).label("total_amount"),
            func.min(Claim.date_of_service).label("first_claim"),
            func.max(Claim.date_of_service).label("last_claim"),
        )
        .filter(Claim.vendor_id == supplier_id)
        .group_by(Claim.npi)
        .order_by(func.count(Claim.id).desc())
        .all()
    )

    if not npi_rows:
        raise HTTPException(status_code=404, detail={
            "error": "Vendor not found", "code": "SUPPLIER_NOT_FOUND"})

    result = []
    for row in npi_rows:
        profile = db.query(NpiProfile).filter(NpiProfile.npi == row.npi).first()

        flag_count = db.query(func.count(Action.id)).filter(
            Action.npi == row.npi,
            Action.vendor_id == supplier_id,
            Action.action_type.in_(FLAG_ACTIONS),
        ).scalar() or 0

        denial_count = db.query(func.count(Action.id)).filter(
            Action.npi == row.npi,
            Action.vendor_id == supplier_id,
            Action.action_type == "did_not_order",
        ).scalar() or 0

        # Rule flags fired on this physician's claims with THIS vendor specifically.
        rule_flag_count = db.query(func.count(RulesFlag.id)).filter(
            RulesFlag.npi == row.npi,
            RulesFlag.vendor_id == supplier_id,
        ).scalar() or 0

        result.append({
            "npi": row.npi,
            "physician_name": profile.physician_name if profile else f"NPI {row.npi}",
            "specialty": profile.specialty if profile else None,
            "practice_city": profile.practice_city if profile else None,
            "practice_state": profile.practice_state if profile else None,
            "claim_count": row.claim_count,
            "total_amount": float(row.total_amount or 0),
            "first_claim_date": row.first_claim.isoformat() if row.first_claim else None,
            "last_claim_date": row.last_claim.isoformat() if row.last_claim else None,
            "physician_flag_count": flag_count,
            "flags_on_this_supplier": rule_flag_count,
            "denial_count": denial_count,
            "has_denied": denial_count > 0,
        })

    return {
        "supplier_id": supplier_id,
        "distinct_npi_count": len(result),
        "total_denials": sum(r["denial_count"] for r in result),
        "physicians": result,
    }


# ---------------------------------------------------------------------------
# GET /plan/alerts  — REST companion to the SSE stream (history / initial load)
# ---------------------------------------------------------------------------
def _action_to_alert(a, physician_name) -> AlertEvent:
    is_escalation = a.action_type == "did_not_order"
    return AlertEvent(
        id=str(a.id),
        action_type=a.action_type,
        physician_name=physician_name or a.npi,
        npi=a.npi,
        vendor_name=a.vendor_name,
        patient_name=a.patient_name,
        claim_amount=float(a.claim_amount),
        timestamp=a.created_at.isoformat() if a.created_at else "",
        escalation=is_escalation,
        escalation_label="PHYSICIAN DENIAL" if is_escalation else None,
        plan_status=a.plan_status or "pending",
        vendor_id=a.vendor_id,
    )


@router.get("/plan/alerts")
def get_alerts_history(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    supplier_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    # Supplier-scoped requests (the supplier "Flags Raised" panel) stay flags-only.
    # The global activity feed (no supplier_id) also includes confirm/dispute.
    types = FLAG_ACTIONS if supplier_id else (*FLAG_ACTIONS, "confirm", "dispute")
    base = db.query(Action).filter(Action.action_type.in_(types))
    if supplier_id:
        base = base.filter(Action.vendor_id == supplier_id)
    total = base.count()
    actions = (
        base.order_by(Action.created_at.desc())
        .offset(offset).limit(limit).all()
    )
    # batch-resolve physician names
    npis = {a.npi for a in actions}
    name_map = {}
    if npis:
        for npi, name in (db.query(NpiProfile.npi, NpiProfile.physician_name)
                          .filter(NpiProfile.npi.in_(npis)).all()):
            name_map[npi] = name
    items = [_action_to_alert(a, name_map.get(a.npi)) for a in actions]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


# ---------------------------------------------------------------------------
# GET /plan/actions/{action_id}  — full detail for the "Review" button
# ---------------------------------------------------------------------------
@router.get("/plan/actions/{action_id}", response_model=PlanActionDetail)
def get_action_detail(action_id: str, db: Session = Depends(get_db)):
    try:
        aid = _uuid.UUID(action_id)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=422, detail={
            "error": "action_id is not a valid UUID", "code": "INVALID_UUID"})
    a = db.query(Action).filter(Action.id == aid).first()
    if not a:
        raise HTTPException(status_code=404, detail={
            "error": "Action not found", "code": "ACTION_NOT_FOUND"})
    return _build_action_detail(db, a)


# ---------------------------------------------------------------------------
# PATCH /plan/actions/{action_id}/status  — investigator updates the plan status
# ---------------------------------------------------------------------------
class PlanStatusUpdate(BaseModel):
    status: str
    note: Optional[str] = None


@router.patch("/plan/actions/{action_id}/status", response_model=PlanActionDetail)
def update_action_status(action_id: str, body: PlanStatusUpdate, request: Request,
                         db: Session = Depends(get_db)):
    if body.status not in VALID_PLAN_STATUS:
        raise HTTPException(status_code=422, detail={
            "error": f"status must be one of {VALID_PLAN_STATUS}",
            "code": "INVALID_PLAN_STATUS"})
    try:
        aid = _uuid.UUID(action_id)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=422, detail={
            "error": "action_id is not a valid UUID", "code": "INVALID_UUID"})

    a = db.query(Action).filter(Action.id == aid).first()
    if not a:
        raise HTTPException(status_code=404, detail={
            "error": "Action not found", "code": "ACTION_NOT_FOUND"})

    a.plan_status = body.status
    db.add(ActionStatusLog(
        action_id=a.id, status=body.status,
        note=(body.note or None),
        changed_by=_investigator_email(request),
    ))
    db.commit()
    db.refresh(a)
    return _build_action_detail(db, a)


# ---------------------------------------------------------------------------
# GET /plan/disputes — compliance view of all open / non-responsive vendor disputes
# ---------------------------------------------------------------------------

_OPEN_STATUSES     = ["OPEN", "NON_RESPONSIVE"]
_RESOLVED_STATUSES = ["RESPONDED_TO_MEDICARE", "RESOLVED_BY_PHYSICIAN", "CLOSED", "REFERRED_OIG"]


@router.get("/plan/disputes")
def get_plan_disputes(status: str = Query("open"), db: Session = Depends(get_db)):
    if status not in ("open", "resolved", "all"):
        raise HTTPException(status_code=422, detail={
            "error": "status must be one of: open, resolved, all", "code": "INVALID_STATUS"})

    escalate_overdue_disputes(db)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    base = get_settings().base_url.rstrip("/")

    query = (
        db.query(DisputeCase, SupplierProfile.supplier_name, ClaimNotification)
        .outerjoin(SupplierProfile, SupplierProfile.npi == DisputeCase.vendor_npi)
        .join(ClaimNotification, ClaimNotification.notification_id == DisputeCase.notification_id)
    )
    if status == "open":
        query = query.filter(DisputeCase.status.in_(_OPEN_STATUSES))
    elif status == "resolved":
        query = query.filter(DisputeCase.status.in_(_RESOLVED_STATUSES))
    rows = query.order_by(DisputeCase.opened_at.desc()).all()

    physician_npis = {case.physician_npi for case, _, _ in rows}
    physicians_by_npi = {
        p.npi: p for p in db.query(Physician).filter(Physician.npi.in_(physician_npis)).all()
    } if physician_npis else {}

    result = []
    for case, vendor_name, notif in rows:
        days = (case.response_due_date - now).days if case.response_due_date else 0
        phys = physicians_by_npi.get(case.physician_npi)
        result.append({
            "case_id":                      case.case_id,
            "claim_number":                 notif.claim_ccn or notif.claim_number,
            "physician_npi":                case.physician_npi,
            "vendor_npi":                   case.vendor_npi,
            "vendor_name":                  vendor_name,
            "dispute_type":                 case.dispute_type,
            "status":                       case.status,
            "opened_at":                    case.opened_at.isoformat() if case.opened_at else None,
            "billing_provider_notified_at": case.billing_provider_notified_at.isoformat() if case.billing_provider_notified_at else None,
            "response_due_date":            case.response_due_date.isoformat() if case.response_due_date else None,
            "days_remaining":               days,
            "deadline_passed":              days < 0,
            "physician_notes":              case.physician_notes,
            "provider_response_type":       case.provider_response_type,
            "vendor_response":              case.vendor_response,
            "vendor_responded_at":          case.vendor_responded_at.isoformat() if case.vendor_responded_at else None,
            "vendor_docs":                  case.vendor_docs or [],
            "closed_at":                    case.closed_at.isoformat() if case.closed_at else None,
            "resolution_notes":             case.resolution_notes,
            "escalation_unlocked":          case.escalation_unlocked,
            "events":                       serialize_dispute_events(db, case.case_id, base),
            "claim": {
                "patient_name_partial": notif.patient_name_partial,
                "dos_from":             str(notif.dos_from) if notif.dos_from else None,
                "dos_to":               str(notif.dos_to)   if notif.dos_to   else None,
                "service_description":  notif.service_description,
                "hcpcs_codes":          notif.hcpcs_codes,
                "amount_billed":        float(notif.amount_billed) if notif.amount_billed else None,
                "amount_paid":          float(notif.amount_paid)   if notif.amount_paid   else None,
                "physician_npi_role":   notif.physician_npi_role,
                "physician_name":       f"{phys.first_name} {phys.last_name}".strip() if phys and (phys.first_name or phys.last_name) else None,
                "physician_practice":   phys.practice_name if phys else None,
            },
        })
    return {"disputes": result, "total": len(result)}


# ---------------------------------------------------------------------------
# POST /plan/disputes/{case_id}/compliance-action — compliance records a
# decision on an escalated (non-responsive) dispute case. Two of the four
# actions resolve the case (moving it into _RESOLVED_STATUSES above); the
# other two just log a note without changing where the case sits.
# ---------------------------------------------------------------------------
COMPLIANCE_ACTION_LABEL = {
    "REFER_TO_MEDICARE":   "Referred to Medicare",
    "SUSPEND_SUPPLIER":    "Supplier enrollment suspended",
    "REQUEST_DOCS":        "Requested more documentation",
    "CLOSE_INVESTIGATION": "Investigation closed",
}


class ComplianceActionRequest(BaseModel):
    action: str
    notes: Optional[str] = None


@router.post("/plan/disputes/{case_id}/compliance-action")
def submit_compliance_action(case_id: int, body: ComplianceActionRequest, request: Request,
                              db: Session = Depends(get_db)):
    if body.action not in COMPLIANCE_ACTION_LABEL:
        raise HTTPException(status_code=422, detail={
            "error": f"action must be one of {list(COMPLIANCE_ACTION_LABEL)}", "code": "INVALID_ACTION"})

    case = db.query(DisputeCase).filter(DisputeCase.case_id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail={"error": "Case not found", "code": "CASE_NOT_FOUND"})

    # response_type carries the action code (frontend maps it to a label,
    # same convention VENDOR_RESPONDED uses) — notes stay separate free text
    # instead of being flattened into one string, so the UI can render them
    # as a distinct quoted line under the action label.
    record_dispute_event(db, case, "COMPLIANCE_ACTION", "COMPLIANCE",
                          response_type=body.action, note=body.notes)

    if body.action == "REFER_TO_MEDICARE":
        case.status = "REFERRED_OIG"
        case.closed_at = datetime.utcnow()
        case.resolution_notes = body.notes
    elif body.action == "CLOSE_INVESTIGATION":
        case.status = "CLOSED"
        case.closed_at = datetime.utcnow()
        case.resolution_notes = body.notes
    elif body.action == "SUSPEND_SUPPLIER" and case.vendor_npi:
        supplier = db.query(SupplierProfile).filter(SupplierProfile.npi == case.vendor_npi).first()
        if supplier:
            supplier.oig_excluded = True
    # REQUEST_DOCS leaves status untouched — just the logged note above.

    db.commit()
    broadcast_dispute_event(case, "compliance_action")
    return {"ok": True, "status": case.status}


# ---------------------------------------------------------------------------
# GET /plan/notifications — compliance bell dropdown
# ---------------------------------------------------------------------------

# Exactly three kinds of activity reach the compliance bell:
# (1) a physician marking a claim (dispute/fraud/deceased — DISPUTE_OPENED,
#     plus the flag Actions below), (2) the vendor's response landing or the
#     response window expiring unanswered, (3) the physician's approve/decline
#     verdict on the vendor's response.
_PLAN_NOTIFICATION_EVENTS = (
    "DISPUTE_OPENED", "VENDOR_RESPONDED", "NON_RESPONSIVE",
    "PHYSICIAN_CONFIRMED", "PHYSICIAN_REJECTED",
)
_PLAN_EVENT_TITLES = {
    "PHYSICIAN_CONFIRMED":  "Physician approved vendor's documents",
    "PHYSICIAN_REJECTED":   "Physician declined vendor's documents — referred to you",
    "NON_RESPONSIVE":       "Vendor did not respond — escalated",
}
# Which of the bell's three filter tabs each event belongs to:
# reported = a physician marked a claim, response = the vendor's docs landed
# or the window expired unanswered, decision = the physician's verdict.
_PLAN_EVENT_GROUPS = {
    "DISPUTE_OPENED":       "reported",
    "VENDOR_RESPONDED":     "response",
    "NON_RESPONSIVE":       "response",
    "PHYSICIAN_CONFIRMED":  "decision",
    "PHYSICIAN_REJECTED":   "decision",
}
_PLAN_ACTION_TITLES = {
    "flag_supplier":  "Vendor flagged",
    "unknown_patient": "Unknown patient flagged",
    "did_not_order":  "Did-not-order flagged",
    "deceased_patient": "Deceased patient flagged",
}


@router.get("/plan/notifications")
def get_plan_notifications(request: Request, db: Session = Depends(get_db)):
    """Recent activity for the compliance bell dropdown — the same dispute-case
    event log and flag Actions that already drive this role's unread count
    (auth.py's /notifications/count sees everything, unfiltered by type/case),
    just shaped into a displayable list instead of a bare number."""
    email = _investigator_email(request)
    user = db.query(User).filter(User.email == email).first() if email else None
    since = user.last_alert_seen_at if user and user.last_alert_seen_at else datetime(1970, 1, 1)

    event_rows = (
        db.query(DisputeCaseEvent, DisputeCase, ClaimNotification)
        .join(DisputeCase, DisputeCase.case_id == DisputeCaseEvent.case_id)
        .join(ClaimNotification, ClaimNotification.notification_id == DisputeCase.notification_id)
        .filter(DisputeCaseEvent.event_type.in_(_PLAN_NOTIFICATION_EVENTS))
        .order_by(DisputeCaseEvent.created_at.desc())
        .limit(20)
        .all()
    )
    action_rows = (
        db.query(Action)
        .filter(Action.action_type.in_(FLAG_ACTIONS))
        .order_by(Action.created_at.desc())
        .limit(20)
        .all()
    )

    notifications = []
    for event, case, notif in event_rows:
        is_fraud = case.dispute_type == "FRAUD_REPORT"
        is_deceased = case.dispute_type == "DECEASED_PATIENT"
        claim_number = notif.claim_ccn or notif.claim_number
        if event.event_type == "DISPUTE_OPENED":
            title = ("Deceased patient reported" if is_deceased
                     else "Fraud reported" if is_fraud
                     else "New dispute filed")
        elif event.event_type == "VENDOR_RESPONDED":
            title = "Vendor uploaded proof-of-work documents"
        else:
            title = _PLAN_EVENT_TITLES.get(event.event_type, event.event_type)
        notifications.append({
            "id":           f"event-{event.event_id}",
            "category":     "deceased" if is_deceased else "fraud" if is_fraud else "dispute",
            "group":        _PLAN_EVENT_GROUPS.get(event.event_type, "reported"),
            "title":        title,
            "description":  f"Claim {claim_number}" + (f" — {event.note}" if event.note else ""),
            "created_at":   event.created_at.isoformat(),
            "case_id":      case.case_id,
            "claim_number": claim_number,
            "read":         event.created_at <= since,
        })

    for a in action_rows:
        notifications.append({
            "id":           f"action-{a.id}",
            "category":     "deceased" if a.action_type == "deceased_patient" else "flag",
            "group":        "reported",  # flag actions are all "physician marked a claim"
            "title":        _PLAN_ACTION_TITLES.get(a.action_type, a.action_type),
            "description":  f"{a.vendor_name} — {a.patient_name}",
            "created_at":   a.created_at.isoformat() if a.created_at else None,
            "case_id":      None,
            "claim_number": None,
            "read":         (a.created_at <= since) if a.created_at else True,
        })

    notifications.sort(key=lambda n: n["created_at"] or "", reverse=True)
    return {"notifications": notifications[:30]}
