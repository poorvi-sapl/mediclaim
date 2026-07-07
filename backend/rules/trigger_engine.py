"""
NPI Watch trigger engine — step 1 of the notification loop.

process_incoming_claim: matches claim NPI roles against registered physicians,
  creates CLAIM_NOTIFICATION rows (status=PENDING). No email/push yet.

respond_to_notification: records physician response (CONFIRM / DISPUTE / FRAUD_REPORT),
  updates CLAIM_NOTIFICATION status, and creates a DISPUTE_CASE row on DISPUTE or
  FRAUD_REPORT. CONFIRM stays silent — no DisputeCase, no vendor involvement.

escalate_overdue_disputes: there is no scheduled job in this app that flips a case to
  NON_RESPONSIVE the moment its 15-day window lapses, so status can go stale (still
  OPEN in the DB after the deadline has actually passed). Callers that list/read
  DisputeCase rows call this first so status is never stale by the time it's shown.

notify_vendor_from_claim_action: a second entry point into the same DisputeCase/vendor-
  email machinery as respond_to_notification, triggered from the My Claims screen
  (actions.py) instead of the NPI Watch alert flow. Vendor info comes straight off the
  Claim row (vendor_npi/vendor_name/contact info) rather than a ClaimNotification, since
  no NPI Watch alert exists yet for these claims — the physician is disputing their own
  billed claim, not responding to a notification about someone else using their NPI.

escalate_unconfirmed_physician_resolutions: a vendor's "resolved with physician"
  response isn't final until the physician confirms it (see PENDING_PHYSICIAN_CONFIRMATION
  in DisputeCase.status). If the physician doesn't act within the confirmation window,
  this reopens the case and unlocks the "Responded to Medicare" escalation path for the
  vendor's next response — same "no scheduled job" caveat as escalate_overdue_disputes,
  called at the top of read paths instead.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import List

from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Physician, Claim, ClaimNotification, DisputeCase, NpiProfile, SupplierProfile
from ..utils.tokens import generate_response_token
from ..utils.email import send_vendor_dispute_email
from ..sse import broadcast_alert

log = logging.getLogger("rules.trigger_engine")


def broadcast_dispute_event(case: DisputeCase, event_type: str) -> None:
    """Live-push a dispute-case change to every portal that cares about it: the
    vendor, the physician, and the compliance/payer dashboard. Used at every
    DisputeCase state transition (created, vendor responded, physician
    confirmed/rejected) so open screens update without a manual refresh.
    Recipients are scoped by NPI (physician:<npi> / vendor:<npi>) except the
    payer dashboard, which sees every case. Best-effort — SSE delivery must
    never break the underlying dispute mutation it's reporting on."""
    try:
        payload = {
            "type":            "dispute_updated",
            "event":           event_type,
            "case_id":         case.case_id,
            "notification_id": case.notification_id,
            "status":          case.status,
        }
        broadcast_alert(payload, recipient="plan")
        if case.vendor_npi:
            broadcast_alert(payload, recipient=f"vendor:{case.vendor_npi}")
        if case.physician_npi:
            broadcast_alert(payload, recipient=f"physician:{case.physician_npi}")
    except Exception:
        log.exception(f"broadcast_dispute_event failed for case {case.case_id}")


def escalate_overdue_disputes(db: Session) -> int:
    """Flips any OPEN dispute whose response_due_date has passed to NON_RESPONSIVE.
    Idempotent, cheap (single UPDATE), safe to call at the top of any read path."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    updated = (
        db.query(DisputeCase)
        .filter(DisputeCase.status == "OPEN", DisputeCase.response_due_date < now)
        .update({"status": "NON_RESPONSIVE"}, synchronize_session=False)
    )
    if updated:
        db.commit()
    return updated


def escalate_unconfirmed_physician_resolutions(db: Session) -> int:
    """Flips any PENDING_PHYSICIAN_CONFIRMATION case whose confirmation window has
    passed back to OPEN, with escalation_unlocked=True so the vendor's next response
    can also pick RESPONDED_TO_MEDICARE. Idempotent, cheap (single UPDATE)."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    updated = (
        db.query(DisputeCase)
        .filter(
            DisputeCase.status == "PENDING_PHYSICIAN_CONFIRMATION",
            DisputeCase.physician_confirmation_due_date < now,
        )
        .update({"status": "OPEN", "escalation_unlocked": True}, synchronize_session=False)
    )
    if updated:
        db.commit()
    return updated

# Maps synthetic claim dict field names → physician_npi_role values
_NPI_ROLE_FIELDS = {
    "ordering_npi":   "ORDERING",
    "referring_npi":  "REFERRING",
    "certifying_npi": "CERTIFYING",
    "attending_npi":  "ATTENDING",
}

_VALID_RESPONSES = {"CONFIRM", "DISPUTE", "FRAUD_REPORT"}

_STATUS_MAP = {
    "CONFIRM":      "CONFIRMED",
    "DISPUTE":      "DISPUTED",
    "FRAUD_REPORT": "FRAUD_REPORTED",
}


def process_incoming_claim(claim: dict, db: Session) -> List[ClaimNotification]:
    """
    Takes a synthetic claim payload (no 835 parsing — payer data is stubbed).
    Checks ordering/referring/certifying/attending NPI fields.
    For each NPI that matches a registered Physician row:
      - creates a CLAIM_NOTIFICATION row with status=PENDING
    Does NOT send any email/push/SMS — that is the next phase.
    Returns the list of created ClaimNotification objects (may be empty).
    """
    notifications: List[ClaimNotification] = []

    for field, role in _NPI_ROLE_FIELDS.items():
        npi = claim.get(field)
        if not npi:
            continue

        physician = db.query(Physician).filter(Physician.npi == npi).first()
        if not physician:
            continue

        notification = ClaimNotification(
            claim_number=claim.get("claim_number"),
            physician_npi=npi,
            physician_npi_role=role,
            vendor_npi=claim.get("vendor_npi"),
            vendor_name=claim.get("vendor_name"),
            vendor_type=claim.get("vendor_type"),
            patient_mbi=claim.get("patient_mbi"),
            patient_name_partial=claim.get("patient_name_partial"),
            dos_from=claim.get("dos_from"),
            dos_to=claim.get("dos_to"),
            service_description=claim.get("service_description"),
            hcpcs_codes=claim.get("hcpcs_codes"),
            amount_billed=claim.get("amount_billed"),
            amount_paid=claim.get("amount_paid"),
            status="PENDING",
        )
        db.add(notification)
        notifications.append(notification)

    db.commit()
    # Generate and store a signed response token now that notification_id is assigned.
    for n in notifications:
        db.refresh(n)
        n.response_token = generate_response_token(n.notification_id, n.physician_npi)
    db.commit()
    for n in notifications:
        db.refresh(n)

    return notifications


def respond_to_notification(
    notification_id: int, response: str, db: Session, notes: str = None
) -> ClaimNotification:
    """
    Records a physician response against a CLAIM_NOTIFICATION row.

    response must be one of: CONFIRM, DISPUTE, FRAUD_REPORT.

    CONFIRM  → status=CONFIRMED, nothing else happens, no vendor involvement.
    DISPUTE  → status=DISPUTED,      DISPUTE_CASE created (dispute_type=DISPUTE).
    FRAUD_REPORT → status=FRAUD_REPORTED, DISPUTE_CASE created (dispute_type=FRAUD_REPORT).

    notes, if given, is stored as DisputeCase.physician_notes (DISPUTE / FRAUD_REPORT
    only — ignored for CONFIRM, which creates no DisputeCase).

    response_due_date on the DisputeCase is set to NOW() + 15 days.
    Returns the updated ClaimNotification.
    """
    if response not in _VALID_RESPONSES:
        raise ValueError(
            f"Invalid response '{response}'. Must be one of: {sorted(_VALID_RESPONSES)}"
        )

    notification = (
        db.query(ClaimNotification)
        .filter(ClaimNotification.notification_id == notification_id)
        .first()
    )
    if not notification:
        raise ValueError(f"ClaimNotification id={notification_id} not found")

    # Idempotency guard — if already responded, return existing state unchanged.
    if notification.status != "PENDING":
        return notification

    notification.status = _STATUS_MAP[response]
    notification.physician_response = response
    notification.response_at = datetime.utcnow()

    dispute_case = None
    if response in ("DISPUTE", "FRAUD_REPORT"):
        dispute_case = DisputeCase(
            notification_id=notification_id,
            physician_npi=notification.physician_npi,
            vendor_npi=notification.vendor_npi,
            dispute_type=response,
            physician_notes=(notes.strip() or None) if notes else None,
            response_due_date=datetime.utcnow() + timedelta(days=15),
            status="OPEN",
        )
        db.add(dispute_case)

    db.commit()
    db.refresh(notification)

    if dispute_case is not None:
        db.refresh(dispute_case)
        broadcast_dispute_event(dispute_case, "dispute_created")
        settings = get_settings()
        vendor = (
            db.query(SupplierProfile)
            .filter(SupplierProfile.npi == notification.vendor_npi)
            .first()
        )

        if vendor and vendor.npi_watch_registered:
            send_vendor_dispute_email(
                dispute_case=dispute_case,
                notification=notification,
                vendor=vendor,
                base_url=settings.base_url,
            )
            db.commit()
        elif vendor and not vendor.npi_watch_registered:
            log.warning(
                f"Vendor {notification.vendor_npi} exists but not registered "
                f"on NPI Watch — dispute email skipped for case "
                f"{dispute_case.case_id}"
            )
        else:
            log.warning(
                f"Vendor {notification.vendor_npi} not found in "
                f"supplier_profiles — dispute email skipped for case "
                f"{dispute_case.case_id}"
            )

    return notification


_CLAIM_ACTION_TO_DISPUTE_TYPE = {
    "dispute": "DISPUTE",
    # 'fraud' is not a reachable action_type from My Claims today (ClaimsTable.jsx has
    # no Report Fraud button, and actions.py's VALID_ACTION_TYPES doesn't include it) —
    # kept here so this function is ready if that ever changes.
    "fraud":   "FRAUD_REPORT",
}


def _mask_patient_name(full_name: str) -> str:
    """"John Smith" -> "J*** S***" — same partial-mask convention used elsewhere
    for patient_name_partial. Falls back for missing/blank names."""
    if not full_name or not full_name.strip():
        return "Unknown Patient"
    return " ".join(f"{part[0].upper()}***" for part in full_name.split() if part)


def notify_vendor_from_claim_action(
    claim_id: str, physician_npi: str, action_type: str, db: Session
) -> bool:
    """
    Called when a physician disputes or reports fraud on a claim from the My Claims
    screen (backend/routers/actions.py), rather than responding to an existing NPI
    Watch alert. Creates a ClaimNotification + DisputeCase from the Claim row's own
    vendor_npi/vendor_name/vendor_type/contact info and sends the same vendor dispute
    email as respond_to_notification() — same downstream tables, same email, same
    15-day response window, different entry point.

    action_type must be 'dispute' or 'fraud'.

    Returns True if a new DisputeCase was created (regardless of whether the vendor
    email actually sent — that failure mode is only logged, per send_vendor_dispute_email's
    contract). Returns False if the claim/vendor wasn't found or a notification already
    exists for this claim+physician (idempotent — never creates a duplicate).
    Never raises — every failure is logged and returns False so a vendor-notification
    problem can never break the underlying My Claims action.
    """
    dispute_type = _CLAIM_ACTION_TO_DISPUTE_TYPE.get(action_type)
    if not dispute_type:
        log.error(f"notify_vendor_from_claim_action: invalid action_type '{action_type}'")
        return False

    try:
        claim = db.query(Claim).filter(Claim.id == claim_id).first()
        if not claim:
            log.warning(f"notify_vendor_from_claim_action: claim {claim_id} not found")
            return False

        if not claim.vendor_npi:
            log.warning(f"notify_vendor_from_claim_action: claim {claim_id} has no vendor_npi")
            return False

        # ClaimNotification.physician_npi has a real FK to physicians.npi. My Claims is
        # reachable by any physician regardless of NPI Watch registration, so — unlike
        # the NPI Watch alert flow, where a Physician row is a precondition — one may
        # not exist yet here. Auto-create a minimal one rather than silently failing.
        physician_row = db.query(Physician).filter(Physician.npi == physician_npi).first()
        if not physician_row:
            profile = db.query(NpiProfile).filter(NpiProfile.npi == physician_npi).first()
            if profile and profile.physician_name:
                # NpiProfile stores the full name as one string, e.g. "Dr. JAMES WILSON".
                name_parts = profile.physician_name.replace("Dr.", "").replace("DR.", "").strip().split()
                first = name_parts[0].title() if len(name_parts) > 0 else "Unknown"
                last  = name_parts[-1].title() if len(name_parts) > 1 else "Physician"
            else:
                first, last = "Unknown", "Physician"

            physician_row = Physician(
                npi=physician_npi,
                first_name=first,
                last_name=last,
                email_primary=f"npi{physician_npi}@placeholder.npiwatch",
                verified=False,
                registered_date=datetime.utcnow(),
            )
            db.add(physician_row)
            db.flush()
            log.info(f"Auto-created physicians row for NPI {physician_npi} ({first} {last})")

        existing = (
            db.query(ClaimNotification)
            .filter(
                ClaimNotification.claim_number == str(claim_id),
                ClaimNotification.physician_npi == physician_npi,
            )
            .first()
        )
        if existing:
            log.info(
                f"notify_vendor_from_claim_action: notification already exists for "
                f"claim {claim_id} / physician {physician_npi} — skipping duplicate"
            )
            return False

        dos_from = claim.date_of_service
        notification = ClaimNotification(
            claim_number         = str(claim_id),
            claim_id             = claim.id,
            claim_ccn            = claim.ccn,
            physician_npi        = physician_npi,
            # My Claims has no ordering/referring/certifying/attending distinction —
            # the physician on the claim is simplified to ORDERING here.
            physician_npi_role   = "ORDERING",
            vendor_npi           = claim.vendor_npi,
            vendor_name          = claim.vendor_name,
            vendor_type          = claim.vendor_type,
            patient_mbi          = "MASKED",
            patient_name_partial = _mask_patient_name(claim.patient_name),
            dos_from             = dos_from,
            dos_to               = dos_from + timedelta(days=30) if dos_from else None,
            service_description  = claim.service_description,
            hcpcs_codes          = [claim.hcpcs_code] if claim.hcpcs_code else [],
            amount_billed        = float(claim.claim_amount or 0),
            amount_paid          = float(claim.claim_amount or 0) * 0.85,
            email_sent           = False,
            status               = _STATUS_MAP[dispute_type],
            physician_response   = dispute_type,
            response_at          = datetime.utcnow(),
            created_at           = datetime.utcnow(),
        )
        db.add(notification)
        db.flush()  # assigns notification_id

        notification.response_token = generate_response_token(notification.notification_id, physician_npi)

        dispute_case = DisputeCase(
            notification_id = notification.notification_id,
            physician_npi   = physician_npi,
            vendor_npi      = claim.vendor_npi,
            dispute_type    = dispute_type,
            physician_notes = (
                "Physician disputed this claim via claim review."
                if action_type == "dispute"
                else "Physician reported this claim as fraud via claim review."
            ),
            response_due_date = datetime.utcnow() + timedelta(days=15),
            status            = "OPEN",
        )
        db.add(dispute_case)
        db.flush()

        db.commit()
        db.refresh(notification)
        db.refresh(dispute_case)
        broadcast_dispute_event(dispute_case, "dispute_created")

        settings = get_settings()
        vendor = db.query(SupplierProfile).filter(SupplierProfile.npi == claim.vendor_npi).first()

        if vendor and vendor.npi_watch_registered:
            if send_vendor_dispute_email(
                dispute_case=dispute_case, notification=notification,
                vendor=vendor, base_url=settings.base_url,
            ):
                notification.email_sent = True
                db.commit()
        elif vendor and not vendor.npi_watch_registered:
            log.warning(
                f"Vendor {claim.vendor_npi} exists but not registered on NPI Watch — "
                f"dispute email skipped for case {dispute_case.case_id}"
            )
        else:
            log.warning(
                f"Vendor {claim.vendor_npi} not found in supplier_profiles — "
                f"dispute email skipped for case {dispute_case.case_id}"
            )

        return True

    except Exception as exc:
        db.rollback()
        log.error(f"notify_vendor_from_claim_action: failed for claim {claim_id}: {exc}")
        return False
