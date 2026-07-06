"""
Seeds NPI Watch notifications for the flagship demo physician account
(Dr. James Wilson, NPI 1234567890 — physician@mediclaim.com), so the
NPI Alerts screen shows real data instead of "No NPI watch notifications found."

That account only had synthetic risk-pattern claims planted for the payer-side
leaderboard (see augment_demo_physician.py) — a separate dataset from NPI Watch,
which is why the alerts feed was empty. This creates the actual
claim_notifications / dispute_cases rows the NPI Watch feature reads.

Distribution: 10 PENDING, 8 CONFIRMED, 7 DISPUTED, 5 FRAUD_REPORTED (30 total).
Disputed/fraud-reported notifications also get a DisputeCase row; roughly half
of those are already resolved by the vendor (RESPONDED_TO_MEDICARE or
RESOLVED_BY_PHYSICIAN, each with a note) so the physician can see the
vendor-response visibility feature working end to end.

Run:
    python -m backend.data.seed_demo_physician_npi_watch
"""

import random
from datetime import datetime, timedelta

from backend.database import SessionLocal
from backend.models import Claim, ClaimNotification, DisputeCase, Physician, SupplierProfile
from backend.utils.tokens import generate_response_token

PHYSICIAN_NPI = "1234567890"

STATUS_PLAN = (
    ["PENDING"] * 10 +
    ["CONFIRMED"] * 8 +
    ["DISPUTED"] * 7 +
    ["FRAUD_REPORTED"] * 5
)

RESPONSE_FOR_STATUS = {
    "CONFIRMED":      "CONFIRM",
    "DISPUTED":       "DISPUTE",
    "FRAUD_REPORTED": "FRAUD_REPORT",
}
DISPUTE_TYPE_FOR_STATUS = {
    "DISPUTED":       "DISPUTE",
    "FRAUD_REPORTED": "FRAUD_REPORT",
}
HCPCS_MAP = {
    "dme":         ["A4570", "E0143", "K0001"],
    "home_health": ["G0179", "G0180", "T1002"],
    "drugs":       ["Q5001", "J0171", "J2310"],
    "hospital":    ["Q5001", "Q5002", "Q5003"],
    "hospice":     ["Q5001", "Q5002"],
}
DEFAULT_HCPCS = ["Q5001", "Q5002"]

VENDOR_TYPE_FOR_SUPPLIER_TYPE = {
    "DME Supplier":       "DME",
    "Home Health Agency": "HOME_HEALTH",
    "Hospice Care":       "HOSPICE",
}

# provider_response_type on the DB row must be RESPONDED_TO_MEDICARE / PHYSICIAN_CHANGED_RESPONSE
# / NULL — RESOLVED_BY_PHYSICIAN is a case *status*, not a valid provider_response_type value
# (same distinction vendor.py's _RESPONSE_TYPE_TO_PROVIDER_TYPE makes for live responses).
VENDOR_RESPONSE_NOTES = {
    "RESPONDED_TO_MEDICARE": "We have submitted a correction/resubmission to Medicare for this claim.",
    "RESOLVED_BY_PHYSICIAN": "Contacted the office directly, confirmed the order, and resolved the discrepancy.",
}


def _ensure_physician(db):
    if db.query(Physician).filter(Physician.npi == PHYSICIAN_NPI).first():
        return
    db.add(Physician(
        npi=PHYSICIAN_NPI,
        first_name="James",
        last_name="Wilson",
        specialty="Internal Medicine",
        practice_name="Dr. James Wilson, Internal Medicine",
        practice_address="San Francisco, CA",
        email_primary="physician@mediclaim.com",
        mobile_phone="4155550100",
        notification_mode="REALTIME",
        verified=True,
    ))
    db.commit()
    print(f"  Created physicians row for NPI {PHYSICIAN_NPI} (none existed — FK required for claim_notifications).")


def run():
    db = SessionLocal()
    try:
        existing = db.query(ClaimNotification).filter(
            ClaimNotification.physician_npi == PHYSICIAN_NPI
        ).count()
        if existing > 0:
            print(f"Already seeded — {existing} notifications exist for physician NPI {PHYSICIAN_NPI}.")
            print("To re-seed, first run:")
            print(f"  DELETE FROM dispute_cases WHERE physician_npi = '{PHYSICIAN_NPI}';")
            print(f"  DELETE FROM claim_notifications WHERE physician_npi = '{PHYSICIAN_NPI}';")
            return

        _ensure_physician(db)

        vendors = db.query(SupplierProfile).filter(SupplierProfile.npi_watch_registered == True).all()
        if not vendors:
            print("No npi_watch_registered vendors found in supplier_profiles — cannot seed.")
            return
        print(f"NPI Watch-registered vendors available: {len(vendors)}")

        claims = (
            db.query(Claim)
              .filter(Claim.npi == PHYSICIAN_NPI)
              .order_by(Claim.date_of_service.desc())
              .limit(len(STATUS_PLAN))
              .all()
        )
        print(f"Claims found for physician {PHYSICIAN_NPI}: {len(claims)}")

        statuses = list(STATUS_PLAN)
        random.shuffle(statuses)

        now = datetime.utcnow()
        notif_count   = 0
        dispute_count = 0
        status_tally  = {s: 0 for s in ("PENDING", "CONFIRMED", "DISPUTED", "FRAUD_REPORTED")}

        for i, status in enumerate(statuses):
            status_tally[status] += 1
            claim  = claims[i] if i < len(claims) else None
            vendor = random.choice(vendors)

            if status == "PENDING":
                physician_response = None
                response_at        = None
            else:
                physician_response = RESPONSE_FOR_STATUS[status]
                response_at        = now - timedelta(hours=random.randint(1, 240))

            category  = (claim.service_category if claim else None) or "hospice"
            hcpcs     = HCPCS_MAP.get(category, DEFAULT_HCPCS)
            dos_from  = claim.date_of_service if claim else (now - timedelta(days=random.randint(1, 60))).date()
            dos_to    = dos_from + timedelta(days=30) if dos_from else None
            billed    = float(claim.claim_amount) if claim and claim.claim_amount else round(random.uniform(200, 3000), 2)
            service_desc = (claim.service_description if claim else None) or "Durable medical equipment"
            vendor_type  = VENDOR_TYPE_FOR_SUPPLIER_TYPE.get(vendor.supplier_type, "DME")

            notif = ClaimNotification(
                claim_number         = str(claim.id) if claim else f"WILSON-DEMO-{i + 1:03d}",
                physician_npi        = PHYSICIAN_NPI,
                physician_npi_role   = "ORDERING",
                vendor_npi           = vendor.npi,
                vendor_name          = vendor.supplier_name,
                vendor_type          = vendor_type,
                patient_mbi          = "1EG4-TE5-MK80",
                patient_name_partial = "J*** W***",
                dos_from             = dos_from,
                dos_to               = dos_to,
                service_description  = service_desc,
                hcpcs_codes          = hcpcs,
                amount_billed        = billed,
                amount_paid          = round(billed * 0.85, 2),
                email_sent           = True,
                push_sent            = False,
                sms_sent             = False,
                notification_sent_at = now - timedelta(hours=random.randint(1, 720)),
                status               = status,
                physician_response   = physician_response,
                response_at          = response_at,
                response_changed     = False,
                created_at           = now - timedelta(hours=random.randint(1, 720)),
            )
            db.add(notif)
            db.flush()  # assigns notification_id

            # Generate the response token AFTER flush so it embeds the real
            # notification_id — PENDING rows are then actually clickable, unlike
            # the placeholder-id approach in seed_demo_vendor_notifications.py.
            notif.response_token = generate_response_token(notif.notification_id, PHYSICIAN_NPI)
            notif_count += 1

            if status in ("DISPUTED", "FRAUD_REPORTED"):
                days_ago  = random.randint(0, 20)
                opened_at = now - timedelta(days=days_ago)
                due_dt    = opened_at + timedelta(days=15)
                overdue   = due_dt < now

                if overdue:
                    case_status          = "NON_RESPONSIVE"
                    vendor_responded_at  = None
                    provider_resp_type   = None
                    vendor_response_text = None
                elif random.random() > 0.5:
                    resolution_kind      = random.choice(["RESPONDED_TO_MEDICARE", "RESOLVED_BY_PHYSICIAN"])
                    case_status          = resolution_kind
                    vendor_responded_at  = now - timedelta(hours=random.randint(1, 48))
                    vendor_response_text = VENDOR_RESPONSE_NOTES[resolution_kind]
                    provider_resp_type   = resolution_kind if resolution_kind == "RESPONDED_TO_MEDICARE" else None
                else:
                    case_status          = "OPEN"
                    vendor_responded_at  = None
                    provider_resp_type   = None
                    vendor_response_text = None

                notes = (
                    "I did not order this service for this patient."
                    if status == "DISPUTED"
                    else "I never saw this patient. This appears to be fraud."
                )

                dispute = DisputeCase(
                    notification_id              = notif.notification_id,
                    physician_npi                = PHYSICIAN_NPI,
                    vendor_npi                   = vendor.npi,
                    dispute_type                 = DISPUTE_TYPE_FOR_STATUS[status],
                    physician_notes              = notes,
                    billing_provider_notified_at = opened_at,
                    response_due_date            = due_dt,
                    vendor_response              = vendor_response_text,
                    vendor_responded_at          = vendor_responded_at,
                    provider_response_type       = provider_resp_type,
                    reminder_sent_day7           = days_ago >= 7,
                    reminder_sent_day13          = days_ago >= 13,
                    status                       = case_status,
                    opened_at                    = opened_at,
                )
                db.add(dispute)
                dispute_count += 1

        db.commit()

        print(f"\nSeeding complete — Dr. James Wilson (NPI {PHYSICIAN_NPI})")
        print("  Login:  physician@mediclaim.com")
        print(f"\n  Notifications created: {notif_count}")
        for status, count in status_tally.items():
            print(f"    {status:<20} {count}")
        print(f"\n  Dispute cases created: {dispute_count}")

        db_notifs = db.query(ClaimNotification).filter(ClaimNotification.physician_npi == PHYSICIAN_NPI).count()
        db_disputes = db.query(DisputeCase).filter(DisputeCase.physician_npi == PHYSICIAN_NPI).count()
        db_resolved = db.query(DisputeCase).filter(
            DisputeCase.physician_npi == PHYSICIAN_NPI,
            DisputeCase.vendor_responded_at.isnot(None),
        ).count()
        print(f"\n  DB check:")
        print(f"    claim_notifications rows  : {db_notifs}")
        print(f"    dispute_cases rows        : {db_disputes}")
        print(f"    already resolved by vendor: {db_resolved}")

    except Exception as exc:
        db.rollback()
        print(f"Error: {exc}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    random.seed(7)
    run()
