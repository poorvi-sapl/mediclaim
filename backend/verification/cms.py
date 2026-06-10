"""CMS dataset verification checks for the physician registration flow.

Two read-only checks against public CMS datasets:
  1. check_order_referring(npi) — is the physician eligible to order/refer Medicare
     services (home health, hospice, DME)?
  2. check_revalidation(npi)    — is their Medicare enrollment revalidation current?

IMPORTANT — dataset mapping (verified live via the data-api on first build):
  The two dataset IDs in the original spec were SWAPPED. Confirmed by fetching one
  record from each endpoint:
    * c99b5865-... returns Order & Referring fields:
        NPI, FIRST_NAME, LAST_NAME, PARTB, DME, HHA, PMD, HOSPICE
    * e1f1fa9a-... returns Revalidation fields:
        Individual NPI, Individual First/Last Name, Individual State Code,
        Individual Specialty Description, Individual Due Date, Group Due Date, ...
  So each constant below points at the dataset that ACTUALLY serves its purpose.
  The data-api filters with ?filter[<Column>]=<value> (confirmed working).

Error handling (per spec): every call has a 10s timeout, is wrapped in try/except,
and a CMS outage NEVER blocks registration — it degrades to a manual-review flag.
Responses are never cached; we query live at registration time.

CMS_MOCK mode: when settings.cms_mock is true (CMS_MOCK=true in .env), the network is
not touched and deterministic fixtures are returned, keyed by the NPI's digits, so the
whole flow is demonstrable in environments that can't reach data.cms.gov:
    last 2 digits == "99" -> Order&Referring: NOT eligible (registration blocked)
    last 2 digits == "98" -> Order&Referring: simulated API failure (manual review)
    last digit    == "1"  -> Revalidation: lapsed
    last digit    == "2"  -> Revalidation: due_soon
    last digit    == "3"  -> Revalidation: tbd
    last digit    == "0"  -> Revalidation: not_found
    last digit    == "8"  -> Revalidation: simulated API failure
    otherwise             -> eligible / revalidation current
"""

import logging
from datetime import datetime, date, timedelta

import httpx

from ..config import get_settings

logger = logging.getLogger("verification.cms")
settings = get_settings()

# Each constant points at the dataset that genuinely serves its purpose (see module docstring).
ORDER_REFERRING_URL = "https://data.cms.gov/data-api/v1/dataset/c99b5865-1119-4436-bb80-c5af2773ea1f/data"
REVALIDATION_URL = "https://data.cms.gov/data-api/v1/dataset/e1f1fa9a-d6b4-417e-948a-c72dead8a41c/data"

TIMEOUT_SECONDS = 10
DUE_SOON_DAYS = 90

# Actual field names (confirmed from live responses).
OR_NPI_FIELD = "NPI"
OR_FIRST = "FIRST_NAME"
OR_LAST = "LAST_NAME"
RV_NPI_FIELD = "Individual NPI"
RV_FIRST = "Individual First Name"
RV_LAST = "Individual Last Name"
RV_STATE = "Individual State Code"
RV_SPECIALTY = "Individual Specialty Description"
RV_DUE_DATE = "Individual Due Date"


# ---------------------------------------------------------------------------
# FUNCTION 1 — Order & Referring eligibility
# ---------------------------------------------------------------------------
def check_order_referring(npi: str) -> dict:
    """Confirm the physician is eligible to order/refer Medicare services."""
    if settings.cms_mock:
        return _mock_order_referring(npi)

    try:
        resp = httpx.get(ORDER_REFERRING_URL,
                         params={f"filter[{OR_NPI_FIELD}]": npi},
                         timeout=TIMEOUT_SECONDS)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        _log_failure(ORDER_REFERRING_URL, npi, e)
        # A CMS outage must never lock out registration — flag for manual review.
        return {
            "eligible": True,
            "warning": "CMS Order and Referring check unavailable. Flagged for manual review.",
            "manual_review": True,
        }

    if not data:
        return {
            "eligible": False,
            "reason": ("NPI not found in Medicare Order and Referring dataset. "
                       "Physician may not be enrolled or eligible to order Medicare services."),
        }

    rec = data[0]
    name = f"{rec.get(OR_FIRST, '') or ''} {rec.get(OR_LAST, '') or ''}".strip()
    return {
        "eligible": True,
        "name": name or None,
        # The Order & Referring dataset has no state/specialty columns; the service
        # eligibility flags below are the meaningful payload (kept in `raw` for audit).
        "state": None,
        "specialty": None,
        "raw": rec,
    }


# ---------------------------------------------------------------------------
# FUNCTION 2 — Revalidation status
# ---------------------------------------------------------------------------
def check_revalidation(npi: str) -> dict:
    """Check whether the physician's Medicare revalidation is current/upcoming/lapsed."""
    if settings.cms_mock:
        return _mock_revalidation(npi)

    try:
        resp = httpx.get(REVALIDATION_URL,
                         params={f"filter[{RV_NPI_FIELD}]": npi},
                         timeout=TIMEOUT_SECONDS)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        _log_failure(REVALIDATION_URL, npi, e)
        return {"found": False, "status": "check_failed",
                "warning": "Revalidation check unavailable"}

    if not data:
        return {"found": False, "status": "not_found"}

    rec = data[0]
    due_raw = rec.get(RV_DUE_DATE)
    status = _revalidation_status(due_raw)
    return {"found": True, "status": status, "due_date": due_raw, "raw": rec}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _log_failure(url: str, npi: str, error: Exception) -> None:
    logger.error("CMS check failed | endpoint=%s | npi=%s | error=%s | at=%s",
                 url, npi, repr(error), datetime.utcnow().isoformat())


def _parse_due_date(value):
    if not value:
        return None
    s = str(value).strip()
    if not s or s.upper() == "TBD":
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%Y/%m/%d", "%m/%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(s).date()
    except ValueError:
        return None


def _revalidation_status(due_raw) -> str:
    due = _parse_due_date(due_raw)
    if due is None:
        return "tbd"
    today = date.today()
    if due < today:
        return "lapsed"
    if due <= today + timedelta(days=DUE_SOON_DAYS):
        return "due_soon"
    return "current"


# ---------------------------------------------------------------------------
# CMS_MOCK fixtures (deterministic, keyed by NPI digits — see module docstring)
# ---------------------------------------------------------------------------
def _mock_order_referring(npi: str) -> dict:
    tail2 = npi[-2:]
    if tail2 == "98":  # simulate CMS outage
        _log_failure(ORDER_REFERRING_URL, npi, RuntimeError("CMS_MOCK simulated failure"))
        return {
            "eligible": True,
            "warning": "CMS Order and Referring check unavailable. Flagged for manual review.",
            "manual_review": True,
        }
    if tail2 == "99":  # simulate "not enrolled to order/refer"
        return {
            "eligible": False,
            "reason": ("NPI not found in Medicare Order and Referring dataset. "
                       "Physician may not be enrolled or eligible to order Medicare services."),
        }
    return {
        "eligible": True,
        "name": "MOCK PROVIDER",
        "state": None,
        "specialty": None,
        "raw": {OR_NPI_FIELD: npi, OR_FIRST: "MOCK", OR_LAST: "PROVIDER",
                "PARTB": "Y", "DME": "Y", "HHA": "Y", "PMD": "N", "HOSPICE": "Y",
                "_mock": True},
    }


def _mock_revalidation(npi: str) -> dict:
    tail = npi[-1]
    today = date.today()
    if tail == "8":  # simulate failure
        _log_failure(REVALIDATION_URL, npi, RuntimeError("CMS_MOCK simulated failure"))
        return {"found": False, "status": "check_failed",
                "warning": "Revalidation check unavailable"}
    if tail == "0":
        return {"found": False, "status": "not_found"}
    if tail == "1":
        due = (today - timedelta(days=45)).isoformat()
    elif tail == "2":
        due = (today + timedelta(days=30)).isoformat()
    elif tail == "3":
        due = "TBD"
    else:
        due = (today + timedelta(days=400)).isoformat()
    return {
        "found": True,
        "status": _revalidation_status(due),
        "due_date": due,
        "raw": {RV_NPI_FIELD: npi, RV_DUE_DATE: due, "_mock": True},
    }
