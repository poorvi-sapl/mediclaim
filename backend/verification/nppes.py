"""NPPES NPI lookup. Live path (NPPES_MOCK=false, the default) queries the loaded
NPPES registry snapshot (npi_profiles). Mock path is deterministic. Used by the
lightweight /auth/verify-npi endpoint; the registration endpoint keeps its own inline
NPPES check unchanged.
"""

import re

from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import NpiProfile
from .mock_util import is_mock_fail

settings = get_settings()
_FMT = re.compile(r"^\d{10}$")


def _live_nppes(npi: str, db: Session) -> dict:
    p = db.query(NpiProfile).filter(NpiProfile.npi == npi).first()
    if not p:
        return {"valid": False, "reason": "NPI not found in the NPPES registry"}
    return {"valid": True, "npi": npi, "name": p.physician_name,
            "state": p.practice_state, "specialty": p.specialty}


def _mock_nppes(npi: str) -> dict:
    if not _FMT.match(npi or ""):
        return {"valid": False, "reason": "NPI must be 10 digits"}
    if is_mock_fail(npi, 10):
        return {"valid": False, "reason": "NPI not found in the NPPES registry"}
    return {"valid": True, "npi": npi, "name": "Mock Provider " + npi[-4:], "state": "CA"}


async def check_nppes(npi: str, db: Session = None) -> dict:
    npi = (npi or "").strip()
    if not _FMT.match(npi):
        return {"valid": False, "reason": "NPI must be 10 digits"}
    if settings.nppes_mock or db is None:
        return _mock_nppes(npi)
    return _live_nppes(npi, db)
