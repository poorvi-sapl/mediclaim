"""MFA (TOTP) utilities for ClaimLens.

- TOTP secrets are encrypted at rest with Fernet (symmetric, key in MFA_ENCRYPTION_KEY).
- Backup codes are 8-char alphanumeric, stored only as bcrypt hashes (shown in plaintext once).
- The "mfa_pending" JWT is a short-lived token issued after the password step but BEFORE
  the TOTP step; it is signed with the same JWT_SECRET_KEY but carries type="mfa_pending"
  so the auth middleware refuses it on protected routes.
"""

import secrets
import string
from datetime import datetime, timedelta
from typing import Optional

import bcrypt
import pyotp
from cryptography.fernet import Fernet, InvalidToken
from jose import jwt, JWTError

from ..config import get_settings

settings = get_settings()

_BACKUP_CODE_ALPHABET = string.ascii_uppercase + string.digits
_BACKUP_CODE_LEN = 8
_BACKUP_CODE_COUNT = 10
_BCRYPT_ROUNDS = 12


def _fernet() -> Fernet:
    key = settings.mfa_encryption_key
    if not key:
        raise RuntimeError(
            "MFA_ENCRYPTION_KEY is not set. Generate one with "
            "`python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\"`"
        )
    return Fernet(key.encode("utf-8"))


# 1 ---------------------------------------------------------------------------
def encrypt_secret(plain_secret: str) -> str:
    """Encrypt a plaintext TOTP secret with Fernet; returns a base64 token string."""
    return _fernet().encrypt(plain_secret.encode("utf-8")).decode("utf-8")


# 2 ---------------------------------------------------------------------------
def decrypt_secret(encrypted: str) -> str:
    """Reverse of encrypt_secret; returns the plaintext TOTP secret."""
    return _fernet().decrypt(encrypted.encode("utf-8")).decode("utf-8")


# 3 ---------------------------------------------------------------------------
def generate_totp_secret() -> str:
    """A fresh base32 TOTP secret."""
    return pyotp.random_base32()


# 4 ---------------------------------------------------------------------------
def get_totp_uri(secret: str, email: str) -> str:
    """otpauth:// provisioning URI for QR rendering."""
    return pyotp.totp.TOTP(secret).provisioning_uri(
        name=email,
        issuer_name="ClaimLens",
    )


# 5 ---------------------------------------------------------------------------
def verify_totp_code(encrypted_secret: str, code: str) -> bool:
    """Verify a 6-digit TOTP code against an encrypted secret (±30s clock skew)."""
    if not encrypted_secret or not code:
        return False
    try:
        secret = decrypt_secret(encrypted_secret)
    except (InvalidToken, Exception):
        return False
    return pyotp.TOTP(secret).verify(str(code).strip(), valid_window=1)


# 6 ---------------------------------------------------------------------------
def generate_backup_codes() -> tuple[list[str], list[str]]:
    """Return (plaintext_codes, hashed_codes).

    plaintext_codes are shown to the user exactly once; hashed_codes (bcrypt, 12 rounds)
    are what we persist. Codes are 8-char uppercase alphanumeric.
    """
    plaintext_codes: list[str] = []
    hashed_codes: list[str] = []
    for _ in range(_BACKUP_CODE_COUNT):
        code = "".join(secrets.choice(_BACKUP_CODE_ALPHABET) for _ in range(_BACKUP_CODE_LEN))
        hashed = bcrypt.hashpw(code.encode("utf-8"), bcrypt.gensalt(rounds=_BCRYPT_ROUNDS)).decode("utf-8")
        plaintext_codes.append(code)
        hashed_codes.append(hashed)
    return plaintext_codes, hashed_codes


def _normalize_backup_code(code: str) -> str:
    """Strip whitespace/hyphens and uppercase so 'abcd-1234' matches 'ABCD1234'."""
    return "".join(ch for ch in (code or "") if ch.isalnum()).upper()


# 7 ---------------------------------------------------------------------------
def verify_backup_code(code: str, hashed_codes: Optional[list[str]]) -> Optional[int]:
    """Return the index of the matching hash, or None if no backup code matches."""
    if not code or not hashed_codes:
        return None
    candidate = _normalize_backup_code(code).encode("utf-8")
    for i, hashed in enumerate(hashed_codes):
        try:
            if bcrypt.checkpw(candidate, hashed.encode("utf-8")):
                return i
        except Exception:
            continue
    return None


# 8 ---------------------------------------------------------------------------
def create_mfa_pending_token(user_id: str, role: str) -> str:
    """Short-lived (5 min) token that proves the password step passed but MFA is still pending."""
    now = datetime.utcnow()
    payload = {
        "sub": str(user_id),
        "role": role,
        "type": "mfa_pending",  # CRITICAL: marks this as incomplete auth — rejected on protected routes
        "iat": now,
        "exp": now + timedelta(minutes=settings.mfa_pending_expiry_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


# 9 ---------------------------------------------------------------------------
def verify_mfa_pending_token(token: str) -> Optional[dict]:
    """Decode + validate an mfa_pending token. Returns the payload or None if invalid/expired."""
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError:
        return None
    if payload.get("type") != "mfa_pending":
        return None
    return payload
