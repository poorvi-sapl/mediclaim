"""Pydantic response/request models for the ClaimLens API."""

from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel


class FlagBadge(BaseModel):
    rule_name: str
    severity: str
    description: str


class ClaimResponse(BaseModel):
    id: str
    ccn: str
    patient_name: str
    patient_zip: str
    date_of_service: date
    cpt_code: Optional[str]
    hcpcs_code: Optional[str]
    service_description: str
    service_category: str
    vendor_name: str
    vendor_id: str
    supplier_npi: Optional[str]
    claim_amount: float
    oig_flagged: bool
    reviewed: bool
    latest_action: Optional[str] = None   # most recent action_type for this claim
    flags: list[str] = []
    severities: list[str] = []
    flag_descriptions: list[str] = []
    created_at: Optional[datetime] = None   # when the claim was received, for the detail screen's timeline

    class Config:
        from_attributes = True


class ClaimActionResponse(BaseModel):
    id: str
    action_type: str
    note: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class ClaimsPageResponse(BaseModel):
    items: list[ClaimResponse]
    total: int
    page: int
    page_size: int
    total_pages: int
    # NPI-wide aggregate cards (independent of the current filter/page)
    total_count: int = 0
    flagged_count: int = 0
    confirmed_count: int = 0
    disputed_count: int = 0
    unknown_count: int = 0


class PhysicianSummaryResponse(BaseModel):
    physician_name: str
    npi: str
    specialty: Optional[str]
    practice_state: Optional[str]
    practice_city: Optional[str]
    total_claims_month: int
    unreviewed_count: int
    unknown_supplier_count: int
    total_amount_month: float


class FlaggedSupplierResponse(BaseModel):
    vendor_id: str
    vendor_name: str
    claim_count: int
    total_amount: float
    first_flagged_at: datetime
    flagged_at: datetime
    plan_status: str = "pending"   # pending | under_review | acknowledged
    flag_count: int
    oig_flagged: bool


class ActionRequest(BaseModel):
    claim_id: str
    npi: str
    action_type: str
    note: Optional[str] = None


class ActionResponse(BaseModel):
    id: str
    action_type: str
    created_at: datetime


class ErrorResponse(BaseModel):
    error: str
    code: str


# --------------------------------------------------------------------------
# Plan-facing models
# --------------------------------------------------------------------------
class PlanSummaryResponse(BaseModel):
    total_npis: int
    # The critical band (81-100) — the same cut the NPI leaderboard's "High-risk
    # NPIs" tile shows. band_counts below carries the full breakdown so nothing
    # has to re-derive a union from an ambiguous single number.
    high_risk_npis: int
    band_counts: dict[str, int]
    alerts_today: int
    total_physician_flags: int


class NpiRiskRow(BaseModel):
    npi: str
    physician_name: str
    specialty: Optional[str]
    practice_state: Optional[str]
    practice_city: Optional[str]
    risk_score: int
    risk_band: str
    total_claim_count: int
    total_claim_amount: float
    physician_flag_count: int
    top_vendor_name: Optional[str]
    volume_flag: bool
    geo_flag: bool
    cross_npi_flag: bool
    oig_flag: bool
    new_vendor_flag: bool
    identity_reuse_flag: bool = False
    hospice_duration_flag: bool = False
    upcoding_flag: bool = False
    unbundling_flag: bool = False
    needs_manual_review: bool = False


class NpiRiskPageResponse(BaseModel):
    items: list[NpiRiskRow]
    total: int
    page: int
    page_size: int
    total_pages: int


class ScoreBreakdownItem(BaseModel):
    factor: str
    points: int


class NpiDetailResponse(BaseModel):
    profile: dict
    score: dict
    claims: ClaimsPageResponse
    physician_actions: list[dict]
    verification: Optional[dict] = None  # users.verification_results if this NPI registered; else None


class SupplierWatchlistRow(BaseModel):
    vendor_id: str
    vendor_name: str
    oig_flag: bool
    distinct_npi_count: Optional[int]
    physician_flag_count: int
    total_claim_count: int
    total_claim_amount: float
    risk_score: int
    risk_band: str
    first_seen: Optional[date] = None


class StatusLogEntry(BaseModel):
    status: str
    note: Optional[str] = None
    changed_by: Optional[str] = None
    changed_at: Optional[str] = None


class PlanActionDetail(BaseModel):
    action_id: str
    npi: str
    physician_name: Optional[str]
    vendor_name: str
    vendor_id: Optional[str] = None
    claim_id: str
    action_type: str
    amount: float
    created_at: datetime
    plan_status: str
    case_ref: Optional[str] = None
    history: list[StatusLogEntry] = []


class NotificationCount(BaseModel):
    unread: int


class SupplierPageResponse(BaseModel):
    items: list[SupplierWatchlistRow]
    total: int
    page: int
    page_size: int
    total_pages: int


class AlertEvent(BaseModel):
    id: str
    action_type: str
    physician_name: str
    npi: str
    vendor_name: str
    patient_name: str
    claim_amount: float
    timestamp: str
    escalation: bool = False
    escalation_label: Optional[str] = None
    plan_status: str = "pending"
    vendor_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Risk bands — the product's ONE risk classification.
#
# Every label, count, filter and chart derives from these bounds, so no surface
# can disagree with another (they previously used 70, 80 and 60 in five places,
# and a separate 3-band high/mid/low scheme in the analytics charts).
#
#   critical  81-100      high  61-80      medium  31-60      low  0-30
#
# The frontend mirror lives in frontend/src/lib/risk.js — change both together.
# ---------------------------------------------------------------------------
CRITICAL_MIN = 81
HIGH_MIN = 61
MEDIUM_MIN = 31
RISK_BAND_ORDER = ("critical", "high", "medium", "low")

# Single "high risk" cutoff shared by /plan/summary, analytics, and chat_tools:
# `risk_score > HIGH_RISK_THRESHOLD` is the top-severity count. Pinned to the
# critical floor so this count equals the critical band (81-100) everywhere.
HIGH_RISK_THRESHOLD = CRITICAL_MIN - 1   # 80

# Inclusive score bounds per band, for building count queries and range labels.
RISK_BAND_BOUNDS = {
    "critical": (CRITICAL_MIN, 100),
    "high": (HIGH_MIN, CRITICAL_MIN - 1),
    "medium": (MEDIUM_MIN, HIGH_MIN - 1),
    "low": (0, MEDIUM_MIN - 1),
}


def get_risk_band(score: int) -> str:
    """Score -> band name. The only place a score becomes a band, backend-side."""
    if score is None:
        return "low"
    if score >= CRITICAL_MIN:
        return "critical"
    if score >= HIGH_MIN:
        return "high"
    if score >= MEDIUM_MIN:
        return "medium"
    return "low"
