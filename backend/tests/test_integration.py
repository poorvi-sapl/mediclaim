"""
Integration tests — My Claims (actions.py) triggering the same vendor-notification
machinery as NPI Watch (trigger_engine.py), via notify_vendor_from_claim_action().

7 tests:
  1. test_my_claims_dispute_triggers_vendor_notification
  2. test_my_claims_fraud_triggers_vendor_notification (direct call — 'fraud' was not
     reachable through POST /actions until this file's Fix 2a; still exercised directly
     to isolate the trigger_engine logic from the endpoint layer)
  3. test_my_claims_confirm_no_vendor_notification
  4. test_no_duplicate_notification
  5. test_vendor_notification_failure_doesnt_break_action
  6. test_auto_creates_physician_row_if_missing
  7. test_fraud_action_via_post_endpoint

Plus 2 tests for the 24h undo-window deferral (backend/rules/reminders.py
process_pending_vendor_notifications + routers/actions.py's undo window):
  8. test_vendor_notify_deferred_until_window_closes
  9. test_undo_within_window_prevents_vendor_notification

Uses the live dev DB and FastAPI TestClient, matching the pattern in test_phase5.py.
"""

from datetime import date, datetime, timedelta
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.auth import create_access_token
from backend.config import get_settings
from backend.database import SessionLocal, engine, Base
from backend.main import app
from backend.models import Action, Claim, ClaimNotification, DisputeCase, DisputeCaseEvent, NpiProfile, Physician, SupplierProfile, User
from backend.rules.reminders import process_pending_vendor_notifications
from backend.rules.trigger_engine import notify_vendor_from_claim_action

TEST_PHYSICIAN_NPI         = "9990000077"
TEST_PHYSICIAN_NPI_NO_ROW  = "9990000078"  # deliberately has no physicians row up front
TEST_VENDOR_NPI            = "1999000077"
TEST_CLAIM_ID_TAG          = "int-test-claim"  # embedded in patient_id for easy cleanup lookup

client = TestClient(app)

# POST /actions is guarded by the global AuthMiddleware (main.py) — requires a valid
# 'physician' role JWT. The middleware only decodes claims, no DB user lookup needed.
_AUTH_HEADERS = {
    "Authorization": f"Bearer {create_access_token(email='int_test_phys@internal.test', role='physician', npi=TEST_PHYSICIAN_NPI, full_name='Integration Test Physician', expires_hours=1)}"
}


@pytest.fixture(scope="session", autouse=True)
def ensure_tables():
    Base.metadata.create_all(bind=engine)


@pytest.fixture
def db():
    session = SessionLocal()
    yield session
    session.close()


def _purge(db: Session):
    for npi in (TEST_PHYSICIAN_NPI, TEST_PHYSICIAN_NPI_NO_ROW):
        claim_ids = [r.id for r in db.query(Claim.id).filter(Claim.npi == npi).all()]
        if claim_ids:
            notif_ids = [
                r.notification_id for r in
                db.query(ClaimNotification.notification_id)
                  .filter(ClaimNotification.claim_number.in_([str(c) for c in claim_ids]))
                  .all()
            ]
            if notif_ids:
                db.query(DisputeCase).filter(DisputeCase.notification_id.in_(notif_ids)).delete(synchronize_session=False)
            db.query(ClaimNotification).filter(ClaimNotification.claim_number.in_([str(c) for c in claim_ids])).delete(synchronize_session=False)
            db.query(Action).filter(Action.claim_id.in_(claim_ids)).delete(synchronize_session=False)
            db.query(Claim).filter(Claim.id.in_(claim_ids)).delete(synchronize_session=False)
        db.query(Physician).filter(Physician.npi == npi).delete(synchronize_session=False)
        db.query(NpiProfile).filter(NpiProfile.npi == npi).delete(synchronize_session=False)
    db.query(SupplierProfile).filter(SupplierProfile.npi == TEST_VENDOR_NPI).delete(synchronize_session=False)
    db.query(User).filter(User.email.in_([
        "int_test_vendor@internal.test", "int_test_other_phys@internal.test", "int_test_phys@internal.test",
    ])).delete(synchronize_session=False)
    db.commit()


@pytest.fixture(autouse=True)
def cleanup(db):
    _purge(db)
    yield
    _purge(db)


@pytest.fixture(autouse=True)
def _instant_vendor_notify(monkeypatch):
    """Tests 1-7 below assert the vendor dispute case/email exist immediately
    after POST /actions — they're testing the notify_vendor_from_claim_action
    bridge itself (idempotency, error-handling, auto-created physician row),
    not the 24h undo-window deferral added in routers/actions.py (that has its
    own coverage further down: test_vendor_notify_deferred_* below). Force
    instant notification and skip real SMTP for the duration of this module so
    those assertions stay meaningful without threading a fake clock through
    every test, and so test runs never hit the network.
    get_settings() is @lru_cache()'d — this mutates the one live Settings
    singleton the app itself reads, and monkeypatch restores it after each test."""
    settings = get_settings()
    monkeypatch.setattr(settings, "vendor_notify_delay_hours", 0.0)
    monkeypatch.setattr(settings, "email_enabled", False)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _insert_physician(db: Session) -> Physician:
    # notify_vendor_from_claim_action() writes ClaimNotification.physician_npi, which
    # has a real FK to physicians.npi — a physician must be NPI-Watch-registered for
    # the bridge to work at all (see the note in the report below).
    p = Physician(
        npi=TEST_PHYSICIAN_NPI, first_name="Integration", last_name="Test",
        specialty="Internal Medicine", practice_name="Integration Test Practice",
        practice_address="1 Test St", email_primary="int_test_phys@internal.test",
        mobile_phone="5125550000", notification_mode="REALTIME", verified=True,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def _make_vendor(db: Session, npi_watch_registered: bool = True) -> SupplierProfile:
    v = SupplierProfile(
        npi=TEST_VENDOR_NPI,
        supplier_name="Integration Test Vendor LLC",
        supplier_type="DME Supplier",
        contact_name="Test Contact",
        contact_email="vendor@integrationtest.internal",
        npi_watch_registered=npi_watch_registered,
    )
    db.add(v)
    db.commit()
    db.refresh(v)
    return v


def _make_claim(db: Session, suffix: str, npi: str = TEST_PHYSICIAN_NPI) -> Claim:
    c = Claim(
        npi=npi,
        patient_id=f"{TEST_CLAIM_ID_TAG}-{suffix}",
        patient_name="Jane Doe",
        patient_zip="78701",
        patient_state="TX",
        date_of_service=date(2026, 6, 1),
        service_description="DME equipment rental",
        service_category="dme",
        vendor_name="Integration Test Vendor LLC",
        vendor_id=TEST_VENDOR_NPI,
        vendor_npi=TEST_VENDOR_NPI,
        vendor_type="DME",
        contact_email="vendor@integrationtest.internal",
        contact_name="Test Contact",
        claim_amount=1200.00,
        plan_name="Test Plan",
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


def _post_action(claim_id, action_type):
    return client.post("/actions", headers=_AUTH_HEADERS, json={
        "claim_id": str(claim_id), "npi": TEST_PHYSICIAN_NPI, "action_type": action_type,
    })


# ---------------------------------------------------------------------------
# TEST 1 — My Claims dispute triggers the vendor notification flow
# ---------------------------------------------------------------------------

def test_my_claims_dispute_triggers_vendor_notification(db):
    _insert_physician(db)
    _make_vendor(db)
    claim = _make_claim(db, "d01")

    resp = _post_action(claim.id, "dispute")
    assert resp.status_code == 201

    action = db.query(Action).filter(Action.claim_id == claim.id).first()
    assert action is not None
    assert action.action_type == "dispute"

    notif = db.query(ClaimNotification).filter(ClaimNotification.claim_number == str(claim.id)).first()
    assert notif is not None
    assert notif.status == "DISPUTED"
    assert notif.physician_npi == TEST_PHYSICIAN_NPI

    case = db.query(DisputeCase).filter(DisputeCase.notification_id == notif.notification_id).first()
    assert case is not None
    assert case.dispute_type == "DISPUTE"
    assert case.status == "OPEN"
    assert case.response_due_date is not None

    print(f"\n  [PASS] My Claims dispute -> Action + ClaimNotification(DISPUTED) + DisputeCase(DISPUTE) all created")


# ---------------------------------------------------------------------------
# TEST 2 — 'fraud' path (direct call — not reachable via POST /actions today,
# since VALID_ACTION_TYPES in actions.py has no 'fraud' value and ClaimsTable.jsx
# has no Report Fraud button; this exercises notify_vendor_from_claim_action()
# directly to prove the branch is correct and ready if that ever changes).
# ---------------------------------------------------------------------------

def test_my_claims_fraud_triggers_vendor_notification(db):
    _insert_physician(db)
    _make_vendor(db)
    claim = _make_claim(db, "f01")

    result = notify_vendor_from_claim_action(
        claim_id=str(claim.id), physician_npi=TEST_PHYSICIAN_NPI, action_type="fraud", db=db,
    )
    assert result is True

    notif = db.query(ClaimNotification).filter(ClaimNotification.claim_number == str(claim.id)).first()
    assert notif is not None
    assert notif.status == "FRAUD_REPORTED"

    case = db.query(DisputeCase).filter(DisputeCase.notification_id == notif.notification_id).first()
    assert case is not None
    assert case.dispute_type == "FRAUD_REPORT"

    print(f"\n  [PASS] notify_vendor_from_claim_action('fraud') -> FRAUD_REPORTED / FRAUD_REPORT")


# ---------------------------------------------------------------------------
# TEST 3 — confirm never touches the vendor-notification tables
# ---------------------------------------------------------------------------

def test_my_claims_confirm_no_vendor_notification(db):
    _insert_physician(db)
    _make_vendor(db)
    claim = _make_claim(db, "c01")

    resp = _post_action(claim.id, "confirm")
    assert resp.status_code == 201

    action = db.query(Action).filter(Action.claim_id == claim.id).first()
    assert action is not None
    assert action.action_type == "confirm"

    notif = db.query(ClaimNotification).filter(ClaimNotification.claim_number == str(claim.id)).first()
    assert notif is None

    print(f"\n  [PASS] confirm action -> Action row created, no ClaimNotification/DisputeCase touched")


# ---------------------------------------------------------------------------
# TEST 4 — idempotency: disputing the same claim twice creates only one notification
# ---------------------------------------------------------------------------

def test_no_duplicate_notification(db):
    _insert_physician(db)
    _make_vendor(db)
    claim = _make_claim(db, "dup01")

    resp1 = _post_action(claim.id, "dispute")
    assert resp1.status_code == 201

    resp2 = _post_action(claim.id, "dispute")
    # The claim action itself is allowed to be recorded again (no restriction on
    # re-disputing) — it's the vendor notification side that must not duplicate.
    assert resp2.status_code == 201

    notifs = db.query(ClaimNotification).filter(ClaimNotification.claim_number == str(claim.id)).all()
    assert len(notifs) == 1

    print(f"\n  [PASS] Disputed twice -> exactly 1 ClaimNotification row (no duplicate)")


# ---------------------------------------------------------------------------
# TEST 5 — a vendor-email failure must never break the underlying action
# ---------------------------------------------------------------------------

def test_vendor_notification_failure_doesnt_break_action(db):
    _insert_physician(db)
    _make_vendor(db)
    claim = _make_claim(db, "err01")

    with patch("backend.rules.trigger_engine.send_vendor_dispute_email", side_effect=Exception("boom")):
        resp = _post_action(claim.id, "dispute")

    assert resp.status_code == 201

    action = db.query(Action).filter(Action.claim_id == claim.id).first()
    assert action is not None

    # The notification + dispute case are committed to the DB before the (mocked)
    # failing email call, so they still exist even though the email step blew up.
    notif = db.query(ClaimNotification).filter(ClaimNotification.claim_number == str(claim.id)).first()
    assert notif is not None
    case = db.query(DisputeCase).filter(DisputeCase.notification_id == notif.notification_id).first()
    assert case is not None

    print(f"\n  [PASS] Vendor email raised -> POST /actions still 201, Action + ClaimNotification + DisputeCase all persisted")


# ---------------------------------------------------------------------------
# Physician-confirmation workflow — a vendor's "resolved with physician" claim
# must be confirmed by the physician before it's final (RESOLVED_BY_PHYSICIAN).
# Rejecting it (or letting the confirmation window lapse) reopens the case and
# unlocks "Responded to Medicare" as an escalation path for the vendor.
# ---------------------------------------------------------------------------

def _make_physician_user(db, email="int_test_phys@internal.test", npi=TEST_PHYSICIAN_NPI):
    # _require_physician (npi_watch.py) does a real User lookup by email — unlike
    # the AuthMiddleware, which only decodes the JWT claims. A session token alone
    # isn't enough for these endpoints; the User row must actually exist.
    existing = db.query(User).filter(User.email == email).first()
    if existing:
        return existing
    u = User(email=email, password_hash="x", role="physician", npi=npi, full_name="Int Test Physician")
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _create_pending_review_case(db):
    """Dispute a claim, then have the vendor respond — lands the case in
    PENDING_PHYSICIAN_REVIEW, same as a real user flow.

    The vendor's response is now always "here are my proof-of-work documents";
    the old two-choice response (resolve-with-physician vs responded-to-Medicare)
    was removed, so response_type is accepted and ignored. See vendor.py's
    _apply_vendor_docs."""
    _insert_physician(db)
    _make_physician_user(db)
    vendor = _make_vendor(db)
    claim = _make_claim(db, "confirm01")

    resp = _post_action(claim.id, "dispute")
    assert resp.status_code == 201
    notif = db.query(ClaimNotification).filter(ClaimNotification.claim_number == str(claim.id)).first()
    case = db.query(DisputeCase).filter(DisputeCase.notification_id == notif.notification_id).first()

    vendor_user = User(email="int_test_vendor@internal.test", password_hash="x", role="vendor", npi=TEST_VENDOR_NPI, full_name="Int Test Vendor")
    db.add(vendor_user)
    db.commit()
    db.refresh(vendor_user)
    vendor_headers = {"Authorization": f"Bearer {create_access_token(email=vendor_user.email, role='vendor', npi=TEST_VENDOR_NPI, full_name=vendor_user.full_name, expires_hours=1)}"}

    resp = client.post(
        f"/api/v1/vendor/portal/disputes/{case.case_id}/respond",
        headers=vendor_headers,
        data={"response_type": "RESOLVED_WITH_PHYSICIAN", "vendor_response": "Confirmed with office, order was legitimate."},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "PENDING_PHYSICIAN_REVIEW"

    db.expire_all()
    case = db.query(DisputeCase).filter(DisputeCase.case_id == case.case_id).first()
    return case


def test_physician_confirm_resolves_case(db):
    case = _create_pending_review_case(db)

    resp = client.post(
        f"/api/v1/physician/npi-watch/disputes/{case.case_id}/confirm",
        headers=_AUTH_HEADERS,
        json={"confirmed": True},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "RESOLVED_BY_PHYSICIAN"

    db.expire_all()
    updated = db.query(DisputeCase).filter(DisputeCase.case_id == case.case_id).first()
    assert updated.status == "RESOLVED_BY_PHYSICIAN"
    assert updated.closed_at is not None
    assert updated.escalation_unlocked is False

    print(f"\n  [PASS] Physician confirms -> RESOLVED_BY_PHYSICIAN, closed_at set")


def test_physician_decline_refers_case_to_payer(db):
    """Declining the vendor's documents ends the vendor's involvement — the case
    is handed to the payer, NOT reopened for another vendor attempt. (The old flow
    reopened it as OPEN with escalation_unlocked=True; see npi_watch.py's confirm.)"""
    case = _create_pending_review_case(db)

    resp = client.post(
        f"/api/v1/physician/npi-watch/disputes/{case.case_id}/confirm",
        headers=_AUTH_HEADERS,
        json={"confirmed": False, "note": "Documents don't cover the billed service."},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "REFERRED_TO_PAYER"

    db.expire_all()
    updated = db.query(DisputeCase).filter(DisputeCase.case_id == case.case_id).first()
    assert updated.status == "REFERRED_TO_PAYER"
    assert updated.closed_at is not None, "a referred case is closed for the vendor"

    events = [e.event_type for e in db.query(DisputeCaseEvent)
              .filter(DisputeCaseEvent.case_id == case.case_id).all()]
    assert "PHYSICIAN_REJECTED" in events, "the payer is notified via this event"

    print(f"\n  [PASS] Physician declines -> REFERRED_TO_PAYER, closed, payer notified")


def test_vendor_respond_ignores_response_type(db):
    """The vendor no longer chooses how to respond — uploading documents is the
    only option. Whatever response_type is posted (the field is kept for
    backward-compat), the case lands in PENDING_PHYSICIAN_REVIEW."""
    case = _create_pending_review_case(db)
    case.status = "OPEN"          # reopen so a second response is accepted
    db.commit()

    vendor_headers = {"Authorization": f"Bearer {create_access_token(email='int_test_vendor@internal.test', role='vendor', npi=TEST_VENDOR_NPI, full_name='Int Test Vendor', expires_hours=1)}"}
    resp = client.post(
        f"/api/v1/vendor/portal/disputes/{case.case_id}/respond",
        headers=vendor_headers,
        data={"response_type": "RESPONDED_TO_MEDICARE", "vendor_response": "Submitted correction to Medicare."},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "PENDING_PHYSICIAN_REVIEW"

    db.expire_all()
    updated = db.query(DisputeCase).filter(DisputeCase.case_id == case.case_id).first()
    assert updated.provider_response_type is None, "the old response-type choice is not recorded"

    print(f"\n  [PASS] response_type is ignored -> always PENDING_PHYSICIAN_REVIEW")


def test_legacy_confirmation_timeout_drains_to_open(db):
    """LEGACY PATH. PENDING_PHYSICIAN_CONFIRMATION belonged to the retired
    resolve-with-physician flow; nothing in the app creates it anymore, so this
    test has to set it by hand. The timer is kept purely as a one-way drain for
    rows that may still exist in deployed databases — without it they'd be stuck
    forever, since /confirm rejects any status but PENDING_PHYSICIAN_REVIEW.
    Delete this test and escalate_unconfirmed_physician_resolutions together, once
    `SELECT count(*) FROM dispute_cases WHERE status='PENDING_PHYSICIAN_CONFIRMATION'`
    returns 0 in every environment."""
    from datetime import datetime, timedelta
    from backend.rules.trigger_engine import escalate_unconfirmed_physician_resolutions

    case = _create_pending_review_case(db)
    case.status = "PENDING_PHYSICIAN_CONFIRMATION"
    case.physician_confirmation_due_date = datetime.utcnow() - timedelta(days=1)
    db.commit()

    updated_count = escalate_unconfirmed_physician_resolutions(db)
    assert updated_count >= 1

    db.expire_all()
    updated = db.query(DisputeCase).filter(DisputeCase.case_id == case.case_id).first()
    assert updated.status == "OPEN"
    assert updated.escalation_unlocked is True

    print(f"\n  [PASS] legacy drain: expired confirmation window -> OPEN")


def test_confirm_endpoint_rejects_non_owner(db):
    case = _create_pending_review_case(db)
    _make_physician_user(db, email="int_test_other_phys@internal.test", npi="9990000079")

    other_phys_headers = {"Authorization": f"Bearer {create_access_token(email='int_test_other_phys@internal.test', role='physician', npi='9990000079', full_name='Other Physician', expires_hours=1)}"}
    resp = client.post(
        f"/api/v1/physician/npi-watch/disputes/{case.case_id}/confirm",
        headers=other_phys_headers,
        json={"confirmed": True},
    )
    assert resp.status_code == 403

    print(f"\n  [PASS] Confirming someone else's dispute -> 403 forbidden")


# ---------------------------------------------------------------------------
# /disputes/{case_id}/decide — physician's final 5-action call after reviewing
# a vendor response, applied to the underlying claim (same as My Claims).
# ---------------------------------------------------------------------------

def test_decide_endpoint_creates_action_after_vendor_resolved(db):
    from backend.models import Action
    case = _create_pending_review_case(db)

    resp = client.post(
        f"/api/v1/physician/npi-watch/disputes/{case.case_id}/confirm",
        headers=_AUTH_HEADERS, json={"confirmed": True},
    )
    assert resp.json()["status"] == "RESOLVED_BY_PHYSICIAN"

    resp = client.post(
        f"/api/v1/physician/npi-watch/disputes/{case.case_id}/decide",
        headers=_AUTH_HEADERS, json={"action_type": "confirm", "note": "Reviewed, looks legitimate."},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["action_type"] == "confirm"

    action = db.query(Action).filter(Action.id == body["action_id"]).first()
    assert action is not None
    assert action.action_type == "confirm"
    assert action.note == "Reviewed, looks legitimate."

    db.expire_all()
    case_after = db.query(DisputeCase).filter(DisputeCase.case_id == case.case_id).first()
    assert case_after.status == "RESOLVED_BY_PHYSICIAN", "deciding must not touch the dispute case's own status"

    print(f"\n  [PASS] decide('confirm') after vendor resolution -> Action created, dispute case untouched")


def test_decide_endpoint_dispute_again_does_not_duplicate_notification(db):
    case = _create_pending_review_case(db)
    client.post(f"/api/v1/physician/npi-watch/disputes/{case.case_id}/confirm", headers=_AUTH_HEADERS, json={"confirmed": True})

    claim_number = db.query(ClaimNotification.claim_number).filter(ClaimNotification.notification_id == case.notification_id).scalar()
    notifs_before = db.query(ClaimNotification).filter(ClaimNotification.claim_number == claim_number).count()

    resp = client.post(
        f"/api/v1/physician/npi-watch/disputes/{case.case_id}/decide",
        headers=_AUTH_HEADERS, json={"action_type": "dispute"},
    )
    assert resp.status_code == 200

    # notify_vendor_from_claim_action's own duplicate check means re-disputing an
    # already-disputed claim does NOT open a second, parallel vendor dispute cycle.
    notifs_after = db.query(ClaimNotification).filter(ClaimNotification.claim_number == claim_number).count()
    assert notifs_after == notifs_before == 1

    print(f"\n  [PASS] decide('dispute') on an already-disputed claim -> no duplicate vendor notification")


def test_decide_endpoint_rejects_before_vendor_response(db):
    _insert_physician(db)
    _make_physician_user(db)
    vendor = _make_vendor(db)
    claim = _make_claim(db, "decide01")
    resp = _post_action(claim.id, "dispute")
    assert resp.status_code == 201
    notif = db.query(ClaimNotification).filter(ClaimNotification.claim_number == str(claim.id)).first()
    case = db.query(DisputeCase).filter(DisputeCase.notification_id == notif.notification_id).first()
    assert case.status == "OPEN"

    resp = client.post(
        f"/api/v1/physician/npi-watch/disputes/{case.case_id}/decide",
        headers=_AUTH_HEADERS, json={"action_type": "confirm"},
    )
    assert resp.status_code == 409
    assert resp.json()["error"] == "no_vendor_response_yet"

    print(f"\n  [PASS] decide() before vendor responds -> 409 no_vendor_response_yet")


def test_decide_endpoint_rejects_non_owner(db):
    case = _create_pending_review_case(db)
    client.post(f"/api/v1/physician/npi-watch/disputes/{case.case_id}/confirm", headers=_AUTH_HEADERS, json={"confirmed": True})
    _make_physician_user(db, email="int_test_other_phys@internal.test", npi="9990000079")

    other_phys_headers = {"Authorization": f"Bearer {create_access_token(email='int_test_other_phys@internal.test', role='physician', npi='9990000079', full_name='Other Physician', expires_hours=1)}"}
    resp = client.post(
        f"/api/v1/physician/npi-watch/disputes/{case.case_id}/decide",
        headers=other_phys_headers, json={"action_type": "confirm"},
    )
    assert resp.status_code == 403

    print(f"\n  [PASS] decide() on someone else's dispute -> 403 forbidden")


def test_decide_endpoint_no_backing_claim(db):
    _insert_physician(db)
    _make_physician_user(db)
    vendor = _make_vendor(db)

    notif = ClaimNotification(
        claim_number="ORPHAN-PLACEHOLDER-001", physician_npi=TEST_PHYSICIAN_NPI, physician_npi_role="ORDERING",
        vendor_npi=TEST_VENDOR_NPI, vendor_name="Integration Test Vendor LLC", vendor_type="DME",
        patient_name_partial="J*** D***", status="DISPUTED",
    )
    db.add(notif)
    db.commit()
    db.refresh(notif)
    case = DisputeCase(
        notification_id=notif.notification_id, physician_npi=TEST_PHYSICIAN_NPI, vendor_npi=TEST_VENDOR_NPI,
        dispute_type="DISPUTE", status="RESPONDED_TO_MEDICARE",
    )
    db.add(case)
    db.commit()
    db.refresh(case)

    try:
        resp = client.post(
            f"/api/v1/physician/npi-watch/disputes/{case.case_id}/decide",
            headers=_AUTH_HEADERS, json={"action_type": "confirm"},
        )
        assert resp.status_code == 422
        assert resp.json()["error"] == "no_backing_claim"
    finally:
        # This notification has no real claims-table row by design (that's what's under
        # test), so _purge()'s claim_ids-based lookup can never find it — clean up directly.
        db.query(DisputeCase).filter(DisputeCase.case_id == case.case_id).delete(synchronize_session=False)
        db.query(ClaimNotification).filter(ClaimNotification.notification_id == notif.notification_id).delete(synchronize_session=False)
        db.commit()

    print(f"\n  [PASS] decide() on a dispute with no backing claim row -> 422 no_backing_claim")


# ---------------------------------------------------------------------------
# TEST 6 — a physician with no physicians row gets one auto-created, rather than
# the ClaimNotification insert failing on the physician_npi FK constraint.
# ---------------------------------------------------------------------------

def test_auto_creates_physician_row_if_missing(db):
    assert db.query(Physician).filter(Physician.npi == TEST_PHYSICIAN_NPI_NO_ROW).first() is None

    db.add(NpiProfile(npi=TEST_PHYSICIAN_NPI_NO_ROW, physician_name="Dr. JAMES WILSON"))
    db.commit()

    _make_vendor(db)
    claim = _make_claim(db, "noreg01", npi=TEST_PHYSICIAN_NPI_NO_ROW)

    result = notify_vendor_from_claim_action(
        claim_id=str(claim.id), physician_npi=TEST_PHYSICIAN_NPI_NO_ROW, action_type="dispute", db=db,
    )
    assert result is True

    physician = db.query(Physician).filter(Physician.npi == TEST_PHYSICIAN_NPI_NO_ROW).first()
    assert physician is not None
    assert physician.first_name == "James"
    assert physician.last_name == "Wilson"
    assert physician.email_primary == f"npi{TEST_PHYSICIAN_NPI_NO_ROW}@placeholder.npiwatch"

    notif = db.query(ClaimNotification).filter(ClaimNotification.claim_number == str(claim.id)).first()
    assert notif is not None
    assert notif.physician_npi == TEST_PHYSICIAN_NPI_NO_ROW

    print(f"\n  [PASS] Missing physicians row auto-created (James Wilson from NpiProfile) -> ClaimNotification created, no FK violation")


# ---------------------------------------------------------------------------
# TEST 7 — 'fraud' is now a valid action_type reachable through the real endpoint
# ---------------------------------------------------------------------------

def test_fraud_action_via_post_endpoint(db):
    _insert_physician(db)
    _make_vendor(db)
    claim = _make_claim(db, "fraudep01")

    resp = _post_action(claim.id, "fraud")
    assert resp.status_code == 201

    action = db.query(Action).filter(Action.claim_id == claim.id).first()
    assert action is not None
    assert action.action_type == "fraud"

    notif = db.query(ClaimNotification).filter(ClaimNotification.claim_number == str(claim.id)).first()
    assert notif is not None
    assert notif.status == "FRAUD_REPORTED"

    case = db.query(DisputeCase).filter(DisputeCase.notification_id == notif.notification_id).first()
    assert case is not None
    assert case.dispute_type == "FRAUD_REPORT"

    print(f"\n  [PASS] POST /actions action_type='fraud' -> 201, Action(fraud) + ClaimNotification(FRAUD_REPORTED) + DisputeCase(FRAUD_REPORT)")


# ---------------------------------------------------------------------------
# TEST 8 — with vendor_notify_delay_hours > 0 (the real default), the vendor
# notification does NOT happen at POST /actions time; it only appears once the
# reminder worker's process_pending_vendor_notifications() runs against an
# action whose window has closed.
# ---------------------------------------------------------------------------

def test_vendor_notify_deferred_until_window_closes(db, monkeypatch):
    monkeypatch.setattr(get_settings(), "vendor_notify_delay_hours", 24.0)
    _insert_physician(db)
    _make_vendor(db)
    claim = _make_claim(db, "defer01")

    resp = _post_action(claim.id, "dispute")
    assert resp.status_code == 201

    # Still inside the 24h window — nothing sent to the vendor yet.
    notif = db.query(ClaimNotification).filter(ClaimNotification.claim_number == str(claim.id)).first()
    assert notif is None

    # A same-moment reminder pass must not jump the gun either.
    process_pending_vendor_notifications(db)
    notif = db.query(ClaimNotification).filter(ClaimNotification.claim_number == str(claim.id)).first()
    assert notif is None

    # Simulate the window closing by backdating the action, then re-run the pass.
    action = db.query(Action).filter(Action.claim_id == claim.id).first()
    action.created_at = datetime.utcnow() - timedelta(hours=25)
    db.commit()

    sent = process_pending_vendor_notifications(db)
    assert sent == 1

    notif = db.query(ClaimNotification).filter(ClaimNotification.claim_number == str(claim.id)).first()
    assert notif is not None
    assert notif.status == "DISPUTED"
    case = db.query(DisputeCase).filter(DisputeCase.notification_id == notif.notification_id).first()
    assert case is not None
    assert case.status == "OPEN"

    print(f"\n  [PASS] Vendor notification withheld until the 24h undo window closes, then sent by the reminder pass")


# ---------------------------------------------------------------------------
# TEST 9 — undoing a vendor-notifying action inside its window means the
# vendor is never told anything — there's no Action row left to notify from.
# ---------------------------------------------------------------------------

def test_undo_within_window_prevents_vendor_notification(db, monkeypatch):
    monkeypatch.setattr(get_settings(), "vendor_notify_delay_hours", 24.0)
    _insert_physician(db)
    _make_vendor(db)
    claim = _make_claim(db, "undo01")

    resp = _post_action(claim.id, "dispute")
    assert resp.status_code == 201
    action_id = resp.json()["id"]

    undo_resp = client.delete(f"/actions/{action_id}", headers=_AUTH_HEADERS)
    assert undo_resp.status_code == 200

    assert db.query(Action).filter(Action.claim_id == claim.id).first() is None

    # Even backdating can't resurrect a notification for an action that no longer exists.
    process_pending_vendor_notifications(db)
    notif = db.query(ClaimNotification).filter(ClaimNotification.claim_number == str(claim.id)).first()
    assert notif is None

    print(f"\n  [PASS] Undo within the 24h window deletes the Action -> reminder pass has nothing to notify the vendor about")
