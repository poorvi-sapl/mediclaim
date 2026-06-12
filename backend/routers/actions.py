import uuid
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from jose import JWTError
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Claim, Action, NpiProfile, NpiRiskScore
from backend.schemas import ActionRequest, ActionResponse
from backend.config import get_settings
from backend.scoring.risk_score import (
    increment_supplier_flag_count, calculate_npi_scores, calculate_supplier_scores,
)
from backend.sse import broadcast_alert
from backend.auth import extract_token, decode_token, is_blacklisted

router = APIRouter()
log = logging.getLogger("routers.actions")


def _claims(request: Request) -> dict:
    """Decode the requesting user's token (npi / role / email)."""
    token = extract_token(request)
    if not token or is_blacklisted(token):
        raise HTTPException(status_code=401, detail={"error": "Not authenticated", "code": "NO_TOKEN"})
    try:
        return decode_token(token)
    except JWTError:
        raise HTTPException(status_code=401, detail={"error": "Invalid or expired token", "code": "INVALID_TOKEN"})


def _decrement_supplier(db: Session, supplier_id: str, settings) -> None:
    """Exact inverse of increment_supplier_flag_count (forward action) — O(1)."""
    row = (db.query(NpiRiskScore)
           .filter_by(entity_type="supplier", entity_id=supplier_id).first())
    if not row:
        return
    row.physician_flag_count = max(0, (row.physician_flag_count or 0) - 1)
    row.risk_score = max(0, (row.risk_score or 0) - settings.weight_per_physician_flag)
    row.last_calculated = datetime.utcnow()
    db.commit()

VALID_ACTION_TYPES = {"confirm", "dispute", "flag_supplier", "unknown_patient",
                      "did_not_order"}
ALERT_ACTION_TYPES = {"flag_supplier", "unknown_patient", "did_not_order"}
ESCALATION_ACTION_TYPES = {"did_not_order"}


@router.post("/actions", response_model=ActionResponse, status_code=201)
def create_action(payload: ActionRequest, db: Session = Depends(get_db)):
    settings = get_settings()

    # --- validation ---
    if len(payload.npi) != 10 or not payload.npi.isdigit():
        raise HTTPException(status_code=422, detail={
            "error": "NPI must be exactly 10 digits", "code": "INVALID_NPI_FORMAT"})

    if payload.action_type not in VALID_ACTION_TYPES:
        raise HTTPException(status_code=422, detail={
            "error": f"Invalid action_type '{payload.action_type}'",
            "code": "INVALID_ACTION_TYPE"})

    try:
        claim_uuid = uuid.UUID(payload.claim_id)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=422, detail={
            "error": "claim_id is not a valid UUID", "code": "INVALID_UUID"})

    claim = db.query(Claim).filter(Claim.id == claim_uuid).first()
    if not claim:
        raise HTTPException(status_code=404, detail={
            "error": "Claim not found", "code": "CLAIM_NOT_FOUND"})

    # --- record action + mark claim reviewed ---
    action = Action(
        claim_id=claim.id,
        npi=payload.npi,
        action_type=payload.action_type,
        note=payload.note,
        supplier_id=claim.supplier_id,
        supplier_name=claim.supplier_name,
        patient_name=claim.patient_name,
        claim_amount=claim.claim_amount,
        broadcast=False,
    )
    try:
        db.add(action)
        claim.reviewed = True
        db.commit()
        db.refresh(action)
    except Exception as e:
        db.rollback()
        log.error(f"POST /actions DB failure: {e}")
        raise HTTPException(status_code=503, detail={
            "error": "Transaction failed — action not recorded", "code": "DB_ERROR"})

    # --- supplier risk bump for flag_supplier / unknown_patient / did_not_order ---
    if payload.action_type in ALERT_ACTION_TYPES:
        # bump supplier risk score (no-op if no score row)
        try:
            increment_supplier_flag_count(db, claim.supplier_id, settings)
        except Exception as e:
            log.error(f"increment_supplier_flag_count failed: {e}")

    # Broadcast EVERY action to the payer live feed (confirm/dispute included), with
    # supplier_npi so the feed can deep-link to the supplier case. (supplier_id is the
    # supplier's NPI string.)
    physician = (
        db.query(NpiProfile.physician_name)
        .filter(NpiProfile.npi == payload.npi).first()
    )
    physician_name = physician[0] if physician else payload.npi

    is_escalation = payload.action_type in ESCALATION_ACTION_TYPES
    broadcast_alert({
        "id": str(action.id),
        "action_type": action.action_type,
        "physician_name": physician_name,
        "npi": payload.npi,
        "supplier_name": claim.supplier_name,
        "supplier_npi": claim.supplier_id,
        "patient_name": claim.patient_name,
        "claim_amount": float(claim.claim_amount),
        "timestamp": action.created_at.isoformat(),
        "escalation": is_escalation,
        "escalation_label": "PHYSICIAN DENIAL" if is_escalation else None,
    })

    return ActionResponse(
        id=str(action.id),
        action_type=action.action_type,
        created_at=action.created_at,
    )


@router.delete("/actions/{action_id}")
def undo_action(action_id: str, request: Request, db: Session = Depends(get_db)):
    """Reverse a physician action. Restores the claim to unreviewed, reverses the score
    side-effect, re-scores the NPI, and broadcasts an SSE reversal alert."""
    settings = get_settings()
    claims = _claims(request)
    if claims.get("role") != "physician":
        raise HTTPException(status_code=403, detail={
            "error": "Only physicians can undo actions", "code": "FORBIDDEN"})
    try:
        aid = uuid.UUID(action_id)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=422, detail={
            "error": "action_id is not a valid UUID", "code": "INVALID_UUID"})

    action = db.query(Action).filter(Action.id == aid).first()
    if not action:
        raise HTTPException(status_code=404, detail={
            "error": "Action not found", "code": "ACTION_NOT_FOUND"})
    if action.npi != claims.get("npi"):
        raise HTTPException(status_code=403, detail={
            "error": "You can only undo your own actions", "code": "NOT_OWNER"})

    # Undo window: 24 hours for dispute, 60 seconds for all other actions.
    undo_window = 86400 if action.action_type == "dispute" else 60
    if (datetime.utcnow() - action.created_at).total_seconds() > undo_window:
        raise HTTPException(status_code=403, detail={
            "error": "undo_expired",
            "message": "Undo window has closed. This action is now permanent.",
            "code": "UNDO_EXPIRED"})

    claim_id = str(action.claim_id)
    supplier_id = action.supplier_id
    action_type = action.action_type
    npi = action.npi

    # Delete the action and return the claim to unreviewed.
    db.delete(action)
    claim = db.query(Claim).filter(Claim.id == action.claim_id).first()
    if claim:
        claim.reviewed = False
    db.commit()

    # Reverse the scoring: undo the supplier bump (mirror of create), then re-score NPIs
    # so the physician's risk score drops on the payer leaderboard.
    if action_type in ALERT_ACTION_TYPES:
        try:
            _decrement_supplier(db, supplier_id, settings)
        except Exception as e:
            log.error(f"undo: supplier decrement failed: {e}")
    try:
        calculate_npi_scores(db, settings)
    except Exception as e:
        log.error(f"undo: re-score failed: {e}")

    # Broadcast the reversal to the payer live feed.
    physician = db.query(NpiProfile.physician_name).filter(NpiProfile.npi == npi).first()
    physician_name = physician[0] if physician else npi
    broadcast_alert({
        "id": str(uuid.uuid4()),
        "action_type": "action_undone",
        "physician_name": physician_name,
        "npi": npi,
        "message": f"Physician reversed a flag on NPI {npi}",
        "timestamp": datetime.utcnow().isoformat(),
    })
    return {"undone": True, "claim_id": claim_id}


# DEMO ONLY — remove for production.
@router.post("/physician/reset-actions")
def reset_actions(request: Request, db: Session = Depends(get_db)):
    """Clear ALL of the requesting physician's actions and re-score — one-call demo reset."""
    settings = get_settings()
    claims = _claims(request)
    if not (claims.get("email") or "").lower().endswith("@mediclaim.com"):
        raise HTTPException(status_code=403, detail={
            "error": "Demo reset not available", "code": "NOT_DEMO_ACCOUNT"})
    npi = claims.get("npi")

    actions = db.query(Action).filter(Action.npi == npi).all()
    count = len(actions)
    claim_ids = {a.claim_id for a in actions}
    for a in actions:
        db.delete(a)
    if claim_ids:
        db.query(Claim).filter(Claim.id.in_(claim_ids)).update(
            {Claim.reviewed: False}, synchronize_session=False)
    db.commit()

    try:
        calculate_npi_scores(db, settings)
        calculate_supplier_scores(db, settings)
    except Exception as e:
        log.error(f"reset-actions: re-score failed: {e}")
    return {"reset": True, "actions_cleared": count}
