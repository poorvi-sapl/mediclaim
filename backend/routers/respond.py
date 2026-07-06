"""
Public one-click response endpoint for NPI Watch physician emails.
GET /api/v1/respond?token=<jwt>&action=CONFIRM|DISPUTE|FRAUD_REPORT

No JWT auth — the signed response token IS the authentication.
Returns clean HTML in all cases (valid, expired, invalid, already responded).
"""

import logging

from fastapi import APIRouter, Depends, Query
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.utils.tokens import decode_response_token
from backend.rules.trigger_engine import respond_to_notification

router = APIRouter(prefix="/api/v1", tags=["respond"])
log = logging.getLogger("routers.respond")

_VALID_ACTIONS = {"CONFIRM", "DISPUTE", "FRAUD_REPORT"}

# ---------------------------------------------------------------------------
# HTML templates
# ---------------------------------------------------------------------------

_STYLE = (
    "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;"
    "max-width: 600px; margin: 80px auto; padding: 32px;"
    "border: 1px solid #e5e7eb; border-radius: 8px;"
)

_EXPIRED_HTML = f"""<!DOCTYPE html>
<html><head><title>Link Expired</title></head>
<body><div style="{_STYLE}">
  <h2 style="color:#6b7280;">Link Expired</h2>
  <p>This link has expired. Please log in to your portal to respond.</p>
</div></body></html>"""

_INVALID_HTML = f"""<!DOCTYPE html>
<html><head><title>Invalid Link</title></head>
<body><div style="{_STYLE}">
  <h2 style="color:#6b7280;">Invalid Link</h2>
  <p>This link is invalid or has already been used. Please log in to your portal.</p>
</div></body></html>"""

_DISPUTE_HTML = f"""<!DOCTYPE html>
<html><head><title>Dispute Submitted</title></head>
<body><div style="{_STYLE}">
  <h2 style="color:#d97706;">Dispute Submitted</h2>
  <p>Your dispute has been submitted. The billing provider has been notified
     and has 15 days to respond.</p>
  <p>You will be contacted if additional information is needed.</p>
</div></body></html>"""

_FRAUD_HTML = f"""<!DOCTYPE html>
<html><head><title>Fraud Report Submitted</title></head>
<body><div style="{_STYLE}">
  <h2 style="color:#dc2626;">Fraud Report Submitted</h2>
  <p>Your fraud report has been submitted. This case has been escalated
     to our compliance team.</p>
  <p>Our team will review this matter and may contact you for additional details.</p>
</div></body></html>"""


def _confirm_html(claim_number: str) -> str:
    return (
        f'<!DOCTYPE html><html><head><title>Confirmation Recorded</title></head>'
        f'<body><div style="{_STYLE}">'
        f'<h2 style="color:#16a34a;">Confirmation Recorded</h2>'
        f'<p>Thank you. Your confirmation has been recorded for claim '
        f'<strong>{claim_number}</strong>.</p>'
        f'<p>No further action is required.</p>'
        f'</div></body></html>'
    )


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.get("/respond", response_class=HTMLResponse)
def respond_to_claim(
    token:  str = Query(..., description="Signed response token from the alert email"),
    action: str = Query(..., description="CONFIRM | DISPUTE | FRAUD_REPORT"),
    notes:  str = Query(None, max_length=1000, description="Optional physician note (DISPUTE / FRAUD_REPORT only)"),
    db: Session = Depends(get_db),
):
    # 1. Decode token
    try:
        payload = decode_response_token(token)
    except ValueError as exc:
        if "expired" in str(exc).lower():
            return HTMLResponse(content=_EXPIRED_HTML, status_code=200)
        log.warning(f"Invalid response token: {exc}")
        return HTMLResponse(content=_INVALID_HTML, status_code=200)

    # 2. Validate action
    action = action.upper()
    if action not in _VALID_ACTIONS:
        return HTMLResponse(
            content=(
                f'<!DOCTYPE html><html><body style="{_STYLE}">'
                f'<p>Invalid action <strong>{action}</strong>. '
                f'Must be one of: {", ".join(sorted(_VALID_ACTIONS))}</p>'
                f'</body></html>'
            ),
            status_code=400,
        )

    # 3. Record response
    notification_id = payload["notification_id"]
    try:
        notification = respond_to_notification(notification_id, action, db, notes=notes)
    except ValueError as exc:
        log.error(f"respond_to_notification({notification_id}, {action}): {exc}")
        return HTMLResponse(content=_INVALID_HTML, status_code=200)

    claim_number = notification.claim_ccn or notification.claim_number or str(notification_id)

    # 4. Return confirmation HTML
    if action == "CONFIRM":
        return HTMLResponse(content=_confirm_html(claim_number), status_code=200)
    if action == "DISPUTE":
        return HTMLResponse(content=_DISPUTE_HTML, status_code=200)
    return HTMLResponse(content=_FRAUD_HTML, status_code=200)
