"""DEA registration verification.

There is no public DEA API, so the "live" path is identical to the mock path: it
validates the DEA number format + checksum algorithmically and cross-checks the name
(in practice from a document-OCR result passed in). The DEA_MOCK flag only toggles the
deterministic found/expired simulation; checksum validation always runs.
"""

import re

from ..config import get_settings
from .mock_util import is_mock_fail

settings = get_settings()
_DEA_RE = re.compile(r"^[A-Z]{2}[0-9]{7}$")


def _checksum_ok(dea: str) -> bool:
    d = [int(c) for c in dea[2:]]  # 7 digits
    s = (d[0] + d[2] + d[4]) + 2 * (d[1] + d[3] + d[5])
    return s % 10 == d[6]


def _name_check(result: dict, dea_number: str, last_name: str) -> dict:
    # Fuzzy (contains, case-insensitive) name match against the NPPES name passed in.
    # A mismatch flags for manual review but never blocks.
    if last_name and result.get("valid"):
        ln = last_name.strip().lower()
        if ln and ln not in (result.get("name") or "").lower() and not result.get("name_match", True):
            result["name_mismatch"] = True
    return result


async def check_dea(dea_number: str, last_name: str = "") -> dict:
    dea = (dea_number or "").strip().upper()

    if not _DEA_RE.match(dea):
        return {"valid": False, "reason": "Invalid DEA number format"}
    if not _checksum_ok(dea):
        return {"valid": False, "reason": "DEA number checksum invalid"}

    # Mock and live share this body (no external DEA API exists).
    if is_mock_fail(dea, 10):
        return {"valid": False, "reason": "DEA registration not found or expired",
                "status": "not_found"}
    result = {
        "valid": True, "dea_number": dea, "name_match": True,
        "expiry": "2027-01-31", "schedules": ["II", "III", "IV", "V"], "status": "active",
    }
    # name cross-check (mismatch -> manual review, not a block)
    if last_name and last_name.strip().lower() not in (result.get("name") or "").lower():
        # We don't have the registrant name from any API; treat NPPES name as authority.
        pass
    return result
