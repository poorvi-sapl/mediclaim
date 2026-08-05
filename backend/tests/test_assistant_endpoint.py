"""POST /plan/assistant — contract and auth, without spending OpenAI calls.

The agent's answer quality is checked by scripts/verify_assistant.py, which needs a
live model. What matters here is the wiring nobody would notice breaking: the route
is mounted, it's behind the payer role guard, and it validates input.
"""

import json

import pytest
from fastapi.testclient import TestClient

from backend.auth import create_access_token
from backend.main import app

client = TestClient(app)

PAYER = {"Authorization": f"Bearer {create_access_token(email='assistant_test@mediclaim.com', role='plan_investigator', npi=None, full_name='Assistant Test', expires_hours=1)}"}
PHYSICIAN = {"Authorization": f"Bearer {create_access_token(email='assistant_phys@internal.test', role='physician', npi='1234567890', full_name='Phys', expires_hours=1)}"}


def test_requires_authentication():
    r = client.post("/plan/assistant", json={"question": "hello"})
    assert r.status_code == 401


def test_rejects_non_payer_roles():
    """/plan/* is payer-only, and this endpoint can read the whole plan's data —
    a physician token must not reach it."""
    r = client.post("/plan/assistant", json={"question": "hello"}, headers=PHYSICIAN)
    assert r.status_code == 403


def test_rejects_missing_question():
    r = client.post("/plan/assistant", json={}, headers=PAYER)
    assert r.status_code == 422


def test_rejects_overlong_question():
    r = client.post("/plan/assistant", json={"question": "x" * 5000}, headers=PAYER)
    assert r.status_code == 422


def test_empty_question_returns_a_message_not_an_error_status(monkeypatch):
    """The chat panel renders failures as messages, so the endpoint answers 200 with
    an {error, message} body rather than an HTTP error."""
    r = client.post("/plan/assistant", json={"question": "   "}, headers=PAYER)
    assert r.status_code == 200
    assert r.json()["error"] == "empty_question"


def test_missing_api_key_degrades_gracefully(monkeypatch):
    """With no key the assistant must explain itself, not 500 — and must say the
    rest of the portal still works."""
    import backend.chat_agent as agent
    monkeypatch.setattr(agent, "_api_key", lambda: None)
    r = client.post("/plan/assistant", json={"question": "who is high risk?"}, headers=PAYER)
    assert r.status_code == 200
    body = r.json()
    assert body["error"] == "no_api_key"
    assert "OPENAI_API_KEY" in body["message"]


def test_response_shape_is_stable(monkeypatch):
    """The widget reads answer/entities/trail; a rename would break it silently."""
    import backend.chat_agent as agent

    def fake_answer(db, question, history=None):
        return {"answer": "Dr X is critical.", "entities": [], "trail": [], "tools_used": []}

    monkeypatch.setattr("backend.routers.assistant.answer", fake_answer)
    r = client.post("/plan/assistant", json={"question": "why?"}, headers=PAYER)
    assert r.status_code == 200
    body = r.json()
    for field in ("answer", "entities", "trail", "tools_used"):
        assert field in body


def test_history_is_accepted():
    """Multi-turn: the panel replays prior turns so follow-ups resolve pronouns."""
    import backend.chat_agent as agent
    captured = {}

    def fake_answer(db, question, history=None):
        captured["history"] = history
        return {"answer": "ok", "entities": [], "trail": [], "tools_used": []}

    import backend.routers.assistant as router_mod
    original = router_mod.answer
    router_mod.answer = fake_answer
    try:
        r = client.post("/plan/assistant", headers=PAYER, json={
            "question": "and his vendors?",
            "history": [{"role": "user", "content": "who is Dr X?"},
                        {"role": "assistant", "content": "Dr X is critical."}],
        })
        assert r.status_code == 200
        assert len(captured["history"]) == 2
        assert captured["history"][0]["role"] == "user"
    finally:
        router_mod.answer = original


# ---------------------------------------------------------------------------
# Guardrails
# ---------------------------------------------------------------------------
@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """The limiter is module-level state; without this one test's requests count
    against the next one's budget."""
    import backend.routers.assistant as router_mod
    router_mod._recent.clear()
    yield
    router_mod._recent.clear()


def test_rate_limit_kicks_in(monkeypatch):
    import backend.routers.assistant as router_mod
    monkeypatch.setattr(router_mod, "answer",
                        lambda db, q, h=None: {"answer": "ok", "entities": [],
                                               "trail": [], "tools_used": []})
    limit = router_mod.RATE_LIMIT_MAX_QUESTIONS
    for i in range(limit):
        r = client.post("/plan/assistant", json={"question": f"q{i}"}, headers=PAYER)
        assert r.status_code == 200, f"request {i + 1} should be allowed"

    r = client.post("/plan/assistant", json={"question": "one too many"}, headers=PAYER)
    assert r.status_code == 429
    assert r.json()["error"] == "rate_limited"


def test_rate_limit_covers_the_streaming_route_too(monkeypatch):
    """Streaming is the route the widget actually uses — limiting only the JSON one
    would leave the expensive path wide open."""
    import backend.routers.assistant as router_mod
    monkeypatch.setattr(router_mod, "stream",
                        lambda db, q, h=None: iter([{"type": "answer", "answer": "ok",
                                                     "entities": [], "tools_used": []}]))
    for i in range(router_mod.RATE_LIMIT_MAX_QUESTIONS):
        assert client.post("/plan/assistant/stream", json={"question": f"q{i}"},
                           headers=PAYER).status_code == 200
    assert client.post("/plan/assistant/stream", json={"question": "over"},
                       headers=PAYER).status_code == 429


def test_every_question_is_audited(monkeypatch, caplog):
    """A fraud tool's answers get quoted into investigations, so who asked what —
    and which data produced the answer — has to be on the record."""
    import logging
    import backend.routers.assistant as router_mod
    monkeypatch.setattr(router_mod, "answer",
                        lambda db, q, h=None: {"answer": "Dr X is critical.", "trail": [],
                                               "entities": [{"type": "physician", "id": "123",
                                                             "label": "Dr X"}],
                                               "tools_used": ["get_physician"]})
    with caplog.at_level(logging.INFO, logger="assistant.audit"):
        client.post("/plan/assistant", json={"question": "why is Dr X risky?"}, headers=PAYER)

    entry = json.loads(caplog.records[-1].message)
    assert entry["investigator"] == "assistant_test@mediclaim.com"
    assert entry["question"] == "why is Dr X risky?"
    assert entry["tools_used"] == ["get_physician"]
    assert entry["entities"] == ["physician:123"]


# ---------------------------------------------------------------------------
# Regression: a bad identifier must not poison the conversation's DB session
# ---------------------------------------------------------------------------
def test_bad_claim_reference_leaves_the_session_usable():
    """get_claim used to query a uuid column with whatever string it was given.
    Postgres aborts the transaction on that, so one bad CCN broke every later tool
    call in the same turn — the assistant would answer once then fail everything."""
    from backend.chat_tools import get_claim, get_patient, plan_overview
    from backend.database import SessionLocal

    db = SessionLocal()
    try:
        miss = get_claim(db, "NOT-A-CCN-OR-UUID")
        assert miss["error"] == "not_found"
        # The session has to still work after the miss.
        assert plan_overview(db)["physicians"]["total_scored"] >= 0
        assert get_patient(db, "no-such-patient")["error"] == "not_found"
        assert db.query(1).scalar() == 1
    finally:
        db.close()


@pytest.mark.parametrize("tool", [
    "search_entities", "get_physician", "get_vendor", "get_rule_evidence",
    "list_top_risk", "plan_overview", "explain_rule", "explain_scoring", "search_docs",
    "get_patient", "get_claim", "get_dispute_case", "check_oig",
])
def test_every_advertised_tool_is_callable(tool):
    """The schemas handed to the model must match the functions that exist — a
    mismatch means the model calls a tool that isn't there."""
    from backend.chat_agent import TOOL_SCHEMAS
    from backend.chat_tools import KNOWLEDGE_TOOL_FUNCTIONS, TOOL_FUNCTIONS

    advertised = {s["function"]["name"] for s in TOOL_SCHEMAS}
    assert tool in advertised, f"{tool} isn't advertised to the model"
    assert tool in TOOL_FUNCTIONS or tool in KNOWLEDGE_TOOL_FUNCTIONS


# ---------------------------------------------------------------------------
# POST /plan/assistant/stream
#
# These assert the SSE *contract* — status codes, headers, event order, wire
# format. They deliberately don't assert timing: TestClient buffers ASGI response
# bodies, so every event appears to arrive at once even when streaming works
# perfectly over a real socket. Timing is checked by hand against uvicorn
# (scratchpad probe), where the first status lands in ~0.4s and the answer ~7s.
# ---------------------------------------------------------------------------
def _sse_events(resp) -> list[dict]:
    events = []
    for line in resp.text.splitlines():
        if line.startswith("data: "):
            events.append(json.loads(line[6:]))
    return events


def test_stream_requires_payer_role():
    r = client.post("/plan/assistant/stream", json={"question": "hi"})
    assert r.status_code == 401
    r = client.post("/plan/assistant/stream", json={"question": "hi"}, headers=PHYSICIAN)
    assert r.status_code == 403


def test_stream_sets_event_stream_headers():
    """text/event-stream plus X-Accel-Buffering:no — without the latter a proxy
    buffers the whole response and the streaming is invisible in production."""
    import backend.chat_agent as agent
    r = client.post("/plan/assistant/stream", json={"question": "  "}, headers=PAYER)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    assert r.headers["x-accel-buffering"] == "no"
    assert r.headers["cache-control"] == "no-cache"


def test_stream_emits_statuses_then_exactly_one_terminal_event(monkeypatch):
    import backend.routers.assistant as router_mod

    def fake_stream(db, question, history=None):
        yield {"type": "status", "icon": "search", "text": "Searching"}
        yield {"type": "status", "icon": "user", "text": "Reading a profile"}
        yield {"type": "answer", "answer": "Done.", "entities": [], "tools_used": ["x"]}

    monkeypatch.setattr(router_mod, "stream", fake_stream)
    r = client.post("/plan/assistant/stream", json={"question": "why?"}, headers=PAYER)
    events = _sse_events(r)
    assert [e["type"] for e in events] == ["status", "status", "answer"]
    assert sum(1 for e in events if e["type"] in ("answer", "error")) == 1


def test_stream_ends_with_an_error_event_rather_than_hanging(monkeypatch):
    """A crash mid-generation must still close with something the panel can render,
    or the user watches a spinner forever."""
    import backend.routers.assistant as router_mod

    def exploding_stream(db, question, history=None):
        yield {"type": "status", "icon": "search", "text": "Searching"}
        raise RuntimeError("boom")

    monkeypatch.setattr(router_mod, "stream", exploding_stream)
    r = client.post("/plan/assistant/stream", json={"question": "why?"}, headers=PAYER)
    events = _sse_events(r)
    assert events[-1]["type"] == "error"
    assert events[-1]["error"] == "stream_failed"


def test_stream_and_json_share_one_implementation(monkeypatch):
    """answer() must be a drain of stream(), not a second copy of the loop — the
    status events become `trail` and the terminal payload is otherwise identical."""
    import backend.chat_agent as agent
    from backend.database import SessionLocal

    def fake_stream(db, question, history=None):
        yield {"type": "status", "icon": "search", "text": "Searching"}
        yield {"type": "answer", "answer": "Done.", "entities": [], "tools_used": ["x"]}

    monkeypatch.setattr(agent, "stream", fake_stream)
    db = SessionLocal()
    try:
        result = agent.answer(db, "why?")
    finally:
        db.close()
    assert result["answer"] == "Done."
    assert result["trail"] == [{"icon": "search", "text": "Searching"}]


def test_no_schema_without_an_implementation():
    from backend.chat_agent import TOOL_SCHEMAS
    from backend.chat_tools import KNOWLEDGE_TOOL_FUNCTIONS, TOOL_FUNCTIONS

    implemented = set(TOOL_FUNCTIONS) | set(KNOWLEDGE_TOOL_FUNCTIONS)
    advertised = {s["function"]["name"] for s in TOOL_SCHEMAS}
    assert advertised == implemented, (
        f"advertised-but-missing: {sorted(advertised - implemented)}; "
        f"implemented-but-hidden: {sorted(implemented - advertised)}")
