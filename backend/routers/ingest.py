"""
Payer claim ingest endpoint — the real-time entry point for new claims.
POST /api/v1/claims/ingest/single

Full pipeline per claim (same treatment the seeded data got, live):
  1. Live OIG LEIE check — vendor_npi against oig_excluded_npis (indexed PK
     lookup) with a case-insensitive vendor_name fallback against
     oig_excluded_names. A hit stamps Claim.oig_flagged and syncs
     supplier_profiles.oig_excluded.
  2. Insert a real claims-table row (when the payload carries the full claim
     fields), auto-creating minimal supplier_profiles / npi_profiles rows for
     first-seen vendors/NPIs so scoring and the watchlist pick them up.
  3. Create CLAIM_NOTIFICATION rows for registered physicians (linked to the
     new claim row) and send them notification emails.
  4. Schedule a debounced background refresh of the rules engine + risk scores
     (see backend/rules/refresh.py) so leaderboard/watchlist reflect the new
     claim without blocking the ingest response.

Backwards compatible: a minimal payload (no patient/category/amount block)
still does notifications-only, exactly like the old endpoint — the response
says explicitly whether a claim row was created and why not.
"""

import logging
import uuid as _uuid
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy import func
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import (
    Claim, NpiProfile, OigExcludedName, OigExcludedNpi, Physician, SupplierProfile,
)
from backend.rules.refresh import refresh_fraud_analytics
from backend.rules.trigger_engine import process_incoming_claim, _mask_patient_name
from backend.utils.email import send_claim_notification_email
from backend.config import get_settings

router = APIRouter(prefix="/api/v1/claims", tags=["ingest"])
log = logging.getLogger("routers.ingest")

VALID_CATEGORIES = {"home_health", "hospice", "dme", "drugs", "hospital"}
# vendor_type → service_category default when the payload doesn't say explicitly
_VENDOR_TYPE_CATEGORY = {"DME": "dme", "HOME_HEALTH": "home_health", "HOSPICE": "hospice"}


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
    # ── full-claim fields (claims-table row) ──
    patient_id:          Optional[str]        = None
    patient_name:        Optional[str]        = None
    patient_zip:         Optional[str]        = None
    patient_state:       Optional[str]        = None   # 2-letter
    patient_lat:         Optional[float]      = None
    patient_lng:         Optional[float]      = None
    service_category:    Optional[str]        = None   # home_health|hospice|dme|drugs|hospital
    cpt_code:            Optional[str]        = None
    vendor_id:           Optional[str]        = None   # supplier entity key; defaults to vendor_npi
    vendor_zip:          Optional[str]        = None
    vendor_state:        Optional[str]        = None
    plan_name:           Optional[str]        = None
    contact_email:       Optional[str]        = None
    contact_name:        Optional[str]        = None
    contact_phone:       Optional[str]        = None


def check_oig_exclusion(db: Session, vendor_npi: Optional[str], vendor_name: Optional[str]) -> bool:
    """Live OIG LEIE lookup — primary-key match on the vendor's NPI, then a
    case-insensitive exact match on the entity name. Both are single indexed
    lookups, safe to run inline on every ingested claim."""
    if vendor_npi:
        if db.query(OigExcludedNpi.npi).filter(OigExcludedNpi.npi == vendor_npi).first():
            return True
    if vendor_name:
        needle = vendor_name.strip().lower()
        if needle and db.query(OigExcludedName.id).filter(
            func.lower(func.trim(OigExcludedName.entity_name)) == needle
        ).first():
            return True
    return False


def _resolve_category(body: ClaimIngestRequest) -> Optional[str]:
    if body.service_category:
        cat = body.service_category.strip().lower()
        return cat if cat in VALID_CATEGORIES else None
    if body.vendor_type:
        return _VENDOR_TYPE_CATEGORY.get(body.vendor_type.strip().upper())
    return None


def _missing_claim_fields(body: ClaimIngestRequest, npi: Optional[str], category: Optional[str]) -> list:
    """Which NOT NULL claims-table fields the payload can't satisfy."""
    missing = []
    if not npi:                              missing.append("a physician NPI (npi_ordering/referring/certifying/attending)")
    if not (body.patient_id or body.patient_mbi): missing.append("patient_id (or patient_mbi)")
    if not body.patient_name:                missing.append("patient_name")
    if not body.patient_zip:                 missing.append("patient_zip")
    if not (body.patient_state and len(body.patient_state.strip()) == 2): missing.append("patient_state (2-letter)")
    if not body.dos_from:                    missing.append("dos_from")
    if not body.service_description:         missing.append("service_description")
    if not category:                         missing.append("service_category (or a mappable vendor_type)")
    if body.amount_billed is None or body.amount_billed < 0: missing.append("amount_billed (>= 0)")
    if not (body.vendor_id or body.vendor_npi): missing.append("vendor_id (or vendor_npi)")
    if not body.vendor_name:                 missing.append("vendor_name")
    return missing


def _sync_supplier_profile(db: Session, body: ClaimIngestRequest, oig_hit: bool) -> None:
    """First-seen vendors get a supplier_profiles row (so vendor emails and the
    watchlist have contact/identity data); an OIG hit flips oig_excluded on
    new AND existing rows."""
    if not body.vendor_npi:
        return
    supplier = db.query(SupplierProfile).filter(SupplierProfile.npi == body.vendor_npi).first()
    if not supplier:
        supplier = SupplierProfile(
            npi=body.vendor_npi,
            supplier_name=body.vendor_name,
            supplier_type=body.vendor_type,
            state=body.vendor_state,
            zip=body.vendor_zip,
            contact_email=body.contact_email,
            contact_name=body.contact_name,
            contact_phone=body.contact_phone,
            oig_excluded=oig_hit,
            npi_watch_registered=bool(body.contact_email),
            is_synthetic=False,
        )
        db.add(supplier)
    elif oig_hit and not supplier.oig_excluded:
        supplier.oig_excluded = True


def _ensure_npi_profile(db: Session, npi: str) -> None:
    """The scorer only covers NPIs present in npi_profiles — auto-create a
    minimal row for first-seen NPIs so a real-time claim's physician doesn't
    silently fall out of the leaderboard."""
    if not db.query(NpiProfile.npi).filter(NpiProfile.npi == npi).first():
        db.add(NpiProfile(npi=npi, physician_name=f"NPI {npi}"))


@router.post("/ingest/single")
def ingest_single_claim(body: ClaimIngestRequest, background_tasks: BackgroundTasks,
                        db: Session = Depends(get_db)):
    settings = get_settings()

    claim_npi = body.npi_ordering or body.npi_referring or body.npi_certifying or body.npi_attending
    category = _resolve_category(body)

    # ── 1. Live OIG check (always runs — feeds both the claim stamp and the
    #       supplier-profile sync, even in notifications-only mode) ──
    oig_hit = check_oig_exclusion(db, body.vendor_npi, body.vendor_name)
    _sync_supplier_profile(db, body, oig_hit)

    # ── 2. Real claims-table row (full payloads only) ──
    claim_row = None
    missing = _missing_claim_fields(body, claim_npi, category)
    if not missing:
        _ensure_npi_profile(db, claim_npi)
        claim_row = Claim(
            id=_uuid.uuid4(),
            npi=claim_npi,
            patient_id=body.patient_id or body.patient_mbi,
            patient_name=body.patient_name,
            patient_zip=body.patient_zip,
            patient_state=body.patient_state.strip().upper(),
            patient_lat=body.patient_lat,
            patient_lng=body.patient_lng,
            date_of_service=body.dos_from,
            cpt_code=body.cpt_code,
            hcpcs_code=(body.hcpcs_codes or [None])[0],
            service_description=body.service_description,
            service_category=category,
            vendor_name=body.vendor_name,
            vendor_id=body.vendor_id or body.vendor_npi,
            vendor_zip=body.vendor_zip,
            vendor_state=(body.vendor_state or "").strip().upper()[:2] or None,
            claim_amount=body.amount_billed,
            plan_name=body.plan_name or "Medicare",
            oig_flagged=oig_hit,
            reviewed=False,
            vendor_npi=body.vendor_npi,
            vendor_type=body.vendor_type,
            contact_email=body.contact_email,
            contact_name=body.contact_name,
            contact_phone=body.contact_phone,
        )
        db.add(claim_row)

    db.commit()
    if claim_row:
        db.refresh(claim_row)

    # ── 3. Physician notifications (linked to the claim row when one exists) ──
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
        "patient_name_partial": body.patient_name_partial
                                or (_mask_patient_name(body.patient_name) if body.patient_name else None),
        "dos_from":            body.dos_from,
        "dos_to":              body.dos_to,
        "service_description": body.service_description,
        "hcpcs_codes":         body.hcpcs_codes,
        "amount_billed":       body.amount_billed,
        "amount_paid":         body.amount_paid,
        "claim_row_id":        claim_row.id if claim_row else None,
        "claim_ccn":           claim_row.ccn if claim_row else None,
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

    # ── 4. Debounced fraud-analytics refresh (rules + scores) ──
    if claim_row:
        background_tasks.add_task(refresh_fraud_analytics)

    return {
        "claim_created":     claim_row is not None,
        "claim_id":          str(claim_row.id) if claim_row else None,
        "claim_ccn":         claim_row.ccn if claim_row else None,
        "oig_flagged":       oig_hit,
        "analytics_refresh": "scheduled" if claim_row else "skipped",
        "claim_skipped_reason": (
            None if not missing
            else f"claims-table row not created — missing: {', '.join(missing)}"
        ),
        "notifications": results,
        "count":         len(results),
        "note": (
            None if results
            else "No registered physicians matched the NPIs in this claim"
        ),
    }
