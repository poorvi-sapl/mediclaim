"""
Vendor endpoints — two auth modes:

Token-gated (no session, signed URL from email):
  GET  /api/v1/vendor/disputes/{case_id}?token=...
  POST /api/v1/vendor/disputes/{case_id}/respond?token=...

Session-auth (vendor must be logged in):
  GET  /api/v1/vendor/portal/claims
  GET  /api/v1/vendor/portal/disputes
  GET  /api/v1/vendor/portal/stats
  POST /api/v1/vendor/portal/disputes/{case_id}/respond
"""

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import List

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from jose import JWTError
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.config import get_settings
from backend.models import ClaimNotification, DisputeCase, Physician, SupplierProfile, User
from backend.auth import decode_token, extract_token, is_blacklisted
from backend.utils.tokens import decode_vendor_dispute_token
from backend.rules.trigger_engine import escalate_overdue_disputes, escalate_unconfirmed_physician_resolutions
from backend.routers.documents import MAX_BYTES, ALLOWED

# A vendor's first response to a dispute may only try to resolve it with the
# physician — "Responded to Medicare" only unlocks after the physician rejects
# that resolution or the confirmation window lapses (escalation_unlocked=True).
PHYSICIAN_CONFIRMATION_WINDOW_DAYS = 7

router = APIRouter(prefix="/api/v1/vendor", tags=["vendor"])
log = logging.getLogger("routers.vendor")


# ---------------------------------------------------------------------------
# Session-auth helper
# ---------------------------------------------------------------------------

def _require_vendor(request: Request, db: Session) -> User:
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
    if user.role != "vendor":
        raise HTTPException(status_code=403, detail={"error": "Vendor access required", "code": "FORBIDDEN_ROLE"})
    return user


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _decode_or_error(token: str):
    """
    Returns (payload_dict, None) on success.
    Returns (None, JSONResponse) on failure — caller returns the response.
    """
    try:
        return decode_vendor_dispute_token(token), None
    except ValueError as exc:
        msg = str(exc)
        if "expired" in msg.lower():
            return None, JSONResponse(
                status_code=410,
                content={
                    "error": "link_expired",
                    "message": (
                        "This link has expired. "
                        "The 15-day response window may have closed."
                    ),
                },
            )
        return None, JSONResponse(
            status_code=410,
            content={
                "error": "invalid_token",
                "message": "This link is invalid or has already been used.",
            },
        )


def _days_remaining(due_date) -> int:
    if due_date is None:
        return 0
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    return (due_date - now).days


async def _save_dispute_docs(case_id: int, files: List[UploadFile]) -> list:
    """Saves proof documents attached to a vendor dispute response to disk and
    returns metadata dicts to append to DisputeCase.vendor_docs (JSONB). Reuses
    the same size/type constraints as the registration-document uploader."""
    settings = get_settings()
    case_dir = os.path.join(settings.document_upload_dir, "disputes", str(case_id))
    saved = []
    for f in files or []:
        if not f or not f.filename:
            continue
        if f.content_type not in ALLOWED:
            raise ValueError(f"Unsupported file type for {f.filename}. Allowed: PDF, JPEG, PNG.")
        content = await f.read()
        if len(content) > MAX_BYTES:
            raise ValueError(f"{f.filename} is too large. Maximum size is 10MB.")
        os.makedirs(case_dir, exist_ok=True)
        ext = ALLOWED[f.content_type]
        stored_name = os.path.basename(f"{int(datetime.utcnow().timestamp() * 1000)}_{f.filename}")
        with open(os.path.join(case_dir, stored_name), "wb") as out:
            out.write(content)
        saved.append({
            "filename":      f.filename,
            "stored_name":   stored_name,
            "content_type":  f.content_type,
            "size":          len(content),
            "uploaded_at":   datetime.utcnow().isoformat(),
        })
    return saved


# ---------------------------------------------------------------------------
# GET /api/v1/vendor/disputes/{case_id}
# ---------------------------------------------------------------------------

@router.get("/disputes/{case_id}")
def get_vendor_dispute(
    case_id: int,
    token: str = Query(..., description="Signed vendor dispute token"),
    db: Session = Depends(get_db),
):
    payload, err = _decode_or_error(token)
    if err:
        return err

    escalate_overdue_disputes(db)
    escalate_unconfirmed_physician_resolutions(db)

    case = db.query(DisputeCase).filter(DisputeCase.case_id == case_id).first()
    if not case:
        return JSONResponse(status_code=404, content={"error": "not_found", "message": "Dispute case not found."})

    if payload["vendor_npi"] != case.vendor_npi:
        return JSONResponse(status_code=403, content={"error": "forbidden", "message": "This token does not match the dispute."})

    notif = (
        db.query(ClaimNotification)
        .filter(ClaimNotification.notification_id == case.notification_id)
        .first()
    )

    days = _days_remaining(case.response_due_date)
    deadline_passed = days < 0

    return {
        "case_id":               case.case_id,
        "dispute_type":          case.dispute_type,
        "status":                case.status,
        "response_due_date":     case.response_due_date.isoformat() if case.response_due_date else None,
        "days_remaining":        days,
        "deadline_passed":       deadline_passed,
        "physician_notes":       case.physician_notes,
        "vendor_responded_at":   case.vendor_responded_at.isoformat() if case.vendor_responded_at else None,
        "provider_response_type": case.provider_response_type,
        "vendor_response":       case.vendor_response,
        "vendor_docs":           case.vendor_docs or [],
        "escalation_unlocked":   case.escalation_unlocked,
        "physician_confirmation_due_date": case.physician_confirmation_due_date.isoformat() if case.physician_confirmation_due_date else None,
        "claim": {
            "claim_number":        (notif.claim_ccn or notif.claim_number) if notif else None,
            "vendor_name":         notif.vendor_name if notif else None,
            "vendor_type":         notif.vendor_type if notif else None,
            "patient_name_partial": notif.patient_name_partial if notif else None,
            "dos_from":            str(notif.dos_from) if notif and notif.dos_from else None,
            "dos_to":              str(notif.dos_to)   if notif and notif.dos_to   else None,
            "service_description": notif.service_description if notif else None,
            "hcpcs_codes":         notif.hcpcs_codes if notif else None,
            "amount_billed":       float(notif.amount_billed) if notif and notif.amount_billed else None,
            "physician_npi_role":  notif.physician_npi_role if notif else None,
        },
    }


# ---------------------------------------------------------------------------
# GET /api/v1/vendor/disputes/{case_id}/docs/{stored_name}  (session-auth,
# cross-role: vendor who owns the case, physician who filed it, or compliance)
# ---------------------------------------------------------------------------

@router.get("/disputes/{case_id}/docs/{stored_name}")
def download_dispute_doc(
    case_id: int, stored_name: str, request: Request,
    token: str = Query(None, description="Signed vendor dispute token (email-link flow, no session)"),
    db: Session = Depends(get_db),
):
    case = db.query(DisputeCase).filter(DisputeCase.case_id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": "Dispute case not found."})

    allowed = False

    # Email-link flow: the signed per-dispute token proves vendor ownership with no session.
    if token:
        payload, err = _decode_or_error(token)
        if not err and payload.get("vendor_npi") == case.vendor_npi:
            allowed = True

    # Portal flow: whoever is logged in (vendor/physician on this case, or any compliance user).
    if not allowed:
        session_token = extract_token(request)
        if session_token and not is_blacklisted(session_token):
            try:
                claims = decode_token(session_token)
                user = db.query(User).filter(User.email == claims.get("email")).first()
            except JWTError:
                user = None
            if user:
                allowed = (
                    (user.role == "vendor" and user.npi == case.vendor_npi) or
                    (user.role == "physician" and user.npi == case.physician_npi) or
                    (user.role == "plan_investigator")
                )

    if not allowed:
        raise HTTPException(status_code=403, detail={"error": "forbidden", "message": "You do not have access to this document."})

    doc = next((d for d in (case.vendor_docs or []) if d.get("stored_name") == stored_name), None)
    if not doc:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": "Document not found."})

    settings = get_settings()
    path = os.path.join(settings.document_upload_dir, "disputes", str(case_id), stored_name)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": "File missing on disk."})

    return FileResponse(path, media_type=doc.get("content_type"), filename=doc.get("filename"))


# ---------------------------------------------------------------------------
# POST /api/v1/vendor/disputes/{case_id}/respond
# ---------------------------------------------------------------------------

_VALID_RESPONSE_TYPES = {"RESPONDED_TO_MEDICARE", "RESOLVED_WITH_PHYSICIAN"}

# RESOLVED_WITH_PHYSICIAN is not final on submit anymore — it goes to
# PENDING_PHYSICIAN_CONFIRMATION and only becomes RESOLVED_BY_PHYSICIAN once the
# physician confirms it (see npi_watch.py's confirm endpoint).
_RESPONSE_TYPE_TO_STATUS = {
    "RESPONDED_TO_MEDICARE":   "RESPONDED_TO_MEDICARE",
    "RESOLVED_WITH_PHYSICIAN": "PENDING_PHYSICIAN_CONFIRMATION",
}

# "RESOLVED_WITH_PHYSICIAN" is not a valid provider_response_type per the DB
# constraint — the case status already captures it.
_RESPONSE_TYPE_TO_PROVIDER_TYPE = {
    "RESPONDED_TO_MEDICARE":   "RESPONDED_TO_MEDICARE",
    "RESOLVED_WITH_PHYSICIAN": None,
}


def _validate_response_type(case: DisputeCase, response_type: str):
    """Returns a JSONResponse error, or None if the response_type is allowed for
    this case's current escalation state."""
    if response_type not in _VALID_RESPONSE_TYPES:
        return JSONResponse(
            status_code=422,
            content={"error": "invalid_response_type",
                     "message": f"response_type must be one of: {sorted(_VALID_RESPONSE_TYPES)}"},
        )
    if response_type == "RESPONDED_TO_MEDICARE" and not case.escalation_unlocked:
        return JSONResponse(
            status_code=403,
            content={
                "error": "escalation_locked",
                "message": "Try resolving this with the physician first. \"Responded to Medicare\" "
                           "unlocks only if the physician doesn't confirm the resolution.",
            },
        )
    return None


@router.post("/disputes/{case_id}/respond")
async def vendor_respond(
    case_id: int,
    token: str = Query(..., description="Signed vendor dispute token"),
    response_type:   str           = Form(...),
    vendor_response: str           = Form(""),
    docs:            List[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
):
    payload, err = _decode_or_error(token)
    if err:
        return err

    escalate_unconfirmed_physician_resolutions(db)

    case = db.query(DisputeCase).filter(DisputeCase.case_id == case_id).first()
    if not case:
        return JSONResponse(status_code=404, content={"error": "not_found", "message": "Dispute case not found."})

    if payload["vendor_npi"] != case.vendor_npi:
        return JSONResponse(status_code=403, content={"error": "forbidden", "message": "This token does not match the dispute."})

    if case.status != "OPEN":
        return JSONResponse(
            status_code=409,
            content={
                "error": "already_resolved",
                "message": "This dispute has already been responded to.",
            },
        )

    days = _days_remaining(case.response_due_date)
    if days < 0:
        return JSONResponse(
            status_code=410,
            content={
                "error": "deadline_passed",
                "message": "The 15-day response window has closed. This case has been escalated.",
            },
        )

    type_err = _validate_response_type(case, response_type)
    if type_err:
        return type_err

    try:
        saved_docs = await _save_dispute_docs(case_id, docs)
    except ValueError as exc:
        return JSONResponse(status_code=400, content={"error": "bad_file", "message": str(exc)})

    new_status = _RESPONSE_TYPE_TO_STATUS[response_type]
    case.vendor_response        = vendor_response
    case.provider_response_type = _RESPONSE_TYPE_TO_PROVIDER_TYPE[response_type]
    case.vendor_responded_at    = datetime.utcnow()
    case.status                 = new_status
    if new_status == "PENDING_PHYSICIAN_CONFIRMATION":
        case.physician_confirmation_due_date = datetime.utcnow() + timedelta(days=PHYSICIAN_CONFIRMATION_WINDOW_DAYS)
    if saved_docs:
        case.vendor_docs = (case.vendor_docs or []) + saved_docs
    db.commit()
    db.refresh(case)

    return {
        "success": True,
        "status":  case.status,
        "docs":    case.vendor_docs or [],
        "message": (
            "Your response has been recorded. The physician has "
            f"{PHYSICIAN_CONFIRMATION_WINDOW_DAYS} days to confirm it's resolved."
            if new_status == "PENDING_PHYSICIAN_CONFIRMATION"
            else "Your response has been recorded."
        ),
    }


# ===========================================================================
# Session-auth portal endpoints
# ===========================================================================

# ---------------------------------------------------------------------------
# GET /api/v1/vendor/portal/claims
# ---------------------------------------------------------------------------

@router.get("/portal/claims")
def portal_claims(request: Request, db: Session = Depends(get_db)):
    user = _require_vendor(request, db)
    rows = (
        db.query(ClaimNotification)
        .filter(ClaimNotification.vendor_npi == user.npi)
        .order_by(ClaimNotification.created_at.desc())
        .all()
    )

    total         = len(rows)
    pending       = sum(1 for r in rows if r.status == "PENDING")
    confirmed     = sum(1 for r in rows if r.status == "CONFIRMED")
    disputed      = sum(1 for r in rows if r.status == "DISPUTED")
    fraud_reported = sum(1 for r in rows if r.status == "FRAUD_REPORTED")

    claims = [
        {
            "notification_id":      r.notification_id,
            "claim_number":         r.claim_ccn or r.claim_number,
            "physician_npi":        r.physician_npi,
            "physician_npi_role":   r.physician_npi_role,
            "patient_name_partial": r.patient_name_partial,
            "dos_from":             str(r.dos_from)  if r.dos_from  else None,
            "dos_to":               str(r.dos_to)    if r.dos_to    else None,
            "service_description":  r.service_description,
            "amount_billed":        float(r.amount_billed) if r.amount_billed else None,
            "amount_paid":          float(r.amount_paid)   if r.amount_paid   else None,
            "status":               r.status,
            "created_at":           r.created_at.isoformat() if r.created_at else None,
            "response_at":          r.response_at.isoformat() if r.response_at else None,
        }
        for r in rows
    ]

    return {
        "claims": claims,
        "summary": {
            "total":          total,
            "pending":        pending,
            "confirmed":      confirmed,
            "disputed":       disputed,
            "fraud_reported": fraud_reported,
        },
    }


# ---------------------------------------------------------------------------
# GET /api/v1/vendor/portal/disputes
# ---------------------------------------------------------------------------

@router.get("/portal/disputes")
def portal_disputes(request: Request, db: Session = Depends(get_db)):
    user = _require_vendor(request, db)
    escalate_overdue_disputes(db)
    escalate_unconfirmed_physician_resolutions(db)
    cases = (
        db.query(DisputeCase, ClaimNotification)
        .join(ClaimNotification, DisputeCase.notification_id == ClaimNotification.notification_id)
        .filter(DisputeCase.vendor_npi == user.npi)
        .order_by(DisputeCase.opened_at.desc())
        .all()
    )

    physician_npis = {case.physician_npi for case, _ in cases}
    physicians_by_npi = {
        p.npi: p for p in db.query(Physician).filter(Physician.npi.in_(physician_npis)).all()
    } if physician_npis else {}

    result = []
    for case, notif in cases:
        days = _days_remaining(case.response_due_date)
        phys = physicians_by_npi.get(case.physician_npi)
        result.append({
            "case_id":                       case.case_id,
            "claim_number":                  notif.claim_ccn or notif.claim_number,
            "dispute_type":                  case.dispute_type,
            "status":                        case.status,
            "opened_at":                     case.opened_at.isoformat() if case.opened_at else None,
            "response_due_date":             case.response_due_date.isoformat() if case.response_due_date else None,
            "days_remaining":                days,
            "deadline_passed":               days < 0,
            "physician_notes":               case.physician_notes,
            "vendor_response":               case.vendor_response,
            "vendor_responded_at":           case.vendor_responded_at.isoformat() if case.vendor_responded_at else None,
            "provider_response_type":        case.provider_response_type,
            "vendor_docs":                   case.vendor_docs or [],
            "billing_provider_notified_at":  case.billing_provider_notified_at.isoformat() if case.billing_provider_notified_at else None,
            "closed_at":                     case.closed_at.isoformat() if case.closed_at else None,
            "escalation_unlocked":           case.escalation_unlocked,
            "physician_confirmation_due_date": case.physician_confirmation_due_date.isoformat() if case.physician_confirmation_due_date else None,
            "claim": {
                "claim_number":         notif.claim_ccn or notif.claim_number,
                "patient_name_partial": notif.patient_name_partial,
                "dos_from":             str(notif.dos_from) if notif.dos_from else None,
                "dos_to":               str(notif.dos_to)   if notif.dos_to   else None,
                "service_description":  notif.service_description,
                "hcpcs_codes":          notif.hcpcs_codes,
                "amount_billed":        float(notif.amount_billed) if notif.amount_billed else None,
                "amount_paid":          float(notif.amount_paid)   if notif.amount_paid   else None,
                "physician_npi_role":   notif.physician_npi_role,
                "physician_npi":        case.physician_npi,
                "physician_name":       f"{phys.first_name} {phys.last_name}".strip() if phys and (phys.first_name or phys.last_name) else None,
                "physician_practice":   phys.practice_name if phys else None,
            },
        })
    return {"disputes": result}


# ---------------------------------------------------------------------------
# GET /api/v1/vendor/portal/stats
# ---------------------------------------------------------------------------

@router.get("/portal/stats")
def portal_stats(request: Request, db: Session = Depends(get_db)):
    user = _require_vendor(request, db)
    escalate_overdue_disputes(db)
    escalate_unconfirmed_physician_resolutions(db)

    rows = (
        db.query(ClaimNotification.status)
        .filter(ClaimNotification.vendor_npi == user.npi)
        .all()
    )
    total     = len(rows)
    confirmed = sum(1 for (s,) in rows if s == "CONFIRMED")
    confirmed_rate = round(confirmed / total * 100, 1) if total > 0 else 0.0

    open_disputes = (
        db.query(DisputeCase)
        .filter(DisputeCase.vendor_npi == user.npi, DisputeCase.status == "OPEN")
        .count()
    )
    # Escalation above already flips overdue OPEN cases to NON_RESPONSIVE, so
    # "overdue" is now just that bucket rather than a live date comparison.
    overdue_disputes = (
        db.query(DisputeCase)
        .filter(DisputeCase.vendor_npi == user.npi, DisputeCase.status == "NON_RESPONSIVE")
        .count()
    )

    profile = (
        db.query(SupplierProfile)
        .filter(SupplierProfile.npi == user.npi)
        .first()
    )

    return {
        "total_claims":     total,
        "confirmed_rate":   confirmed_rate,
        "open_disputes":    open_disputes,
        "overdue_disputes": overdue_disputes,
        "trust_score":      confirmed_rate,
        "vendor_name":      profile.supplier_name if profile else None,
        "vendor_type":      profile.supplier_type if profile else None,
        "vendor_city":      profile.city if profile else None,
        "vendor_state":     profile.state if profile else None,
        "contact_name":     profile.contact_name if profile else None,
        "contact_email":    profile.contact_email if profile else None,
    }


# ---------------------------------------------------------------------------
# POST /api/v1/vendor/portal/disputes/{case_id}/respond  (session-auth)
# ---------------------------------------------------------------------------

@router.post("/portal/disputes/{case_id}/respond")
async def portal_respond(
    case_id: int,
    request: Request,
    response_type:   str           = Form(...),
    vendor_response: str           = Form(""),
    docs:            List[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
):
    user = _require_vendor(request, db)
    escalate_unconfirmed_physician_resolutions(db)

    case = db.query(DisputeCase).filter(DisputeCase.case_id == case_id).first()
    if not case:
        return JSONResponse(status_code=404, content={"error": "not_found", "message": "Dispute case not found."})

    if user.npi != case.vendor_npi:
        return JSONResponse(status_code=403, content={"error": "forbidden", "message": "This dispute does not belong to your account."})

    if case.status != "OPEN":
        return JSONResponse(
            status_code=409,
            content={"error": "already_resolved", "message": "This dispute has already been responded to."},
        )

    days = _days_remaining(case.response_due_date)
    if days < 0:
        return JSONResponse(
            status_code=410,
            content={"error": "deadline_passed", "message": "The 15-day response window has closed."},
        )

    type_err = _validate_response_type(case, response_type)
    if type_err:
        return type_err

    try:
        saved_docs = await _save_dispute_docs(case_id, docs)
    except ValueError as exc:
        return JSONResponse(status_code=400, content={"error": "bad_file", "message": str(exc)})

    new_status = _RESPONSE_TYPE_TO_STATUS[response_type]
    case.vendor_response        = vendor_response
    case.provider_response_type = _RESPONSE_TYPE_TO_PROVIDER_TYPE[response_type]
    case.vendor_responded_at    = datetime.utcnow()
    case.status                 = new_status
    if new_status == "PENDING_PHYSICIAN_CONFIRMATION":
        case.physician_confirmation_due_date = datetime.utcnow() + timedelta(days=PHYSICIAN_CONFIRMATION_WINDOW_DAYS)
    if saved_docs:
        case.vendor_docs = (case.vendor_docs or []) + saved_docs
    db.commit()
    db.refresh(case)

    return {
        "success": True,
        "status":  case.status,
        "docs":    case.vendor_docs or [],
        "message": (
            "Your response has been recorded. The physician has "
            f"{PHYSICIAN_CONFIRMATION_WINDOW_DAYS} days to confirm it's resolved."
            if new_status == "PENDING_PHYSICIAN_CONFIRMATION"
            else "Your response has been recorded."
        ),
    }
