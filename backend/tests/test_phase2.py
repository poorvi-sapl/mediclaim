"""
Phase 2 — NPI Watch ingest + token + respond + email tests.

All 7 spec tests:
  1. test_ingest_endpoint_creates_notification
  2. test_ingest_with_no_matching_physician
  3. test_token_generation_and_decode
  4. test_respond_endpoint_confirm
  5. test_respond_endpoint_dispute
  6. test_respond_expired_token
  7. test_email_sent_flag

Uses the live dev DB; each test cleans up its own rows.
"""

import time
from datetime import date

import pytest
from fastapi.testclient import TestClient
from jose import jwt
from sqlalchemy.orm import Session

from backend.config import get_settings
from backend.database import SessionLocal, engine, Base
from backend.main import app
from backend.models import Physician, ClaimNotification, DisputeCase
from backend.utils.tokens import generate_response_token, decode_response_token

TEST_NPI = "9990000002"

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session", autouse=True)
def ensure_tables():
    Base.metadata.create_all(bind=engine)


@pytest.fixture(scope="session")
def client():
    with TestClient(app, raise_server_exceptions=True) as c:
        yield c


@pytest.fixture
def db():
    session = SessionLocal()
    yield session
    session.close()


def _purge(db: Session):
    notif_ids = [
        r.notification_id
        for r in db.query(ClaimNotification.notification_id)
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


def _insert_physician(db: Session) -> Physician:
    p = Physician(
        npi=TEST_NPI,
        first_name="Robert",
        last_name="Chen",
        specialty="Geriatrics",
        practice_name="Chen Geriatric Associates",
        practice_address="456 Oak Ave, Chicago, IL 60601",
        email_primary="robert.chen@chengeriatric.com",
        mobile_phone="3125550200",
        notification_mode="REALTIME",
        verified=True,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def _claim_body(claim_number: str = "CLM-P2-001") -> dict:
    return {
        "claim_number":        claim_number,
        "npi_ordering":        TEST_NPI,
        "vendor_npi":          "1122334455",
        "vendor_name":         "ABC Home Health Agency",
        "vendor_type":         "HOME_HEALTH",
        "patient_mbi":         "1EG4-TE5-MK73",
        "patient_name_partial": "J*** S***",
        "dos_from":            "2026-06-01",
        "dos_to":              "2026-06-30",
        "service_description": "Home Health Services",
        "hcpcs_codes":         ["G0179", "G0180"],
        "amount_billed":       3850.00,
        "amount_paid":         3250.00,
    }


# ---------------------------------------------------------------------------
# TEST 1 — ingest creates notification
# ---------------------------------------------------------------------------

def test_ingest_endpoint_creates_notification(client, db):
    _insert_physician(db)

    resp = client.post("/api/v1/claims/ingest/single", json=_claim_body())

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["count"] == 1
    n = data["notifications"][0]
    assert n["notification_id"] is not None
    assert n["physician_npi"] == TEST_NPI
    assert n["physician_npi_role"] == "ORDERING"
    assert n["status"] == "PENDING"
    assert n["response_token"]  # token populated

    print(f"\n  [PASS] Ingest: notification_id={n['notification_id']} status={n['status']}")


# ---------------------------------------------------------------------------
# TEST 2 — ingest with no matching physician → 200 + empty list
# ---------------------------------------------------------------------------

def test_ingest_with_no_matching_physician(client):
    body = {
        "claim_number": "CLM-NOMATCH",
        "npi_ordering": "0000000000",   # not in physicians table
        "vendor_name":  "Ghost Vendor",
        "vendor_type":  "DME",
    }
    resp = client.post("/api/v1/claims/ingest/single", json=body)

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["count"] == 0
    assert data["notifications"] == []
    assert data["note"] is not None   # explains why empty

    print(f"\n  [PASS] No-match ingest: count=0, note='{data['note']}'")


# ---------------------------------------------------------------------------
# TEST 3 — token round-trip + expiry
# ---------------------------------------------------------------------------

def test_token_generation_and_decode():
    token = generate_response_token(42, TEST_NPI)
    decoded = decode_response_token(token)

    assert decoded["notification_id"] == 42
    assert decoded["physician_npi"] == TEST_NPI

    # Expired token raises ValueError
    settings = get_settings()
    expired = jwt.encode(
        {
            "notification_id": 42,
            "physician_npi":   TEST_NPI,
            "exp":             int(time.time()) - 1,
            "type":            "npi_response",
        },
        settings.secret_key,
        algorithm="HS256",
    )
    with pytest.raises(ValueError, match="expired"):
        decode_response_token(expired)

    print("\n  [PASS] Token round-trip OK; expired token raises ValueError")


# ---------------------------------------------------------------------------
# TEST 4 — respond CONFIRM → HTML + DB status
# ---------------------------------------------------------------------------

def test_respond_endpoint_confirm(client, db):
    _insert_physician(db)
    resp = client.post("/api/v1/claims/ingest/single", json=_claim_body("CLM-CONF"))
    assert resp.status_code == 200
    n_data = resp.json()["notifications"][0]
    token = n_data["response_token"]
    nid   = n_data["notification_id"]

    resp2 = client.get(f"/api/v1/respond?token={token}&action=CONFIRM")

    assert resp2.status_code == 200
    assert "confirmation has been recorded" in resp2.text.lower()

    db.expire_all()
    row = db.query(ClaimNotification).filter(
        ClaimNotification.notification_id == nid
    ).first()
    assert row.status == "CONFIRMED"

    print(f"\n  [PASS] CONFIRM: HTML OK, DB status={row.status}")


# ---------------------------------------------------------------------------
# TEST 5 — respond DISPUTE → HTML + DB status + DISPUTE_CASE
# ---------------------------------------------------------------------------

def test_respond_endpoint_dispute(client, db):
    _insert_physician(db)
    resp = client.post("/api/v1/claims/ingest/single", json=_claim_body("CLM-DISP"))
    assert resp.status_code == 200
    n_data = resp.json()["notifications"][0]
    token = n_data["response_token"]
    nid   = n_data["notification_id"]

    resp2 = client.get(f"/api/v1/respond?token={token}&action=DISPUTE")

    assert resp2.status_code == 200
    assert "dispute has been submitted" in resp2.text.lower()

    db.expire_all()
    row = db.query(ClaimNotification).filter(
        ClaimNotification.notification_id == nid
    ).first()
    assert row.status == "DISPUTED"

    case = db.query(DisputeCase).filter(
        DisputeCase.notification_id == nid
    ).first()
    assert case is not None
    assert case.dispute_type == "DISPUTE"

    print(f"\n  [PASS] DISPUTE: DB status={row.status}, DISPUTE_CASE id={case.case_id}")


# ---------------------------------------------------------------------------
# TEST 6 — expired token → HTML contains "expired", DB unchanged
# ---------------------------------------------------------------------------

def test_respond_expired_token(client, db):
    _insert_physician(db)
    resp = client.post("/api/v1/claims/ingest/single", json=_claim_body("CLM-EXP"))
    nid = resp.json()["notifications"][0]["notification_id"]

    settings = get_settings()
    expired_token = jwt.encode(
        {
            "notification_id": nid,
            "physician_npi":   TEST_NPI,
            "exp":             int(time.time()) - 1,
            "type":            "npi_response",
        },
        settings.secret_key,
        algorithm="HS256",
    )

    resp2 = client.get(f"/api/v1/respond?token={expired_token}&action=CONFIRM")

    assert resp2.status_code == 200
    assert "expired" in resp2.text.lower()

    db.expire_all()
    row = db.query(ClaimNotification).filter(
        ClaimNotification.notification_id == nid
    ).first()
    assert row.status == "PENDING"  # not changed

    print(f"\n  [PASS] Expired token: HTML contains 'expired', DB status still=PENDING")


# ---------------------------------------------------------------------------
# TEST 7 — email_sent flag set after ingest
# ---------------------------------------------------------------------------

def test_email_sent_flag(client, db):
    _insert_physician(db)

    resp = client.post("/api/v1/claims/ingest/single", json=_claim_body("CLM-EMAIL"))
    assert resp.status_code == 200
    nid = resp.json()["notifications"][0]["notification_id"]

    db.expire_all()
    row = db.query(ClaimNotification).filter(
        ClaimNotification.notification_id == nid
    ).first()
    assert row.email_sent is True
    assert row.notification_sent_at is not None

    print(
        f"\n  [PASS] email_sent=True, notification_sent_at="
        f"{row.notification_sent_at.isoformat()}"
    )
