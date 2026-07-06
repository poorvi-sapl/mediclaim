"""
Phase 4 — Vendor dispute portal tests.

8 tests:
  1. test_generate_vendor_dispute_token
  2. test_get_dispute_endpoint_valid_token
  3. test_get_dispute_endpoint_expired_token
  4. test_get_dispute_wrong_vendor
  5. test_vendor_respond_option_a
  6. test_vendor_respond_option_b
  7. test_vendor_respond_already_resolved
  8. test_vendor_respond_deadline_passed

Uses the live dev DB and FastAPI TestClient.
"""

import time
from datetime import date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from jose import jwt
from sqlalchemy.orm import Session

from backend.config import get_settings
from backend.database import SessionLocal, engine, Base
from backend.main import app
from backend.models import Physician, ClaimNotification, DisputeCase
from backend.rules.trigger_engine import process_incoming_claim, respond_to_notification
from backend.utils.tokens import (
    generate_vendor_dispute_token,
    decode_vendor_dispute_token,
)

TEST_NPI_PHYSICIAN = "9990000004"
TEST_VENDOR_NPI    = "1999000001"   # synthetic, npi_watch_registered=True (seeded)
_ALG = "HS256"

client = TestClient(app)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session", autouse=True)
def ensure_tables():
    Base.metadata.create_all(bind=engine)


@pytest.fixture
def db():
    session = SessionLocal()
    yield session
    session.close()


def _purge(db: Session):
    notif_ids = [
        r.notification_id
        for r in db.query(ClaimNotification.notification_id)
        .filter(ClaimNotification.physician_npi == TEST_NPI_PHYSICIAN)
        .all()
    ]
    if notif_ids:
        db.query(DisputeCase).filter(
            DisputeCase.notification_id.in_(notif_ids)
        ).delete(synchronize_session=False)
    db.query(ClaimNotification).filter(
        ClaimNotification.physician_npi == TEST_NPI_PHYSICIAN
    ).delete(synchronize_session=False)
    db.query(Physician).filter(
        Physician.npi == TEST_NPI_PHYSICIAN
    ).delete(synchronize_session=False)
    db.commit()


@pytest.fixture(autouse=True)
def cleanup(db):
    _purge(db)
    yield
    _purge(db)


def _insert_physician(db: Session) -> Physician:
    p = Physician(
        npi=TEST_NPI_PHYSICIAN,
        first_name="Bob",
        last_name="Chen",
        specialty="Cardiology",
        practice_name="Chen Cardiology",
        practice_address="100 Main St, Austin, TX 78701",
        email_primary="bob.chen@chencardiology.com",
        mobile_phone="5125550404",
        notification_mode="REALTIME",
        verified=True,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def _create_dispute(
    db: Session,
    vendor_npi: str = TEST_VENDOR_NPI,
    claim_suffix: str = "P4-001",
) -> DisputeCase:
    claim_dict = {
        "claim_number":         f"CLM-{claim_suffix}",
        "ordering_npi":         TEST_NPI_PHYSICIAN,
        "vendor_npi":           vendor_npi,
        "vendor_name":          "Test Vendor",
        "vendor_type":          "DME",
        "patient_mbi":          "1EG4-TE5-MK74",
        "patient_name_partial": "T*** Q***",
        "dos_from":             date(2026, 6, 1),
        "dos_to":               date(2026, 6, 30),
        "service_description":  "DME equipment",
        "hcpcs_codes":          ["E0601"],
        "amount_billed":        1500.00,
        "amount_paid":          1200.00,
    }
    notifications = process_incoming_claim(claim_dict, db)
    notif = notifications[0]
    respond_to_notification(notif.notification_id, "DISPUTE", db)
    db.expire_all()
    case = (
        db.query(DisputeCase)
        .filter(DisputeCase.notification_id == notif.notification_id)
        .first()
    )
    return case


def _expired_token(case_id: int, vendor_npi: str) -> str:
    settings = get_settings()
    payload = {
        "case_id":    case_id,
        "vendor_npi": vendor_npi,
        "exp":        int(time.time()) - 10,
        "type":       "vendor_dispute",
    }
    return jwt.encode(payload, settings.secret_key, algorithm=_ALG)


# ---------------------------------------------------------------------------
# TEST 1 — generate_vendor_dispute_token round-trips correctly
# ---------------------------------------------------------------------------

def test_generate_vendor_dispute_token():
    token = generate_vendor_dispute_token(case_id=42, vendor_npi="1234567890")
    assert isinstance(token, str)
    assert len(token) > 20

    decoded = decode_vendor_dispute_token(token)
    assert decoded["case_id"] == 42
    assert decoded["vendor_npi"] == "1234567890"

    print("\n  [PASS] Token generated and decoded correctly")


# ---------------------------------------------------------------------------
# TEST 2 — GET /api/v1/vendor/disputes/{case_id} with valid token
# ---------------------------------------------------------------------------

def test_get_dispute_endpoint_valid_token(db):
    _insert_physician(db)
    case = _create_dispute(db, claim_suffix="P4-001")
    assert case is not None, "DisputeCase not created"

    token = generate_vendor_dispute_token(case.case_id, case.vendor_npi)
    resp = client.get(f"/api/v1/vendor/disputes/{case.case_id}?token={token}")

    assert resp.status_code == 200
    data = resp.json()
    assert data["case_id"] == case.case_id
    assert data["dispute_type"] == "DISPUTE"
    assert data["status"] == "OPEN"
    assert "claim" in data
    assert data["claim"]["claim_number"] == "CLM-P4-001"

    print(f"\n  [PASS] GET dispute: case_id={case.case_id}, status={data['status']}")


# ---------------------------------------------------------------------------
# TEST 3 — GET with expired token returns 410 link_expired
# ---------------------------------------------------------------------------

def test_get_dispute_endpoint_expired_token(db):
    _insert_physician(db)
    case = _create_dispute(db, claim_suffix="P4-002")

    token = _expired_token(case.case_id, case.vendor_npi)
    resp = client.get(f"/api/v1/vendor/disputes/{case.case_id}?token={token}")

    assert resp.status_code == 410
    assert resp.json()["error"] == "link_expired"

    print("\n  [PASS] Expired token → 410 link_expired")


# ---------------------------------------------------------------------------
# TEST 4 — GET with wrong vendor NPI in token returns 403
# ---------------------------------------------------------------------------

def test_get_dispute_wrong_vendor(db):
    _insert_physician(db)
    case = _create_dispute(db, claim_suffix="P4-003")

    # Token encodes a different NPI than the case's vendor_npi
    token = generate_vendor_dispute_token(case.case_id, "0000000001")
    resp = client.get(f"/api/v1/vendor/disputes/{case.case_id}?token={token}")

    assert resp.status_code == 403
    assert resp.json()["error"] == "forbidden"

    print("\n  [PASS] Wrong vendor NPI in token → 403 forbidden")


# ---------------------------------------------------------------------------
# TEST 5 — POST respond with RESPONDED_TO_MEDICARE (only valid once escalation
# is unlocked — a fresh dispute must try RESOLVED_WITH_PHYSICIAN first)
# ---------------------------------------------------------------------------

def test_vendor_respond_option_a_locked_on_fresh_case(db):
    _insert_physician(db)
    case = _create_dispute(db, claim_suffix="P4-004")
    token = generate_vendor_dispute_token(case.case_id, case.vendor_npi)

    resp = client.post(
        f"/api/v1/vendor/disputes/{case.case_id}/respond?token={token}",
        data={
            "response_type":   "RESPONDED_TO_MEDICARE",
            "vendor_response": "We have submitted the claim correction to Medicare.",
        },
    )
    assert resp.status_code == 403
    assert resp.json()["error"] == "escalation_locked"

    print("\n  [PASS] RESPONDED_TO_MEDICARE rejected on a fresh, not-yet-escalated case")


def test_vendor_respond_option_a_after_escalation_unlocked(db):
    _insert_physician(db)
    case = _create_dispute(db, claim_suffix="P4-004b")
    case.escalation_unlocked = True  # simulates: physician already rejected an earlier resolution
    db.commit()
    token = generate_vendor_dispute_token(case.case_id, case.vendor_npi)

    resp = client.post(
        f"/api/v1/vendor/disputes/{case.case_id}/respond?token={token}",
        data={
            "response_type":   "RESPONDED_TO_MEDICARE",
            "vendor_response": "We have submitted the claim correction to Medicare.",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["status"] == "RESPONDED_TO_MEDICARE"

    db.expire_all()
    updated = db.query(DisputeCase).filter(DisputeCase.case_id == case.case_id).first()
    assert updated.status == "RESPONDED_TO_MEDICARE"
    assert updated.vendor_responded_at is not None

    print(f"\n  [PASS] Option A after unlock: status={updated.status}, responded_at set")


# ---------------------------------------------------------------------------
# TEST 6 — POST respond with RESOLVED_WITH_PHYSICIAN goes to
# PENDING_PHYSICIAN_CONFIRMATION, not straight to RESOLVED_BY_PHYSICIAN
# ---------------------------------------------------------------------------

def test_vendor_respond_option_b(db):
    _insert_physician(db)
    case = _create_dispute(db, claim_suffix="P4-005")
    token = generate_vendor_dispute_token(case.case_id, case.vendor_npi)

    resp = client.post(
        f"/api/v1/vendor/disputes/{case.case_id}/respond?token={token}",
        data={
            "response_type":   "RESOLVED_WITH_PHYSICIAN",
            "vendor_response": "Billing error identified; physician confirmed resolution.",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["status"] == "PENDING_PHYSICIAN_CONFIRMATION"

    db.expire_all()
    updated = db.query(DisputeCase).filter(DisputeCase.case_id == case.case_id).first()
    assert updated.status == "PENDING_PHYSICIAN_CONFIRMATION"
    assert updated.vendor_responded_at is not None
    assert updated.physician_confirmation_due_date is not None

    print(f"\n  [PASS] Option B: status={updated.status}, awaiting physician confirmation")


# ---------------------------------------------------------------------------
# TEST 7 — POST respond on already-resolved case returns 409
# ---------------------------------------------------------------------------

def test_vendor_respond_already_resolved(db):
    _insert_physician(db)
    case = _create_dispute(db, claim_suffix="P4-006")

    case.status = "RESPONDED_TO_MEDICARE"
    db.commit()

    token = generate_vendor_dispute_token(case.case_id, case.vendor_npi)
    resp = client.post(
        f"/api/v1/vendor/disputes/{case.case_id}/respond?token={token}",
        data={"response_type": "RESPONDED_TO_MEDICARE", "vendor_response": ""},
    )
    assert resp.status_code == 409
    assert resp.json()["error"] == "already_resolved"

    print("\n  [PASS] Already-resolved case → 409 already_resolved")


# ---------------------------------------------------------------------------
# TEST 8 — POST respond after deadline returns 410
# ---------------------------------------------------------------------------

def test_vendor_respond_deadline_passed(db):
    _insert_physician(db)
    case = _create_dispute(db, claim_suffix="P4-007")

    case.response_due_date = datetime.utcnow() - timedelta(days=1)
    db.commit()

    token = generate_vendor_dispute_token(case.case_id, case.vendor_npi)
    resp = client.post(
        f"/api/v1/vendor/disputes/{case.case_id}/respond?token={token}",
        data={"response_type": "RESPONDED_TO_MEDICARE", "vendor_response": ""},
    )
    assert resp.status_code == 410
    assert resp.json()["error"] == "deadline_passed"

    print("\n  [PASS] Deadline passed → 410 deadline_passed")
