"""
Payer claim ingest endpoint.
POST /api/v1/claims/ingest/single

Receives a synthetic claim payload (no 835 parsing), calls process_incoming_claim()
to create CLAIM_NOTIFICATION rows for any matching registered physicians, then fires
send_claim_notification_email() for each. Public — no JWT required.
"""

import logging
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Physician
from backend.rules.trigger_engine import process_incoming_claim
from backend.utils.email import send_claim_notification_email
from backend.config import get_settings

router = APIRouter(prefix="/api/v1/claims", tags=["ingest"])
log = logging.getLogger("routers.ingest")


class ClaimIngestRequest(BaseModel):
    claim_number:        str
    npi_ordering:        Optional[str]        = None
    npi_referring:       Optional[str]        = None
    npi_certifying:      Optional[str]        = None
    npi_attending:       Optional[str]        = None
    vendor_npi:          Optional[str]        = None
    vendor_name:         Optional[str]        = None
    vendor_type:         Optional[str]        = None   # DME | HOME_HEALTH | HOSPICE
    patient_mbi:         Optional[str]        = None
    patient_name_partial: Optional[str]       = None
    dos_from:            Optional[date]       = None
    dos_to:              Optional[date]       = None
    service_description: Optional[str]        = None
    hcpcs_codes:         Optional[List[str]]  = None
    amount_billed:       Optional[float]      = None
    amount_paid:         Optional[float]      = None


@router.post("/ingest/single")
def ingest_single_claim(body: ClaimIngestRequest, db: Session = Depends(get_db)):
    settings = get_settings()

    # Map ingest field names → trigger_engine field names
    claim_dict = {
        "claim_number":        body.claim_number,
        "ordering_npi":        body.npi_ordering,
        "referring_npi":       body.npi_referring,
        "certifying_npi":      body.npi_certifying,
        "attending_npi":       body.npi_attending,
        "vendor_npi":          body.vendor_npi,
        "vendor_name":         body.vendor_name,
        "vendor_type":         body.vendor_type,
        "patient_mbi":         body.patient_mbi,
        "patient_name_partial": body.patient_name_partial,
        "dos_from":            body.dos_from,
        "dos_to":              body.dos_to,
        "service_description": body.service_description,
        "hcpcs_codes":         body.hcpcs_codes,
        "amount_billed":       body.amount_billed,
        "amount_paid":         body.amount_paid,
    }

    notifications = process_incoming_claim(claim_dict, db)

    results = []
    for n in notifications:
        physician = db.query(Physician).filter(Physician.npi == n.physician_npi).first()
        if physician and physician.email_primary:
            try:
                send_claim_notification_email(n, physician, settings.base_url, db)
            except Exception as exc:
                log.error(f"Email failed for notification {n.notification_id}: {exc}")
        results.append({
            "notification_id":    n.notification_id,
            "physician_npi":      n.physician_npi,
            "physician_npi_role": n.physician_npi_role,
            "response_token":     n.response_token,
            "status":             n.status,
        })

    return {
        "notifications": results,
        "count":         len(results),
        "note": (
            None if results
            else "No registered physicians matched the NPIs in this claim"
        ),
    }
