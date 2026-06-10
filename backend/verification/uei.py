"""UEI (Unique Entity Identifier) validation via SAM.gov entity registration.

Live: SAM.gov Entity Information API (same SAM_API_KEY as sam.py). Mock: deterministic
validity derived from the UEI. Drop-in: set UEI_MOCK=false + add SAM_API_KEY.
"""

import logging
import re
from datetime import datetime

import httpx

from ..config import get_settings
from .mock_util import is_mock_fail

logger = logging.getLogger("verification.uei")
settings = get_settings()
SAM_URL = "https://api.sam.gov/entity-information/v3/entities"
TIMEOUT = 10
_FMT = re.compile(r"^[A-Za-z0-9]{12}$")


async def _live_uei(uei: str) -> dict:
    try:
        r = httpx.get(SAM_URL, headers={"X-Api-Key": settings.sam_api_key},
                      params={"ueiSAM": uei, "includeSections": "entityRegistration,coreData"},
                      timeout=TIMEOUT)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        logger.error("UEI check failed | uei=%s | err=%r | at=%s", uei, e, datetime.utcnow().isoformat())
        return {"valid": False, "status": "check_failed", "manual_review": True,
                "reason": "SAM.gov unreachable"}
    entities = data.get("entityData") or data.get("entities") or []
    if not entities:
        return {"valid": False, "status": "not_found",
                "reason": "UEI not found in SAM.gov registry"}
    reg = (entities[0] or {}).get("entityRegistration", {}) or {}
    status = reg.get("registrationStatus", "Active")
    return {"valid": status == "Active", "uei": uei,
            "legal_name": reg.get("legalBusinessName"),
            "registration_status": status,
            "expiry_date": reg.get("registrationExpirationDate"),
            "entity_type": "Business or Organization"}


def _mock_uei(uei: str) -> dict:
    if not _FMT.match(uei or ""):
        return {"valid": False, "reason": "UEI must be 12 alphanumeric characters"}
    if is_mock_fail(uei, 10):
        return {"valid": False, "status": "not_found",
                "reason": "UEI not found in SAM.gov registry"}
    return {"valid": True, "uei": uei, "legal_name": "Mock Organization " + uei[-4:],
            "registration_status": "Active", "expiry_date": "2026-09-30",
            "entity_type": "Business or Organization"}


async def check_uei(uei: str) -> dict:
    if settings.uei_mock:
        return _mock_uei(uei)
    return await _live_uei(uei)
