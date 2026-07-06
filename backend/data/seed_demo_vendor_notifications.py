"""
Seeds claim_notifications for the demo vendor (NPI 1999000008 — 1ACCURATE HOSPICE).
Pulls real claim data from the claims table and creates ClaimNotification rows
so the vendor portal looks populated for demos.

Login: billing@1accuratehospic08.com / VendorPass123!

Run:
    python -m backend.data.seed_demo_vendor_notifications
"""

import random
from datetime import datetime, timedelta

from backend.database import SessionLocal
from backend.models import Claim, ClaimNotification, DisputeCase, Physician
from backend.utils.tokens import generate_response_token

VENDOR_NPI  = "1999000008"
VENDOR_NAME = "1ACCURATE HOSPICE"
VENDOR_TYPE = "HOSPICE"

# Status distribution — realistic for an active vendor with some disputes
STATUS_WEIGHTS = [
    ("PENDING",        0.30),
    ("CONFIRMED",      0.42),
    ("DISPUTED",       0.19),
    ("FRAUD_REPORTED", 0.09),
]

# physician_response raw value that produced each status
RESPONSE_FOR_STATUS = {
    "CONFIRMED":      "CONFIRM",
    "DISPUTED":       "DISPUTE",
    "FRAUD_REPORTED": "FRAUD_REPORT",
}

# dispute_type stored in DisputeCase (check constraint values)
DISPUTE_TYPE_FOR_STATUS = {
    "DISPUTED":       "DISPUTE",
    "FRAUD_REPORTED": "FRAUD_REPORT",
}

HCPCS_MAP = {
    "dme":        ["A4570", "E0143", "K0001"],
    "home_health": ["G0179", "G0180", "T1002"],
    "drugs":      ["Q5001", "J0171", "J2310"],
    "hospital":   ["Q5001", "Q5002", "Q5003"],
}
DEFAULT_HCPCS = ["Q5001", "Q5002"]


def run():
    db = SessionLocal()
    try:
        # ── Guard: skip if already seeded ────────────────────────────
        existing = db.query(ClaimNotification).filter(
            ClaimNotification.vendor_npi == VENDOR_NPI
        ).count()
        if existing > 0:
            print(f"Already seeded — {existing} notifications exist for {VENDOR_NPI}.")
            print("To re-seed, first run:")
            print(f"  DELETE FROM claim_notifications WHERE vendor_npi = '{VENDOR_NPI}';")
            return

        # ── Pull claims, keeping only those with a valid physician FK ─
        valid_npis = {
            row.npi for row in db.query(Physician.npi).all()
        }
        claims = [
            c for c in
            db.query(Claim)
              .filter(Claim.vendor_npi == VENDOR_NPI)
              .order_by(Claim.date_of_service.desc())
              .all()
            if c.npi in valid_npis
        ]
        print(f"Claims found with valid physician FK: {len(claims)}")

        if not claims:
            print("No claims found — check vendor_npi seeding.")
            return

        # ── Build shuffled status list proportionally ─────────────────
        statuses = []
        for status, weight in STATUS_WEIGHTS:
            statuses.extend([status] * round(weight * len(claims)))
        while len(statuses) < len(claims):
            statuses.append("CONFIRMED")
        statuses = statuses[:len(claims)]
        random.shuffle(statuses)

        # ── Create rows ───────────────────────────────────────────────
        now = datetime.utcnow()
        notif_count   = 0
        dispute_count = 0
        status_tally  = {s: 0 for s, _ in STATUS_WEIGHTS}

        for i, claim in enumerate(claims):
            status = statuses[i]
            status_tally[status] += 1

            # Token uses loop index as a stable placeholder id
            token = generate_response_token(i + 9000, claim.npi)

            if status == "PENDING":
                physician_response = None
                response_at        = None
            else:
                physician_response = RESPONSE_FOR_STATUS[status]
                response_at        = now - timedelta(hours=random.randint(1, 240))

            category   = claim.service_category or "hospice"
            hcpcs      = HCPCS_MAP.get(category, DEFAULT_HCPCS)
            dos_from   = claim.date_of_service
            dos_to     = dos_from + timedelta(days=30) if dos_from else None
            billed     = float(claim.claim_amount or 0)

            notif = ClaimNotification(
                claim_number         = str(claim.id),
                physician_npi        = claim.npi,
                physician_npi_role   = "ORDERING",
                vendor_npi           = VENDOR_NPI,
                vendor_name          = VENDOR_NAME,
                vendor_type          = VENDOR_TYPE,
                patient_mbi          = "1EG4-TE5-MK73",
                patient_name_partial = "J*** S***",
                dos_from             = dos_from,
                dos_to               = dos_to,
                service_description  = claim.service_description,
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
                response_token       = token,
                response_changed     = False,
                created_at           = now - timedelta(hours=random.randint(1, 720)),
            )
            db.add(notif)
            db.flush()  # populate notification_id before DisputeCase FK
            notif_count += 1

            # ── DisputeCase for DISPUTED and FRAUD_REPORTED ───────────
            if status in ("DISPUTED", "FRAUD_REPORTED"):
                days_ago    = random.randint(0, 20)
                opened_at   = now - timedelta(days=days_ago)
                due_dt      = opened_at + timedelta(days=15)
                overdue     = due_dt < now

                if overdue:
                    case_status          = "NON_RESPONSIVE"
                    vendor_responded_at  = None
                    provider_resp_type   = None
                elif random.random() > 0.55:
                    case_status          = "RESPONDED_TO_MEDICARE"
                    vendor_responded_at  = now - timedelta(hours=random.randint(1, 48))
                    provider_resp_type   = "RESPONDED_TO_MEDICARE"
                else:
                    case_status          = "OPEN"
                    vendor_responded_at  = None
                    provider_resp_type   = None

                notes = (
                    "I did not order this service for this patient."
                    if status == "DISPUTED"
                    else "I never saw this patient. This appears to be fraud."
                )

                dispute = DisputeCase(
                    notification_id              = notif.notification_id,
                    physician_npi                = claim.npi,
                    vendor_npi                   = VENDOR_NPI,
                    dispute_type                 = DISPUTE_TYPE_FOR_STATUS[status],
                    physician_notes              = notes,
                    billing_provider_notified_at = opened_at,
                    response_due_date            = due_dt,
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

        # ── Summary ───────────────────────────────────────────────────
        print(f"\nSeeding complete — {VENDOR_NAME} (NPI {VENDOR_NPI})")
        print(f"  Login:  billing@1accuratehospic08.com / VendorPass123!")
        print(f"\n  Notifications created: {notif_count}")
        for status, count in status_tally.items():
            print(f"    {status:<20} {count}")
        print(f"\n  Dispute cases created: {dispute_count}")

        # DB verification
        db_notifs = db.query(ClaimNotification).filter(
            ClaimNotification.vendor_npi == VENDOR_NPI
        ).count()
        db_open = db.query(DisputeCase).filter(
            DisputeCase.vendor_npi == VENDOR_NPI,
            DisputeCase.status == "OPEN"
        ).count()
        print(f"\n  DB check:")
        print(f"    claim_notifications rows : {db_notifs}")
        print(f"    open dispute cases       : {db_open}")

    except Exception as exc:
        db.rollback()
        print(f"Error: {exc}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    random.seed(42)
    run()
