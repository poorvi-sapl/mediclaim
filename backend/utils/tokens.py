"""
HMAC-signed tokens for the NPI Watch response flows.

generate_response_token      — physician one-click response, 72h expiry
decode_response_token        — validates physician response token

generate_vendor_dispute_token — vendor dispute page access, 15-day expiry
decode_vendor_dispute_token   — validates vendor dispute token
"""

import time
from jose import jwt, JWTError

from ..config import get_settings

_ALGORITHM = "HS256"
_TOKEN_TYPE = "npi_response"
_EXPIRY_SECONDS = 72 * 3600  # 72 hours

_VENDOR_TOKEN_TYPE = "vendor_dispute"
VENDOR_TOKEN_EXPIRY_SECONDS = 15 * 24 * 3600  # 15 days


def generate_response_token(notification_id: int, physician_npi: str) -> str:
    """
    Returns a URL-safe signed JWT encoding notification_id + physician_npi.
    Expires 72 hours from call time. Single-use idempotency is enforced at
    the DB level via ClaimNotification.status transitions in respond_to_notification().
    """
    settings = get_settings()
    payload = {
        "notification_id": notification_id,
        "physician_npi":   physician_npi,
        "exp":             int(time.time()) + _EXPIRY_SECONDS,
        "type":            _TOKEN_TYPE,
    }
    return jwt.encode(payload, settings.secret_key, algorithm=_ALGORITHM)


def decode_response_token(token: str) -> dict:
    """
    Decodes and validates a response token.
    Returns {"notification_id": int, "physician_npi": str} on success.
    Raises ValueError with a user-readable message on expiry, tampering,
    or malformed input.
    """
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[_ALGORITHM])
    except JWTError as exc:
        msg = str(exc).lower()
        if "expired" in msg or "signature has expired" in msg:
            raise ValueError(
                "Token has expired. Please log in to your portal to respond."
            )
        raise ValueError(f"Invalid or malformed token: {exc}")

    if payload.get("type") != _TOKEN_TYPE:
        raise ValueError("Invalid token type")

    return {
        "notification_id": int(payload["notification_id"]),
        "physician_npi":   str(payload["physician_npi"]),
    }


def generate_vendor_dispute_token(case_id: int, vendor_npi: str) -> str:
    """
    Returns a URL-safe signed JWT encoding case_id + vendor_npi.
    Expires 15 days from call time — matches the dispute response window.
    """
    settings = get_settings()
    payload = {
        "case_id":    case_id,
        "vendor_npi": vendor_npi,
        "exp":        int(time.time()) + VENDOR_TOKEN_EXPIRY_SECONDS,
        "type":       _VENDOR_TOKEN_TYPE,
    }
    return jwt.encode(payload, settings.secret_key, algorithm=_ALGORITHM)


def decode_vendor_dispute_token(token: str) -> dict:
    """
    Decodes and validates a vendor dispute token.
    Returns {"case_id": int, "vendor_npi": str} on success.
    Raises ValueError with a user-readable message on expiry, tampering,
    or malformed input.
    """
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[_ALGORITHM])
    except JWTError as exc:
        msg = str(exc).lower()
        if "expired" in msg or "signature has expired" in msg:
            raise ValueError(
                "Token has expired. The 15-day response window may have closed."
            )
        raise ValueError(f"Invalid or malformed vendor token: {exc}")

    if payload.get("type") != _VENDOR_TOKEN_TYPE:
        raise ValueError("Invalid token type")

    return {
        "case_id":    int(payload["case_id"]),
        "vendor_npi": str(payload["vendor_npi"]),
    }
