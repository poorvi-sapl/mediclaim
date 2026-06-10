"""Authentication helpers — password hashing (bcrypt/passlib) + JWT (python-jose).

Token blacklist is an in-memory set (MVP only — cleared on restart). The token is
read from either the `Authorization: Bearer` header (API clients) or the
`claimlens_token` cookie (browser).

This package also exposes MFA (TOTP) helpers via:
    auth.mfa_utils      — encryption, TOTP, backup codes, mfa_pending tokens
    auth.mfa_ratelimit  — in-memory MFA attempt rate limiter
The existing symbols below are unchanged so every `from .auth import ...` keeps working.
"""

from datetime import datetime, timedelta
from typing import Optional

import bcrypt
from fastapi import Request
from jose import jwt, JWTError

from ..config import get_settings

settings = get_settings()

COOKIE_NAME = "claimlens_token"

# In-memory revoked-token set (MVP). Survives only until the process restarts.
_blacklist: set[str] = set()


# --- passwords (bcrypt directly; passlib 1.7.4 is incompatible with bcrypt 5.x) ---
def hash_password(plain: str) -> str:
    # bcrypt hard-caps the input at 72 bytes
    return bcrypt.hashpw(plain.encode("utf-8")[:72], bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8")[:72], hashed.encode("utf-8"))
    except Exception:
        return False


# --- JWT ---
def create_access_token(*, email: str, role: str, npi: Optional[str],
                        full_name: Optional[str], expires_hours: int,
                        is_active: bool = True) -> str:
    now = datetime.utcnow()
    payload = {
        "sub": email,
        "email": email,
        "role": role,
        "npi": npi,
        "full_name": full_name,
        "type": "access",  # distinguishes a fully-authenticated token from an mfa_pending one
        "is_active": is_active,  # False -> middleware blocks protected routes (pending activation)
        "iat": now,
        "exp": now + timedelta(hours=expires_hours),
    }
    return jwt.encode(payload, settings.jwt_secret_key,
                      algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict:
    """Raises jose.JWTError on invalid/expired token."""
    return jwt.decode(token, settings.jwt_secret_key,
                      algorithms=[settings.jwt_algorithm])


def blacklist_token(token: str) -> None:
    _blacklist.add(token)


def is_blacklisted(token: str) -> bool:
    return token in _blacklist


# --- request token extraction ---
def extract_token(request: Request) -> Optional[str]:
    auth = request.headers.get("authorization")
    if auth and auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return request.cookies.get(COOKIE_NAME)
