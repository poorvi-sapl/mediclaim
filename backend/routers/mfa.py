"""MFA (TOTP) endpoints — mounted at /auth/mfa.

Two-step login:
  1. POST /auth/login           → if mfa_enabled, returns an mfa_pending_token (no cookie)
  2. POST /auth/mfa/login       → submit TOTP code + mfa_pending_token → sets claimlens_token cookie

Setup (for a logged-in user with a valid claimlens_token):
     POST /auth/mfa/setup         → returns QR provisioning URI + manual base32 code
     POST /auth/mfa/verify-setup  → confirm first code → enables MFA, returns backup codes

Account recovery:
     POST /auth/mfa/backup        → submit a single-use backup code instead of a TOTP code
"""

import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Request, Response, HTTPException
from jose import JWTError
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..config import get_settings
from ..models import User
from ..auth import (
    create_access_token, decode_token, extract_token, is_blacklisted, COOKIE_NAME,
)
from ..auth.mfa_utils import (
    encrypt_secret, generate_totp_secret, get_totp_uri, verify_totp_code,
    generate_backup_codes, verify_backup_code, verify_mfa_pending_token,
)
from ..auth.mfa_ratelimit import mfa_limiter
from ..auth.email_otp import (
    authenticate_user, initiate_otp, otp_store, verify_token,
)

router = APIRouter(prefix="/auth/mfa", tags=["mfa"])
otp_router = APIRouter(prefix="/auth/otp", tags=["otp"])  # ACTIVE email-OTP login factor
settings = get_settings()
log = logging.getLogger("routers.mfa")

_REDIRECTS = {
    "physician": "/physician/dashboard",
    "plan_investigator": "/plan/dashboard",
}


# --- request/response models ------------------------------------------------
class VerifySetupRequest(BaseModel):
    code: str


class MFALoginRequest(BaseModel):
    code: str
    mfa_pending_token: str


class MFABackupRequest(BaseModel):
    backup_code: str
    mfa_pending_token: str


# --- helpers ----------------------------------------------------------------
def _current_user(request: Request, db: Session) -> User:
    """Resolve the logged-in user from the claimlens_token (header or cookie).

    Mirrors the access-token check the middleware applies; the /auth/* prefix is
    public at the middleware layer, so these endpoints must guard themselves.
    """
    token = extract_token(request)
    if not token or is_blacklisted(token):
        raise HTTPException(status_code=401, detail={
            "error": "Not authenticated", "code": "NO_TOKEN"})
    try:
        claims = decode_token(token)
    except JWTError:
        raise HTTPException(status_code=401, detail={
            "error": "Invalid or expired token", "code": "INVALID_TOKEN"})
    if claims.get("type", "access") != "access":
        raise HTTPException(status_code=401, detail={
            "error": "Invalid or expired token", "code": "INVALID_TOKEN_TYPE"})
    user = db.query(User).filter(User.email == claims.get("email")).first()
    if not user:
        raise HTTPException(status_code=401, detail={
            "error": "User not found", "code": "USER_NOT_FOUND"})
    return user


def _resolve_pending(token: str, db: Session) -> tuple[User, dict]:
    """Validate an mfa_pending token and load its user, or raise the right HTTP error."""
    payload = verify_mfa_pending_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail={
            "error": "Session expired. Please log in again.", "code": "MFA_PENDING_INVALID"})
    user = db.query(User).filter(User.id == payload.get("sub")).first()
    if not user:
        raise HTTPException(status_code=401, detail={
            "error": "Session expired. Please log in again.", "code": "MFA_PENDING_INVALID"})
    return user, payload


def _issue_session_cookie(response: Response, user: User) -> str:
    """Issue the real claimlens_token cookie — identical mechanics to /auth/login."""
    expires_hours = settings.jwt_expiry_hours
    token = create_access_token(
        email=user.email, role=user.role, npi=user.npi,
        full_name=user.full_name, expires_hours=expires_hours,
        is_active=user.is_active,
    )
    user.last_login = datetime.utcnow()
    response.set_cookie(
        key=COOKIE_NAME, value=token, httponly=True, samesite="lax",
        secure=False, max_age=expires_hours * 3600, path="/",
    )
    return token


# ─── TOTP ENDPOINTS (deactivated — kept for future enterprise use) ───────────
# These endpoints are functional but no longer called by the login flow, which now
# uses Email OTP (see the /auth/otp router below). Re-enable TOTP by routing
# /auth/login back through the mfa_pending_token flow instead of initiate_otp().
# ------------------------------------------------------------------------------

# --- ENDPOINT 1: POST /auth/mfa/setup ---------------------------------------
@router.post("/setup")
def mfa_setup(request: Request, db: Session = Depends(get_db)):
    user = _current_user(request, db)
    if user.mfa_enabled:
        raise HTTPException(status_code=400, detail={
            "error": "MFA already configured", "code": "MFA_ALREADY_ENABLED"})

    secret = generate_totp_secret()
    user.mfa_pending_secret = encrypt_secret(secret)
    db.commit()

    return {
        "qr_uri": get_totp_uri(secret, user.email),
        "manual_code": secret,  # base32 fallback for manual entry
    }


# --- ENDPOINT 2: POST /auth/mfa/verify-setup --------------------------------
@router.post("/verify-setup")
def mfa_verify_setup(payload: VerifySetupRequest, request: Request,
                     db: Session = Depends(get_db)):
    user = _current_user(request, db)
    if not user.mfa_pending_secret:
        raise HTTPException(status_code=400, detail={
            "error": "No setup in progress", "code": "MFA_NO_SETUP"})

    if not verify_totp_code(user.mfa_pending_secret, payload.code):
        raise HTTPException(status_code=400, detail={
            "error": "Invalid code. Check your authenticator app.", "code": "MFA_INVALID_CODE"})

    plaintext_codes, hashed_codes = generate_backup_codes()
    user.mfa_secret = user.mfa_pending_secret
    user.mfa_pending_secret = None
    user.mfa_backup_codes = hashed_codes
    user.mfa_enabled = True
    db.commit()

    return {
        "success": True,
        "backup_codes": plaintext_codes,
        "message": "Save these codes somewhere safe. They will not be shown again.",
    }


# --- ENDPOINT 3: POST /auth/mfa/login ---------------------------------------
@router.post("/login")
def mfa_login(payload: MFALoginRequest, response: Response,
              db: Session = Depends(get_db)):
    user, token_payload = _resolve_pending(payload.mfa_pending_token, db)
    user_id = str(user.id)

    if mfa_limiter.check_locked(user_id):
        raise HTTPException(status_code=429, detail={
            "error": "Too many attempts. Try again in 15 minutes.", "code": "MFA_LOCKED"})

    if not verify_totp_code(user.mfa_secret, payload.code):
        mfa_limiter.record_attempt(user_id)
        raise HTTPException(status_code=400, detail={
            "error": "Invalid code", "code": "MFA_INVALID_CODE"})

    mfa_limiter.reset(user_id)
    _issue_session_cookie(response, user)
    db.commit()

    return {
        "success": True,
        "role": user.role,
        "redirect": _REDIRECTS.get(user.role, "/"),
    }


# --- ENDPOINT 4: POST /auth/mfa/backup --------------------------------------
@router.post("/backup")
def mfa_backup(payload: MFABackupRequest, response: Response,
               db: Session = Depends(get_db)):
    user, token_payload = _resolve_pending(payload.mfa_pending_token, db)
    user_id = str(user.id)

    if mfa_limiter.check_locked(user_id):
        raise HTTPException(status_code=429, detail={
            "error": "Too many attempts. Try again in 15 minutes.", "code": "MFA_LOCKED"})

    idx = verify_backup_code(payload.backup_code, user.mfa_backup_codes)
    if idx is None:
        mfa_limiter.record_attempt(user_id)
        raise HTTPException(status_code=400, detail={
            "error": "Invalid backup code", "code": "MFA_INVALID_BACKUP"})

    # Consume the single-use code: drop it from the stored list (reassign so SQLAlchemy
    # detects the change on an ARRAY column).
    remaining = [c for i, c in enumerate(user.mfa_backup_codes) if i != idx]
    user.mfa_backup_codes = remaining
    mfa_limiter.reset(user_id)
    _issue_session_cookie(response, user)
    db.commit()

    result = {
        "success": True,
        "role": user.role,
        "redirect": _REDIRECTS.get(user.role, "/"),
    }
    if len(remaining) < 3:
        result["warning"] = (
            f"You have {len(remaining)} backup codes remaining. "
            "Generate new ones from your settings."
        )
    return result


# ═══════════════════════════════════════════════════════════════════════════
# EMAIL OTP ENDPOINTS (ACTIVE login second factor) — mounted at /auth/otp
# ═══════════════════════════════════════════════════════════════════════════
class OtpSendRequest(BaseModel):
    email: str
    password: str


class OtpVerifyRequest(BaseModel):
    code: str
    otp_pending_token: str


class OtpResendRequest(BaseModel):
    resend_token: str


@otp_router.post("/send")
async def otp_send(payload: OtpSendRequest, db: Session = Depends(get_db)):
    """Password check -> generate + email a 6-digit OTP -> return an otp_pending_token.
    Does NOT set the session cookie. (The middleware rejects type='otp_pending'.)"""
    user = authenticate_user(db, payload.email, payload.password)
    if not user:
        raise HTTPException(status_code=401, detail={
            "error": "Invalid email or password", "code": "INVALID_CREDENTIALS"})
    if mfa_limiter.check_locked(str(user.id)):
        raise HTTPException(status_code=429, detail={
            "error": "Too many attempts. Try again in 15 minutes.", "code": "OTP_LOCKED"})
    return await initiate_otp(user)


@otp_router.post("/verify")
def otp_verify(payload: OtpVerifyRequest, response: Response,
               db: Session = Depends(get_db)):
    """Verify the emailed OTP and issue the real claimlens_token session cookie."""
    token_payload = verify_token(payload.otp_pending_token, "otp_pending")
    if not token_payload:
        raise HTTPException(status_code=401, detail={
            "error": "Session expired. Please log in again.", "code": "OTP_PENDING_INVALID"})
    user_id = token_payload.get("sub")

    if mfa_limiter.check_locked(user_id):
        raise HTTPException(status_code=429, detail={
            "error": "Too many attempts. Try again in 15 minutes.", "code": "OTP_LOCKED"})

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail={
            "error": "Session expired. Please log in again.", "code": "OTP_PENDING_INVALID"})

    if not otp_store.verify(user.email, payload.code):
        mfa_limiter.record_attempt(user_id)
        raise HTTPException(status_code=400, detail={
            "error": "Invalid or expired code. Please try again.", "code": "OTP_INVALID"})

    mfa_limiter.reset(user_id)
    _issue_session_cookie(response, user)
    db.commit()
    return {
        "success": True,
        "role": user.role,
        "redirect": _REDIRECTS.get(user.role, "/"),
    }


@otp_router.post("/resend")
async def otp_resend(payload: OtpResendRequest, db: Session = Depends(get_db)):
    """Re-send a fresh OTP using a short-lived resend_token (no password re-entry).
    Invalidates the previous code and returns a new otp_pending_token."""
    token_payload = verify_token(payload.resend_token, "resend")
    if not token_payload:
        raise HTTPException(status_code=401, detail={
            "error": "Session expired. Please log in again.", "code": "RESEND_INVALID"})
    user = db.query(User).filter(User.id == token_payload.get("sub")).first()
    if not user:
        raise HTTPException(status_code=401, detail={
            "error": "Session expired. Please log in again.", "code": "RESEND_INVALID"})
    return await initiate_otp(user)
