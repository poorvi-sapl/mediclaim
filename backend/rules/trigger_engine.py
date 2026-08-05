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
from ..models import Action, Physician, Claim, ClaimNotification, DisputeCase, DisputeCaseEvent, NpiProfile, SupplierProfile
from ..utils.tokens import generate_response_token
from ..utils.email import send_vendor_dispute_email
from ..sse import broadcast_alert

log = logging.getLogger("rules.trigger_engine")


def record_dispute_event(db, case: DisputeCase, event_type: str, actor: str,
                          response_type: str = None, note: str = None, docs: list = None) -> DisputeCaseEvent:
    """Append one row to the case's history log. Call this at every state
    transition instead of only overwriting DisputeCase's own snapshot columns —
    that's what lets a case with more than one vendor-response round (resolve
    with physician -> rejected -> respond to Medicare) keep its full history
    instead of the later round silently erasing the earlier one. Caller is
    still responsible for committing (this only adds to the session)."""
    event = DisputeCaseEvent(
        case_id=case.case_id, event_type=event_type, actor=actor,
        response_type=response_type, note=note, docs=docs,
        created_at=datetime.utcnow(),
    )
    db.add(event)
    return event


def serialize_dispute_events(db, case_id: int, base_url: str) -> list:
    """Full history for one case, oldest first, for the timeline UIs on all
    three portals. Doc download links reuse the same vendor-docs route the
    single-snapshot vendor_docs field already used, keyed by this case_id."""
    events = (
        db.query(DisputeCaseEvent)
        .filter(DisputeCaseEvent.case_id == case_id)
        .order_by(DisputeCaseEvent.created_at.asc())
        .all()
    )
    return [
        {
            "event_type":    e.event_type,
            "actor":         e.actor,
            "response_type": e.response_type,
            "note":          e.note,
            "created_at":    e.created_at.isoformat() if e.created_at else None,
            "docs": [
                {**doc, "download_url": f"{base_url}/api/v1/vendor/disputes/{case_id}/docs/{doc.get('stored_name')}"}
                for doc in (e.docs or [])
            ],
        }
        for e in events
    ]


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
    Idempotent, safe to call at the top of any read path. Loads matching rows
    (instead of a single bulk UPDATE) so each one gets its own history-log
    entry and live-push notification — this runs rarely enough (only cases
    that just crossed their deadline) that the extra per-row work is fine."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    cases = (
        db.query(DisputeCase)
        .filter(DisputeCase.status == "OPEN", DisputeCase.response_due_date < now)
        .all()
    )
    for case in cases:
        case.status = "NON_RESPONSIVE"
        record_dispute_event(db, case, "NON_RESPONSIVE", "SYSTEM")
    if cases:
        db.commit()
        for case in cases:
            broadcast_dispute_event(case, "escalated_non_responsive")
    return len(cases)


def escalate_unconfirmed_physician_resolutions(db: Session) -> int:
    """LEGACY DRAIN — kept deliberately, not live functionality.

    Flips any PENDING_PHYSICIAN_CONFIRMATION case whose confirmation window has
    passed back to OPEN, with escalation_unlocked=True. Idempotent; see
    escalate_overdue_disputes for why this loads rows instead of a bulk UPDATE.

    PENDING_PHYSICIAN_CONFIRMATION belonged to the retired "vendor resolves with
    the physician" flow. Nothing creates it anymore — a vendor response now always
    lands in PENDING_PHYSICIAN_REVIEW (vendor.py's _apply_vendor_docs). This stays
    because rows may still sit in that status in deployed databases, and they have
    no other way out: /confirm rejects any status but PENDING_PHYSICIAN_REVIEW and
    the physician's dispute list doesn't show them, so without this they are stuck
    permanently.

    Safe to delete — along with its 5 call sites and
    test_legacy_confirmation_timeout_drains_to_open — once
      SELECT count(*) FROM dispute_cases WHERE status='PENDING_PHYSICIAN_CONFIRMATION'
    returns 0 in every environment, production included."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    cases = (
        db.query(DisputeCase)
        .filter(
            DisputeCase.status == "PENDING_PHYSICIAN_CONFIRMATION",
            DisputeCase.physician_confirmation_due_date < now,
        )
        .all()
    )
    for case in cases:
        case.status = "OPEN"
        case.escalation_unlocked = True
        record_dispute_event(db, case, "CONFIRMATION_EXPIRED", "SYSTEM")
    if cases:
        db.commit()
        for case in cases:
            broadcast_dispute_event(case, "confirmation_expired")
    return len(cases)

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
    # Deceased-patient cases ride the FRAUD_REPORTED notification status —
    # chk_cn_status has no separate value for them, and the case's own
    # dispute_type ('DECEASED_PATIENT') is the source of truth for its kind.
    "DECEASED_PATIENT": "FRAUD_REPORTED",
    # Flag / reassign(unknown-patient) cases ride the generic DISPUTED
    # notification status — chk_cn_status has no separate value; the case's
    # dispute_type ('FLAG' / 'UNKNOWN_PATIENT') carries the real kind.
    "FLAG":            "DISPUTED",
    "UNKNOWN_PATIENT": "DISPUTED",
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
            # Set when the ingest path created a real claims-table row for this
            # payload — links the notification to it the same way the My Claims
            # action path does, so downstream joins/remasks work identically.
            claim_id=claim.get("claim_row_id"),
            claim_ccn=claim.get("claim_ccn"),
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


# NPI-Watch email response -> My Claims action_type. Keeps the email path and the
# My Claims path recording the same decision vocabulary.
_RESPONSE_TO_ACTION = {"CONFIRM": "confirm", "DISPUTE": "dispute", "FRAUD_REPORT": "fraud"}


def record_decision_action(db, claim, npi, action_type, note=None, when=None, broadcast=False):
    """Single source of truth for recording a physician's claim decision: writes the
    Action logbook row and flips Claim.reviewed=True. Every decision path — the My
    Claims POST /actions handler and the NPI-Watch email response
    (respond_to_notification) — goes through here, so a decided claim can never again
    end up without its Action row / reviewed flag while its ClaimNotification says it
    was decided. Does NOT commit — the caller owns the transaction. Returns the row."""
    action = Action(
        claim_id=claim.id,
        npi=npi,
        action_type=action_type,
        note=note,
        vendor_id=claim.vendor_id,
        vendor_name=claim.vendor_name,
        patient_name=claim.patient_name,
        claim_amount=claim.claim_amount,
        broadcast=broadcast,
        created_at=when or datetime.utcnow(),
    )
    db.add(action)
    claim.reviewed = True
    return action


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

    # Mirror the My Claims decision on the backing claim: record the Action logbook
    # row + mark the claim reviewed, so a claim decided from an NPI-Watch email link
    # doesn't stay "unreviewed" with an empty timeline while its notification says it
    # was decided. Only when the notification is backed by a real Claim row, and only
    # if that claim hasn't already been actioned (avoids a duplicate if the physician
    # also acted from My Claims).
    if notification.claim_id:
        claim = db.query(Claim).filter(Claim.id == notification.claim_id).first()
        already = db.query(Action.id).filter(
            Action.claim_id == notification.claim_id,
            Action.npi == notification.physician_npi,
        ).first()
        if claim and not already:
            atype = _RESPONSE_TO_ACTION[response]
            record_decision_action(
                db, claim, notification.physician_npi, atype,
                note=_CLAIM_ACTION_NOTES.get(atype), when=notification.response_at,
            )

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
        db.flush()  # assigns case_id for the event FK below
        record_dispute_event(db, dispute_case, "DISPUTE_OPENED", "PHYSICIAN", note=dispute_case.physician_notes)

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
    "dispute":          "DISPUTE",
    "fraud":            "FRAUD_REPORT",
    "deceased_patient": "DECEASED_PATIENT",
    "flag_supplier":    "FLAG",
    "unknown_patient":  "UNKNOWN_PATIENT",
}

# Internal record only — the physician's real reason, visible to the physician and
# payer. The vendor NEVER sees these; its email/notification is the neutral
# "proof-of-work documents needed" wording (see send_vendor_dispute_email).
_CLAIM_ACTION_NOTES = {
    "dispute":          "Physician disputed this claim via claim review.",
    "fraud":            "Physician reported this claim as fraud via claim review.",
    "deceased_patient": "Physician reported the patient as deceased — services could not have been provided.",
    "flag_supplier":    "Physician flagged this vendor via claim review.",
    "unknown_patient":  "Physician does not recognize the patient on this claim.",
}


def _mask_patient_name(full_name: str) -> str:
    """"John Smith" -> "J. Smith" — first name reduced to its initial, surname
    shown in full. Falls back for missing/blank names."""
    if not full_name or not full_name.strip():
        return "Unknown Patient"
    parts = [p for p in full_name.split() if p]
    if len(parts) == 1:
        return f"{parts[0][0].upper()}."
    return f"{parts[0][0].upper()}. {' '.join(parts[1:])}"


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
            physician_notes = _CLAIM_ACTION_NOTES.get(action_type, "Physician flagged this claim via claim review."),
            response_due_date = datetime.utcnow() + timedelta(days=15),
            status            = "OPEN",
        )
        db.add(dispute_case)
        db.flush()
        record_dispute_event(db, dispute_case, "DISPUTE_OPENED", "PHYSICIAN", note=dispute_case.physician_notes)

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
