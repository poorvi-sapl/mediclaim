import logging
from datetime import datetime
from typing import Optional

from datetime import datetime as _dt
from fastapi import APIRouter, Depends, Request, Response, HTTPException
from fastapi.responses import JSONResponse
from jose import JWTError
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..config import get_settings
from ..models import User, Action, NpiProfile, DisputeCase, DisputeCaseEvent, SupplierProfile
from ..schemas import NotificationCount
from ..auth import (
    verify_password, hash_password, create_access_token, decode_token,
    blacklist_token, extract_token, is_blacklisted, COOKIE_NAME, ROLE_REDIRECTS,
)
from ..auth.mfa_utils import create_mfa_pending_token  # legacy TOTP flow (deactivated)
from ..auth.email_otp import authenticate_user, initiate_otp
from ..auth.mfa_ratelimit import mfa_limiter
from ..verification.cms import check_order_referring, check_revalidation
from ..verification.dea import check_dea
from ..verification.state_license import check_state_license
from ..verification.ptan import check_ptan
from ..verification.uei import check_uei
from ..verification.sam import check_sam_exclusions
from ..verification.nppes import check_nppes
import time as _time

ALERT_ACTION_TYPES = ("flag_supplier", "unknown_patient", "did_not_order", "deceased_patient")
EPOCH = _dt(1970, 1, 1)

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()
log = logging.getLogger("routers.auth")

REMEMBER_HOURS = 24 * 30  # "keep me signed in" → 30 days


class LoginRequest(BaseModel):
    email: str
    password: str
    remember: bool = False


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    npi: Optional[str] = None
    full_name: Optional[str] = None
    mfa_enabled: bool = False


class RegisterRequest(BaseModel):
    email: str
    password: str
    npi: str
    role: str = "physician"
    full_name: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    # Identity/contact/practice fields used for verification against NPPES /
    # PECOS / state medical board / CMS enrollment records.
    date_of_birth: Optional[str] = None      # optional, used only for identity matching
    phone: Optional[str] = None
    organization_name: Optional[str] = None  # practice / organization
    specialty: Optional[str] = None
    tax_id: Optional[str] = None             # organization-level EIN, if applicable
    # Legacy license fields — still accepted for backward compatibility but no
    # longer collected by the registration form.
    dea_number: Optional[str] = None
    state_license_number: Optional[str] = None
    state_license_state: Optional[str] = None
    ptan: Optional[str] = None


class PayerRegisterRequest(BaseModel):
    email: str
    password: str
    role: str = "plan_investigator"
    organization_name: str
    uei: str
    authorized_signatory_name: str
    authorized_signatory_title: str
    attestation: bool = False


class VendorRegisterRequest(BaseModel):
    email: str
    password: str
    npi: str
    role: str = "vendor"
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None


# Simple in-memory per-IP rate limiter for the public verify endpoints (10/min).
_VERIFY_HITS: dict = {}


def _rate_limit(request: Request, limit: int = 10, window: int = 60):
    ip = request.client.host if request.client else "unknown"
    now = _time.time()
    hits = [t for t in _VERIFY_HITS.get(ip, []) if now - t < window]
    if len(hits) >= limit:
        raise HTTPException(status_code=429, detail={
            "error": "Too many requests. Please wait a moment.", "code": "RATE_LIMITED"})
    hits.append(now)
    _VERIFY_HITS[ip] = hits


class MeResponse(BaseModel):
    email: str
    role: str
    npi: Optional[str] = None
    full_name: Optional[str] = None
    mfa_enabled: bool = False


@router.post("/login")
async def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)):
    """Step 1 of login. Validates credentials and, in dev/demo mode (all_otp_stub=True),
    issues the session cookie directly without OTP. In production (real SMTP configured),
    routes through Email OTP as the second factor."""
    email = payload.email.lower().strip()

    user = authenticate_user(db, email, payload.password)
    if not user:
        raise HTTPException(status_code=401, detail={
            "error": "Invalid email or password", "code": "INVALID_CREDENTIALS"})

    if mfa_limiter.check_locked(str(user.id)):
        raise HTTPException(status_code=429, detail={
            "error": "Too many attempts. Try again in 15 minutes.", "code": "OTP_LOCKED"})

    # Dev/demo mode: skip OTP entirely and issue a full session cookie directly.
    if settings.all_otp_stub:
        expires_hours = REMEMBER_HOURS if payload.remember else settings.jwt_expiry_hours
        token = create_access_token(
            email=user.email, role=user.role, npi=user.npi,
            full_name=user.full_name, expires_hours=expires_hours, is_active=user.is_active,
        )
        user.last_login = datetime.utcnow()
        db.commit()
        response.set_cookie(
            key=COOKIE_NAME, value=token, httponly=True, samesite="lax",
            secure=False, max_age=expires_hours * 3600, path="/",
        )
        redirect = ROLE_REDIRECTS.get(user.role, "/")
        return {"otp_required": False, "redirect": redirect, "role": user.role}

    return await initiate_otp(user)


class DemoLoginRequest(BaseModel):
    portal: str  # "physician" | "payer"


# DEMO ENDPOINT — remove for production.
@router.post("/demo-login")
def demo_login(payload: DemoLoginRequest, response: Response, request: Request,
               db: Session = Depends(get_db)):
    """Instant one-click demo access — no password, no OTP. Issues the session cookie
    directly for the seeded demo account of the chosen portal."""
    _rate_limit(request, limit=20)
    mapping = {
        "physician": ("physician@mediclaim.com", "/physician/dashboard"),
        "payer":     ("payer@mediclaim.com",     "/plan/dashboard"),
        "vendor":    ("vendor@mediclaim.com",    "/vendor/portal"),
    }
    if payload.portal not in mapping:
        raise HTTPException(status_code=400, detail={
            "error": "Unknown portal", "code": "BAD_PORTAL"})
    email, redirect = mapping[payload.portal]
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=404, detail={
            "error": "Demo account not found", "code": "DEMO_NOT_FOUND"})

    expires_hours = settings.jwt_expiry_hours
    token = create_access_token(
        email=user.email, role=user.role, npi=user.npi,
        full_name=user.full_name, expires_hours=expires_hours, is_active=user.is_active,
    )
    user.last_login = datetime.utcnow()
    db.commit()
    response.set_cookie(
        key=COOKIE_NAME, value=token, httponly=True, samesite="lax",
        secure=False, max_age=expires_hours * 3600, path="/",
    )
    return {"success": True, "redirect": redirect}


def _strip_raw(d: dict) -> dict:
    return {k: v for k, v in (d or {}).items() if k != "raw"}


@router.post("/register", status_code=201)
async def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    """Physician self-registration with layered eligibility verification.

    Blocking: NPPES presence -> OIG exclusion -> CMS Order&Referring.
    Advisory (never block): CMS Revalidation, DEA, State license, PTAN — these set
    needs_manual_review when missing / invalid / manual_review.
    """
    email = payload.email.lower().strip()
    npi = payload.npi.strip()
    last_name = (payload.last_name or "").strip()

    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=409, detail={
            "error": "An account with this email already exists.", "code": "EMAIL_EXISTS"})

    # Step 1 — NPPES presence (blocks). Goes through check_nppes so it honours the
    # NPPES_MOCK flag: live mode = local npi_profiles lookup; mock/testing mode =
    # any well-formed 10-digit NPI passes as a mock provider (no table row needed).
    nppes = await check_nppes(npi, db)
    if not nppes.get("valid"):
        raise HTTPException(status_code=400, detail={
            "error": "NPI not found in the NPPES registry.", "code": "NPI_NOT_IN_NPPES"})
    profile = db.query(NpiProfile).filter(NpiProfile.npi == npi).first()   # None in mock mode
    nppes_name = nppes.get("name") or (profile.physician_name if profile else None)
    nppes_state = nppes.get("state") or (profile.practice_state if profile else None)

    # Step 2 — OIG LEIE exclusion (blocks). Only enforceable against a real local
    # record; a mock-mode NPI with no profile row is treated as not excluded.
    if profile and profile.oig_excluded:
        raise HTTPException(status_code=400, detail={
            "error": "This provider appears on the OIG LEIE exclusion list and cannot register.",
            "code": "OIG_EXCLUDED"})

    # Step 3 — CMS Order & Referring eligibility (blocks).
    order_referring = check_order_referring(npi)
    if order_referring.get("eligible") is False:
        raise HTTPException(status_code=400, detail={
            "error": order_referring.get("reason", "Not eligible to order/refer Medicare services."),
            "code": "ORDER_REFERRING_INELIGIBLE"})

    # Step 4 — CMS Revalidation (advisory).
    revalidation = check_revalidation(npi)

    # Steps 5-7 — DEA / State license / PTAN (advisory, never block). Omitted => not_provided.
    if payload.dea_number:
        dea = await check_dea(payload.dea_number, last_name)
    else:
        dea = {"status": "not_provided"}
    if payload.state_license_number and payload.state_license_state:
        state_license = await check_state_license(
            payload.state_license_number, payload.state_license_state, last_name)
    else:
        state_license = {"status": "not_provided"}
    if payload.ptan:
        ptan = await check_ptan(payload.ptan, npi)
    else:
        ptan = {"status": "not_provided"}

    # Only the identity/enrollment checks that actually run on the collected
    # fields can flag a registration now — DEA / state license / PTAN are no
    # longer part of registration, so their "not_provided" no longer counts.
    needs_manual_review = bool(order_referring.get("manual_review")) \
        or revalidation.get("status") in ("lapsed", "due_soon")

    user = User(
        email=email,
        password_hash=hash_password(payload.password.strip()),
        role="physician",
        npi=npi,
        full_name=(payload.full_name
                   or f"{payload.first_name or ''} {payload.last_name or ''}".strip()
                   or nppes_name or "").strip() or None,
        organization_name=(payload.organization_name or "").strip() or None,
        is_active=True,  # physicians get immediate access
        verification_results={
            "nppes": {"valid": True, "name": nppes_name, "state": nppes_state},
            "oig": {"excluded": False},
            "cms_order_referring": order_referring,
            "cms_revalidation": revalidation,
            "dea": dea,
            "state_license": state_license,
            "ptan": ptan,
            # Registration profile details captured for verification/matching.
            "profile": {
                "date_of_birth": (payload.date_of_birth or "").strip() or None,
                "phone":         (payload.phone or "").strip() or None,
                "specialty":     (payload.specialty or "").strip() or None,
                "organization":  (payload.organization_name or "").strip() or None,
                "tax_id":        (payload.tax_id or "").strip() or None,
            },
            "checked_at": datetime.utcnow().isoformat(),
        },
        needs_manual_review=needs_manual_review,
    )
    db.add(user)
    db.commit()

    return {
        "success": True, "npi": npi, "full_name": user.full_name,
        "needs_manual_review": needs_manual_review,
        "verification": {
            "cms_order_referring": _strip_raw(order_referring),
            "cms_revalidation": _strip_raw(revalidation),
            "dea": _strip_raw(dea), "state_license": _strip_raw(state_license),
            "ptan": _strip_raw(ptan),
        },
    }


@router.post("/register/payer", status_code=201)
async def register_payer(payload: PayerRegisterRequest, db: Session = Depends(get_db)):
    """Payer/organization self-registration. Account is created inactive and requires
    admin activation (Part 5). Blocking: attestation, invalid UEI format, SAM exclusion."""
    email = payload.email.lower().strip()

    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=409, detail={
            "error": "An account with this email already exists.", "code": "EMAIL_EXISTS"})

    # Step 1 — attestation (blocks).
    if not payload.attestation:
        raise HTTPException(status_code=400, detail={
            "error": "You must confirm you are an authorized signatory to register",
            "code": "ATTESTATION_REQUIRED"})

    # Step 2 — UEI check. Invalid format blocks; not-found is advisory.
    uei_result = await check_uei(payload.uei.strip())
    if uei_result.get("valid") is False and uei_result.get("status") != "not_found":
        raise HTTPException(status_code=400, detail={
            "error": uei_result.get("reason", "Invalid UEI."), "code": "UEI_INVALID"})

    # Step 3 — SAM exclusions (blocks if excluded).
    sam = await check_sam_exclusions(payload.organization_name.strip(), payload.uei.strip())
    if sam.get("excluded") is True:
        raise HTTPException(status_code=400, detail={
            "error": "Organization found on SAM.gov exclusion list. Registration cannot proceed.",
            "code": "SAM_EXCLUDED"})

    # Step 4 — create inactive account (admin activation required).
    user = User(
        email=email,
        password_hash=hash_password(payload.password.strip()),
        role="plan_investigator",
        organization_name=payload.organization_name.strip(),
        full_name=payload.authorized_signatory_name.strip() or None,
        is_active=False,
        needs_manual_review=True,
        verification_results={
            "uei": _strip_raw(uei_result),
            "sam_exclusions": _strip_raw(sam),
            "authorized_signatory": {
                "name": payload.authorized_signatory_name,
                "title": payload.authorized_signatory_title,
                "attestation": True,
                "attested_at": datetime.utcnow().isoformat(),
            },
            "checked_at": datetime.utcnow().isoformat(),
        },
    )
    db.add(user)
    db.commit()
    return {
        "success": True, "status": "pending_activation",
        "message": ("Registration submitted. Your account is pending activation. "
                    "You will receive an email once reviewed, typically within 1 business day."),
    }


@router.post("/register/vendor", status_code=201)
async def register_vendor(payload: VendorRegisterRequest, db: Session = Depends(get_db)):
    """Vendor/supplier self-registration. Blocking: NPI must exist in the supplier
    registry and not be OIG-excluded. Active immediately, same as physician —
    there's no admin-activation concept for vendors today."""
    email = payload.email.lower().strip()
    npi = payload.npi.strip()

    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=409, detail={
            "error": "An account with this email already exists.", "code": "EMAIL_EXISTS"})

    profile = db.query(SupplierProfile).filter(SupplierProfile.npi == npi).first()
    if not profile:
        raise HTTPException(status_code=400, detail={
            "error": "NPI not found in the supplier registry.", "code": "NPI_NOT_FOUND"})

    if profile.oig_excluded:
        raise HTTPException(status_code=400, detail={
            "error": "This supplier appears on the OIG LEIE exclusion list and cannot register.",
            "code": "OIG_EXCLUDED"})

    user = User(
        email=email,
        password_hash=hash_password(payload.password.strip()),
        role="vendor",
        npi=npi,
        full_name=(payload.contact_name or profile.contact_name or profile.supplier_name or "").strip() or None,
        organization_name=profile.supplier_name,
        is_active=True,
        verification_results={
            "supplier_registry": {"valid": True, "name": profile.supplier_name, "type": profile.supplier_type},
            "oig": {"excluded": False},
            "checked_at": datetime.utcnow().isoformat(),
        },
    )
    db.add(user)
    db.commit()

    return {
        "success": True, "npi": npi, "full_name": user.full_name,
        "organization_name": profile.supplier_name,
    }


@router.get("/verify-npi")
async def verify_npi(npi: str, request: Request, db: Session = Depends(get_db)):
    """Public, rate-limited NPPES lookup used inline during registration (no account)."""
    _rate_limit(request)
    return await check_nppes(npi.strip(), db)


@router.get("/verify-uei")
async def verify_uei(uei: str, request: Request):
    """Public, rate-limited UEI lookup used inline during payer registration."""
    _rate_limit(request)
    return await check_uei(uei.strip())


@router.get("/verify-vendor-npi")
async def verify_vendor_npi(npi: str, request: Request, db: Session = Depends(get_db)):
    """Public, rate-limited supplier-registry lookup used inline during vendor registration."""
    _rate_limit(request)
    profile = db.query(SupplierProfile).filter(SupplierProfile.npi == npi.strip()).first()
    if not profile:
        return {"valid": False}
    return {
        "valid": not profile.oig_excluded,
        "oig_excluded": profile.oig_excluded,
        "name": profile.supplier_name,
        "type": profile.supplier_type,
    }


@router.post("/logout")
def logout(request: Request, response: Response):
    token = extract_token(request)
    if token:
        blacklist_token(token)
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"message": "Logged out successfully"}


@router.get("/me", response_model=MeResponse)
def me(request: Request, db: Session = Depends(get_db)):
    token = extract_token(request)
    if not token or is_blacklisted(token):
        raise HTTPException(status_code=401, detail={
            "error": "Not authenticated", "code": "NO_TOKEN"})
    try:
        claims = decode_token(token)
    except JWTError:
        raise HTTPException(status_code=401, detail={
            "error": "Invalid or expired token", "code": "INVALID_TOKEN"})
    # mfa_enabled and full_name are read live from the DB (not the token) so they reflect
    # changes made *after* this session's token was issued (e.g. a display-name update).
    user = db.query(User).filter(User.email == claims.get("email")).first()
    return MeResponse(
        email=claims.get("email"), role=claims.get("role"),
        npi=claims.get("npi"),
        full_name=(user.full_name if user and user.full_name else claims.get("full_name")),
        mfa_enabled=bool(user.mfa_enabled) if user else False,
    )


def _current_user(request: Request, db: Session) -> User:
    token = extract_token(request)
    if not token or is_blacklisted(token):
        raise HTTPException(status_code=401, detail={
            "error": "Not authenticated", "code": "NO_TOKEN"})
    try:
        claims = decode_token(token)
    except JWTError:
        raise HTTPException(status_code=401, detail={
            "error": "Invalid or expired token", "code": "INVALID_TOKEN"})
    user = db.query(User).filter(User.email == claims.get("email")).first()
    if not user:
        raise HTTPException(status_code=401, detail={
            "error": "User not found", "code": "USER_NOT_FOUND"})
    return user



# Dispute-case events that matter to each role's bell. Must mirror
# vendor.py's _VENDOR_NOTIFICATION_EVENTS — the vendor bell shows exactly:
# case opened, own docs submitted (confirmation), response window expired
# unanswered, and the physician's approve/decline verdict.
_PHYSICIAN_DISPUTE_EVENTS = ("VENDOR_RESPONDED", "NON_RESPONSIVE", "CONFIRMATION_EXPIRED")
_VENDOR_DISPUTE_EVENTS = ("DISPUTE_OPENED", "VENDOR_RESPONDED", "PHYSICIAN_CONFIRMED", "PHYSICIAN_REJECTED", "NON_RESPONSIVE")
# Payer/compliance bell — mirrors dashboard.py's _PLAN_NOTIFICATION_EVENTS:
# case opened, vendor responded / window expired unanswered, physician verdict.
_PLAN_DISPUTE_EVENTS = ("DISPUTE_OPENED", "VENDOR_RESPONDED", "NON_RESPONSIVE", "PHYSICIAN_CONFIRMED", "PHYSICIAN_REJECTED")


@router.get("/notifications/count", response_model=NotificationCount)
def notifications_count(request: Request, db: Session = Depends(get_db)):
    """Unread count since last_alert_seen_at, scoped by role:
    - plan_investigator (payer/compliance): flag/unknown/denial actions PLUS
      every dispute-case event across every physician/vendor — compliance
      sees everything.
    - physician: dispute-case events on their own cases, caused by someone
      else (the vendor, or an auto-escalation) — not their own actions.
    - vendor: dispute-case events on their own cases, likewise excluding
      their own responses."""
    user = _current_user(request, db)
    since = user.last_alert_seen_at or EPOCH

    if user.role == "physician":
        unread = (
            db.query(func.count(DisputeCaseEvent.event_id))
            .join(DisputeCase, DisputeCase.case_id == DisputeCaseEvent.case_id)
            .filter(
                DisputeCase.physician_npi == user.npi,
                DisputeCaseEvent.event_type.in_(_PHYSICIAN_DISPUTE_EVENTS),
                DisputeCaseEvent.created_at > since,
            ).scalar()
        ) or 0
    elif user.role == "vendor":
        unread = (
            db.query(func.count(DisputeCaseEvent.event_id))
            .join(DisputeCase, DisputeCase.case_id == DisputeCaseEvent.case_id)
            .filter(
                DisputeCase.vendor_npi == user.npi,
                DisputeCaseEvent.event_type.in_(_VENDOR_DISPUTE_EVENTS),
                DisputeCaseEvent.created_at > since,
            ).scalar()
        ) or 0
    else:
        unread = db.query(func.count(Action.id)).filter(
            Action.action_type.in_(ALERT_ACTION_TYPES),
            Action.created_at > since,
        ).scalar() or 0
        # Same event filter as dashboard.py's /plan/notifications feed, so the
        # badge never counts items the dropdown doesn't show.
        unread += db.query(func.count(DisputeCaseEvent.event_id)).filter(
            DisputeCaseEvent.event_type.in_(_PLAN_DISPUTE_EVENTS),
            DisputeCaseEvent.created_at > since,
        ).scalar() or 0

    return NotificationCount(unread=unread)


@router.post("/notifications/seen", response_model=NotificationCount)
def notifications_seen(request: Request, db: Session = Depends(get_db)):
    """Mark all current alerts as seen (resets the unread badge to 0)."""
    user = _current_user(request, db)
    user.last_alert_seen_at = _dt.utcnow()
    db.commit()
    return NotificationCount(unread=0)
