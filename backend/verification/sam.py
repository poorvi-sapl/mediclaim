"""SAM.gov exclusion check for payer organizations.

Live: SAM.gov Entity Information API (needs SAM_API_KEY). Mock: deterministic ~7%
exclusion rate derived from the UEI. Drop-in: set SAM_MOCK=false + add SAM_API_KEY.
"""

import logging
from datetime import datetime

import httpx

from ..config import get_settings
from .mock_util import is_mock_fail

logger = logging.getLogger("verification.sam")
settings = get_settings()
SAM_URL = "https://api.sam.gov/entity-information/v3/entities"
TIMEOUT = 10


async def _live_sam_exclusions(org_name: str, uei: str) -> dict:
    try:
        r = httpx.get(SAM_URL, headers={"X-Api-Key": settings.sam_api_key},
                      params={"ueiSAM": uei, "includeSections": "entityRegistration"},
                      timeout=TIMEOUT)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        logger.error("SAM check failed | uei=%s | err=%r | at=%s", uei, e, datetime.utcnow().isoformat())
        return {"excluded": False, "status": "check_failed", "manual_review": True,
                "warning": "SAM.gov unreachable"}

    entities = data.get("entityData") or data.get("entities") or []
    if not entities:
        return {"excluded": False, "status": "not_found", "manual_review": True,
                "note": "UEI not found in SAM. Manual verification needed."}
    reg = (entities[0] or {}).get("entityRegistration", {}) or {}
    excluded = str(reg.get("exclusionStatusFlag", "N")).upper() == "Y"
    if excluded:
        return {"excluded": True, "uei": uei, "status": "excluded",
                "exclusion_type": reg.get("exclusionURL") or "Ineligibility",
                "reason": "Entity found on SAM.gov exclusion list"}
    return {"excluded": False, "uei": uei, "org_name": reg.get("legalBusinessName", org_name),
            "status": "active", "registration_expiry": reg.get("registrationExpirationDate")}


def _mock_sam_exclusions(org_name: str, uei: str) -> dict:
    if is_mock_fail(uei, 15):  # ~7% exclusion rate
        return {"excluded": True, "uei": uei, "status": "excluded",
                "reason": "Entity found on SAM.gov exclusion list",
                "exclusion_type": "Ineligibility"}
    return {"excluded": False, "uei": uei, "org_name": org_name, "status": "active",
            "registration_expiry": "2026-09-30", "cage_code": "mock-" + uei[-4:],
            "business_type": "Other"}


async def check_sam_exclusions(org_name: str, uei: str) -> dict:
    if settings.sam_mock:
        return _mock_sam_exclusions(org_name, uei)
    return await _live_sam_exclusions(org_name, uei)
