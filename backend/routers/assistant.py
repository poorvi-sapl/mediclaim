"""POST /plan/assistant — the payer portal's chat assistant.

Deliberately mounted under /plan: main.py's AuthMiddleware requires the
plan_investigator role for that prefix, so this endpoint — which can read across
the whole plan's data — inherits the same guard as every other payer route. It is
kept out of /analytics because that prefix has no role requirement.

Two guardrails live here rather than in the agent, because they're about who is
asking rather than what the answer is:

  * a per-investigator rate limit, so one session can't run up an API bill
  * an audit line per question: who asked what, which tools ran, what came back.
    In a fraud tool the assistant's answers get quoted into investigations, so
    there has to be a record of what was asked and what data produced the answer.
"""

import json
import logging
import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.chat_agent import answer, stream
from backend.database import SessionLocal, get_db
from backend.routers.dashboard import _investigator_email

router = APIRouter()
log = logging.getLogger("assistant")
audit = logging.getLogger("assistant.audit")

MAX_QUESTION_CHARS = 1000

# Rate limit: a generous ceiling meant to catch a stuck retry loop or a script, not
# to ration normal use — an investigator working hard might ask 10 questions in a
# few minutes. In-memory and therefore per-process: with several AWS containers the
# effective limit is per-container, which is fine for abuse protection but would
# need Redis to be exact.
RATE_LIMIT_WINDOW_SECONDS = 60
RATE_LIMIT_MAX_QUESTIONS = 20
_recent: dict[str, deque] = defaultdict(deque)


def _rate_limited(who: str) -> bool:
    now = time.monotonic()
    hits = _recent[who]
    while hits and now - hits[0] > RATE_LIMIT_WINDOW_SECONDS:
        hits.popleft()
    if len(hits) >= RATE_LIMIT_MAX_QUESTIONS:
        return True
    hits.append(now)
    return False


_TOO_MANY = JSONResponse(status_code=429, content={
    "error": "rate_limited",
    "message": ("That's a lot of questions in a short time — give it a minute and try again."),
})


class AssistantTurn(BaseModel):
    role: str
    content: str


class AssistantRequest(BaseModel):
    question: str = Field(..., max_length=MAX_QUESTION_CHARS)
    history: list[AssistantTurn] = []


def _audit(who: str, question: str, result: dict) -> None:
    """One line per answered question. Deliberately via the logger rather than a
    table: no migration, and on AWS stdout already goes to CloudWatch. Move it to a
    table if the audit trail ever needs to be queryable in-app."""
    audit.info(json.dumps({
        "investigator": who,
        "question": question[:MAX_QUESTION_CHARS],
        "tools_used": result.get("tools_used") or [],
        "entities": [f"{e['type']}:{e['id']}" for e in (result.get("entities") or [])],
        "error": result.get("error"),
        "answer_chars": len(result.get("answer") or ""),
    }))


@router.post("/plan/assistant")
def plan_assistant(body: AssistantRequest, request: Request, db: Session = Depends(get_db)):
    """Answer one payer question about the plan's data, its fraud patterns, or how
    the product works.

    Always 200 (except rate limiting) — a failure the payer can act on, like a
    missing API key, comes back as {error, message} in the body so the chat panel
    renders it as a message instead of a broken request.
    """
    who = _investigator_email(request) or "unknown"
    if _rate_limited(who):
        return _TOO_MANY

    result = answer(db, body.question, [t.model_dump() for t in body.history])
    _audit(who, body.question, result)
    if result.get("error"):
        log.info(f"assistant declined: {result['error']}")
    return result


@router.post("/plan/assistant/stream")
def plan_assistant_stream(body: AssistantRequest, request: Request):
    """Same answer, streamed as it's produced.

    Emits a `status` event per tool call before that tool runs, then one terminal
    `answer` or `error` event — so the payer sees which data is being read instead of
    a spinner. The status lines are generated from the calls that actually executed,
    which makes the trail an audit record rather than narration.

    Sync generator on purpose: FastAPI runs it in a threadpool, so the blocking DB
    and OpenAI calls behave exactly as they do everywhere else in this codebase and
    no async DB session is needed. The session is opened inside the generator rather
    than injected — a Depends(get_db) session can be closed before a streaming body
    finishes producing.
    """
    who = _investigator_email(request) or "unknown"
    if _rate_limited(who):
        return _TOO_MANY

    history = [t.model_dump() for t in body.history]

    def events():
        db = SessionLocal()
        trail: list[dict] = []
        terminal: dict = {}
        try:
            for event in stream(db, body.question, history):
                if event.get("type") == "status":
                    trail.append(event)
                else:
                    terminal = event
                yield f"data: {json.dumps(event, default=str)}\n\n"
        except Exception as e:                       # never leave the client hanging
            log.warning(f"assistant stream failed: {e}")
            terminal = {"error": "stream_failed"}
            yield f'data: {json.dumps({"type": "error", "error": "stream_failed", "message": "The assistant stopped unexpectedly. Try again."})}\n\n'
        finally:
            # Audited here so a streamed answer leaves the same record as a
            # non-streamed one, even if the client disconnected early.
            _audit(who, body.question, {**terminal, "tools_used": terminal.get("tools_used")
                                        or [s.get("text") for s in trail]})
            db.close()

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            # Without this nginx buffers the whole response and it arrives at once.
            "X-Accel-Buffering": "no",
        },
    )
