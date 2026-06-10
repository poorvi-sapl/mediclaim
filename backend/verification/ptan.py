"""PTAN (Medicare Provider Transaction Access Number) verification.

# No public MAC API — manual review always required.
Both mock and live paths return self_reported + manual_review; only the deterministic
"could not verify" simulation is gated by PTAN_MOCK.
"""

import re

from ..config import get_settings
from .mock_util import is_mock_fail

settings = get_settings()
_FMT = re.compile(r"^[A-Za-z0-9]{6,10}$")


async def check_ptan(ptan: str, npi: str = "") -> dict:
    p = (ptan or "").strip()
    if not _FMT.match(p):
        return {"valid": False, "reason": "Invalid PTAN format"}

    # mock + live behave the same (no public MAC API).
    if is_mock_fail(p, 10):
        return {
            "valid": False, "status": "unverified",
            "reason": "PTAN could not be verified. Flagged for MAC confirmation.",
            "manual_review": True,
        }
    return {
        "valid": True, "ptan": p, "status": "self_reported",
        "manual_review": True,  # always manual review — no live API
        "note": "PTAN collected. MAC verification pending.",
    }
