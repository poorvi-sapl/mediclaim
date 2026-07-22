"""
Regression tests for the decision-consistency invariant (Phase 2 fix).

A physician "decision" on a claim is recorded in three places — Claim.reviewed,
the Action logbook, and ClaimNotification.status — and they must never drift.
Before the fix, the NPI-Watch email response path (respond_to_notification) set
the notification status without writing an Action row or setting Claim.reviewed,
so a decided claim could show as unreviewed in the Oldest-Unreviewed queue and
"Awaiting your review" in its detail timeline while its status badge said it was
already decided.

These tests exercise respond_to_notification on a notification backed by a real
Claim (claim_id set) — the case none of the older notification-flow tests cover.

Uses the live dev DB; each test cleans up its own rows.
"""

from datetime import date

import pytest
from sqlalchemy.orm import Session

from backend.database import SessionLocal, engine, Base
from backend.models import Physician, Claim, Action, ClaimNotification
from backend.rules.trigger_engine import respond_to_notification

TEST_NPI = "9990000042"
TEST_VENDOR_NPI = "9990000043"


@pytest.fixture(scope="session", autouse=True)
def ensure_tables():
    Base.metadata.create_all(bind=engine)


@pytest.fixture
def db():
    session = SessionLocal()
    yield session
    session.close()


def _purge(db: Session):
    # Deleting notifications cascades dispute_cases -> dispute_case_events;
    # deleting claims cascades their actions (both FKs are ON DELETE CASCADE).
    db.query(Action).filter(Action.npi == TEST_NPI).delete(synchronize_session=False)
    db.query(ClaimNotification).filter(ClaimNotification.physician_npi == TEST_NPI).delete(synchronize_session=False)
    db.query(Claim).filter(Claim.npi == TEST_NPI).delete(synchronize_session=False)
    db.query(Physician).filter(Physician.npi == TEST_NPI).delete(synchronize_session=False)
    db.commit()


@pytest.fixture(autouse=True)
def cleanup(db):
    _purge(db)
    yield
    _purge(db)


def _physician(db):
    p = Physician(
        npi=TEST_NPI, first_name="Deci", last_name="Sion", specialty="Internal Medicine",
        taxonomy_code="207R00000X", practice_name="Consistency Clinic",
        practice_address="1 Test St, Austin, TX 78701", email_primary="deci@test.internal",
        mobile_phone="5125550100", notification_mode="REALTIME", verified=True,
    )
    db.add(p); db.commit(); db.refresh(p)
    return p


def _claim(db, suffix="dc01"):
    c = Claim(
        npi=TEST_NPI, patient_id=f"DECI-{suffix}", patient_name="Jane Doe", patient_zip="78701",
        patient_state="TX", date_of_service=date(2026, 6, 1), service_description="DME equipment rental",
        service_category="dme", vendor_name="Consistency Vendor LLC", vendor_id=TEST_VENDOR_NPI,
        vendor_npi=TEST_VENDOR_NPI, vendor_type="DME", claim_amount=1200.00, plan_name="Test Plan",
    )
    db.add(c); db.commit(); db.refresh(c)
    return c


def _notification(db, claim, status="PENDING"):
    n = ClaimNotification(
        claim_number=str(claim.id), claim_id=claim.id, claim_ccn=claim.ccn,
        physician_npi=TEST_NPI, physician_npi_role="ORDERING", vendor_npi=TEST_VENDOR_NPI,
        vendor_name="Consistency Vendor LLC", vendor_type="DME",
        patient_name_partial="J*** D***", status=status,
    )
    db.add(n); db.commit(); db.refresh(n)
    return n


def _actions_for(db, claim):
    return db.query(Action).filter(Action.claim_id == claim.id, Action.npi == TEST_NPI).all()


def test_confirm_records_action_and_reviewed(db):
    """CONFIRM on a claim-backed notification -> Action('confirm') + reviewed=True."""
    _physician(db); c = _claim(db); n = _notification(db, c)

    respond_to_notification(n.notification_id, "CONFIRM", db)

    db.refresh(c); db.refresh(n)
    assert n.status == "CONFIRMED"
    acts = _actions_for(db, c)
    assert len(acts) == 1 and acts[0].action_type == "confirm"
    assert c.reviewed is True


def test_fraud_records_action_and_reviewed(db):
    """FRAUD_REPORT -> status FRAUD_REPORTED + Action('fraud') + reviewed=True."""
    _physician(db); c = _claim(db); n = _notification(db, c)

    respond_to_notification(n.notification_id, "FRAUD_REPORT", db)

    db.refresh(c); db.refresh(n)
    assert n.status == "FRAUD_REPORTED"
    acts = _actions_for(db, c)
    assert len(acts) == 1 and acts[0].action_type == "fraud"
    assert c.reviewed is True


def test_no_duplicate_when_already_actioned(db):
    """If the claim already has an Action (e.g. decided from My Claims), responding
    to the notification must not create a second Action."""
    _physician(db); c = _claim(db)
    db.add(Action(
        claim_id=c.id, npi=TEST_NPI, action_type="fraud", vendor_id=c.vendor_id,
        vendor_name=c.vendor_name, patient_name=c.patient_name, claim_amount=c.claim_amount,
        broadcast=False,
    ))
    c.reviewed = True
    db.commit()
    n = _notification(db, c)

    respond_to_notification(n.notification_id, "FRAUD_REPORT", db)

    assert len(_actions_for(db, c)) == 1, "must not duplicate an existing action"


def test_no_action_when_no_backing_claim(db):
    """A notification with no claim_id (external payer-ingest) must not attempt an
    Action and must not crash."""
    _physician(db)
    n = ClaimNotification(
        claim_number="EXT-0001", claim_id=None, physician_npi=TEST_NPI,
        physician_npi_role="ORDERING", vendor_npi=TEST_VENDOR_NPI, vendor_name="Ext",
        vendor_type="DME", status="PENDING",
    )
    db.add(n); db.commit(); db.refresh(n)

    updated = respond_to_notification(n.notification_id, "CONFIRM", db)

    assert updated.status == "CONFIRMED"
    assert db.query(Action).filter(Action.npi == TEST_NPI).count() == 0
