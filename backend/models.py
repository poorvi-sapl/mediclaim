import uuid
from datetime import datetime, date
from sqlalchemy import (
    Column, String, Boolean, Date, DateTime,
    Numeric, Integer, Text, ForeignKey,
    CheckConstraint, UniqueConstraint
)
from sqlalchemy.dialects.postgresql import UUID, ARRAY, JSONB
from .database import Base

class Claim(Base):
    __tablename__ = "claims"
    id                  = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
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
    supplier_name       = Column(String(255), nullable=False)
    supplier_id         = Column(String(64), nullable=False, index=True)
    supplier_zip        = Column(String(10), nullable=True)
    supplier_state      = Column(String(2), nullable=True)
    claim_amount        = Column(Numeric(10, 2), nullable=False)
    plan_name           = Column(String(255), nullable=False)
    oig_flagged         = Column(Boolean, nullable=False, default=False)
    reviewed            = Column(Boolean, nullable=False, default=False)
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
            "role IN ('physician', 'plan_investigator')",
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
    supplier_id   = Column(String(64), nullable=False, index=True)
    supplier_name = Column(String(255), nullable=False)
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
    supplier_id      = Column(String(64), nullable=False, index=True)
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
    new_supplier_flag    = Column(Boolean, nullable=False, default=False)
    identity_reuse_flag  = Column(Boolean, nullable=False, default=False)
    hospice_duration_flag = Column(Boolean, nullable=False, default=False)
    upcoding_flag        = Column(Boolean, nullable=False, default=False)
    unbundling_flag      = Column(Boolean, nullable=False, default=False)
    physician_flag_count = Column(Integer, nullable=False, default=0)
    total_claim_count    = Column(Integer, nullable=False, default=0)
    total_claim_amount   = Column(Numeric(12, 2), nullable=False, default=0)
    top_supplier_id      = Column(String(64), nullable=True)
    top_supplier_name    = Column(String(255), nullable=True)
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
