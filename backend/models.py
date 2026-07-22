import uuid
from datetime import datetime, date
from sqlalchemy import (
    Column, String, Boolean, Date, DateTime,
    Numeric, Integer, Text, ForeignKey,
    CheckConstraint, UniqueConstraint, text
)
from sqlalchemy.dialects.postgresql import UUID, ARRAY, JSONB
from .database import Base

class Claim(Base):
    __tablename__ = "claims"
    id                  = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Short, CMS-style Claim Control Number shown to users in place of `id` — the raw
    # UUID stays the real internal key for joins/lookups, ccn is display/search-only.
    ccn                 = Column(String(20), nullable=False, unique=True, index=True, server_default=text(
        "(to_char(now(), 'YY') || to_char(now(), 'DDD') || lpad(nextval('claim_ccn_seq')::text, 6, '0'))"
    ))
    npi                 = Column(String(10), nullable=False, index=True)
    patient_id          = Column(String(64), nullable=False)
    patient_name        = Column(String(255), nullable=False)
    patient_zip         = Column(String(10), nullable=False)
    patient_state       = Column(String(2), nullable=False)
    patient_lat         = Column(Numeric(9, 6), nullable=True)
    patient_lng         = Column(Numeric(9, 6), nullable=True)
    date_of_service     = Column(Date, nullable=False, index=True)
    cpt_code            = Column(String(10), nullable=True)
    hcpcs_code          = Column(String(10), nullable=True)
    service_description = Column(String(512), nullable=False)
    service_category    = Column(String(32), nullable=False, index=True)
    vendor_name         = Column(String(255), nullable=False)
    vendor_id           = Column(String(64), nullable=False, index=True)
    vendor_zip          = Column(String(10), nullable=True)
    vendor_state        = Column(String(2), nullable=True)
    claim_amount        = Column(Numeric(10, 2), nullable=False)
    plan_name           = Column(String(255), nullable=False)
    oig_flagged         = Column(Boolean, nullable=False, default=False)
    reviewed            = Column(Boolean, nullable=False, default=False)
    verification_status = Column(String(32), nullable=True, server_default="'unverified'")
    vendor_npi          = Column(String(10),  nullable=True)
    vendor_type         = Column(String(50),  nullable=True)
    contact_email       = Column(String(200), nullable=True)
    contact_name        = Column(String(200), nullable=True)
    contact_phone       = Column(String(20),  nullable=True)
    ingested_at         = Column(DateTime, nullable=False, default=datetime.utcnow)
    created_at          = Column(DateTime, nullable=False, default=datetime.utcnow)
    __table_args__ = (
        CheckConstraint(
            "service_category IN ('home_health','hospice','dme','drugs','hospital')",
            name="chk_service_category"
        ),
        CheckConstraint("claim_amount >= 0", name="chk_claim_amount"),
    )

class User(Base):
    __tablename__ = "users"
    id            = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email         = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    role          = Column(String(20), nullable=False)
    npi           = Column(String(10), nullable=True)   # only for physician role
    full_name     = Column(String(255), nullable=True)
    created_at    = Column(DateTime, nullable=False, default=datetime.utcnow)
    last_login    = Column(DateTime, nullable=True)
    last_alert_seen_at = Column(DateTime, nullable=True)
    # --- MFA (TOTP) ---
    mfa_secret         = Column(Text, nullable=True)            # Fernet-encrypted TOTP secret, NULL until setup confirmed
    mfa_backup_codes   = Column(ARRAY(Text), nullable=True)     # 10 bcrypt-hashed single-use backup codes
    mfa_enabled        = Column(Boolean, nullable=False, default=False, server_default="false")
    mfa_pending_secret = Column(Text, nullable=True)            # temp encrypted secret during setup, cleared after confirm
    # --- CMS registration verification ---
    verification_results = Column(JSONB, nullable=True, server_default="{}")  # {order_referring, revalidation, checked_at}
    needs_manual_review  = Column(Boolean, nullable=False, default=False, server_default="false")
    is_active            = Column(Boolean, nullable=False, default=True, server_default="true")  # payer accounts start false (admin activation)
    organization_name    = Column(String(255), nullable=True)   # payer registrations
    __table_args__ = (
        CheckConstraint(
            "role IN ('physician', 'plan_investigator', 'vendor')",
            name="chk_user_role"
        ),
    )


class NpiProfile(Base):
    # Matches the seeded NPPES npi_profiles table exactly (10 cols),
    # plus practice_lat / practice_lng (populated by pgeocode during ETL).
    __tablename__ = "npi_profiles"
    npi              = Column(String(10), primary_key=True)
    physician_name   = Column(Text, nullable=True)
    specialty        = Column(Text, nullable=True)
    practice_address = Column(Text, nullable=True)
    practice_city    = Column(Text, nullable=True)
    practice_state   = Column(String(40), nullable=True)
    practice_zip     = Column(String(5), nullable=True)
    enrollment_date  = Column(Date, nullable=True)
    last_update      = Column(Date, nullable=True)
    oig_excluded     = Column(Boolean, nullable=True)
    practice_lat     = Column(Numeric(9, 6), nullable=True)
    practice_lng     = Column(Numeric(9, 6), nullable=True)

class Action(Base):
    __tablename__ = "actions"
    id            = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    claim_id      = Column(UUID(as_uuid=True), ForeignKey("claims.id", ondelete="CASCADE"), nullable=False)
    npi           = Column(String(10), nullable=False, index=True)
    action_type   = Column(String(32), nullable=False)
    note          = Column(Text, nullable=True)
    vendor_id     = Column(String(64), nullable=False, index=True)
    vendor_name   = Column(String(255), nullable=False)
    patient_name  = Column(String(255), nullable=False)
    claim_amount  = Column(Numeric(10, 2), nullable=False)
    broadcast     = Column(Boolean, nullable=False, default=False, index=True)
    plan_status   = Column(String(20), nullable=False, default="pending")
    created_at    = Column(DateTime, nullable=False, default=datetime.utcnow)

class ActionStatusLog(Base):
    __tablename__ = "action_status_log"
    id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    action_id  = Column(UUID(as_uuid=True), ForeignKey("actions.id", ondelete="CASCADE"), nullable=False, index=True)
    status     = Column(String(20), nullable=False)
    note       = Column(Text, nullable=True)
    changed_by = Column(String(255), nullable=True)
    changed_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class RulesFlag(Base):
    __tablename__ = "rules_flags"
    id               = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    claim_id         = Column(UUID(as_uuid=True), ForeignKey("claims.id", ondelete="CASCADE"), nullable=False, index=True)
    npi              = Column(String(10), nullable=False, index=True)
    vendor_id        = Column(String(64), nullable=False, index=True)
    rule_name        = Column(String(64), nullable=False, index=True)
    rule_description = Column(Text, nullable=False)
    severity         = Column(String(16), nullable=False)
    fired_at         = Column(DateTime, nullable=False, default=datetime.utcnow)

class NpiRiskScore(Base):
    __tablename__ = "npi_risk_scores"
    id                   = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    entity_type          = Column(String(16), nullable=False, index=True)
    entity_id            = Column(String(64), nullable=False, index=True)
    entity_name          = Column(String(255), nullable=False)
    risk_score           = Column(Integer, nullable=False, default=0, index=True)
    volume_flag          = Column(Boolean, nullable=False, default=False)
    geo_flag             = Column(Boolean, nullable=False, default=False)
    cross_npi_flag       = Column(Boolean, nullable=False, default=False)
    oig_flag             = Column(Boolean, nullable=False, default=False)
    new_vendor_flag      = Column(Boolean, nullable=False, default=False)
    identity_reuse_flag  = Column(Boolean, nullable=False, default=False)
    hospice_duration_flag = Column(Boolean, nullable=False, default=False)
    upcoding_flag        = Column(Boolean, nullable=False, default=False)
    unbundling_flag      = Column(Boolean, nullable=False, default=False)
    physician_flag_count = Column(Integer, nullable=False, default=0)
    total_claim_count    = Column(Integer, nullable=False, default=0)
    total_claim_amount   = Column(Numeric(12, 2), nullable=False, default=0)
    top_vendor_id        = Column(String(64), nullable=True)
    top_vendor_name      = Column(String(255), nullable=True)
    distinct_npi_count   = Column(Integer, nullable=True)
    last_calculated      = Column(DateTime, nullable=False, default=datetime.utcnow)
    __table_args__ = (
        CheckConstraint("entity_type IN ('npi','supplier')", name="chk_entity_type"),
        CheckConstraint("risk_score BETWEEN 0 AND 100", name="chk_risk_score"),
        UniqueConstraint("entity_type", "entity_id", name="uq_entity"),
    )


class Document(Base):
    __tablename__ = "documents"
    id            = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id       = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    doc_type      = Column(String(50))
    filename      = Column(String(255))
    file_path     = Column(Text)
    upload_status = Column(String(20), default="pending_review")
    reviewed_by   = Column(UUID(as_uuid=True), nullable=True)
    reviewed_at   = Column(DateTime, nullable=True)
    review_notes  = Column(Text, nullable=True)
    created_at    = Column(DateTime, nullable=False, default=datetime.utcnow)


class PhysicianBill(Base):
    __tablename__ = "physician_bills"
    id                = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    npi               = Column(String(10), nullable=False, index=True)
    patient_name      = Column(String(255), nullable=False)
    patient_synpuf_id = Column(String(64), nullable=True)
    service_date      = Column(Date, nullable=False, index=True)
    diagnosis_code    = Column(String(20), nullable=True)
    hcpcs_code        = Column(String(10), nullable=True)
    bill_amount       = Column(Numeric(10, 2), nullable=True)
    source            = Column(String(32), nullable=True)
    created_at        = Column(DateTime, nullable=False, default=datetime.utcnow)


# ---------------------------------------------------------------------------
# NPI Watch — notification loop tables
# ---------------------------------------------------------------------------

class Physician(Base):
    __tablename__ = "physicians"
    npi                  = Column(String(10), primary_key=True)
    first_name           = Column(String(100), nullable=True)
    last_name            = Column(String(100), nullable=True)
    specialty            = Column(Text, nullable=True)
    taxonomy_code        = Column(String(20), nullable=True)
    practice_name        = Column(String(255), nullable=True)
    practice_address     = Column(Text, nullable=True)   # TEXT in existing DB (NPPES import)
    email_primary        = Column(String(255), nullable=False)
    email_secondary      = Column(String(255), nullable=True)
    mobile_phone         = Column(String(20), nullable=True)
    notification_mode    = Column(String(10), nullable=False, default="REALTIME")
    alert_threshold      = Column(Numeric(10, 2), nullable=True)
    vendor_type_filter   = Column(JSONB, nullable=True)
    whitelisted_vendors  = Column(JSONB, nullable=True)
    auto_escalate_hours  = Column(Integer, nullable=False, default=72)
    verified             = Column(Boolean, nullable=False, default=False)
    verification_method  = Column(String(50), nullable=True)
    registered_date      = Column(DateTime, nullable=True)
    last_login           = Column(DateTime, nullable=True)
    __table_args__ = (
        CheckConstraint(
            "notification_mode IN ('REALTIME', 'DAILY', 'WEEKLY')",
            name="chk_physician_notification_mode"
        ),
    )


class ClaimNotification(Base):
    __tablename__ = "claim_notifications"
    notification_id      = Column(Integer, primary_key=True, autoincrement=True)
    claim_number         = Column(String(64), nullable=True, index=True)
    # Genuine FK + denormalized short display number for notifications tied to a real
    # Claim row (the notify_vendor_from_claim_action path). NULL for notifications from
    # the external payer-ingest path, whose claim_number is an arbitrary string with no
    # matching claims.id — those keep showing claim_number as-is (see display fallback).
    claim_id             = Column(UUID(as_uuid=True), ForeignKey("claims.id"), nullable=True, index=True)
    claim_ccn            = Column(String(20), nullable=True)
    physician_npi        = Column(String(10), ForeignKey("physicians.npi"), nullable=False, index=True)
    physician_npi_role   = Column(String(20), nullable=False)
    vendor_npi           = Column(String(10), nullable=True)
    vendor_name          = Column(String(255), nullable=True)
    vendor_type          = Column(String(20), nullable=True)
    patient_mbi          = Column(String(20), nullable=True)
    patient_name_partial = Column(String(50), nullable=True)
    dos_from             = Column(Date, nullable=True)
    dos_to               = Column(Date, nullable=True)
    service_description  = Column(String(512), nullable=True)
    hcpcs_codes          = Column(JSONB, nullable=True)
    amount_billed        = Column(Numeric(10, 2), nullable=True)
    amount_paid          = Column(Numeric(10, 2), nullable=True)
    response_token       = Column(String(512), nullable=True, index=True)
    notification_sent_at = Column(DateTime, nullable=True)
    email_sent           = Column(Boolean, nullable=False, default=False)
    push_sent            = Column(Boolean, nullable=False, default=False)
    sms_sent             = Column(Boolean, nullable=False, default=False)
    status               = Column(String(20), nullable=False, default="PENDING")
    physician_response   = Column(String(20), nullable=True)
    response_at          = Column(DateTime, nullable=True)
    response_changed     = Column(Boolean, nullable=False, default=False)
    response_change_reason = Column(Text, nullable=True)
    response_changed_at  = Column(DateTime, nullable=True)
    escalated_at         = Column(DateTime, nullable=True)
    created_at           = Column(DateTime, nullable=False, default=datetime.utcnow)
    __table_args__ = (
        CheckConstraint(
            "physician_npi_role IN ('ORDERING', 'REFERRING', 'CERTIFYING', 'ATTENDING')",
            name="chk_cn_npi_role"
        ),
        CheckConstraint(
            "status IN ('PENDING', 'CONFIRMED', 'DISPUTED', 'FRAUD_REPORTED', 'ESCALATED')",
            name="chk_cn_status"
        ),
        CheckConstraint(
            "vendor_type IN ('DME', 'HOME_HEALTH', 'HOSPICE') OR vendor_type IS NULL",
            name="chk_cn_vendor_type"
        ),
    )


class DisputeCase(Base):
    __tablename__ = "dispute_cases"
    case_id                      = Column(Integer, primary_key=True, autoincrement=True)
    notification_id              = Column(Integer, ForeignKey("claim_notifications.notification_id", ondelete="CASCADE"), nullable=False, index=True)
    physician_npi                = Column(String(10), nullable=False, index=True)
    vendor_npi                   = Column(String(10), nullable=True)
    dispute_type                 = Column(String(20), nullable=False)
    physician_notes              = Column(Text, nullable=True)
    billing_provider_notified_at = Column(DateTime, nullable=True)
    response_due_date            = Column(DateTime, nullable=True)
    provider_response_type       = Column(String(40), nullable=True)
    vendor_response              = Column(Text, nullable=True)
    vendor_docs                  = Column(JSONB, nullable=True)
    vendor_responded_at          = Column(DateTime, nullable=True)
    vendor_token                 = Column(String(600), nullable=True)
    reminder_sent_day7           = Column(Boolean, nullable=False, default=False)
    reminder_sent_day13          = Column(Boolean, nullable=False, default=False)
    expiry_notice_sent           = Column(Boolean, nullable=False, default=False)
    status                       = Column(String(30), nullable=False, default="OPEN")
    opened_at                    = Column(DateTime, nullable=False, default=datetime.utcnow)
    closed_at                    = Column(DateTime, nullable=True)
    resolution_notes             = Column(Text, nullable=True)
    # Physician-confirmation loop for RESOLVED_WITH_PHYSICIAN: a vendor's first response
    # must go through the physician before it counts as resolved. escalation_unlocked
    # flips to True once the physician rejects it (or the confirmation window lapses),
    # only then does the vendor's next response offer "Responded to Medicare" too.
    physician_confirmation_due_date = Column(DateTime, nullable=True)
    escalation_unlocked          = Column(Boolean, nullable=False, default=False)
    __table_args__ = (
        CheckConstraint(
            "dispute_type IN ('DISPUTE', 'FRAUD_REPORT', 'DECEASED_PATIENT', 'FLAG', 'UNKNOWN_PATIENT')",
            name="chk_dc_dispute_type"
        ),
        CheckConstraint(
            "status IN ('OPEN', 'RESPONDED_TO_MEDICARE', 'RESOLVED_BY_PHYSICIAN', 'NON_RESPONSIVE', 'CLOSED', 'REFERRED_OIG', 'PENDING_PHYSICIAN_CONFIRMATION', 'PENDING_PHYSICIAN_REVIEW', 'REFERRED_TO_PAYER')",
            name="chk_dc_status"
        ),
        CheckConstraint(
            "provider_response_type IN ('RESPONDED_TO_MEDICARE', 'PHYSICIAN_CHANGED_RESPONSE', 'NONE') OR provider_response_type IS NULL",
            name="chk_dc_provider_response_type"
        ),
    )


class DisputeCaseEvent(Base):
    """Append-only history log for a DisputeCase — one row per state transition
    (opened, each vendor response, each physician confirm/reject, each auto-
    escalation). DisputeCase itself only tracks the latest snapshot in its
    vendor_response/vendor_responded_at/provider_response_type/vendor_docs
    columns (overwritten on every vendor response, by design, so status
    lookups/filters stay cheap) — this table is what lets a full multi-round
    timeline be reconstructed instead of only ever showing the most recent
    round and silently losing everything before it."""
    __tablename__ = "dispute_case_events"

    event_id      = Column(Integer, primary_key=True, autoincrement=True)
    case_id       = Column(Integer, ForeignKey("dispute_cases.case_id", ondelete="CASCADE"), nullable=False, index=True)
    event_type    = Column(String(30), nullable=False)
    actor         = Column(String(20), nullable=False)
    # Only meaningful for VENDOR_RESPONDED — which of the two response paths
    # the vendor took for that specific round (RESPONDED_TO_MEDICARE or
    # RESOLVED_WITH_PHYSICIAN), independent of whatever the case's overall
    # provider_response_type says right now.
    response_type = Column(String(40), nullable=True)
    note          = Column(Text, nullable=True)
    # Docs attached to *this* round only, not the case's cumulative vendor_docs.
    docs          = Column(JSONB, nullable=True)
    created_at    = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        CheckConstraint(
            "event_type IN ('DISPUTE_OPENED', 'VENDOR_RESPONDED', 'PHYSICIAN_CONFIRMED', "
            "'PHYSICIAN_REJECTED', 'NON_RESPONSIVE', 'CONFIRMATION_EXPIRED')",
            name="chk_dce_event_type"
        ),
        CheckConstraint(
            "actor IN ('PHYSICIAN', 'VENDOR', 'SYSTEM')",
            name="chk_dce_actor"
        ),
    )


class SupplierProfile(Base):
    __tablename__ = "supplier_profiles"

    npi                  = Column(String(10), primary_key=True)
    supplier_name        = Column(Text)
    supplier_type        = Column(Text)
    address              = Column(Text)
    city                 = Column(Text)
    state                = Column(String(10))
    zip                  = Column(String(10))
    enrollment_date      = Column(Date)
    last_update          = Column(Date)
    oig_excluded         = Column(Boolean, default=False)
    # Phase 3 additions — added via ALTER TABLE below
    contact_email        = Column(String(200), nullable=True)
    contact_name         = Column(String(200), nullable=True)
    contact_phone        = Column(String(20),  nullable=True)
    npi_watch_registered = Column(Boolean, default=False)
    is_synthetic         = Column(Boolean, default=False)


# ---------------------------------------------------------------------------
# OIG exclusion tables — read-only reference data, never mutated by the app
# ---------------------------------------------------------------------------

class OigExcludedNpi(Base):
    __tablename__ = "oig_excluded_npis"

    npi            = Column(String(10),  primary_key=True)
    entity_name    = Column(Text,        nullable=True)
    exclusion_type = Column(Text,        nullable=True)
    exclusion_date = Column(Date,        nullable=True)
    specialty      = Column(Text,        nullable=True)
    state          = Column(String(10),  nullable=True)


class OigExcludedName(Base):
    __tablename__ = "oig_excluded_names"

    # No natural PK — surrogate key keeps SQLAlchemy happy; not added to the DB
    id             = Column(Integer,     primary_key=True, autoincrement=True)
    entity_name    = Column(Text,        nullable=True)
    exclusion_type = Column(Text,        nullable=True)
    exclusion_date = Column(Date,        nullable=True)
    specialty      = Column(Text,        nullable=True)
    state          = Column(String(10),  nullable=True)
