"""State medical license verification.

Each state has its own API/portal; live integration is per-state (Phase 3). When
STATE_LICENSE_MOCK=false and no integration exists for the state, we return a
manual_review result (never block). Add real state endpoints to STATE_LICENSE_APIS.
"""

import re

from ..config import get_settings
from .mock_util import is_mock_fail

settings = get_settings()

# Add real state license APIs here as they are integrated (Phase 3).
STATE_LICENSE_APIS = {
    # "CA": "https://api.example.com/ca-license",
}

_FMT = re.compile(r"^[A-Za-z0-9]{6,12}$")


async def _live_state_license(license_number: str, state: str, last_name: str) -> dict:
    api = STATE_LICENSE_APIS.get((state or "").upper())
    if not api:
        return {
            "valid": True, "status": "manual_review",
            "reason": f"Automated verification not available for {state}. Flagged for manual review.",
            "manual_review": True,
        }
    # Future: call the per-state API here. Until then, manual review.
    return {"valid": True, "status": "manual_review", "manual_review": True,
            "reason": f"State API for {state} not yet wired."}


def _mock_state_license(license_number: str, state: str, last_name: str) -> dict:
    if not _FMT.match(license_number or ""):
        return {"valid": False, "reason": "Invalid format"}
    if is_mock_fail((license_number or "") + (state or ""), 10):
        return {"valid": False, "status": "not_found",
                "reason": "License not found in state registry"}
    return {
        "valid": True, "license_number": license_number, "state": state,
        "status": "active", "expiry": "2026-12-31", "license_type": "MD",
        "name_match": True,
    }


async def check_state_license(license_number: str, state: str, last_name: str = "") -> dict:
    if settings.state_license_mock:
        return _mock_state_license(license_number, state, last_name)
    return await _live_state_license(license_number, state, last_name)
