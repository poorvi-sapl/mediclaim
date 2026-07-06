"""
NPI Watch notification loop — verification tests (step 1).

Covers the 6-step spec:
  1. Insert a test Physician row.
  2. process_incoming_claim() → CLAIM_NOTIFICATION with status=PENDING.
  3. Assert notification row exists in DB.
  4. respond_to_notification(DISPUTE) → status=DISPUTED.
  5. Assert DISPUTE_CASE row with dispute_type=DISPUTE and response_due_date ~+15 days.
  6. respond_to_notification(CONFIRM) on fresh notification → NO DISPUTE_CASE created.

Bonus:
  - FRAUD_REPORT also creates a DISPUTE_CASE with dispute_type=FRAUD_REPORT.
  - Unregistered NPI produces zero notifications.

Uses the live dev DB (postgresql://postgres:claimlens@localhost:5433/claimlens).
Each test cleans up its own rows (dispute_cases → claim_notifications → physicians).
"""

from datetime import date, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from backend.database import SessionLocal, engine, Base
from backend.models import Physician, ClaimNotification, DisputeCase
from backend.rules.trigger_engine import process_incoming_claim, respond_to_notification

# Synthetic NPI that will never collide with real NPPES data
TEST_NPI = "9990000001"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session", autouse=True)
def ensure_tables():
    """Create any missing tables (idempotent — create_all skips existing tables)."""
    Base.metadata.create_all(bind=engine)


@pytest.fixture
def db():
    session = SessionLocal()
    yield session
    session.close()


def _purge(db: Session):
    """Delete all test rows in FK-safe order: disputes → notifications → physician."""
    notif_ids = [
        row.notification_id
        for row in db.query(ClaimNotification.notification_id)
        .filter(ClaimNotification.physician_npi == TEST_NPI)
        .all()
    ]
    if notif_ids:
        db.query(DisputeCase).filter(
            DisputeCase.notification_id.in_(notif_ids)
        ).delete(synchronize_session=False)
    db.query(ClaimNotification).filter(
        ClaimNotification.physician_npi == TEST_NPI
    ).delete(synchronize_session=False)
    db.query(Physician).filter(Physician.npi == TEST_NPI).delete(
        synchronize_session=False
    )
    db.commit()


@pytest.fixture(autouse=True)
def cleanup(db):
    _purge(db)
    yield
    _purge(db)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _insert_physician(db: Session) -> Physician:
    p = Physician(
        npi=TEST_NPI,
        first_name="Jane",
        last_name="Smith",
        specialty="Internal Medicine",
        taxonomy_code="207R00000X",
        practice_name="Smith Medical Group",
        practice_address="123 Main St, Boston, MA 02101",
        email_primary="jane.smith@smithmed.com",
        mobile_phone="6175550100",
        notification_mode="REALTIME",
        verified=True,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def _synthetic_claim(npi_role_field: str = "ordering_npi",
                     claim_number: str = "CLM-TEST-001") -> dict:
    return {
        "claim_number": claim_number,
        npi_role_field: TEST_NPI,
        "vendor_npi": "1234567890",
        "vendor_name": "Acme DME Supplies",
        "vendor_type": "DME",
        "patient_mbi": "1EG4-TE5-MK72",
        "patient_name_partial": "J*** S***",
        "dos_from": date(2026, 1, 1),
        "dos_to": date(2026, 1, 31),
        "service_description": "Power wheelchair K0856",
        "hcpcs_codes": ["K0856"],
        "amount_billed": 5000.00,
        "amount_paid": 3500.00,
    }


# ---------------------------------------------------------------------------
# SPEC STEP 1-3: process_incoming_claim creates a PENDING notification
# ---------------------------------------------------------------------------

def test_process_incoming_claim_creates_pending_notification(db):
    """
    Steps 1-3: insert physician, fire claim, assert PENDING notification in DB.
    """
    _insert_physician(db)

    notifications = process_incoming_claim(_synthetic_claim("ordering_npi"), db)

    assert len(notifications) == 1, "Expected exactly 1 notification for 1 matching NPI"
    n = notifications[0]

    # Fields set correctly
    assert n.notification_id is not None
    assert n.status == "PENDING"
    assert n.physician_npi == TEST_NPI
    assert n.physician_npi_role == "ORDERING"
    assert n.claim_number == "CLM-TEST-001"
    assert n.vendor_name == "Acme DME Supplies"
    assert n.vendor_type == "DME"
    assert float(n.amount_billed) == 5000.00

    # Persisted to DB
    row = db.query(ClaimNotification).filter(
        ClaimNotification.notification_id == n.notification_id
    ).first()
    assert row is not None
    assert row.status == "PENDING"

    print(f"\n  [PASS] CLAIM_NOTIFICATION id={row.notification_id} "
          f"status={row.status} role={row.physician_npi_role}")


# ---------------------------------------------------------------------------
# SPEC STEPS 4-5: DISPUTE response creates DISPUTE_CASE with 15-day deadline
# ---------------------------------------------------------------------------

def test_respond_dispute_updates_status_and_creates_dispute_case(db):
    """
    Steps 4-5: respond DISPUTE → status=DISPUTED, DISPUTE_CASE with +15-day due date.
    """
    _insert_physician(db)
    [notif] = process_incoming_claim(_synthetic_claim("ordering_npi"), db)
    nid = notif.notification_id

    before = datetime.utcnow()
    updated = respond_to_notification(nid, "DISPUTE", db)
    after = datetime.utcnow()

    # Notification updated
    assert updated.status == "DISPUTED"
    assert updated.physician_response == "DISPUTE"
    assert updated.response_at is not None

    # Exactly one DisputeCase created
    cases = db.query(DisputeCase).filter(
        DisputeCase.notification_id == nid
    ).all()
    assert len(cases) == 1, "Expected exactly 1 DISPUTE_CASE"
    case = cases[0]
    assert case.dispute_type == "DISPUTE"
    assert case.status == "OPEN"

    # response_due_date is ~15 days from now (allow ±1 second slop)
    assert case.response_due_date is not None
    expected_low  = before + timedelta(days=15)
    expected_high = after  + timedelta(days=15)
    assert expected_low <= case.response_due_date <= expected_high, (
        f"response_due_date {case.response_due_date} not in "
        f"[{expected_low}, {expected_high}]"
    )

    print(f"\n  [PASS] CLAIM_NOTIFICATION id={nid} status={updated.status}")
    print(f"  [PASS] DISPUTE_CASE id={case.case_id} type={case.dispute_type} "
          f"due={case.response_due_date.date()}")


# ---------------------------------------------------------------------------
# SPEC STEP 6: CONFIRM → status=CONFIRMED, NO DISPUTE_CASE
# ---------------------------------------------------------------------------

def test_respond_confirm_creates_no_dispute_case(db):
    """
    Step 6: respond CONFIRM → status=CONFIRMED, zero DisputeCase rows created.
    """
    _insert_physician(db)
    [notif] = process_incoming_claim(
        _synthetic_claim("referring_npi", "CLM-TEST-002"), db
    )
    nid = notif.notification_id

    updated = respond_to_notification(nid, "CONFIRM", db)

    assert updated.status == "CONFIRMED"
    assert updated.physician_response == "CONFIRM"

    count = db.query(DisputeCase).filter(
        DisputeCase.notification_id == nid
    ).count()
    assert count == 0, f"CONFIRM must not create a DISPUTE_CASE (found {count})"

    print(f"\n  [PASS] CONFIRM: status={updated.status}, DISPUTE_CASE count=0")


# ---------------------------------------------------------------------------
# BONUS: FRAUD_REPORT also creates a DISPUTE_CASE (dispute_type=FRAUD_REPORT)
# ---------------------------------------------------------------------------

def test_respond_fraud_report_creates_dispute_case_with_correct_type(db):
    _insert_physician(db)
    [notif] = process_incoming_claim(
        _synthetic_claim("attending_npi", "CLM-TEST-003"), db
    )
    nid = notif.notification_id

    updated = respond_to_notification(nid, "FRAUD_REPORT", db)

    assert updated.status == "FRAUD_REPORTED"

    case = db.query(DisputeCase).filter(
        DisputeCase.notification_id == nid
    ).first()
    assert case is not None
    assert case.dispute_type == "FRAUD_REPORT"

    print(f"\n  [PASS] FRAUD_REPORT: status={updated.status} "
          f"DISPUTE_CASE type={case.dispute_type}")


# ---------------------------------------------------------------------------
# BONUS: Unregistered NPI → zero notifications (no physician row)
# ---------------------------------------------------------------------------

def test_unregistered_npi_produces_no_notifications(db):
    claim = {
        "claim_number": "CLM-TEST-004",
        "ordering_npi": "0000000000",   # not in physicians table
        "vendor_npi": "1234567890",
        "vendor_name": "Ghost Vendor",
        "vendor_type": "DME",
    }
    result = process_incoming_claim(claim, db)
    assert result == [], f"Expected [], got {result}"

    print("\n  [PASS] Unregistered NPI -> 0 notifications")


# ---------------------------------------------------------------------------
# BONUS: Multiple NPI roles on same claim → multiple notifications
# ---------------------------------------------------------------------------

def test_multiple_npi_roles_create_multiple_notifications(db):
    _insert_physician(db)
    claim = {
        "claim_number": "CLM-TEST-005",
        "ordering_npi":   TEST_NPI,
        "referring_npi":  TEST_NPI,
        "vendor_npi": "1234567890",
        "vendor_name": "Acme DME",
        "vendor_type": "DME",
        "amount_billed": 1000.00,
        "amount_paid": 800.00,
    }
    notifications = process_incoming_claim(claim, db)

    assert len(notifications) == 2
    roles = {n.physician_npi_role for n in notifications}
    assert roles == {"ORDERING", "REFERRING"}

    print(f"\n  [PASS] Two NPI roles -> {len(notifications)} notifications: {roles}")
