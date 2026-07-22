"""Email OTP — the active login second factor (replaces the TOTP/authenticator flow).

Flow: password check -> generate 6-digit OTP -> email it -> user submits it -> session.
OTPs are stored only as bcrypt hashes, in memory, single-use, with expiry + attempt caps.

DEV MODE: when MAIL_USERNAME/MAIL_PASSWORD are blank (no SMTP configured), email is NOT
sent — the OTP is logged to the server console instead, so the flow is fully testable
locally. Fill the MAIL_* creds in .env to send real email.

TODO(production): move OTPStore to Redis for multi-instance deployments (in-memory state
does not survive restarts and is not shared across workers).
"""

import logging
import secrets
from datetime import datetime, timedelta
from typing import Optional

import bcrypt
from jose import jwt, JWTError
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import User
from . import verify_password

logger = logging.getLogger("auth.email_otp")
settings = get_settings()

OTP_BCRYPT_ROUNDS = 10

# DEMO STUB — remove for production.
# These accounts log in with their normal email + password, but instead of a random
# emailed OTP they use the fixed code below (no email sent). Frontend shows the normal
# "Check your email" screen; the user enters 123456.
STUB_OTP_EMAILS = {"payer@mediclaim.com", "physician@mediclaim.com", "vendor@mediclaim.com"}
STUB_OTP_CODE = "123456"


def is_stub_email(email: str) -> bool:
    return (email or "").lower().strip() in STUB_OTP_EMAILS


def _mail_configured() -> bool:
    return bool(settings.mail_username and settings.mail_password)


# --- OTP generation -------------------------------------------------------
def generate_otp() -> str:
    """6 cryptographically-secure random digits, zero-padded."""
    return f"{secrets.randbelow(1_000_000):06d}"


def mask_email(email: str) -> str:
    """e.g. 'physician@gmail.com' -> 'ph****@gmail.com'."""
    try:
        local, domain = email.split("@", 1)
    except ValueError:
        return email
    prefix = local[:2]
    return f"{prefix}****@{domain}"


# --- email sending --------------------------------------------------------
def _build_body(otp: str) -> str:
    return (
        f"Your MediClaim verification code is: {otp}\n\n"
        f"This code expires in {settings.otp_expiry_minutes} minutes.\n"
        f"If you did not request this, please contact support.\n\n"
        f"— MediClaim Security"
    )


async def send_otp_email(email: str, otp: str, role: str) -> None:
    """Email the OTP. `role` is accepted for future personalisation (unused for now).

    Falls back to logging the OTP when SMTP is not configured (dev mode).
    """
    subject = "Your MediClaim login code"
    body = _build_body(otp)

    if not _mail_configured():
        # DEV MODE — no SMTP creds. Never do this in production.
        logger.warning("DEV OTP MODE | MediClaim | email=%s | otp=%s", email, otp)
        return

    try:
        from fastapi_mail import FastMail, MessageSchema, ConnectionConfig, MessageType
        conf = ConnectionConfig(
            MAIL_USERNAME=settings.mail_username,
            MAIL_PASSWORD=settings.mail_password,
            MAIL_FROM=settings.mail_from,
            MAIL_PORT=settings.mail_port,
            MAIL_SERVER=settings.mail_server,
            MAIL_STARTTLS=settings.mail_starttls,
            MAIL_SSL_TLS=settings.mail_ssl_tls,
            USE_CREDENTIALS=True,
            VALIDATE_CERTS=True,
        )
        message = MessageSchema(
            subject=subject, recipients=[email], body=body, subtype=MessageType.plain,
        )
        await FastMail(conf).send_message(message)
    except Exception as e:
        # Never let an email failure crash the login request; surface via logs.
        logger.error("OTP email send failed | email=%s | error=%r | at=%s",
                     email, e, datetime.utcnow().isoformat())
        raise


# --- in-memory OTP store --------------------------------------------------
class OTPStore:
    def __init__(self):
        self._store: dict[str, dict] = {}

    def store(self, email: str, otp: str) -> None:
        otp_hash = bcrypt.hashpw(otp.encode("utf-8"), bcrypt.gensalt(rounds=OTP_BCRYPT_ROUNDS)).decode("utf-8")
        self._store[email] = {
            "otp_hash": otp_hash,
            "expires_at": datetime.utcnow() + timedelta(minutes=settings.otp_expiry_minutes),
            "attempts": 0,
        }

    def verify(self, email: str, otp_input: str) -> bool:
        entry = self._store.get(email)
        if not entry:
            return False
        if datetime.utcnow() > entry["expires_at"]:
            self.clear(email)
            return False
        if entry["attempts"] >= 5:  # brute-force protection
            return False
        entry["attempts"] += 1
        try:
            ok = bcrypt.checkpw(str(otp_input).encode("utf-8"), entry["otp_hash"].encode("utf-8"))
        except Exception:
            ok = False
        if ok:
            self.clear(email)  # single-use
            return True
        return False

    def clear(self, email: str) -> None:
        self._store.pop(email, None)


otp_store = OTPStore()


# --- short-lived JWTs for the OTP step ------------------------------------
def _make_token(user_id: str, role: str, ttype: str, minutes: int) -> str:
    now = datetime.utcnow()
    payload = {
        "sub": str(user_id),
        "role": role,
        "type": ttype,
        "iat": now,
        "exp": now + timedelta(minutes=minutes),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def create_otp_pending_token(user_id: str, role: str) -> str:
    return _make_token(user_id, role, "otp_pending", settings.otp_expiry_minutes)


def create_resend_token(user_id: str, role: str) -> str:
    return _make_token(user_id, role, "resend", settings.otp_expiry_minutes)


def verify_token(token: str, expected_type: str) -> Optional[dict]:
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError:
        return None
    if payload.get("type") != expected_type:
        return None
    return payload


# --- shared helpers -------------------------------------------------------
def authenticate_user(db: Session, email: str, password: str) -> Optional[User]:
    """Validate credentials; returns the User or None (shared by /auth/login + /auth/otp/send)."""
    email = (email or "").lower().strip()
    user = db.query(User).filter(User.email == email).first()
    if not user or not verify_password((password or "").strip(), user.password_hash):
        return None
    return user


async def initiate_otp(user: User) -> dict:
    """Generate + store + email an OTP, and mint the pending/resend tokens.

    Shared by POST /auth/login and POST /auth/otp/send.
    """
    # ALL_OTP_STUB — dev/demo only, remove for production. When on, EVERY account gets the
    # fixed code 123456 (no email). Otherwise only STUB_OTP_EMAILS do; all others get a
    # real random emailed OTP.
    if settings.all_otp_stub or is_stub_email(user.email):
        otp_store.store(user.email, STUB_OTP_CODE)
        logger.warning("DEV OTP MODE | MediClaim | email=%s | otp=%s", user.email, STUB_OTP_CODE)
    else:
        otp = generate_otp()
        otp_store.store(user.email, otp)
        await send_otp_email(user.email, otp, user.role)
    return {
        "otp_required": True,
        "otp_pending_token": create_otp_pending_token(str(user.id), user.role),
        "resend_token": create_resend_token(str(user.id), user.role),
        "masked_email": mask_email(user.email),
        "message": "A 6-digit code has been sent to your email.",
        "stub": is_stub_email(user.email),
    }
