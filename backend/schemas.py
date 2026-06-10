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
    patient_name: str
    patient_zip: str
    date_of_service: date
    cpt_code: Optional[str]
    hcpcs_code: Optional[str]
    service_description: str
    service_category: str
    supplier_name: str
    supplier_id: str
    supplier_npi: Optional[str]
    claim_amount: float
    oig_flagged: bool
    reviewed: bool
    latest_action: Optional[str] = None   # most recent action_type for this claim
    flags: list[str] = []
    severities: list[str] = []
    flag_descriptions: list[str] = []

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
    supplier_id: str
    supplier_name: str
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
    high_risk_npis: int
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
    top_supplier_name: Optional[str]
    volume_flag: bool
    geo_flag: bool
    cross_npi_flag: bool
    oig_flag: bool
    new_supplier_flag: bool
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
    supplier_id: str
    supplier_name: str
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
    supplier_name: str
    supplier_id: Optional[str] = None
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
    supplier_name: str
    patient_name: str
    claim_amount: float
    timestamp: str
    escalation: bool = False
    escalation_label: Optional[str] = None
    plan_status: str = "pending"
    supplier_id: Optional[str] = None


def get_risk_band(score: int) -> str:
    if score > 80:
        return "critical"
    if score > 60:
        return "high"
    if score > 30:
        return "medium"
    return "low"
