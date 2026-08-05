"""
Adds a batch of FRAUD_REPORTED disputes between the two flagship demo accounts —
Dr. James Wilson (physician, NPI 1234567890) and 1ACCURATE HOSPICE (vendor,
NPI 1999000008, billing@1accuratehospic08.com / Walter Flores) — so there's
enough fraud volume to exercise every screen (My Disputes, the vendor Disputes
tab, and NPI Disputes on the payer side) end to end.

Consistency is by construction, not convention: every row is built from a real,
unused Claim already belonging to both this physician and this vendor, so the
claim number, patient, service, and dollar amounts are identical no matter
which of the 3 portals reads them back — there's no separate "fake" dataset
per portal to drift out of sync. claim_ccn/claim_id are set explicitly (the
same fields notify_vendor_from_claim_action sets on a real dispute), so this
data is indistinguishable from a physician actually clicking Report Fraud in
My Claims.

Distribution across the batch — deliberately spans every DisputeCase status
the UI has a view for:
  8  OPEN                         — still within the 15-day window, unanswered
  6  RESPONDED_TO_MEDICARE        — vendor escalated straight to Medicare
  4  PENDING_PHYSICIAN_REVIEW     — vendor uploaded docs, awaiting physician review
  5  RESOLVED_BY_PHYSICIAN        — physician already confirmed it
  2  NON_RESPONSIVE               — vendor missed the deadline, escalated

These 4 used to be seeded as PENDING_PHYSICIAN_CONFIRMATION, which the app no
longer produces: the physician's dispute list doesn't show that status and
/confirm rejects it, so those demo cases were invisible and unactionable until a
7-day timer drained them. PENDING_PHYSICIAN_REVIEW is the live equivalent.

Run:
    python -m backend.data.seed_demo_wilson_fraud
"""

import random
from datetime import datetime, timedelta

from backend.database import SessionLocal
from backend.models import Claim, ClaimNotification, DisputeCase, Physician, SupplierProfile
from backend.utils.tokens import generate_response_token
from backend.rules.trigger_engine import _mask_patient_name

PHYSICIAN_NPI = "1234567890"
VENDOR_NPI = "1999000008"

STATUS_PLAN = (
    ["OPEN"] * 8 +
    ["RESPONDED_TO_MEDICARE"] * 6 +
    ["PENDING_PHYSICIAN_REVIEW"] * 4 +
    ["RESOLVED_BY_PHYSICIAN"] * 5 +
    ["NON_RESPONSIVE"] * 2
)

PHYSICIAN_NOTES = [
    "I never saw this patient. This appears to be fraud.",
    "This patient was never under my care. Reporting as suspected fraudulent billing.",
    "I did not authorize any services for this patient — reporting as fraud.",
    "No record of this patient in my practice. This claim appears fraudulent.",
]

MEDICARE_RESPONSE_NOTES = [
    "We have submitted a correction/resubmission to Medicare for this claim.",
    "This has been escalated to our compliance team and reported to Medicare directly.",
]

PHYSICIAN_RESOLUTION_NOTES = [
    "Contacted the office directly, confirmed the order, and resolved the discrepancy.",
    "This was a data-entry mix-up on our end — corrected and confirmed with the physician's office.",
]


def _ensure_accounts_exist(db):
    if not db.query(Physician).filter(Physician.npi == PHYSICIAN_NPI).first():
        raise SystemExit(f"Physician NPI {PHYSICIAN_NPI} not found — run seed_demo_physician_npi_watch first.")
    if not db.query(SupplierProfile).filter(SupplierProfile.npi == VENDOR_NPI).first():
        raise SystemExit(f"Vendor NPI {VENDOR_NPI} not found — run seed_supplier_contacts first.")


def run():
    db = SessionLocal()
    try:
        _ensure_accounts_exist(db)

        already_used_claim_ids = {
            r[0] for r in db.query(ClaimNotification.claim_id)
            .filter(ClaimNotification.physician_npi == PHYSICIAN_NPI, ClaimNotification.claim_id.isnot(None))
            .all()
        }

        claim_query = db.query(Claim).filter(Claim.npi == PHYSICIAN_NPI, Claim.vendor_npi == VENDOR_NPI)
        if already_used_claim_ids:
            claim_query = claim_query.filter(~Claim.id.in_(already_used_claim_ids))

        claims = (
            claim_query
            .order_by(Claim.date_of_service.desc())
            .limit(len(STATUS_PLAN))
            .all()
        )
        if len(claims) < len(STATUS_PLAN):
            print(f"Only {len(claims)} unused claims available for this physician+vendor pair "
                  f"(need {len(STATUS_PLAN)}) — seeding what's available.")

        statuses = list(STATUS_PLAN)[:len(claims)]
        random.shuffle(statuses)

        now = datetime.utcnow()
        notif_count = 0
        status_tally = {s: 0 for s in set(STATUS_PLAN)}

        for claim, case_status in zip(claims, statuses):
            status_tally[case_status] += 1

            # POST /actions (the real My Claims path) always sets this alongside
            # creating a notification — do the same here, or the claim keeps
            # showing as "Unreviewed" in My Claims despite having an active
            # fraud report, which both misrepresents its state and re-invites
            # a duplicate dispute click that then silently no-ops.
            claim.reviewed = True

            dos_from = claim.date_of_service
            dos_to = dos_from + timedelta(days=30) if dos_from else None
            billed = float(claim.claim_amount) if claim.claim_amount else 0.0

            notif = ClaimNotification(
                claim_number=str(claim.id),
                claim_id=claim.id,
                claim_ccn=claim.ccn,
                physician_npi=PHYSICIAN_NPI,
                physician_npi_role="ORDERING",
                vendor_npi=claim.vendor_npi,
                vendor_name=claim.vendor_name,
                vendor_type=claim.vendor_type,
                patient_mbi="MASKED",
                patient_name_partial=_mask_patient_name(claim.patient_name),
                dos_from=dos_from,
                dos_to=dos_to,
                service_description=claim.service_description,
                hcpcs_codes=[claim.hcpcs_code] if claim.hcpcs_code else [],
                amount_billed=billed,
                amount_paid=round(billed * 0.85, 2),
                email_sent=True,
                push_sent=False,
                sms_sent=False,
                notification_sent_at=now - timedelta(hours=random.randint(1, 480)),
                status="FRAUD_REPORTED",
                physician_response="FRAUD_REPORT",
                response_at=now - timedelta(hours=random.randint(1, 480)),
                response_changed=False,
                created_at=now - timedelta(hours=random.randint(1, 480)),
            )
            db.add(notif)
            db.flush()  # assigns notification_id
            notif.response_token = generate_response_token(notif.notification_id, PHYSICIAN_NPI)
            notif_count += 1

            # Stagger opened_at so days-remaining/overdue math is realistic and consistent
            # with the chosen status (NON_RESPONSIVE needs a due date already in the past;
            # everything else needs one still open or just-resolved).
            if case_status == "NON_RESPONSIVE":
                days_ago = random.randint(16, 25)
            elif case_status == "OPEN":
                days_ago = random.randint(1, 13)
            else:
                days_ago = random.randint(3, 14)
            opened_at = now - timedelta(days=days_ago)
            due_dt = opened_at + timedelta(days=15)

            vendor_responded_at = None
            provider_response_type = None
            vendor_response_text = None
            physician_confirmation_due_date = None
            escalation_unlocked = False
            closed_at = None

            if case_status == "RESPONDED_TO_MEDICARE":
                # min(...) caps this at "now" — opened_at + a random forward offset can
                # otherwise land in the future when days_ago is small, which silently
                # produces a DisputeCaseEvent dated after "now" (breaks the "unread
                # since last_alert_seen_at" bell-count query: an event that can never
                # be caught up to always shows as new).
                vendor_responded_at = min(opened_at + timedelta(days=random.randint(1, 10)), now - timedelta(hours=1))
                provider_response_type = "RESPONDED_TO_MEDICARE"
                vendor_response_text = random.choice(MEDICARE_RESPONSE_NOTES)
            elif case_status == "PENDING_PHYSICIAN_REVIEW":
                # Awaiting the physician's approve/decline of the vendor's docs.
                # No confirmation deadline: that timer belongs to the retired flow.
                vendor_responded_at = now - timedelta(hours=random.randint(1, 96))
                vendor_response_text = random.choice(PHYSICIAN_RESOLUTION_NOTES)
            elif case_status == "RESOLVED_BY_PHYSICIAN":
                vendor_responded_at = min(opened_at + timedelta(days=random.randint(1, 8)), now - timedelta(hours=2))
                vendor_response_text = random.choice(PHYSICIAN_RESOLUTION_NOTES)
                closed_at = min(vendor_responded_at + timedelta(hours=random.randint(1, 48)), now - timedelta(hours=1))

            dispute = DisputeCase(
                notification_id=notif.notification_id,
                physician_npi=PHYSICIAN_NPI,
                vendor_npi=claim.vendor_npi,
                dispute_type="FRAUD_REPORT",
                physician_notes=random.choice(PHYSICIAN_NOTES),
                billing_provider_notified_at=opened_at,
                response_due_date=due_dt,
                vendor_response=vendor_response_text,
                vendor_responded_at=vendor_responded_at,
                provider_response_type=provider_response_type,
                physician_confirmation_due_date=physician_confirmation_due_date,
                escalation_unlocked=escalation_unlocked,
                reminder_sent_day7=days_ago >= 7,
                reminder_sent_day13=days_ago >= 13,
                status=case_status,
                opened_at=opened_at,
                closed_at=closed_at,
            )
            db.add(dispute)

        db.commit()

        print(f"\nSeeding complete — fraud batch for Dr. James Wilson (NPI {PHYSICIAN_NPI}) "
              f"x 1ACCURATE HOSPICE (NPI {VENDOR_NPI})")
        print(f"\n  Notifications + dispute cases created: {notif_count}")
        for status, count in sorted(status_tally.items()):
            print(f"    {status:<32} {count}")

        db_fraud_total = db.query(ClaimNotification).filter(
            ClaimNotification.physician_npi == PHYSICIAN_NPI,
            ClaimNotification.vendor_npi == VENDOR_NPI,
            ClaimNotification.status == "FRAUD_REPORTED",
        ).count()
        print(f"\n  Total FRAUD_REPORTED notifications now on file for this physician+vendor pair: {db_fraud_total}")

    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    random.seed(42)
    run()
