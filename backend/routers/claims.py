from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from datetime import date, datetime
from sqlalchemy.orm import Session
from sqlalchemy import func, and_
from backend.database import get_db
from backend.models import Claim, NpiProfile, Action, RulesFlag
from backend.schemas import (
    PhysicianSummaryResponse,
    ClaimsPageResponse,
    ClaimResponse,
    FlaggedSupplierResponse,
)

router = APIRouter()

VALID_CATEGORIES = {
    'home_health', 'hospice', 'dme', 'drugs', 'hospital'
}

FLAG_ACTIONS = ('flag_supplier', 'unknown_patient', 'did_not_order')


def validate_npi(npi: str):
    if len(npi) != 10 or not npi.isdigit():
        raise HTTPException(
            status_code=422,
            detail={"error": "NPI must be exactly 10 digits",
                    "code": "INVALID_NPI_FORMAT"}
        )


def get_physician_or_404(npi: str, db: Session) -> NpiProfile:
    profile = db.query(NpiProfile).filter(NpiProfile.npi == npi).first()
    if not profile:
        raise HTTPException(
            status_code=404,
            detail={"error": "NPI not found", "code": "NPI_NOT_FOUND"}
        )
    return profile



# ---------------------------------------------------------------------------
# GET /physician/{npi}/summary
# ---------------------------------------------------------------------------
@router.get("/physician/{npi}/summary", response_model=PhysicianSummaryResponse)
def physician_summary(npi: str, db: Session = Depends(get_db)):
    validate_npi(npi)
    profile = get_physician_or_404(npi, db)

    month = func.date_trunc('month', Claim.date_of_service) == \
        func.date_trunc('month', func.current_date())

    total_claims_month = (
        db.query(func.count(Claim.id))
        .filter(Claim.npi == npi, month).scalar()
    ) or 0
    total_amount_month = (
        db.query(func.coalesce(func.sum(Claim.claim_amount), 0))
        .filter(Claim.npi == npi, month).scalar()
    )
    unreviewed_count = (
        db.query(func.count(Claim.id))
        .filter(Claim.npi == npi, Claim.reviewed.is_(False)).scalar()
    ) or 0
    unknown_supplier_count = (
        db.query(func.count(func.distinct(Action.vendor_id)))
        .filter(Action.npi == npi, Action.action_type.in_(FLAG_ACTIONS)).scalar()
    ) or 0

    return PhysicianSummaryResponse(
        physician_name=profile.physician_name,
        npi=npi,
        specialty=profile.specialty,
        practice_state=profile.practice_state,
        practice_city=profile.practice_city,
        total_claims_month=total_claims_month,
        unreviewed_count=unreviewed_count,
        unknown_supplier_count=unknown_supplier_count,
        total_amount_month=float(total_amount_month or 0),
    )


# ---------------------------------------------------------------------------
# GET /physician/{npi}/claims
# ---------------------------------------------------------------------------
@router.get("/physician/{npi}/claims", response_model=ClaimsPageResponse)
def physician_claims(
    npi: str,
    page: int = Query(0, ge=0),
    page_size: int = Query(50, ge=1, le=100),
    category: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    reviewed: Optional[bool] = None,
    supplier_search: Optional[str] = None,
    claim_search: Optional[str] = None,
    db: Session = Depends(get_db),
):
    validate_npi(npi)
    get_physician_or_404(npi, db)
    if category is not None and category not in VALID_CATEGORIES:
        raise HTTPException(
            status_code=422,
            detail={"error": f"Invalid category '{category}'",
                    "code": "INVALID_CATEGORY"}
        )
    return build_claims_page(db, npi, page, page_size, category,
                             date_from, date_to, reviewed, supplier_search, claim_search)


def build_claims_page(
    db: Session, npi: str, page: int = 0, page_size: int = 50,
    category: Optional[str] = None, date_from: Optional[date] = None,
    date_to: Optional[date] = None, reviewed: Optional[bool] = None,
    supplier_search: Optional[str] = None, claim_search: Optional[str] = None,
) -> ClaimsPageResponse:
    """Paginated claims-with-flags for an NPI. Shared by the physician claims
    endpoint and the plan NPI-detail endpoint."""
    q = db.query(Claim).filter(Claim.npi == npi)
    if category:
        q = q.filter(Claim.service_category == category)
    if date_from:
        q = q.filter(Claim.date_of_service >= date_from)
    if date_to:
        q = q.filter(Claim.date_of_service <= date_to)
    if reviewed is not None:
        q = q.filter(Claim.reviewed.is_(reviewed))
    if supplier_search:
        q = q.filter(Claim.vendor_name.ilike(f"%{supplier_search}%"))
    if claim_search:
        q = q.filter(Claim.ccn.ilike(f"%{claim_search}%"))

    total = q.count()
    total_pages = (total + page_size - 1) // page_size if page_size else 0

    claims = (
        q.order_by(Claim.reviewed.asc(), Claim.date_of_service.desc())
        .offset(page * page_size).limit(page_size).all()
    )

    # rules flags for this page (parallel arrays), ordered by fired_at
    claim_ids = [c.id for c in claims]
    flags_by_claim: dict = {}
    if claim_ids:
        frows = (
            db.query(RulesFlag.claim_id, RulesFlag.rule_name, RulesFlag.severity,
                     RulesFlag.rule_description)
            .filter(RulesFlag.claim_id.in_(claim_ids))
            .order_by(RulesFlag.fired_at.asc()).all()
        )
        for cid, rule_name, severity, desc in frows:
            flags_by_claim.setdefault(cid, {"flags": [], "severities": [], "descs": []})
            entry = flags_by_claim[cid]
            entry["flags"].append(rule_name)
            entry["severities"].append(severity)
            entry["descs"].append(desc)

    # latest action per claim on this page (for the Status column)
    latest_action_by_claim = {}
    if claim_ids:
        arows = (
            db.query(Action.claim_id, Action.action_type)
            .filter(Action.claim_id.in_(claim_ids))
            .order_by(Action.created_at.desc()).all()
        )
        for cid, atype in arows:
            latest_action_by_claim.setdefault(cid, atype)

    items = []
    for c in claims:
        fb = flags_by_claim.get(c.id, {"flags": [], "severities": [], "descs": []})
        items.append(ClaimResponse(
            id=str(c.id),
            ccn=c.ccn,
            patient_name=c.patient_name,
            patient_zip=c.patient_zip,
            date_of_service=c.date_of_service,
            cpt_code=c.cpt_code,
            hcpcs_code=c.hcpcs_code,
            service_description=c.service_description,
            service_category=c.service_category,
            vendor_name=c.vendor_name,
            vendor_id=c.vendor_id,
            supplier_npi=c.vendor_npi,
            claim_amount=float(c.claim_amount),
            oig_flagged=c.oig_flagged,
            reviewed=c.reviewed,
            latest_action=latest_action_by_claim.get(c.id),
            flags=fb["flags"],
            severities=fb["severities"],
            flag_descriptions=fb["descs"],
        ))

    # NPI-wide aggregate cards (from the actions table — physician's own activity)
    total_count = db.query(func.count(Claim.id)).filter(Claim.npi == npi).scalar() or 0
    flagged_count = (
        db.query(func.count(func.distinct(Action.claim_id)))
        .filter(Action.npi == npi, Action.action_type == "flag_supplier").scalar()
    ) or 0
    confirmed_count = (
        db.query(func.count(func.distinct(Action.claim_id)))
        .filter(Action.npi == npi, Action.action_type == "confirm").scalar()
    ) or 0
    disputed_count = (
        db.query(func.count(func.distinct(Action.claim_id)))
        .filter(Action.npi == npi, Action.action_type == "dispute").scalar()
    ) or 0
    unknown_count = (
        db.query(func.count(func.distinct(Action.claim_id)))
        .filter(Action.npi == npi, Action.action_type == "unknown_patient").scalar()
    ) or 0

    return ClaimsPageResponse(
        items=items, total=total, page=page,
        page_size=page_size, total_pages=total_pages,
        total_count=total_count, flagged_count=flagged_count,
        confirmed_count=confirmed_count, disputed_count=disputed_count,
        unknown_count=unknown_count,
    )


# ---------------------------------------------------------------------------
# GET /physician/{npi}/flagged-suppliers
# ---------------------------------------------------------------------------
@router.get("/physician/{npi}/flagged-suppliers")
def physician_flagged_suppliers(npi: str, db: Session = Depends(get_db)):
    validate_npi(npi)
    get_physician_or_404(npi, db)

    # suppliers this physician has flagged, with first-flag time + flag count
    flagged = (
        db.query(
            Action.vendor_id,
            Action.vendor_name,
            func.min(Action.created_at).label("first_flagged_at"),
            func.count(Action.id).label("flag_count"),
        )
        .filter(Action.npi == npi, Action.action_type.in_(FLAG_ACTIONS))
        .group_by(Action.vendor_id, Action.vendor_name)
        .order_by(func.min(Action.created_at).desc())
        .all()
    )

    items = []
    for vendor_id, vendor_name, first_flagged_at, flag_count in flagged:
        stats = (
            db.query(
                func.count(Claim.id),
                func.coalesce(func.sum(Claim.claim_amount), 0),
                func.bool_or(Claim.oig_flagged),
            )
            .filter(Claim.npi == npi, Claim.vendor_id == vendor_id)
            .first()
        )
        claim_count, total_amount, oig_flagged = stats
        # plan_status from the most recent flag action for this vendor
        plan_status = (
            db.query(Action.plan_status)
            .filter(Action.npi == npi, Action.vendor_id == vendor_id,
                    Action.action_type.in_(FLAG_ACTIONS))
            .order_by(Action.created_at.desc())
            .limit(1).scalar()
        ) or "pending"
        items.append(FlaggedSupplierResponse(
            vendor_id=vendor_id,
            vendor_name=vendor_name,
            claim_count=claim_count or 0,
            total_amount=float(total_amount or 0),
            first_flagged_at=first_flagged_at,
            flagged_at=first_flagged_at,
            plan_status=plan_status,
            flag_count=flag_count,
            oig_flagged=bool(oig_flagged),
        ))

    return {"items": items}
