"""
Phase 3 — Vendor dispute notification tests.

7 tests:
  1. test_supplier_contacts_seeded
  2. test_normalize_vendor_type
  3. test_dispute_triggers_vendor_email
  4. test_fraud_triggers_vendor_email
  5. test_confirm_no_vendor_involvement
  6. test_unregistered_vendor_no_crash
  7. test_unknown_vendor_no_crash

Uses the live dev DB; each test cleans up its own rows.
"""

import logging
from datetime import date

import pytest
from sqlalchemy.orm import Session

from backend.config import get_settings
from backend.database import SessionLocal, engine, Base
from backend.models import Physician, ClaimNotification, DisputeCase, SupplierProfile
from backend.rules.trigger_engine import respond_to_notification, process_incoming_claim
from backend.utils.supplier_utils import normalize_vendor_type

# ---------------------------------------------------------------------------
# Test vendor NPIs (seeded by seed_supplier_contacts.py)
# ---------------------------------------------------------------------------

TEST_VENDOR_NPI_DME         = "1003101296"   # 101 DIABETIC SUPPLIES, LLC  — FL, DME
TEST_VENDOR_NPI_HOME_HEALTH = "1184131435"   # 01030712 LLC               — FL, Home Health
TEST_VENDOR_NPI_HOSPICE     = "1003290032"   # 1 & 1 HOSPICE, INC         — CA, Hospice
TEST_VENDOR_NPI_UNREGISTERED = "1497758544"  # CUMBERLAND COUNTY HOSPITAL  — npi_watch_registered=False
TEST_VENDOR_NPI_UNKNOWN     = "0000000099"   # not in supplier_profiles at all

TEST_NPI_PHYSICIAN = "9990000003"

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
        first_name="Alice",
        last_name="Park",
        specialty="Internal Medicine",
        practice_name="Park Internal Medicine",
        practice_address="789 Pine St, Miami, FL 33101",
        email_primary="alice.park@parkinternalmedicine.com",
        mobile_phone="3055550303",
        notification_mode="REALTIME",
        verified=True,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def _create_notification(db: Session, vendor_npi: str, claim_suffix: str = "001") -> ClaimNotification:
    claim_dict = {
        "claim_number":        f"CLM-P3-{claim_suffix}",
        "ordering_npi":        TEST_NPI_PHYSICIAN,
        "vendor_npi":          vendor_npi,
        "vendor_name":         "Test Supplier",
        "vendor_type":         "DME",
        "patient_mbi":         "1EG4-TE5-MK73",
        "patient_name_partial": "T*** P***",
        "dos_from":            date(2026, 6, 1),
        "dos_to":              date(2026, 6, 30),
        "service_description": "DME equipment",
        "hcpcs_codes":         ["E0601"],
        "amount_billed":       1200.00,
        "amount_paid":         1000.00,
    }
    notifications = process_incoming_claim(claim_dict, db)
    return notifications[0]


# ---------------------------------------------------------------------------
# TEST 1 — seeded contacts
# ---------------------------------------------------------------------------


def test_supplier_contacts_seeded(db):
    rows = (
        db.query(SupplierProfile)
        .filter(SupplierProfile.npi_watch_registered.is_(True))
        .all()
    )
    assert len(rows) >= 91, f"Expected >= 91 registered, got {len(rows)}"

    emails = [r.contact_email for r in rows]
    assert all(e is not None for e in emails), "Some contact_email is NULL"
    assert len(set(emails)) == len(emails), "Duplicate contact emails found"

    synth = [r for r in rows if r.is_synthetic is True]
    real  = [r for r in rows if r.is_synthetic is False]
    assert len(synth) == 20, f"Expected 20 synthetic, got {len(synth)}"
    assert len(real)  == 71, f"Expected 71 real, got {len(real)}"

    print(f"\n  [PASS] {len(rows)} registered, {len(synth)} synthetic, "
          f"{len(real)} real, all emails unique")


# ---------------------------------------------------------------------------
# TEST 2 — normalize_vendor_type
# ---------------------------------------------------------------------------


def test_normalize_vendor_type():
    assert normalize_vendor_type("DME Supplier")           == "DME"
    assert normalize_vendor_type("DME - Contact Lens")     == "DME"
    assert normalize_vendor_type("DME - Oxygen")           == "DME"
    assert normalize_vendor_type("DME - Prosthetics")      == "DME"
    assert normalize_vendor_type("DME - Nursing Facility") == "DME"
    assert normalize_vendor_type("Home Health Agency")     == "HOME_HEALTH"
    assert normalize_vendor_type("Home Health Clinic")     == "HOME_HEALTH"
    assert normalize_vendor_type("Community Hospice")      == "HOSPICE"
    assert normalize_vendor_type("Hospice Care")           == "HOSPICE"
    assert normalize_vendor_type("Unknown Type")           == "UNKNOWN"
    assert normalize_vendor_type("")                       == "UNKNOWN"
    assert normalize_vendor_type(None)                     == "UNKNOWN"

    print("\n  [PASS] All 9 mappings correct; UNKNOWN/empty/None handled")


# ---------------------------------------------------------------------------
# TEST 3 — DISPUTE triggers vendor email
# ---------------------------------------------------------------------------


def _force_console_email(monkeypatch):
    """Vendor emails are only logged to console when EMAIL_ENABLED=false, and this
    repo's .env sets it true. Pin it off so these tests assert on behavior instead
    of on whichever way the local environment happens to be configured."""
    monkeypatch.setattr(get_settings(), "email_enabled", False)


def test_dispute_triggers_vendor_email(db, caplog, monkeypatch):
    _force_console_email(monkeypatch)
    _insert_physician(db)
    notif = _create_notification(db, TEST_VENDOR_NPI_DME, "DME")

    with caplog.at_level(logging.INFO, logger="utils.email"):
        notification = respond_to_notification(notif.notification_id, "DISPUTE", db)

    db.expire_all()
    case = (
        db.query(DisputeCase)
        .filter(DisputeCase.notification_id == notif.notification_id)
        .first()
    )
    assert case is not None, "DisputeCase not created"
    assert case.billing_provider_notified_at is not None, \
        "billing_provider_notified_at not set"
    # The subject asks for documents and says nothing about why. It used to lead
    # with [URGENT]; the vendor is now told only that a review is underway.
    assert "[ACTION REQUIRED]" in caplog.text, "Expected the document-request email"
    assert "[URGENT]" not in caplog.text

    print(f"\n  [PASS] DISPUTE: case_id={case.case_id}, "
          f"notified_at={case.billing_provider_notified_at.isoformat()}")


# ---------------------------------------------------------------------------
# TEST 4 — FRAUD_REPORT triggers vendor email
# ---------------------------------------------------------------------------


def test_fraud_triggers_vendor_email(db, caplog, monkeypatch):
    """A fraud report must reach the vendor as an ordinary document request. The
    case records FRAUD_REPORT for the physician and payer; the vendor's email is
    type-blind, so it cannot tell a fraud report from a routine dispute."""
    _force_console_email(monkeypatch)
    _insert_physician(db)
    notif = _create_notification(db, TEST_VENDOR_NPI_HOME_HEALTH, "HH")

    with caplog.at_level(logging.INFO, logger="utils.email"):
        respond_to_notification(notif.notification_id, "FRAUD_REPORT", db)

    db.expire_all()
    case = (
        db.query(DisputeCase)
        .filter(DisputeCase.notification_id == notif.notification_id)
        .first()
    )
    assert case is not None
    assert case.dispute_type == "FRAUD_REPORT", "the reason is recorded server-side"
    assert "[ACTION REQUIRED]" in caplog.text, "Expected the document-request email"
    assert "[FRAUD ALERT]" not in caplog.text, "the vendor must not be told it's a fraud report"
    assert "FRAUD" not in caplog.text.upper().replace("FRAUD_REPORT_LINK", ""), \
        "no mention of fraud anywhere in the vendor's email"

    print(f"\n  [PASS] FRAUD_REPORT: case_id={case.case_id}, "
          f"dispute_type={case.dispute_type}")


# ---------------------------------------------------------------------------
# TEST 5 — CONFIRM has zero vendor involvement
# ---------------------------------------------------------------------------


def test_confirm_no_vendor_involvement(db, caplog):
    _insert_physician(db)
    notif = _create_notification(db, TEST_VENDOR_NPI_DME, "CONF")

    with caplog.at_level(logging.INFO, logger="utils.email"):
        respond_to_notification(notif.notification_id, "CONFIRM", db)

    db.expire_all()
    case = (
        db.query(DisputeCase)
        .filter(DisputeCase.notification_id == notif.notification_id)
        .first()
    )
    assert case is None, "DisputeCase should not exist for CONFIRM"
    assert "[URGENT]" not in caplog.text
    assert "[FRAUD ALERT]" not in caplog.text

    print("\n  [PASS] CONFIRM: no DisputeCase, no vendor email")


# ---------------------------------------------------------------------------
# TEST 6 — unregistered vendor: DisputeCase created, no email, no crash
# ---------------------------------------------------------------------------


def test_unregistered_vendor_no_crash(db, caplog):
    # Confirm the NPI exists but is not registered
    vendor = (
        db.query(SupplierProfile)
        .filter(SupplierProfile.npi == TEST_VENDOR_NPI_UNREGISTERED)
        .first()
    )
    assert vendor is not None, "Test prerequisite: vendor must exist in supplier_profiles"
    assert vendor.npi_watch_registered is False

    _insert_physician(db)
    notif = _create_notification(db, TEST_VENDOR_NPI_UNREGISTERED, "UNREG")

    with caplog.at_level(logging.WARNING, logger="rules.trigger_engine"):
        notification = respond_to_notification(notif.notification_id, "DISPUTE", db)

    db.expire_all()
    case = (
        db.query(DisputeCase)
        .filter(DisputeCase.notification_id == notif.notification_id)
        .first()
    )
    assert case is not None, "DisputeCase should still be created"
    assert case.billing_provider_notified_at is None, \
        "billing_provider_notified_at should be NULL for unregistered vendor"
    assert "not registered" in caplog.text

    print(f"\n  [PASS] Unregistered vendor: case_id={case.case_id}, "
          f"notified_at=None, warning logged")


# ---------------------------------------------------------------------------
# TEST 7 — unknown vendor NPI: DisputeCase created, no crash
# ---------------------------------------------------------------------------


def test_unknown_vendor_no_crash(db, caplog):
    # Confirm the NPI does NOT exist in supplier_profiles
    vendor = (
        db.query(SupplierProfile)
        .filter(SupplierProfile.npi == TEST_VENDOR_NPI_UNKNOWN)
        .first()
    )
    assert vendor is None, "Test prerequisite: NPI must not exist in supplier_profiles"

    _insert_physician(db)
    notif = _create_notification(db, TEST_VENDOR_NPI_UNKNOWN, "UNK")

    with caplog.at_level(logging.WARNING, logger="rules.trigger_engine"):
        notification = respond_to_notification(notif.notification_id, "DISPUTE", db)

    db.expire_all()
    case = (
        db.query(DisputeCase)
        .filter(DisputeCase.notification_id == notif.notification_id)
        .first()
    )
    assert case is not None, "DisputeCase should still be created"
    assert "not found in supplier_profiles" in caplog.text

    print(f"\n  [PASS] Unknown vendor: case_id={case.case_id}, warning logged, no crash")
