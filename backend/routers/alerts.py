import json
import asyncio

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Action, NpiProfile
from backend.sse import broker

router = APIRouter()

FLAG_ACTIONS = ("flag_supplier", "unknown_patient")


@router.get("/plan/alerts/stream")
async def alert_stream(db: Session = Depends(get_db)):

    async def event_generator():
        # Step 1: replay unbroadcast flag actions on connect (chronological)
        unbroadcast = (
            db.query(Action)
            .filter(Action.broadcast.is_(False),
                    Action.action_type.in_(FLAG_ACTIONS))
            .order_by(Action.created_at.asc())
            .all()
        )
        for action in unbroadcast:
            profile = (
                db.query(NpiProfile)
                .filter(NpiProfile.npi == action.npi).first()
            )
            is_escalation = action.action_type == "did_not_order"
            event = {
                "id": str(action.id),
                "action_type": action.action_type,
                "physician_name": profile.physician_name if profile else action.npi,
                "npi": action.npi,
                "supplier_name": action.supplier_name,
                "patient_name": action.patient_name,
                "claim_amount": float(action.claim_amount),
                "timestamp": action.created_at.isoformat(),
                "escalation": is_escalation,
                "escalation_label": "PHYSICIAN DENIAL" if is_escalation else None,
            }
            yield f"data: {json.dumps(event)}\n\n"
            action.broadcast = True
        db.commit()

        # Step 2: subscribe to the broker and stream live events
        queue = await broker.subscribe()
        try:
            while True:
                try:
                    message = await asyncio.wait_for(queue.get(), timeout=15.0)
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
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
