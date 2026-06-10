# LLD — Low Level Design
## ClaimLens — NPI Intelligence Platform

---

## Document Purpose

This document defines the internal design of every component in ClaimLens. Where HLD defines what each component does and why, LLD defines exactly how it is built — function signatures, class structures, algorithm logic, error handling patterns, and implementation decisions. A developer should be able to read this document and write the code without ambiguity.

---

## 1. Project Structure

```
backend/
├── main.py
├── database.py
├── models.py
├── config.py
├── routers/
│   ├── __init__.py
│   ├── claims.py
│   ├── actions.py
│   ├── dashboard.py
│   └── alerts.py
├── rules/
│   ├── __init__.py
│   ├── engine.py
│   └── models.py
├── scoring/
│   ├── __init__.py
│   └── risk_score.py
├── etl/
│   ├── __init__.py
│   ├── mapper.py
│   ├── entity_resolution.py
│   ├── geocoder.py
│   └── oig_checker.py
└── data/
    ├── generate_synthetic.py
    ├── load_oig_leie.py
    ├── demo_reset.py
    └── seed_demo_actions.py
```

---

## 2. Configuration — `config.py`

Single source of truth for all configuration values. Uses Pydantic Settings for automatic environment variable loading and validation.

```python
from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    # Database
    database_url: str

    # OpenAI
    openai_api_key: str

    # Security
    secret_key: str
    cors_origins: list[str] = ["http://localhost:3000"]

    # App
    port: int = 8000
    environment: str = "development"

    # Rules engine thresholds
    volume_spike_multiplier: float = 2.0      # rate must be X times baseline
    geographic_anomaly_miles: float = 150.0   # distance threshold in miles
    cross_npi_threshold: int = 3              # distinct NPIs before flagging
    new_supplier_amount_threshold: float = 500.0  # minimum amount for new supplier flag
    new_supplier_days_lookback: int = 30      # days to check for "new" supplier

    # Risk scoring weights
    weight_volume_spike: int = 25
    weight_geo_anomaly: int = 15
    weight_cross_npi: int = 30
    weight_oig_hit: int = 35
    weight_new_supplier: int = 10
    weight_per_physician_flag: int = 5
    max_physician_flag_contribution: int = 20

    # SSE
    sse_keepalive_seconds: int = 15

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

@lru_cache()
def get_settings() -> Settings:
    return Settings()
```

**Design decision:** All threshold values are in config, not hardcoded. Changing the cross-NPI threshold from 3 to 5 requires only an environment variable change, not a code change.

---

## 3. Database Layer — `database.py`

```python
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from .config import get_settings

settings = get_settings()

engine = create_engine(
    settings.database_url,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,        # test connection before use
    pool_recycle=3600,         # recycle connections after 1 hour
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

Base = declarative_base()

def get_db():
    """FastAPI dependency — yields a DB session and closes it after request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

---

## 4. Models — `models.py`

SQLAlchemy ORM models matching the schema defined in DB_SCHEMA.md exactly.

```python
import uuid
from datetime import datetime, date
from decimal import Decimal
from sqlalchemy import (
    Column, String, Boolean, Date, DateTime,
    Numeric, Integer, Text, ForeignKey, CheckConstraint, UniqueConstraint
)
from sqlalchemy.dialects.postgresql import UUID
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
    oig_flagged         = Column(Boolean, nullable=False, default=False, index=True)
    reviewed            = Column(Boolean, nullable=False, default=False)
    ingested_at         = Column(DateTime, nullable=False, default=datetime.utcnow)
    created_at          = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        CheckConstraint(
            "service_category IN ('home_health','hospice','dme','drugs','hospital')",
            name="chk_service_category"
        ),
        CheckConstraint("claim_amount >= 0", name="chk_claim_amount"),
        CheckConstraint("LENGTH(npi) = 10", name="chk_npi_length"),
    )


class NpiProfile(Base):
    __tablename__ = "npi_profiles"

    npi               = Column(String(10), primary_key=True)
    physician_name    = Column(String(255), nullable=False)
    specialty         = Column(String(255), nullable=True)
    practice_city     = Column(String(128), nullable=True)
    practice_state    = Column(String(2), nullable=True)
    practice_zip      = Column(String(10), nullable=False)
    practice_lat      = Column(Numeric(9, 6), nullable=True)
    practice_lng      = Column(Numeric(9, 6), nullable=True)
    enrollment_status = Column(String(32), nullable=True)
    enrolled_since    = Column(Date, nullable=True)
    created_at        = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at        = Column(DateTime, nullable=False, default=datetime.utcnow)


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
    created_at    = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        CheckConstraint(
            "action_type IN ('confirm','dispute','flag_supplier','unknown_patient')",
            name="chk_action_type"
        ),
    )


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

    __table_args__ = (
        CheckConstraint(
            "rule_name IN ('volume_spike','geographic_anomaly','cross_npi_supplier','new_high_value_supplier','oig_leie_hit')",
            name="chk_rule_name"
        ),
        CheckConstraint(
            "severity IN ('low','medium','high','critical')",
            name="chk_severity"
        ),
    )


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
```

---

## 5. Rules Engine — `rules/engine.py`

### Data Classes

```python
from dataclasses import dataclass
from uuid import UUID

@dataclass
class RuleFlagResult:
    claim_id: UUID
    npi: str
    supplier_id: str
    rule_name: str
    rule_description: str
    severity: str
```

### Helper — Haversine Distance

```python
import math

def haversine_miles(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """
    Calculate distance in miles between two lat/lng points.
    Uses haversine formula. Returns float miles.
    """
    R = 3958.8  # Earth radius in miles
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dphi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlng/2)**2
    return 2 * R * math.asin(math.sqrt(a))
```

### Rule 1 — Volume Spike

```python
def volume_spike_rule(db: Session, settings: Settings) -> list[RuleFlagResult]:
    """
    Detect NPIs whose claim rate in the last 30 days is more than
    settings.volume_spike_multiplier times their rate in the prior 60-day baseline.

    Algorithm:
        baseline_rate = claims_in_prior_60_days / 60  (claims per day)
        recent_rate   = claims_in_last_30_days / 30   (claims per day)
        flag if recent_rate > baseline_rate * multiplier
        AND baseline_rate > 0 (skip NPIs with no prior history)

    Returns one RuleFlagResult per claim in the flagged NPI's last-30-day window.
    """
    flags = []
    today = date.today()
    recent_start  = today - timedelta(days=30)
    baseline_start = today - timedelta(days=90)
    baseline_end   = today - timedelta(days=30)

    # Get claim counts per NPI for both windows
    recent_counts = (
        db.query(Claim.npi, func.count(Claim.id).label("count"))
        .filter(Claim.date_of_service >= recent_start)
        .group_by(Claim.npi)
        .all()
    )
    baseline_counts = (
        db.query(Claim.npi, func.count(Claim.id).label("count"))
        .filter(Claim.date_of_service >= baseline_start)
        .filter(Claim.date_of_service < baseline_end)
        .group_by(Claim.npi)
        .all()
    )

    baseline_map = {row.npi: row.count for row in baseline_counts}

    for row in recent_counts:
        baseline = baseline_map.get(row.npi, 0)
        if baseline == 0:
            continue  # no prior history — cannot calculate spike
        recent_rate   = row.count / 30
        baseline_rate = baseline / 60
        if recent_rate > baseline_rate * settings.volume_spike_multiplier:
            # Flag every claim in the recent window for this NPI
            recent_claims = (
                db.query(Claim)
                .filter(Claim.npi == row.npi)
                .filter(Claim.date_of_service >= recent_start)
                .all()
            )
            for claim in recent_claims:
                flags.append(RuleFlagResult(
                    claim_id=claim.id,
                    npi=claim.npi,
                    supplier_id=claim.supplier_id,
                    rule_name="volume_spike",
                    rule_description=(
                        f"NPI {claim.npi} claim rate in last 30 days "
                        f"({row.count} claims, {recent_rate:.1f}/day) is "
                        f"{recent_rate/baseline_rate:.1f}x the prior 60-day "
                        f"baseline ({baseline} claims, {baseline_rate:.1f}/day)"
                    ),
                    severity="high",
                ))
    return flags
```

### Rule 2 — Geographic Anomaly

```python
def geographic_anomaly_rule(db: Session, settings: Settings) -> list[RuleFlagResult]:
    """
    Flag claims where patient is more than settings.geographic_anomaly_miles
    from the ordering physician's practice location.

    Requires patient_lat/lng on claims and practice_lat/lng on npi_profiles.
    Skips claims where either lat/lng is null.
    """
    flags = []

    claims_with_profiles = (
        db.query(Claim, NpiProfile)
        .join(NpiProfile, NpiProfile.npi == Claim.npi)
        .filter(
            Claim.patient_lat.isnot(None),
            Claim.patient_lng.isnot(None),
            NpiProfile.practice_lat.isnot(None),
            NpiProfile.practice_lng.isnot(None),
        )
        .all()
    )

    for claim, profile in claims_with_profiles:
        distance = haversine_miles(
            float(claim.patient_lat), float(claim.patient_lng),
            float(profile.practice_lat), float(profile.practice_lng)
        )
        if distance > settings.geographic_anomaly_miles:
            flags.append(RuleFlagResult(
                claim_id=claim.id,
                npi=claim.npi,
                supplier_id=claim.supplier_id,
                rule_name="geographic_anomaly",
                rule_description=(
                    f"Patient zip {claim.patient_zip} is {distance:.0f} miles "
                    f"from physician practice zip {profile.practice_zip} "
                    f"(threshold: {settings.geographic_anomaly_miles:.0f} miles)"
                ),
                severity="medium",
            ))
    return flags
```

### Rule 3 — Cross-NPI Supplier

```python
def cross_npi_supplier_rule(db: Session, settings: Settings) -> list[RuleFlagResult]:
    """
    Flag all claims from suppliers that bill under more than
    settings.cross_npi_threshold distinct NPIs.
    """
    flags = []

    supplier_npi_counts = (
        db.query(Claim.supplier_id, Claim.supplier_name,
                 func.count(func.distinct(Claim.npi)).label("npi_count"))
        .group_by(Claim.supplier_id, Claim.supplier_name)
        .having(func.count(func.distinct(Claim.npi)) > settings.cross_npi_threshold)
        .all()
    )

    for supplier in supplier_npi_counts:
        flagged_claims = (
            db.query(Claim)
            .filter(Claim.supplier_id == supplier.supplier_id)
            .all()
        )
        for claim in flagged_claims:
            flags.append(RuleFlagResult(
                claim_id=claim.id,
                npi=claim.npi,
                supplier_id=claim.supplier_id,
                rule_name="cross_npi_supplier",
                rule_description=(
                    f"Supplier '{supplier.supplier_name}' is billing under "
                    f"{supplier.npi_count} distinct physician NPIs "
                    f"(threshold: {settings.cross_npi_threshold})"
                ),
                severity="critical",
            ))
    return flags
```

### Rule 4 — New High-Value Supplier

```python
def new_high_value_supplier_rule(db: Session, settings: Settings) -> list[RuleFlagResult]:
    """
    Flag claims from suppliers appearing for the first time under an NPI
    within the last settings.new_supplier_days_lookback days,
    where claim_amount > settings.new_supplier_amount_threshold.
    """
    flags = []
    cutoff = date.today() - timedelta(days=settings.new_supplier_days_lookback)

    # Get all (npi, supplier_id) pairs with their earliest claim date
    earliest_dates = (
        db.query(
            Claim.npi,
            Claim.supplier_id,
            func.min(Claim.date_of_service).label("first_seen")
        )
        .group_by(Claim.npi, Claim.supplier_id)
        .all()
    )

    # New pairs: first seen within lookback window
    new_pairs = {
        (row.npi, row.supplier_id)
        for row in earliest_dates
        if row.first_seen >= cutoff
    }

    for npi, supplier_id in new_pairs:
        qualifying_claims = (
            db.query(Claim)
            .filter(
                Claim.npi == npi,
                Claim.supplier_id == supplier_id,
                Claim.claim_amount > settings.new_supplier_amount_threshold,
            )
            .all()
        )
        for claim in qualifying_claims:
            flags.append(RuleFlagResult(
                claim_id=claim.id,
                npi=claim.npi,
                supplier_id=claim.supplier_id,
                rule_name="new_high_value_supplier",
                rule_description=(
                    f"Supplier '{claim.supplier_name}' appeared for the first time "
                    f"under NPI {claim.npi} within the last "
                    f"{settings.new_supplier_days_lookback} days "
                    f"with claim amount ${claim.claim_amount:.2f} "
                    f"(threshold: ${settings.new_supplier_amount_threshold:.2f})"
                ),
                severity="medium",
            ))
    return flags
```

### Rule 5 — OIG LEIE Hit

```python
def oig_leie_hit_rule(db: Session) -> list[RuleFlagResult]:
    """
    Flag all claims where oig_flagged = true.
    The oig_flagged boolean is set at ETL ingestion time.
    This rule simply surfaces those flags in the rules_flags table.
    """
    flagged_claims = db.query(Claim).filter(Claim.oig_flagged == True).all()

    return [
        RuleFlagResult(
            claim_id=claim.id,
            npi=claim.npi,
            supplier_id=claim.supplier_id,
            rule_name="oig_leie_hit",
            rule_description=(
                f"Supplier '{claim.supplier_name}' appears on the OIG LEIE "
                f"exclusion list. Medicare/Medicaid cannot reimburse claims "
                f"from excluded providers."
            ),
            severity="critical",
        )
        for claim in flagged_claims
    ]
```

### Orchestrator — `run_all_rules()`

```python
def run_all_rules(db: Session, settings: Settings) -> int:
    """
    Run all 5 rules against the full claims dataset.
    Clears existing flags before inserting new ones (idempotent).

    Returns total number of flags written.
    """
    import logging
    logger = logging.getLogger(__name__)

    logger.info("Rules engine starting...")

    # Clear existing flags (idempotency)
    deleted = db.query(RulesFlag).delete()
    db.commit()
    logger.info(f"Cleared {deleted} existing flags")

    all_flags: list[RuleFlagResult] = []

    rules = [
        ("volume_spike",          lambda: volume_spike_rule(db, settings)),
        ("geographic_anomaly",    lambda: geographic_anomaly_rule(db, settings)),
        ("cross_npi_supplier",    lambda: cross_npi_supplier_rule(db, settings)),
        ("new_high_value_supplier", lambda: new_high_value_supplier_rule(db, settings)),
        ("oig_leie_hit",          lambda: oig_leie_hit_rule(db)),
    ]

    for rule_name, rule_fn in rules:
        import time
        start = time.time()
        results = rule_fn()
        elapsed = time.time() - start
        all_flags.extend(results)
        logger.info(f"Rule '{rule_name}': {len(results)} flags fired in {elapsed:.2f}s")

    # Bulk insert all flags
    if all_flags:
        db.bulk_insert_mappings(RulesFlag, [
            {
                "claim_id":         str(f.claim_id),
                "npi":              f.npi,
                "supplier_id":      f.supplier_id,
                "rule_name":        f.rule_name,
                "rule_description": f.rule_description,
                "severity":         f.severity,
            }
            for f in all_flags
        ])
        db.commit()

    logger.info(f"Rules engine complete: {len(all_flags)} total flags written")
    return len(all_flags)
```

---

## 6. Risk Scoring — `scoring/risk_score.py`

```python
def calculate_all_scores(db: Session, settings: Settings) -> None:
    """
    Calculate risk scores for all NPIs and all suppliers.
    Upserts into npi_risk_scores table.
    """
    _calculate_npi_scores(db, settings)
    _calculate_supplier_scores(db, settings)
    db.commit()


def _calculate_npi_scores(db: Session, settings: Settings) -> None:
    all_npis = db.query(NpiProfile).all()

    for profile in all_npis:
        npi = profile.npi

        # Pull flags
        flags = db.query(RulesFlag).filter(RulesFlag.npi == npi).all()
        flag_names = {f.rule_name for f in flags}

        # Physician flag count (only flag_supplier + unknown_patient)
        physician_flags = (
            db.query(func.count(Action.id))
            .filter(Action.npi == npi)
            .filter(Action.action_type.in_(["flag_supplier", "unknown_patient"]))
            .scalar() or 0
        )

        # Score calculation
        score = 0
        volume_flag    = "volume_spike" in flag_names
        geo_flag       = "geographic_anomaly" in flag_names
        cross_npi_flag = "cross_npi_supplier" in flag_names
        oig_flag       = "oig_leie_hit" in flag_names
        new_sup_flag   = "new_high_value_supplier" in flag_names

        if volume_flag:    score += settings.weight_volume_spike
        if geo_flag:       score += settings.weight_geo_anomaly
        if cross_npi_flag: score += settings.weight_cross_npi
        if oig_flag:       score += settings.weight_oig_hit
        if new_sup_flag:   score += settings.weight_new_supplier

        flag_contribution = min(
            physician_flags * settings.weight_per_physician_flag,
            settings.max_physician_flag_contribution
        )
        score = min(score + flag_contribution, 100)

        # Claim stats
        claim_stats = (
            db.query(
                func.count(Claim.id).label("total_count"),
                func.sum(Claim.claim_amount).label("total_amount"),
            )
            .filter(Claim.npi == npi)
            .first()
        )

        # Top supplier
        top_supplier = (
            db.query(Claim.supplier_id, Claim.supplier_name,
                     func.count(Claim.id).label("cnt"))
            .filter(Claim.npi == npi)
            .group_by(Claim.supplier_id, Claim.supplier_name)
            .order_by(func.count(Claim.id).desc())
            .first()
        )

        # Upsert
        existing = (
            db.query(NpiRiskScore)
            .filter_by(entity_type="npi", entity_id=npi)
            .first()
        )
        values = dict(
            entity_type="npi",
            entity_id=npi,
            entity_name=profile.physician_name,
            risk_score=score,
            volume_flag=volume_flag,
            geo_flag=geo_flag,
            cross_npi_flag=cross_npi_flag,
            oig_flag=oig_flag,
            new_supplier_flag=new_sup_flag,
            physician_flag_count=physician_flags,
            total_claim_count=claim_stats.total_count or 0,
            total_claim_amount=claim_stats.total_amount or 0,
            top_supplier_id=top_supplier.supplier_id if top_supplier else None,
            top_supplier_name=top_supplier.supplier_name if top_supplier else None,
            last_calculated=datetime.utcnow(),
        )

        if existing:
            for k, v in values.items():
                setattr(existing, k, v)
        else:
            db.add(NpiRiskScore(**values))
```

The supplier scoring function follows the identical pattern with `entity_type = "supplier"` and `distinct_npi_count` populated from a COUNT(DISTINCT npi) query.

---

## 7. API Layer

### 7.1 Pydantic Response Models

```python
# schemas.py

from pydantic import BaseModel
from uuid import UUID
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

class ClaimResponse(BaseModel):
    id: UUID
    patient_name: str
    patient_zip: str
    date_of_service: date
    cpt_code: Optional[str]
    hcpcs_code: Optional[str]
    service_description: str
    service_category: str
    supplier_name: str
    supplier_id: str
    claim_amount: Decimal
    oig_flagged: bool
    reviewed: bool
    flags: list[str] = []
    severities: list[str] = []

    class Config:
        from_attributes = True


class PhysicianSummaryResponse(BaseModel):
    physician_name: str
    npi: str
    specialty: Optional[str]
    practice_state: Optional[str]
    total_claims_month: int
    unreviewed_count: int
    unknown_supplier_count: int
    total_amount_month: Decimal


class ActionRequest(BaseModel):
    claim_id: UUID
    npi: str
    action_type: str  # validated in router
    note: Optional[str] = None


class ActionResponse(BaseModel):
    id: UUID
    action_type: str
    created_at: datetime


class NpiRiskRow(BaseModel):
    npi: str
    physician_name: str
    specialty: Optional[str]
    practice_state: Optional[str]
    risk_score: int
    total_claim_count: int
    total_claim_amount: Decimal
    physician_flag_count: int
    top_supplier_name: Optional[str]
    volume_flag: bool
    geo_flag: bool
    cross_npi_flag: bool
    oig_flag: bool
    new_supplier_flag: bool


class SupplierWatchlistRow(BaseModel):
    supplier_id: str
    supplier_name: str
    oig_flag: bool
    distinct_npi_count: Optional[int]
    physician_flag_count: int
    total_claim_amount: Decimal
    risk_score: int


class AlertEvent(BaseModel):
    id: str
    action_type: str
    physician_name: str
    npi: str
    supplier_name: str
    patient_name: str
    claim_amount: Decimal
    timestamp: str


class HealthResponse(BaseModel):
    status: str
    database: str
    total_claims: int
    total_flags: int
    timestamp: datetime


class ErrorResponse(BaseModel):
    error: str
    code: str
```

---

### 7.2 Physician Router — `routers/claims.py`

```python
@router.get("/physician/{npi}/summary", response_model=PhysicianSummaryResponse)
def get_physician_summary(npi: str, db: Session = Depends(get_db)):
    if len(npi) != 10 or not npi.isdigit():
        raise HTTPException(status_code=422, detail="NPI must be exactly 10 digits")

    profile = db.query(NpiProfile).filter(NpiProfile.npi == npi).first()
    if not profile:
        raise HTTPException(status_code=404, detail="NPI not found")

    # ... queries as defined in DATA_FLOW.md
    return PhysicianSummaryResponse(...)


@router.get("/physician/{npi}/claims", response_model=list[ClaimResponse])
def get_physician_claims(
    npi: str,
    category: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    reviewed: Optional[bool] = None,
    supplier_search: Optional[str] = None,
    page: int = 0,
    db: Session = Depends(get_db)
):
    """
    Returns paginated claims for this NPI with applied filters.
    Each claim includes its rules_flags as a list.
    Default sort: reviewed=false first, then date_of_service DESC.
    Page size: 50.
    """
    # Validate NPI
    # Build base query with LEFT JOIN to rules_flags
    # Apply filters conditionally
    # Sort and paginate
    # Return list[ClaimResponse]
    ...


@router.get("/physician/{npi}/flagged-suppliers")
def get_flagged_suppliers(npi: str, db: Session = Depends(get_db)):
    """
    Returns all suppliers this physician has flagged,
    with claim counts and total amounts.
    """
    ...
```

---

### 7.3 Actions Router — `routers/actions.py`

```python
ALERT_ACTION_TYPES = {"flag_supplier", "unknown_patient"}
VALID_ACTION_TYPES = {"confirm", "dispute", "flag_supplier", "unknown_patient"}

@router.post("/actions", response_model=ActionResponse, status_code=201)
async def create_action(
    request: ActionRequest,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    # 1. Validate action_type
    if request.action_type not in VALID_ACTION_TYPES:
        raise HTTPException(
            status_code=422,
            detail={"error": f"Invalid action_type", "code": "INVALID_ACTION_TYPE"}
        )

    # 2. Fetch claim (validates claim_id exists)
    claim = db.query(Claim).filter(Claim.id == request.claim_id).first()
    if not claim:
        raise HTTPException(status_code=404, detail={"error": "Claim not found", "code": "CLAIM_NOT_FOUND"})

    # 3. Fetch physician name for alert
    profile = db.query(NpiProfile).filter(NpiProfile.npi == request.npi).first()
    physician_name = profile.physician_name if profile else f"NPI {request.npi}"

    # 4. Create action + update claim.reviewed in single transaction
    try:
        action = Action(
            claim_id=request.claim_id,
            npi=request.npi,
            action_type=request.action_type,
            note=request.note,
            supplier_id=claim.supplier_id,
            supplier_name=claim.supplier_name,
            patient_name=claim.patient_name,
            claim_amount=claim.claim_amount,
            broadcast=False,
        )
        db.add(action)
        claim.reviewed = True
        db.commit()
        db.refresh(action)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=503, detail={"error": "Database error", "code": "DB_ERROR"})

    # 5. Update risk score if this is a flagging action
    if request.action_type in ALERT_ACTION_TYPES:
        _increment_supplier_flag_count(db, claim.supplier_id, settings)

    # 6. Broadcast SSE event if flagging action
    if request.action_type in ALERT_ACTION_TYPES:
        event = AlertEvent(
            id=str(action.id),
            action_type=request.action_type,
            physician_name=physician_name,
            npi=request.npi,
            supplier_name=claim.supplier_name,
            patient_name=claim.patient_name,
            claim_amount=claim.claim_amount,
            timestamp=action.created_at.isoformat(),
        )
        await broadcast_alert(event)

    return ActionResponse(
        id=action.id,
        action_type=action.action_type,
        created_at=action.created_at,
    )
```

---

### 7.4 SSE Alert Stream — `routers/alerts.py`

```python
import asyncio
import json
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

router = APIRouter()

# Global set of queues — one per connected plan dashboard client
_connections: set[asyncio.Queue] = set()


async def broadcast_alert(event: AlertEvent) -> None:
    """Called by actions router when a flag action is submitted."""
    message = f"data: {event.model_dump_json()}\n\n"
    dead_connections = set()

    for queue in _connections:
        try:
            await queue.put(message)
        except Exception:
            dead_connections.add(queue)

    _connections.difference_update(dead_connections)

    # Mark as broadcast in DB (background task)
    # This is handled separately to avoid blocking the response


@router.get("/plan/alerts/stream")
async def alert_stream(db: Session = Depends(get_db)):
    """
    SSE endpoint. Holds connection open. Pushes events when physicians flag claims.
    On connect, replays any unbroadcast events first.
    """
    queue: asyncio.Queue = asyncio.Queue()
    _connections.add(queue)

    async def event_generator():
        try:
            # Replay unbroadcast events on connect
            unbroadcast = (
                db.query(Action)
                .filter(Action.broadcast == False)
                .filter(Action.action_type.in_(["flag_supplier", "unknown_patient"]))
                .order_by(Action.created_at.asc())
                .all()
            )
            for action in unbroadcast:
                # Build and yield replayed events
                profile = db.query(NpiProfile).filter(
                    NpiProfile.npi == action.npi
                ).first()
                event = AlertEvent(
                    id=str(action.id),
                    action_type=action.action_type,
                    physician_name=profile.physician_name if profile else action.npi,
                    npi=action.npi,
                    supplier_name=action.supplier_name,
                    patient_name=action.patient_name,
                    claim_amount=action.claim_amount,
                    timestamp=action.created_at.isoformat(),
                )
                yield f"data: {event.model_dump_json()}\n\n"
                action.broadcast = True
            db.commit()

            # Keep-alive and new event loop
            while True:
                try:
                    message = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield message
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"

        except asyncio.CancelledError:
            pass
        finally:
            _connections.discard(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # critical for Nginx — disables proxy buffering
        },
    )
```

**Important Nginx note:** The `X-Accel-Buffering: no` header is required when serving SSE through Nginx. Without it, Nginx buffers the response and events never reach the browser.

---

### 7.5 Main App — `main.py`

```python
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from .config import get_settings
from .routers import claims, actions, dashboard, alerts
from .database import engine
from .models import Base

settings = get_settings()

# Create all tables on startup
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="ClaimLens API",
    version="1.0.0",
    description="NPI Intelligence Platform — Backend API",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(claims.router)
app.include_router(actions.router)
app.include_router(dashboard.router)
app.include_router(alerts.router)


@app.get("/health")
def health_check(db: Session = Depends(get_db)):
    try:
        claim_count = db.query(func.count(Claim.id)).scalar()
        flag_count  = db.query(func.count(RulesFlag.id)).scalar()
        db_status   = "connected"
    except Exception:
        return JSONResponse(
            status_code=503,
            content={"error": "Database unavailable", "code": "DB_UNAVAILABLE"}
        )

    return HealthResponse(
        status="ok",
        database=db_status,
        total_claims=claim_count,
        total_flags=flag_count,
        timestamp=datetime.utcnow(),
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Catch all unhandled exceptions — never expose stack traces."""
    import logging
    logging.getLogger(__name__).error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error", "code": "INTERNAL_ERROR"}
    )
```

---

## 8. ETL Components

### 8.1 Entity Resolution — `etl/entity_resolution.py`

```python
from rapidfuzz import fuzz, process

def resolve_supplier_entities(supplier_names: list[str]) -> dict[str, str]:
    """
    Group supplier name variants and return a mapping of
    supplier_name → supplier_id.

    Algorithm:
        1. Sort names by length (longer = more specific = canonical)
        2. For each name, find the best fuzzy match in already-resolved names
        3. If match score >= 85, assign the same supplier_id
        4. Otherwise create a new supplier_id

    Returns: dict mapping every input name to a supplier_id (UUID string)
    """
    import hashlib

    resolved: dict[str, str] = {}  # canonical_name → supplier_id
    name_to_id: dict[str, str] = {}  # input_name → supplier_id

    for name in sorted(set(supplier_names), key=len, reverse=True):
        if not resolved:
            sid = _make_supplier_id(name)
            resolved[name] = sid
            name_to_id[name] = sid
            continue

        best_match, score, _ = process.extractOne(
            name,
            resolved.keys(),
            scorer=fuzz.token_sort_ratio,
        )
        if score >= 85:
            name_to_id[name] = resolved[best_match]
        else:
            sid = _make_supplier_id(name)
            resolved[name] = sid
            name_to_id[name] = sid

    return name_to_id


def _make_supplier_id(name: str) -> str:
    """Deterministic supplier ID from name — same name always gets same ID."""
    import hashlib
    return "SUP-" + hashlib.md5(name.upper().strip().encode()).hexdigest()[:12]
```

---

## 9. Error Handling Strategy

### Principle
Every error must be caught, logged, and returned as a structured JSON response. No raw Python exceptions must ever reach the client.

### Error Response Shape
```json
{
    "error": "Human readable message",
    "code": "MACHINE_READABLE_CODE"
}
```

### Error Codes

| Code | HTTP Status | Meaning |
|---|---|---|
| `NPI_NOT_FOUND` | 404 | NPI does not exist in npi_profiles |
| `CLAIM_NOT_FOUND` | 404 | claim_id does not exist in claims |
| `INVALID_ACTION_TYPE` | 422 | action_type not in allowed enum |
| `INVALID_NPI_FORMAT` | 422 | NPI is not exactly 10 digits |
| `INVALID_UUID` | 422 | claim_id is not valid UUID format |
| `DB_ERROR` | 503 | Database write failed |
| `DB_UNAVAILABLE` | 503 | Cannot connect to database |
| `INTERNAL_ERROR` | 500 | Unhandled exception (never exposes detail) |

---

## 10. Python Dependencies

```
# requirements.txt

# Framework
fastapi==0.111.0
uvicorn[standard]==0.29.0
pydantic==2.7.1
pydantic-settings==2.2.1

# Database
sqlalchemy==2.0.30
psycopg2-binary==2.9.9
alembic==1.13.1

# ETL and data processing
pandas==2.2.2
rapidfuzz==3.9.0
pgeocode==0.4.1

# OpenAI (synthetic data generation only)
openai==1.30.1

# Utilities
python-dotenv==1.0.1
python-multipart==0.0.9

# Dev and testing
pytest==8.2.0
pytest-asyncio==0.23.6
httpx==0.27.0
black==24.4.2
ruff==0.4.4
```
