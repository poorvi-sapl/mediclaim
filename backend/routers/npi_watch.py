"""
Physician NPI Watch notification feed endpoints.

GET /api/v1/physician/npi-watch/notifications — notification feed for logged-in physician
GET /api/v1/physician/npi-watch/stats         — summary counts
"""

import asyncio
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from jose import JWTError
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Action, Claim, ClaimNotification, DisputeCase, DisputeCaseEvent, User
from backend.schemas import ActionRequest
from backend.auth import decode_token, extract_token, is_blacklisted
from backend.config import get_settings
from backend.rules.trigger_engine import escalate_overdue_disputes, escalate_unconfirmed_physician_resolutions, broadcast_dispute_event, record_dispute_event, serialize_dispute_events
from backend.routers.actions import create_action
from backend.sse import broker

router = APIRouter(prefix="/api/v1/physician/npi-watch", tags=["npi_watch"])
log = logging.getLogger("routers.npi_watch")


def _require_physician(request: Request, db: Session) -> User:
    token = extract_token(request)
    if not token or is_blacklisted(token):
        raise HTTPException(status_code=401, detail={"error": "Not authenticated", "code": "NO_TOKEN"})
    try:
        claims = decode_token(token)
    except JWTError:
        raise HTTPException(status_code=401, detail={"error": "Invalid or expired token", "code": "INVALID_TOKEN"})
    user = db.query(User).filter(User.email == claims.get("email")).first()
    if not user:
        raise HTTPException(status_code=401, detail={"error": "User not found", "code": "USER_NOT_FOUND"})
    if user.role != "physician":
        raise HTTPException(status_code=403, detail={"error": "Physician access required", "code": "FORBIDDEN_ROLE"})
    return user


@router.get("/alerts/stream")
async def dispute_alert_stream(request: Request, db: Session = Depends(get_db)):
    """Live push for this physician's own dispute cases — a vendor responding
    (to them or to Medicare) shows up without a manual refresh. Pure signal,
    no payload beyond identifying the case; the frontend just refetches on
    receipt (same data it already loads on mount)."""
    user = _require_physician(request, db)
    recipient = f"physician:{user.npi}"

    async def event_generator():
        queue = await broker.subscribe()
        try:
            while True:
                try:
                    message = await asyncio.wait_for(queue.get(), timeout=15.0)
                    if message.get("recipient") == recipient:
                        yield f"data: {json.dumps(message)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            await broker.unsubscribe(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/notifications")
def get_notifications(request: Request, db: Session = Depends(get_db)):
    user = _require_physician(request, db)
    settings = get_settings()
    escalate_overdue_disputes(db)
    escalate_unconfirmed_physician_resolutions(db)

    rows = (
        db.query(ClaimNotification)
        .filter(
            ClaimNotification.physician_npi == user.npi,
            ClaimNotification.status.in_(["DISPUTED", "FRAUD_REPORTED"]),
        )
        .order_by(ClaimNotification.created_at.desc())
        .limit(50)
        .all()
    )

    base = settings.base_url.rstrip("/")

    # One dispute per notification in practice (respond_to_notification only ever
    # creates one, guarded by the PENDING check) — batched here to avoid N+1 queries.
    notif_ids = [r.notification_id for r in rows]
    disputes_by_notif = {
        d.notification_id: d
        for d in db.query(DisputeCase).filter(DisputeCase.notification_id.in_(notif_ids)).all()
    } if notif_ids else {}

    def _action_url(token: str, action: str) -> str:
        if not token:
            return None
        return f"{base}/api/v1/respond?token={token}&action={action}"

    def _dispute_payload(d):
        if not d:
            return None
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        days_remaining = (d.response_due_date - now).days if d.response_due_date else None
        return {
            "case_id":                d.case_id,
            "dispute_type":           d.dispute_type,
            "status":                 d.status,
            "physician_notes":        d.physician_notes,
            "vendor_response":        d.vendor_response,
            "provider_response_type": d.provider_response_type,
            "opened_at":              d.opened_at.isoformat() if d.opened_at else None,
            "billing_provider_notified_at": d.billing_provider_notified_at.isoformat() if d.billing_provider_notified_at else None,
            "vendor_responded_at":    d.vendor_responded_at.isoformat() if d.vendor_responded_at else None,
            "response_due_date":      d.response_due_date.isoformat() if d.response_due_date else None,
            "closed_at":              d.closed_at.isoformat() if d.closed_at else None,
            "days_remaining":         days_remaining,
            "deadline_passed":        days_remaining is not None and days_remaining < 0,
            "escalation_unlocked":    d.escalation_unlocked,
            "physician_confirmation_due_date": d.physician_confirmation_due_date.isoformat() if d.physician_confirmation_due_date else None,
            "docs": [
                {**doc, "download_url": f"{base}/api/v1/vendor/disputes/{d.case_id}/docs/{doc.get('stored_name')}"}
                for doc in (d.vendor_docs or [])
            ],
            "events": serialize_dispute_events(db, d.case_id, base),
        }

    notifications = [
        {
            "notification_id":      r.notification_id,
            "claim_number":         r.claim_ccn or r.claim_number,
            "vendor_name":          r.vendor_name,
            "vendor_npi":           r.vendor_npi,
            "vendor_type":          r.vendor_type,
            "patient_name_partial": r.patient_name_partial,
            "dos_from":             str(r.dos_from) if r.dos_from else None,
            "dos_to":               str(r.dos_to)   if r.dos_to   else None,
            "service_description":  r.service_description,
            "hcpcs_codes":          r.hcpcs_codes,
            "amount_billed":        float(r.amount_billed) if r.amount_billed else None,
            "amount_paid":          float(r.amount_paid) if r.amount_paid else None,
            "physician_npi_role":   r.physician_npi_role,
            "status":               r.status,
            "created_at":           r.created_at.isoformat() if r.created_at else None,
            "response_at":          r.response_at.isoformat() if r.response_at else None,
            "confirm_url":          _action_url(r.response_token, "CONFIRM"),
            "dispute_url":          _action_url(r.response_token, "DISPUTE"),
            "fraud_url":            _action_url(r.response_token, "FRAUD_REPORT"),
            "dispute":              _dispute_payload(disputes_by_notif.get(r.notification_id)),
        }
        for r in rows
    ]

    return {"notifications": notifications}


# ---------------------------------------------------------------------------
# GET /notifications/bell — recent-activity bell dropdown, distinct from the
# full "My Disputes" feed above: event-level (one row per thing that
# happened), not claim-level, and only events caused by someone else — a
# vendor responding, or an auto-escalation — the same convention vendor.py's
# own bell uses (excludes the physician's own DISPUTE_OPENED/CONFIRMED/REJECTED).
# ---------------------------------------------------------------------------
_PHYSICIAN_NOTIFICATION_EVENTS = ("VENDOR_RESPONDED", "NON_RESPONSIVE", "CONFIRMATION_EXPIRED")
_PHYSICIAN_EVENT_TITLES = {
    "NON_RESPONSIVE":       "Vendor did not respond — escalated to compliance",
    "CONFIRMATION_EXPIRED": "Confirmation window expired — case reopened",
}

# dispute_type -> the claim action that produced it, so the bell can filter and
# badge by what the physician actually did rather than lumping four of the five
# actions together as "dispute". Ids match ClaimsTable.jsx's ACTIONS.
#
# There is no `confirmed` entry on purpose: confirming a claim involves no vendor,
# so it never opens a dispute case and can never appear in this feed.
_BELL_CATEGORY = {
    "FRAUD_REPORT":     "fraud",
    "DISPUTE":          "dispute",
    "FLAG":             "flagged",
    "UNKNOWN_PATIENT":  "unknownPatient",
    "DECEASED_PATIENT": "deceasedPatient",
}


@router.get("/notifications/bell")
def get_bell_notifications(request: Request, db: Session = Depends(get_db)):
    user = _require_physician(request, db)
    since = user.last_alert_seen_at if user.last_alert_seen_at else datetime(1970, 1, 1)

    rows = (
        db.query(DisputeCaseEvent, DisputeCase, ClaimNotification)
        .join(DisputeCase, DisputeCase.case_id == DisputeCaseEvent.case_id)
        .join(ClaimNotification, ClaimNotification.notification_id == DisputeCase.notification_id)
        .filter(
            DisputeCase.physician_npi == user.npi,
            DisputeCaseEvent.event_type.in_(_PHYSICIAN_NOTIFICATION_EVENTS),
        )
        .order_by(DisputeCaseEvent.created_at.desc())
        .limit(30)
        .all()
    )

    notifications = []
    for event, case, notif in rows:
        is_fraud = case.dispute_type == "FRAUD_REPORT"
        is_deceased = case.dispute_type == "DECEASED_PATIENT"
        claim_number = notif.claim_ccn or notif.claim_number
        if event.event_type == "VENDOR_RESPONDED":
            title = ("Vendor responded to your deceased-patient report" if is_deceased
                     else "Vendor responded to your fraud report" if is_fraud
                     else "Vendor responded to your dispute")
        else:
            title = _PHYSICIAN_EVENT_TITLES.get(event.event_type, event.event_type)
        notifications.append({
            "id":           f"event-{event.event_id}",
            "category":     _BELL_CATEGORY.get(case.dispute_type, "dispute"),
            "title":        title,
            "description":  f"Claim {claim_number}" + (f" — {event.note}" if event.note else ""),
            "created_at":   event.created_at.isoformat(),
            "case_id":      case.case_id,
            "claim_number": claim_number,
            "read":         event.created_at <= since,
        })

    # Confirmations, so the bell's `confirmed` filter has something to filter.
    # These are the only rows here caused by the physician rather than someone
    # else, and they are the exception for a structural reason: confirming a claim
    # involves no vendor, so it never opens a DisputeCase and can never appear as a
    # case event. Without this the Confirm filter would be permanently empty.
    #
    # Always read=True — they are your own actions, so they must never contribute
    # to the unread badge. (That badge counts DisputeCaseEvent rows in
    # auth.py's /notifications/count and is unaffected by this block either way.)
    confirms = (
        db.query(Action, Claim.ccn)
        .join(Claim, Claim.id == Action.claim_id)
        .filter(Action.npi == user.npi, Action.action_type == "confirm")
        .order_by(Action.created_at.desc())
        .limit(30)
        .all()
    )
    for action, ccn in confirms:
        notifications.append({
            "id":           f"action-{action.id}",
            "category":     "confirmed",
            "title":        "You confirmed a claim as legitimate",
            "description":  f"Claim {ccn}" + (f" — {action.note}" if action.note else ""),
            "created_at":   action.created_at.isoformat(),
            "case_id":      None,
            "claim_number": ccn,
            "read":         True,
        })

    notifications.sort(key=lambda n: n["created_at"], reverse=True)
    return {"notifications": notifications}


@router.get("/stats")
def get_stats(request: Request, db: Session = Depends(get_db)):
    user = _require_physician(request, db)
    escalate_overdue_disputes(db)
    escalate_unconfirmed_physician_resolutions(db)

    # Counted from the case's dispute_type, not the notification status —
    # DECEASED_PATIENT cases share the FRAUD_REPORTED notification status
    # (see trigger_engine._STATUS_MAP), so status alone can't tell them apart.
    type_rows = (
        db.query(DisputeCase.dispute_type)
        .filter(DisputeCase.physician_npi == user.npi)
        .all()
    )
    types = [t for (t,) in type_rows]
    disputed = types.count("DISPUTE")
    fraud_reported = types.count("FRAUD_REPORT")
    deceased_reported = types.count("DECEASED_PATIENT")

    # DisputeCase.physician_npi is the direct, correct scope here — filtering by
    # vendor_npi instead would pull in other physicians' disputes against the same
    # vendor, which isn't what "my open disputes" means. PENDING_PHYSICIAN_REVIEW
    # counts as "open" too — it's arguably more actionable than plain OPEN since it's
    # the physician's own approve/decline that's pending, not the vendor's.
    open_count = (
        db.query(DisputeCase)
        .filter(
            DisputeCase.physician_npi == user.npi,
            DisputeCase.status.in_(["OPEN", "PENDING_PHYSICIAN_REVIEW"]),
        )
        .count()
    )
    resolved_count = (
        db.query(DisputeCase)
        .filter(
            DisputeCase.physician_npi == user.npi,
            DisputeCase.status.in_(["RESOLVED_BY_PHYSICIAN", "REFERRED_TO_PAYER"]),
        )
        .count()
    )
    # Separate from open_count above (which folds this in as "actionable open") —
    # this is specifically "vendor uploaded docs, your approve/decline is pending",
    # for the physician-side filter that isolates just that queue.
    needs_confirmation_count = (
        db.query(DisputeCase)
        .filter(
            DisputeCase.physician_npi == user.npi,
            DisputeCase.status == "PENDING_PHYSICIAN_REVIEW",
        )
        .count()
    )

    return {
        "total":              disputed + fraud_reported + deceased_reported,
        "disputed":           disputed,
        "fraud_reported":     fraud_reported,
        "deceased_reported":  deceased_reported,
        "open":               open_count,
        "resolved":           resolved_count,
        "needs_confirmation": needs_confirmation_count,
    }


class DisputeConfirmationRequest(BaseModel):
    confirmed: bool
    note: str = None


@router.post("/disputes/{case_id}/confirm")
def confirm_dispute_resolution(case_id: int, body: DisputeConfirmationRequest, request: Request, db: Session = Depends(get_db)):
    """Physician's review of the vendor's uploaded proof-of-work documents.
    confirmed=True  -> Approve: docs are satisfactory, case is done (RESOLVED_BY_PHYSICIAN).
    confirmed=False -> Decline: docs are unsatisfactory. The case leaves the vendor
                        (they are NOT asked again) and is referred to the payer
                        (REFERRED_TO_PAYER); the payer is notified via the
                        PHYSICIAN_REJECTED event on its dashboard."""
    user = _require_physician(request, db)

    case = db.query(DisputeCase).filter(DisputeCase.case_id == case_id).first()
    if not case:
        return JSONResponse(status_code=404, content={"error": "not_found", "message": "Dispute case not found."})
    if case.physician_npi != user.npi:
        return JSONResponse(status_code=403, content={"error": "forbidden", "message": "This dispute does not belong to you."})
    if case.status != "PENDING_PHYSICIAN_REVIEW":
        return JSONResponse(status_code=409, content={
            "error": "not_pending_review",
            "message": "This case isn't awaiting your review of the vendor's documents.",
        })

    if body.confirmed:
        case.status = "RESOLVED_BY_PHYSICIAN"
        case.closed_at = datetime.utcnow()
        record_dispute_event(db, case, "PHYSICIAN_CONFIRMED", "PHYSICIAN")
    else:
        # Declined — hand the case to the payer; the vendor is done with it.
        case.status = "REFERRED_TO_PAYER"
        case.closed_at = datetime.utcnow()
        record_dispute_event(db, case, "PHYSICIAN_REJECTED", "PHYSICIAN", note=body.note)

    db.commit()
    db.refresh(case)
    broadcast_dispute_event(case, "physician_confirmed" if body.confirmed else "physician_rejected")

    return {"success": True, "status": case.status}


# ---------------------------------------------------------------------------
# POST /api/v1/physician/npi-watch/disputes/{case_id}/decide
# ---------------------------------------------------------------------------

# The same 6 actions available in My Claims (ClaimsTable.jsx's ACTIONS array) —
# 'did_not_order' isn't one of the UI buttons, so it's excluded here too.
PHYSICIAN_REVIEW_ACTION_TYPES = {"confirm", "dispute", "flag_supplier", "unknown_patient", "fraud", "deceased_patient"}

# A vendor response has to actually exist before there's anything to review and
# decide on. PENDING_PHYSICIAN_CONFIRMATION already has its own dedicated
# confirm/reject flow above — this endpoint is for the states after that.
_VENDOR_RESPONDED_STATUSES = {"RESOLVED_BY_PHYSICIAN", "RESPONDED_TO_MEDICARE", "NON_RESPONSIVE"}


class DisputeDecisionRequest(BaseModel):
    action_type: str
    note: str = None


@router.post("/disputes/{case_id}/decide")
def decide_dispute_claim(case_id: int, body: DisputeDecisionRequest, request: Request, db: Session = Depends(get_db)):
    """Physician's final call on the underlying claim after reviewing the vendor's
    response to a dispute/fraud report — the same 5 actions available in My Claims,
    now that there's a concrete vendor response to react to.

    This records a normal Action row (visible in My Claims history) and does NOT
    reopen or otherwise touch the dispute case itself — the case stays exactly as
    a historical record of what happened with the vendor. If action_type is
    'dispute' or 'fraud', it does flow through the same My-Claims -> vendor bridge
    as any other dispute — but since a notification already exists for this claim
    (from the original dispute), the bridge's own duplicate check is a no-op here;
    it will not open a second, parallel vendor dispute cycle.
    """
    user = _require_physician(request, db)

    if body.action_type not in PHYSICIAN_REVIEW_ACTION_TYPES:
        return JSONResponse(status_code=422, content={
            "error": "invalid_action_type",
            "message": f"action_type must be one of: {sorted(PHYSICIAN_REVIEW_ACTION_TYPES)}",
        })

    case = db.query(DisputeCase).filter(DisputeCase.case_id == case_id).first()
    if not case:
        return JSONResponse(status_code=404, content={"error": "not_found", "message": "Dispute case not found."})
    if case.physician_npi != user.npi:
        return JSONResponse(status_code=403, content={"error": "forbidden", "message": "This dispute does not belong to you."})
    if case.status not in _VENDOR_RESPONDED_STATUSES:
        return JSONResponse(status_code=409, content={
            "error": "no_vendor_response_yet",
            "message": "The vendor hasn't responded to this dispute yet — there's nothing to review.",
        })

    notif = db.query(ClaimNotification).filter(ClaimNotification.notification_id == case.notification_id).first()
    claim = None
    if notif and notif.claim_id:
        claim = db.query(Claim).filter(Claim.id == notif.claim_id).first()
    if not claim:
        return JSONResponse(status_code=422, content={
            "error": "no_backing_claim",
            "message": "This dispute has no matching claim record, so it can't be re-actioned.",
        })

    result = create_action(ActionRequest(claim_id=str(claim.id), npi=user.npi, action_type=body.action_type, note=body.note), db)

    return {"success": True, "action_id": result.id, "action_type": result.action_type}
