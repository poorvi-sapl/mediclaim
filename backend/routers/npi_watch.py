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
from backend.models import Claim, ClaimNotification, DisputeCase, User
from backend.schemas import ActionRequest
from backend.auth import decode_token, extract_token, is_blacklisted
from backend.config import get_settings
from backend.rules.trigger_engine import escalate_overdue_disputes, escalate_unconfirmed_physician_resolutions, broadcast_dispute_event
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
            "amount_billed":        float(r.amount_billed) if r.amount_billed else None,
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


@router.get("/stats")
def get_stats(request: Request, db: Session = Depends(get_db)):
    user = _require_physician(request, db)
    escalate_overdue_disputes(db)
    escalate_unconfirmed_physician_resolutions(db)

    rows = (
        db.query(ClaimNotification.status)
        .filter(
            ClaimNotification.physician_npi == user.npi,
            ClaimNotification.status.in_(["DISPUTED", "FRAUD_REPORTED"]),
        )
        .all()
    )
    statuses = [s for (s,) in rows]
    disputed = statuses.count("DISPUTED")
    fraud_reported = statuses.count("FRAUD_REPORTED")

    # DisputeCase.physician_npi is the direct, correct scope here — filtering by
    # vendor_npi instead would pull in other physicians' disputes against the same
    # vendor, which isn't what "my open disputes" means. PENDING_PHYSICIAN_CONFIRMATION
    # counts as "open" too — it's arguably more actionable than plain OPEN since it's
    # the physician's own confirm/reject action that's pending, not the vendor's.
    open_count = (
        db.query(DisputeCase)
        .filter(
            DisputeCase.physician_npi == user.npi,
            DisputeCase.status.in_(["OPEN", "PENDING_PHYSICIAN_CONFIRMATION"]),
        )
        .count()
    )
    resolved_count = (
        db.query(DisputeCase)
        .filter(
            DisputeCase.physician_npi == user.npi,
            DisputeCase.status.in_(["RESPONDED_TO_MEDICARE", "RESOLVED_BY_PHYSICIAN"]),
        )
        .count()
    )

    return {
        "total":          disputed + fraud_reported,
        "disputed":       disputed,
        "fraud_reported": fraud_reported,
        "open":           open_count,
        "resolved":       resolved_count,
    }


class DisputeConfirmationRequest(BaseModel):
    confirmed: bool


@router.post("/disputes/{case_id}/confirm")
def confirm_dispute_resolution(case_id: int, body: DisputeConfirmationRequest, request: Request, db: Session = Depends(get_db)):
    """Physician's response to a vendor's RESOLVED_WITH_PHYSICIAN claim.
    confirmed=True  -> case is done (RESOLVED_BY_PHYSICIAN).
    confirmed=False -> case reopens and unlocks RESPONDED_TO_MEDICARE for the vendor's
                        next response — the physician disagrees it's actually resolved."""
    user = _require_physician(request, db)

    case = db.query(DisputeCase).filter(DisputeCase.case_id == case_id).first()
    if not case:
        return JSONResponse(status_code=404, content={"error": "not_found", "message": "Dispute case not found."})
    if case.physician_npi != user.npi:
        return JSONResponse(status_code=403, content={"error": "forbidden", "message": "This dispute does not belong to you."})
    if case.status != "PENDING_PHYSICIAN_CONFIRMATION":
        return JSONResponse(status_code=409, content={
            "error": "not_pending_confirmation",
            "message": "This case isn't awaiting your confirmation.",
        })

    if body.confirmed:
        case.status = "RESOLVED_BY_PHYSICIAN"
        case.closed_at = datetime.utcnow()
    else:
        case.status = "OPEN"
        case.escalation_unlocked = True
        case.physician_confirmation_due_date = None

    db.commit()
    db.refresh(case)
    broadcast_dispute_event(case, "physician_confirmed" if body.confirmed else "physician_rejected")

    return {"success": True, "status": case.status}


# ---------------------------------------------------------------------------
# POST /api/v1/physician/npi-watch/disputes/{case_id}/decide
# ---------------------------------------------------------------------------

# The same 5 actions available in My Claims (ClaimsTable.jsx's ACTIONS array) —
# 'did_not_order' isn't one of the 5 UI buttons, so it's excluded here too.
PHYSICIAN_REVIEW_ACTION_TYPES = {"confirm", "dispute", "flag_supplier", "unknown_patient", "fraud"}

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
