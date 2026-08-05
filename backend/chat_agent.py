"""The payer assistant's reasoning loop.

Given a question, the model decides which of the assistant's tools to call, reads
the results, and writes an answer grounded in them. It can chain calls — resolve a
name to an NPI, then pull that NPI's profile, then pull the evidence behind one of
its patterns — up to MAX_TOOL_ROUNDS.

Two things are produced deterministically rather than by the model:

  * the status trail — built from the tool calls that actually executed, so it is a
    record of which data the answer touched, not narration the model could invent
  * the entity list — collected from tool results, then filtered to the ones the
    answer actually mentions, so the UI can turn names into links to detail screens

Grounding is enforced by the prompt plus the shape of the tools: every tool either
returns real rows or an explicit "not found", and none of them can invent an NPI.
"""

import json
import logging
from typing import Any, Iterator, Optional

from sqlalchemy.orm import Session

from backend.chat_tools import KNOWLEDGE_TOOL_FUNCTIONS, TOOL_FUNCTIONS
from backend.config import get_settings
from backend.rule_glossary import KNOWN_RULES, rule_label
from backend.schemas import RISK_BAND_ORDER

log = logging.getLogger("chat_agent")

MODEL = "gpt-4o-mini"
MAX_TOOL_ROUNDS = 4
MAX_HISTORY_TURNS = 8
MAX_ENTITIES = 10

SYSTEM_PROMPT = f"""You are the assistant inside a Medicare fraud-detection product, \
helping a payer investigator. You answer questions about the physicians, vendors, \
claims and fraud patterns in their plan's data, and about how the product itself works.

HOW TO ANSWER
- Always call a tool before stating any fact about a physician, vendor, number or \
pattern. You have no knowledge of this plan's data except what tools return.
- If a question names someone, call search_entities first to resolve them to a real \
NPI or vendor id, then call the tool for that entity.
- For "how does X work" / "what happens when" / product and workflow questions, use \
search_docs. For "what is <pattern>" or "what threshold triggers X", use explain_rule. \
For "how is the score calculated", use explain_scoring.
- Prefer one or two well-chosen tool calls over many.

GROUNDING — this is a fraud tool and answers get quoted into investigations
- Never invent or guess an NPI, name, vendor, count, amount or date. Every number \
you state must come from a tool result in this conversation.
- NEGATIVES COUNT AS FACTS. Never say something does not exist, has none, or is not \
flagged unless a tool explicitly told you so. If you resolved a physician but have \
not yet fetched their details, fetch them before saying anything about their vendors, \
patterns or claims — "no vendors found" is a claim about the data and needs a tool \
result behind it just like a number does.
- If a tool says not_found or returns nothing, say so plainly and stop. Do not \
substitute a similar-sounding entity without saying that is what you did.
- If a tool reports that someone exists in the national NPI registry but has no \
claims in this plan, say exactly that — it is a meaningful distinction.
- Do not soften or dramatise. Report what the data says.

RISK BANDS — {', '.join(RISK_BAND_ORDER)}, worst first. critical is 81-100, high is \
61-80, medium 31-60, low 0-30. "critical" is MORE severe than "high", so a payer \
asking loosely about "high risk" providers almost always means critical AND high \
together. For counts like "how many are high risk", call plan_overview and report \
the bands separately (e.g. "10 critical and 1 high") rather than filtering to the \
strict high band alone and reporting a misleadingly small number.

STYLE
- Lead with the answer, then the supporting detail. 2-5 sentences for most questions.
- Name entities as "Dr Jane Smith (NPI 1234567890)" or "Apex Medical (vendor \
sup-abc123)" the first time you mention them, so they can be linked.
- Quote scores as "82/100 (critical)". The bands are {', '.join(RISK_BAND_ORDER)}.
- Use plain prose. No markdown headings. Short lists are fine when listing entities.
- If you genuinely cannot answer from the tools, say what you would need."""


# ---------------------------------------------------------------------------
# Tool schemas handed to the model
# ---------------------------------------------------------------------------
_RULE_ENUM = list(KNOWN_RULES)

TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "search_entities",
            "description": ("Resolve a name, partial name, NPI or vendor name to the real "
                            "physicians and vendors billing in this plan. Call this first "
                            "whenever a question names someone."),
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string",
                                         "description": "Name, partial name, NPI, or vendor name."}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_physician",
            "description": ("Everything known about one physician: risk score and band, which "
                            "fraud patterns fired and on how many claims, claim totals, top "
                            "vendors, physician feedback, dispute counts. Needs an exact NPI."),
            "parameters": {
                "type": "object",
                "properties": {"npi": {"type": "string", "description": "The 10-digit NPI."}},
                "required": ["npi"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_vendor",
            "description": ("Everything known about one vendor/supplier: risk score, OIG "
                            "exclusion status, which fraud patterns fired, claim totals, and "
                            "which physicians bill through it. Needs an exact vendor id."),
            "parameters": {
                "type": "object",
                "properties": {"vendor_id": {"type": "string",
                                             "description": "The vendor id, e.g. sup-6ae3c9720aa4."}},
                "required": ["vendor_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_rule_evidence",
            "description": ("The actual flagged claims behind one fraud pattern for one "
                            "physician or vendor, each with the engine's own reason text. Use "
                            "when asked why a pattern fired or for specific examples."),
            "parameters": {
                "type": "object",
                "properties": {
                    "rule_name": {"type": "string", "enum": _RULE_ENUM},
                    "npi": {"type": "string", "description": "Physician NPI — use this OR vendor_id."},
                    "vendor_id": {"type": "string", "description": "Vendor id — use this OR npi."},
                },
                "required": ["rule_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_top_risk",
            "description": ("Ranked list of the riskiest physicians or vendors, optionally "
                            "filtered by risk band, fraud pattern, state, specialty or OIG "
                            "status. Use for 'who are the worst', 'how many in Texas', "
                            "'which vendors are on the OIG list'."),
            "parameters": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": ["physicians", "vendors"]},
                    "risk_band": {"type": "string", "enum": list(RISK_BAND_ORDER) + ["all"],
                                  "description": ("Exact band only. 'high' means 61-80 and "
                                                  "EXCLUDES critical (81-100). For a loose "
                                                  "'high risk' question use plan_overview, or "
                                                  "call this twice.")},
                    "pattern": {"type": "string", "enum": _RULE_ENUM,
                                "description": "Only entities where this rule fired."},
                    "state": {"type": "string", "description": "2-letter state code."},
                    "specialty": {"type": "string"},
                    "oig_only": {"type": "boolean", "description": "Vendors only: OIG-excluded."},
                    "limit": {"type": "integer", "description": "1-15, default 10."},
                },
                "required": ["kind"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "plan_overview",
            "description": ("Plan-wide totals: how many physicians and vendors in each risk "
                            "band, claim and dollar totals, every fraud pattern's firing count, "
                            "dispute counts by status. Use for 'how many', 'overall', 'in total'."),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_patient",
            "description": ("One beneficiary: which physicians and vendors billed them, how "
                            "many claims, and which fraud patterns fired on those claims. Use "
                            "for identity-reuse or deceased-patient questions, or any question "
                            "about a named patient. Accepts a patient id or a name."),
            "parameters": {
                "type": "object",
                "properties": {"patient": {"type": "string",
                                           "description": "Patient id, or the patient's name."}},
                "required": ["patient"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_claim",
            "description": ("One claim by its CCN — the short claim control number shown in the "
                            "UI. Returns the physician, vendor, patient, service, amount, every "
                            "rule that fired on it and any physician action taken."),
            "parameters": {
                "type": "object",
                "properties": {"ccn": {"type": "string", "description": "Claim control number."}},
                "required": ["ccn"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_dispute_case",
            "description": ("One dispute case: its status in plain English, what it's waiting on, "
                            "and its full event timeline. Use for 'why is case N still open', "
                            "'what happened on case N', or any question about a case number."),
            "parameters": {
                "type": "object",
                "properties": {"case_id": {"type": "integer", "description": "The case number."}},
                "required": ["case_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_oig",
            "description": ("Check an NPI or entity name against the federal OIG exclusion list "
                            "itself, returning the exclusion type and date. Use when asked "
                            "whether someone is excluded, debarred or on the OIG list."),
            "parameters": {
                "type": "object",
                "properties": {"npi_or_name": {"type": "string",
                                               "description": "An NPI, or an entity/person name."}},
                "required": ["npi_or_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "explain_rule",
            "description": ("What a fraud pattern means, the exact threshold that triggers it, "
                            "how many points it adds, and why it matters. Use for 'what is X' / "
                            "'what threshold' questions about a pattern."),
            "parameters": {
                "type": "object",
                "properties": {"rule_name": {"type": "string",
                                             "description": "Rule name or how a person said it "
                                                            "(e.g. 'kickback', 'OIG')."}},
                "required": ["rule_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "explain_scoring",
            "description": ("How the 0-100 risk score is built: the bands, the weighting, and "
                            "why individual rule points don't simply sum to the score."),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_docs",
            "description": ("Search the product's own specification documents. Use for how the "
                            "product works — screens, workflows, the dispute lifecycle, roles, "
                            "what an action does — as opposed to questions about the data."),
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "The question, in full."}},
                "required": ["query"],
            },
        },
    },
]


# ---------------------------------------------------------------------------
# Status trail — derived from calls that actually ran, never from the model
# ---------------------------------------------------------------------------
def _status_for(name: str, args: dict) -> dict:
    q = args.get("query") or ""
    if name == "search_entities":
        return {"icon": "search", "text": f'Searching for "{q}"'}
    if name == "get_physician":
        return {"icon": "user", "text": f"Reading NPI {args.get('npi', '?')}'s risk profile"}
    if name == "get_vendor":
        return {"icon": "building", "text": f"Reading vendor {args.get('vendor_id', '?')}"}
    if name == "get_rule_evidence":
        return {"icon": "chart", "text": f"Pulling {rule_label(args.get('rule_name', ''))} evidence"}
    if name == "list_top_risk":
        bits = [args.get("risk_band"), args.get("state"), args.get("specialty")]
        extra = ", ".join(b for b in bits if b)
        kind = args.get("kind", "entities")
        return {"icon": "list", "text": f"Ranking {kind}" + (f" ({extra})" if extra else "")}
    if name == "plan_overview":
        return {"icon": "chart", "text": "Checking plan-wide totals"}
    if name == "get_patient":
        return {"icon": "user", "text": f"Looking up patient {args.get('patient', '?')}"}
    if name == "get_claim":
        return {"icon": "docs", "text": f"Pulling claim {args.get('ccn', '?')}"}
    if name == "get_dispute_case":
        return {"icon": "docs", "text": f"Reading dispute case {args.get('case_id', '?')}"}
    if name == "check_oig":
        return {"icon": "search", "text": f"Checking {args.get('npi_or_name', '?')} against the OIG list"}
    if name == "explain_rule":
        return {"icon": "book", "text": f"Looking up the {args.get('rule_name', '')} rule"}
    if name == "explain_scoring":
        return {"icon": "book", "text": "Reading the scoring methodology"}
    if name == "search_docs":
        return {"icon": "docs", "text": f'Searching product documentation for "{q}"'}
    return {"icon": "search", "text": f"Running {name}"}


# ---------------------------------------------------------------------------
# Entity collection — candidates from tool results, filtered by the final answer
# ---------------------------------------------------------------------------
def _collect_entities(result: Any, into: list) -> None:
    """Pull every (type, id, label) a tool result mentions. Over-collects on
    purpose; _mentioned_in filters down to what the answer actually said."""
    if not isinstance(result, dict):
        return

    def add(kind: str, ident, label):
        if not ident or not label:
            return
        key = (kind, str(ident))
        if key not in {(e["type"], e["id"]) for e in into}:
            into.append({"type": kind, "id": str(ident), "label": str(label)})

    if result.get("npi") and result.get("name"):
        add("physician", result["npi"], result["name"])
    if result.get("vendor_id") and result.get("name"):
        add("vendor", result["vendor_id"], result["name"])

    # List-shaped results, across every tool that returns rows of entities.
    for key in ("physicians", "top_physicians_by_claims", "billed_by_physicians"):
        for row in result.get(key) or []:
            if isinstance(row, dict):
                add("physician", row.get("npi"), row.get("name"))
    for key in ("vendors", "top_vendors_by_amount", "billed_by_vendors", "matches"):
        for row in result.get(key) or []:
            if isinstance(row, dict):
                add("vendor", row.get("vendor_id"), row.get("name"))

    # Nested single objects — get_claim and get_dispute_case name a physician and a
    # vendor this way, and without these the answer mentions them unlinked.
    for key in ("physician", "target"):
        nested = result.get(key)
        if isinstance(nested, dict):
            add("physician", nested.get("npi"), nested.get("name") or nested.get("physician_name"))
    for key in ("vendor", "target"):
        nested = result.get(key)
        if isinstance(nested, dict):
            add("vendor", nested.get("vendor_id"), nested.get("name") or nested.get("vendor_name"))


def _mentioned_in(answer: str, candidates: list) -> list:
    """Keep only entities the answer actually names, so the UI never links a row
    the reader can't see. Matches on the id or the label."""
    low = (answer or "").lower()
    kept = []
    for e in candidates:
        if e["id"].lower() in low or e["label"].lower() in low:
            kept.append(e)
        else:
            # Surnames are how the answer usually refers to a person.
            parts = [p for p in e["label"].replace(".", " ").split() if len(p) > 3]
            if parts and all(p.lower() in low for p in parts[-1:]):
                kept.append(e)
    return kept[:MAX_ENTITIES]


# ---------------------------------------------------------------------------
# The loop
# ---------------------------------------------------------------------------
def _api_key() -> Optional[str]:
    key = (get_settings().openai_api_key or "").strip()
    if not key or "your" in key.lower() or len(key) < 20:
        return None
    return key


def _run_tool(db: Session, name: str, args: dict) -> Any:
    if name in TOOL_FUNCTIONS:
        return TOOL_FUNCTIONS[name](db, **args)
    if name in KNOWLEDGE_TOOL_FUNCTIONS:
        return KNOWLEDGE_TOOL_FUNCTIONS[name](**args)
    return {"error": "unknown_tool", "message": f"No tool named {name}."}


def stream(db: Session, question: str, history: Optional[list] = None) -> Iterator[dict]:
    """Run one question, yielding progress as it happens.

    Yields any number of {"type": "status", icon, text} events — one per tool call,
    emitted BEFORE the tool runs so the panel shows what's in flight — then exactly
    one terminal event: {"type": "answer", ...} or {"type": "error", ...}.

    This is the single implementation of the loop; answer() drains it.
    """
    q = (question or "").strip()
    if not q:
        yield {"type": "error", "error": "empty_question",
               "message": "Ask a question to get started."}
        return

    key = _api_key()
    if not key:
        yield {
            "type": "error",
            "error": "no_api_key",
            "message": ("The assistant needs OPENAI_API_KEY set in the backend environment. "
                        "Everything else in the portal works without it."),
        }
        return

    from openai import OpenAI
    client = OpenAI(api_key=key, timeout=45)

    messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]
    for turn in (history or [])[-MAX_HISTORY_TURNS:]:
        role, content = turn.get("role"), turn.get("content")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": str(content)[:4000]})
    messages.append({"role": "user", "content": q})

    tools_used: list[str] = []
    candidates: list[dict] = []

    # Fills the ~1s gap before the first tool call, so the panel isn't blank while
    # the model decides. Truthful: it really is choosing which data to read.
    yield {"type": "status", "icon": "search", "text": "Working out which data to check"}

    for round_no in range(MAX_TOOL_ROUNDS):
        try:
            resp = client.chat.completions.create(
                model=MODEL, temperature=0.2, max_tokens=700,
                messages=messages, tools=TOOL_SCHEMAS, tool_choice="auto",
            )
        except Exception as e:
            log.warning(f"assistant model call failed: {e}")
            yield {"type": "error", "error": "model_failed",
                   "message": "The assistant couldn't reach the language model. Try again."}
            return

        msg = resp.choices[0].message
        calls = msg.tool_calls or []
        if not calls:
            text = (msg.content or "").strip()
            yield {
                "type": "answer",
                "answer": text or "I couldn't find an answer to that.",
                "entities": _mentioned_in(text, candidates),
                "tools_used": tools_used,
                "model": MODEL,
            }
            return

        messages.append({
            "role": "assistant",
            "content": msg.content,
            "tool_calls": [{
                "id": c.id, "type": "function",
                "function": {"name": c.function.name, "arguments": c.function.arguments},
            } for c in calls],
        })

        for call in calls:
            name = call.function.name
            try:
                args = json.loads(call.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            yield {"type": "status", **_status_for(name, args)}
            tools_used.append(name)
            try:
                result = _run_tool(db, name, args)
            except TypeError as e:                    # bad argument shape from the model
                result = {"error": "bad_arguments", "message": str(e)}
            except Exception as e:
                # Roll back before continuing: a failed query leaves the postgres
                # transaction aborted, and every later tool call in this turn would
                # then fail too — one bad argument would break the whole answer.
                try:
                    db.rollback()
                except Exception:
                    pass
                log.warning(f"tool {name} failed: {e}")
                result = {"error": "tool_failed", "message": f"{name} could not be run."}
            _collect_entities(result, candidates)
            messages.append({
                "role": "tool", "tool_call_id": call.id,
                "content": json.dumps(result, default=str)[:12000],
            })

    # Out of tool rounds — force a prose answer from what's already gathered.
    yield {"type": "status", "icon": "book", "text": "Writing up what the data shows"}
    try:
        final = client.chat.completions.create(
            model=MODEL, temperature=0.2, max_tokens=700,
            messages=messages + [{
                "role": "user",
                "content": ("Answer now using only the tool results above. If they don't "
                            "contain the answer, say what's missing."),
            }],
        )
        text = (final.choices[0].message.content or "").strip()
    except Exception as e:
        log.warning(f"assistant final call failed: {e}")
        yield {"type": "error", "error": "model_failed",
               "message": "The assistant couldn't finish that answer. Try again."}
        return

    yield {
        "type": "answer",
        "answer": text or "I couldn't find an answer to that.",
        "entities": _mentioned_in(text, candidates),
        "tools_used": tools_used,
        "model": MODEL,
        "truncated": True,
    }


def answer(db: Session, question: str, history: Optional[list] = None) -> dict:
    """Non-streaming form of stream(), for clients that want one JSON body.

    Returns {answer, entities, trail, tools_used, model} — with the status events
    collected into `trail` — or {error, message}.
    """
    trail: list[dict] = []
    for event in stream(db, question, history):
        kind = event.get("type")
        payload = {k: v for k, v in event.items() if k != "type"}
        if kind == "status":
            trail.append(payload)
            continue
        if kind == "answer":
            payload["trail"] = trail
        return payload
    return {"error": "no_answer", "message": "The assistant produced no answer."}
