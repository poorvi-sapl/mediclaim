"""
Phase 5 — Vendor session portal, physician NPI watch, and compliance dispute tests.

9 tests:
  1. test_vendor_role_migration
  2. test_vendor_portal_claims_endpoint
  3. test_vendor_portal_disputes_endpoint
  4. test_vendor_portal_stats
  5. test_vendor_session_respond
  6. test_vendor_cannot_see_other_vendor_disputes
  7. test_physician_npi_watch_notifications
  8. test_physician_npi_watch_stats
  9. test_compliance_disputes_visible

Uses the live dev DB and FastAPI TestClient.
"""

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.auth import create_access_token
from backend.database import SessionLocal, engine, Base
from backend.main import app
from backend.models import Physician, ClaimNotification, DisputeCase, User
from backend.rules.trigger_engine import process_incoming_claim, respond_to_notification

TEST_PHYSICIAN_NPI_P5 = "9990000005"
TEST_VENDOR_NPI_A     = "1999000011"
TEST_VENDOR_NPI_B     = "1999000013"
TEST_VENDOR_EMAIL_A   = "test_vendor_a_p5@internal.test"
TEST_VENDOR_EMAIL_B   = "test_vendor_b_p5@internal.test"
TEST_PHYSICIAN_EMAIL  = "test_phys_p5@internal.test"
TEST_PLAN_EMAIL       = "test_plan_p5@internal.test"

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
        .filter(ClaimNotification.physician_npi == TEST_PHYSICIAN_NPI_P5)
        .all()
    ]
    if notif_ids:
        db.query(DisputeCase).filter(
            DisputeCase.notification_id.in_(notif_ids)
        ).delete(synchronize_session=False)
    db.query(ClaimNotification).filter(
        ClaimNotification.physician_npi == TEST_PHYSICIAN_NPI_P5
    ).delete(synchronize_session=False)
    db.query(Physician).filter(
        Physician.npi == TEST_PHYSICIAN_NPI_P5
    ).delete(synchronize_session=False)
    for email in (TEST_VENDOR_EMAIL_A, TEST_VENDOR_EMAIL_B, TEST_PHYSICIAN_EMAIL, TEST_PLAN_EMAIL):
        db.query(User).filter(User.email == email).delete(synchronize_session=False)
    db.commit()


@pytest.fixture(autouse=True)
def cleanup(db):
    _purge(db)
    yield
    _purge(db)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_user(db: Session, email: str, role: str, npi: str = None, name: str = "Test User") -> User:
    u = User(
        email=email,
        password_hash="$2b$12$fakehashfortest",
        role=role,
        npi=npi,
        full_name=name,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _session_token(user: User) -> str:
    return create_access_token(
        email=user.email, role=user.role, npi=user.npi,
        full_name=user.full_name, expires_hours=1,
    )


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _insert_physician(db: Session) -> Physician:
    p = Physician(
        npi=TEST_PHYSICIAN_NPI_P5,
        first_name="Alice",
        last_name="Test",
        specialty="Internal Medicine",
        practice_name="Test Practice",
        practice_address="100 Test St, Testville, TX 78701",
        email_primary="alice.test@testpractice.com",
        mobile_phone="5125559999",
        notification_mode="REALTIME",
        verified=True,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def _create_claim(db: Session, vendor_npi: str, suffix: str) -> ClaimNotification:
    claim_dict = {
        "claim_number":         f"CLM-P5-{suffix}",
        "ordering_npi":         TEST_PHYSICIAN_NPI_P5,
        "vendor_npi":           vendor_npi,
        "vendor_name":          "Test Vendor Corp",
        "vendor_type":          "DME",
        "patient_mbi":          "1EG4-TE5-MK75",
        "patient_name_partial": "T*** P***",
        "dos_from":             date(2026, 6, 1),
        "dos_to":               date(2026, 6, 30),
        "service_description":  "DME equipment rental",
        "hcpcs_codes":          ["E0601"],
        "amount_billed":        2000.00,
        "amount_paid":          1600.00,
    }
    notifications = process_incoming_claim(claim_dict, db)
    return notifications[0]


def _create_dispute(db: Session, vendor_npi: str, suffix: str) -> DisputeCase:
    _insert_physician(db)
    notif = _create_claim(db, vendor_npi, suffix)
    respond_to_notification(notif.notification_id, "DISPUTE", db)
    db.expire_all()
    return (
        db.query(DisputeCase)
        .filter(DisputeCase.notification_id == notif.notification_id)
        .first()
    )


# ---------------------------------------------------------------------------
# TEST 1 — vendor role constraint: 'vendor' accepted, invalid role raises
# ---------------------------------------------------------------------------

def test_vendor_role_migration(db):
    u = User(
        email="__role_test_vendor@internal.test",
        password_hash="$2b$12$fakehashfortest",
        role="vendor",
        full_name="Role Test",
    )
    db.add(u)
    db.commit()
    db.query(User).filter(User.email == "__role_test_vendor@internal.test").delete()
    db.commit()

    u2 = User(
        email="__role_test_bad@internal.test",
        password_hash="$2b$12$fakehashfortest",
        role="hacker",
        full_name="Bad Role",
    )
    db.add(u2)
    with pytest.raises(IntegrityError):
        db.flush()
    db.rollback()

    print("\n  [PASS] vendor role accepted; invalid role raises IntegrityError")


# ---------------------------------------------------------------------------
# TEST 2 — GET /api/v1/vendor/portal/claims returns vendor's claims
# ---------------------------------------------------------------------------

def test_vendor_portal_claims_endpoint(db):
    _insert_physician(db)
    user = _make_user(db, TEST_VENDOR_EMAIL_A, "vendor", TEST_VENDOR_NPI_A)
    _create_claim(db, TEST_VENDOR_NPI_A, "C01")
    _create_claim(db, TEST_VENDOR_NPI_A, "C02")

    resp = client.get("/api/v1/vendor/portal/claims", headers=_auth(_session_token(user)))
    assert resp.status_code == 200
    data = resp.json()
    assert "claims" in data
    assert "summary" in data
    assert data["summary"]["total"] >= 2

    print(f"\n  [PASS] portal/claims: {data['summary']['total']} claims returned")


# ---------------------------------------------------------------------------
# TEST 3 — GET /api/v1/vendor/portal/disputes includes days_remaining
# ---------------------------------------------------------------------------

def test_vendor_portal_disputes_endpoint(db):
    user = _make_user(db, TEST_VENDOR_EMAIL_A, "vendor", TEST_VENDOR_NPI_A)
    case = _create_dispute(db, TEST_VENDOR_NPI_A, "D01")
    assert case is not None

    resp = client.get("/api/v1/vendor/portal/disputes", headers=_auth(_session_token(user)))
    assert resp.status_code == 200
    data = resp.json()
    assert "disputes" in data
    assert len(data["disputes"]) >= 1
    d = data["disputes"][0]
    assert "days_remaining" in d
    assert "deadline_passed" in d
    assert "claim_number" in d

    print(f"\n  [PASS] portal/disputes: days_remaining={d['days_remaining']}, case_id={d['case_id']}")


# ---------------------------------------------------------------------------
# TEST 4 — GET /api/v1/vendor/portal/stats returns all 6 expected fields
# ---------------------------------------------------------------------------

def test_vendor_portal_stats(db):
    _insert_physician(db)
    user = _make_user(db, TEST_VENDOR_EMAIL_A, "vendor", TEST_VENDOR_NPI_A)
    _create_claim(db, TEST_VENDOR_NPI_A, "S01")

    resp = client.get("/api/v1/vendor/portal/stats", headers=_auth(_session_token(user)))
    assert resp.status_code == 200
    data = resp.json()
    for field in ("total_claims", "confirmed_rate", "open_disputes", "overdue_disputes", "trust_score", "vendor_name"):
        assert field in data, f"Missing field: {field}"
    assert data["total_claims"] >= 1

    print(f"\n  [PASS] portal/stats: total_claims={data['total_claims']}")


# ---------------------------------------------------------------------------
# TEST 5 — POST /api/v1/vendor/portal/disputes/{id}/respond (session auth)
# ---------------------------------------------------------------------------

def test_vendor_session_respond(db):
    user = _make_user(db, TEST_VENDOR_EMAIL_A, "vendor", TEST_VENDOR_NPI_A)
    case = _create_dispute(db, TEST_VENDOR_NPI_A, "R01")
    assert case is not None and case.status == "OPEN"

    # response_type is accepted for backward-compat and ignored — uploading
    # documents is the vendor's only response, and it always lands in
    # PENDING_PHYSICIAN_REVIEW for the physician to approve or decline.
    resp = client.post(
        f"/api/v1/vendor/portal/disputes/{case.case_id}/respond",
        headers=_auth(_session_token(user)),
        data={"response_type": "RESOLVED_WITH_PHYSICIAN", "vendor_response": "Submitted correction."},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["status"] == "PENDING_PHYSICIAN_REVIEW"

    db.expire_all()
    updated = db.query(DisputeCase).filter(DisputeCase.case_id == case.case_id).first()
    assert updated.status == "PENDING_PHYSICIAN_REVIEW"

    print(f"\n  [PASS] portal respond: case_id={case.case_id}, new status={updated.status}")


# ---------------------------------------------------------------------------
# TEST 6 — vendor A cannot see vendor B's disputes
# ---------------------------------------------------------------------------

def test_vendor_cannot_see_other_vendor_disputes(db):
    case_b = _create_dispute(db, TEST_VENDOR_NPI_B, "ISO01")
    assert case_b is not None

    user_a = _make_user(db, TEST_VENDOR_EMAIL_A, "vendor", TEST_VENDOR_NPI_A)
    resp = client.get("/api/v1/vendor/portal/disputes", headers=_auth(_session_token(user_a)))
    assert resp.status_code == 200
    dispute_ids = [d["case_id"] for d in resp.json()["disputes"]]
    assert case_b.case_id not in dispute_ids, "Vendor A must not see Vendor B's dispute"

    print(f"\n  [PASS] Isolation: Vendor A does not see Vendor B's case_id={case_b.case_id}")


# ---------------------------------------------------------------------------
# TEST 7 — GET /api/v1/physician/npi-watch/notifications returns only
# DISPUTED / FRAUD_REPORTED (this feed is now "My Disputes", tracking-only —
# PENDING/CONFIRMED notifications are handled elsewhere and never appear here)
# ---------------------------------------------------------------------------

def test_physician_npi_watch_notifications(db):
    case = _create_dispute(db, TEST_VENDOR_NPI_A, "NW01")
    assert case is not None

    phys_user = _make_user(db, TEST_PHYSICIAN_EMAIL, "physician", TEST_PHYSICIAN_NPI_P5)
    resp = client.get(
        "/api/v1/physician/npi-watch/notifications",
        headers=_auth(_session_token(phys_user)),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "notifications" in data
    assert len(data["notifications"]) >= 1
    assert all(n["status"] in ("DISPUTED", "FRAUD_REPORTED") for n in data["notifications"])

    n = data["notifications"][0]
    for field in ("notification_id", "claim_number", "status", "confirm_url", "dispute_url", "fraud_url", "dispute"):
        assert field in n, f"Missing field: {field}"
    assert n["dispute"] is not None
    for field in ("case_id", "status", "days_remaining", "deadline_passed"):
        assert field in n["dispute"], f"Missing dispute field: {field}"

    print(f"\n  [PASS] npi-watch/notifications: {len(data['notifications'])} returned, all DISPUTED/FRAUD_REPORTED")


# ---------------------------------------------------------------------------
# TEST 8 — GET /api/v1/physician/npi-watch/stats returns the My Disputes
# field set (total/disputed/fraud_reported/open/resolved) — pending/confirmed/
# escalated no longer apply since this screen only tracks disputes now.
# ---------------------------------------------------------------------------

def test_physician_npi_watch_stats(db):
    case = _create_dispute(db, TEST_VENDOR_NPI_A, "NS01")
    assert case is not None and case.status == "OPEN"

    phys_user = _make_user(db, TEST_PHYSICIAN_EMAIL, "physician", TEST_PHYSICIAN_NPI_P5)
    resp = client.get(
        "/api/v1/physician/npi-watch/stats",
        headers=_auth(_session_token(phys_user)),
    )
    assert resp.status_code == 200
    data = resp.json()
    for field in ("total", "disputed", "fraud_reported", "open", "resolved"):
        assert field in data, f"Missing field: {field}"
    for field in ("pending", "confirmed", "escalated"):
        assert field not in data, f"Stale field should be gone: {field}"
    assert data["total"] >= 1
    assert data["open"] >= 1

    print(f"\n  [PASS] npi-watch/stats: {data}")


# ---------------------------------------------------------------------------
# TEST 9 — GET /plan/disputes returns open disputes with vendor_name join
# ---------------------------------------------------------------------------

def test_compliance_disputes_visible(db):
    case = _create_dispute(db, TEST_VENDOR_NPI_A, "CP01")
    assert case is not None and case.status == "OPEN"

    plan_user = _make_user(db, TEST_PLAN_EMAIL, "plan_investigator")
    resp = client.get("/plan/disputes", headers=_auth(_session_token(plan_user)))
    assert resp.status_code == 200
    data = resp.json()
    assert "disputes" in data and "total" in data
    assert data["total"] >= 1

    ids = [d["case_id"] for d in data["disputes"]]
    assert case.case_id in ids, "Compliance view must include the seeded OPEN dispute"

    the_case = next(d for d in data["disputes"] if d["case_id"] == case.case_id)
    for field in ("vendor_name", "days_remaining", "claim_number", "status"):
        assert field in the_case, f"Missing field: {field}"
    assert the_case["status"] in ("OPEN", "NON_RESPONSIVE")

    print(f"\n  [PASS] /plan/disputes: case_id={case.case_id}, vendor_name={the_case['vendor_name']}")
