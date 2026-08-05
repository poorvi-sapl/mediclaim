"""Phase 3 check: does the assistant route to the right tools and stay grounded?

Runs a fixed question set spanning all three domains the assistant claims to cover
— entity data, fraud methodology, product knowledge — plus deliberate traps for
hallucination. For each question it prints the answer, the tools that actually ran,
and the entities the UI would be able to link.

Each question declares `expect_tools` (at least one must have run) and optionally
`must_not_say` / `must_say` fragments. Failures are summarised at the end.

Costs real OpenAI calls — roughly 25-40 requests for a full run.

    python scripts/verify_assistant.py            # everything
    python scripts/verify_assistant.py grounding  # one group
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import func  # noqa: E402

from backend.chat_agent import answer  # noqa: E402
from backend.database import SessionLocal  # noqa: E402
from backend.models import (  # noqa: E402
    Claim, DisputeCase, NpiProfile, NpiRiskScore, OigExcludedNpi,
)

failures: list[str] = []

# Any genuine refusal contains one of these.
NEGATIONS = ["no ", "not ", "cannot", "couldn't", "could not"]
# Signals that the model invented data for an entity that doesn't exist.
NO_FABRICATION = ["/100", "risk score of", "critical", "$"]


def build_questions(top_name: str, top_npi: str, vendor_name: str,
                    patient_id: str = "", patient_name: str = "",
                    ccn: str = "", case_id: int = 0, oig_npi: str = "") -> list[dict]:
    surname = top_name.split()[-1] if top_name else "Wilson"
    return [
        # ── entity data ────────────────────────────────────────────────────
        {"group": "entity", "q": f"Why is {top_name} high risk?",
         "expect_tools": {"search_entities", "get_physician"}},
        {"group": "entity", "q": f"Tell me about NPI {top_npi}",
         "expect_tools": {"get_physician"}},
        {"group": "entity", "q": f"What do you know about the vendor {vendor_name}?",
         "expect_tools": {"search_entities", "get_vendor"}},
        {"group": "entity", "q": f"Which vendors does {surname} bill through?",
         "expect_tools": {"search_entities", "get_physician"}},
        {"group": "entity", "q": "Who are the five riskiest physicians in the plan?",
         "expect_tools": {"list_top_risk"}},
        {"group": "entity", "q": "Which vendors are on the OIG exclusion list?",
         "expect_tools": {"list_top_risk", "plan_overview"}},
        {"group": "entity", "q": "How many high risk physicians are there in total?",
         "expect_tools": {"plan_overview", "list_top_risk"}},
        {"group": "entity", "q": f"Show me the evidence behind the cross-NPI pattern for NPI {top_npi}",
         "expect_tools": {"get_rule_evidence"}},

        # ── patients, claims, cases, OIG (phase 6 coverage) ───────────────
        {"group": "records", "q": f"Who is patient {patient_id}?",
         "expect_tools": {"get_patient"}},
        {"group": "records", "q": f"Which physicians billed for {patient_name}?",
         "expect_tools": {"get_patient"}},
        {"group": "records", "q": f"Tell me about claim {ccn}",
         "expect_tools": {"get_claim"}},
        {"group": "records", "q": f"Why is dispute case {case_id} still open?",
         "expect_tools": {"get_dispute_case"}},
        {"group": "records", "q": f"What happened on case {case_id}?",
         "expect_tools": {"get_dispute_case"}},
        {"group": "records", "q": f"Is NPI {oig_npi} on the OIG exclusion list?",
         "expect_tools": {"check_oig"}, "must_say_any": ["excluded", "yes", "is on"]},
        {"group": "records", "q": f"Is NPI {top_npi} excluded by the OIG?",
         "expect_tools": {"check_oig"}},
        {"group": "records", "q": "Tell me about claim NOPE-999",
         "expect_tools": {"get_claim"}, "must_say_any": NEGATIONS,
         "must_not_say": ["$"]},
        {"group": "records", "q": "Why is dispute case 999999 still open?",
         "expect_tools": {"get_dispute_case"}, "must_say_any": NEGATIONS},

        # ── fraud methodology ─────────────────────────────────────────────
        {"group": "methodology", "q": "What is cross-NPI billing?",
         "expect_tools": {"explain_rule"}},
        {"group": "methodology", "q": "What threshold triggers a volume spike?",
         "expect_tools": {"explain_rule"}, "must_say": ["2"]},
        {"group": "methodology", "q": "How is the risk score calculated?",
         "expect_tools": {"explain_scoring", "search_docs"}},
        {"group": "methodology", "q": "What does it mean if a vendor is on the OIG list?",
         "expect_tools": {"explain_rule", "search_docs"}},

        # ── product knowledge ─────────────────────────────────────────────
        {"group": "product", "q": "What happens after I flag a claim?",
         "expect_tools": {"search_docs"}},
        {"group": "product", "q": "How long does a vendor have to respond to a dispute?",
         "expect_tools": {"search_docs"}},
        {"group": "product", "q": "What can I do on the vendor watchlist screen?",
         "expect_tools": {"search_docs"}},

        # ── grounding traps ───────────────────────────────────────────────
        # For a nonexistent entity the test that matters isn't which words the
        # refusal uses — it's that no risk score, band or dollar figure is invented.
        # NO_FABRICATION covers that; must_say_any only checks it actually negated.
        {"group": "grounding", "q": "Why is Dr Zebediah Nonexistent high risk?",
         "expect_tools": {"search_entities"},
         "must_not_say": NO_FABRICATION,
         "must_say_any": NEGATIONS},
        {"group": "grounding", "q": "Tell me about NPI 0000000000",
         "expect_tools": {"get_physician", "search_entities"},
         "must_not_say": NO_FABRICATION,
         "must_say_any": NEGATIONS},
        {"group": "grounding", "q": "What is the capital of France?",
         "expect_tools": set()},
        {"group": "grounding", "q": "How many claims did Dr Smith bill last Tuesday?",
         "expect_tools": {"search_entities"}},
    ]


def run(questions: list[dict]) -> None:
    db = SessionLocal()
    try:
        for i, case in enumerate(questions, 1):
            res = answer(db, case["q"])
            print("=" * 78)
            print(f"[{i}/{len(questions)}] ({case['group']}) {case['q']}")
            if res.get("error"):
                print(f"  ERROR {res['error']}: {res.get('message')}")
                failures.append(f"{case['q']!r} -> {res['error']}")
                continue

            text = res["answer"]
            print(f"  tools : {', '.join(res['tools_used']) or '(none)'}")
            print(f"  links : {', '.join(e['label'] for e in res['entities']) or '(none)'}")
            print(f"  answer: {text}")

            expect = case.get("expect_tools")
            used = set(res["tools_used"])
            if expect is not None:
                if expect and not (used & expect):
                    failures.append(f"{case['q']!r} used {sorted(used) or 'no tools'}, "
                                    f"expected one of {sorted(expect)}")
                if not expect and used:
                    failures.append(f"{case['q']!r} should need no tools but used {sorted(used)}")
            low = text.lower()
            for frag in case.get("must_say", []):
                if frag.lower() not in low:
                    failures.append(f"{case['q']!r} never said {frag!r}")
            # must_say_any: at least one has to appear. Refusals are phrased many
            # ways ("no record", "not found", "couldn't find"), so requiring a
            # specific wording would fail a perfectly good answer.
            any_of = case.get("must_say_any", [])
            if any_of and not any(f.lower() in low for f in any_of):
                failures.append(f"{case['q']!r} said none of {any_of}")
            for frag in case.get("must_not_say", []):
                if frag.lower() in low:
                    failures.append(f"{case['q']!r} wrongly said {frag!r}")
    finally:
        db.close()


def main() -> int:
    db = SessionLocal()
    try:
        top = (db.query(NpiRiskScore).filter(NpiRiskScore.entity_type == "npi")
               .order_by(NpiRiskScore.risk_score.desc()).first())
        vendor = (db.query(NpiRiskScore).filter(NpiRiskScore.entity_type == "supplier")
                  .order_by(NpiRiskScore.physician_flag_count.desc()).first())
        if not top or not vendor:
            print("No scored NPIs or vendors — seed data first.")
            return 1
        name = db.query(NpiProfile.physician_name).filter(
            NpiProfile.npi == top.entity_id).scalar() or f"NPI {top.entity_id}"

        # Real records to ask about, discovered from the data like everything else.
        pat = (db.query(Claim.patient_id, Claim.patient_name, Claim.ccn)
               .filter(Claim.npi == top.entity_id).first())
        case_id = (db.query(DisputeCase.case_id)
                   .filter(DisputeCase.status == "OPEN")
                   .order_by(DisputeCase.case_id.desc()).limit(1).scalar()
                   or db.query(DisputeCase.case_id).limit(1).scalar() or 0)
        oig_npi = db.query(OigExcludedNpi.npi).limit(1).scalar() or ""
    finally:
        db.close()

    args = (name, top.entity_id, vendor.entity_name,
            pat.patient_id if pat else "", pat.patient_name if pat else "",
            pat.ccn if pat else "", case_id, oig_npi)
    questions = build_questions(*args)
    only = sys.argv[1] if len(sys.argv) > 1 else None
    if only:
        questions = [q for q in questions if q["group"] == only]
        if not questions:
            groups = sorted({q["group"] for q in build_questions(*args)})
            print(f"No group {only!r}. Try one of: {', '.join(groups)}")
            return 1

    run(questions)

    print("\n" + "=" * 78)
    if failures:
        print(f"FAILED — {len(failures)} issue(s):")
        for f in failures:
            print(f"  · {f}")
        return 1
    print(f"OK — all {len(questions)} questions routed correctly and stayed grounded.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
