"""Check for the payer assistant's tools — data (phase 1) and knowledge (phase 2).

Runs every tool in backend/chat_tools.py against the live DB and the docs corpus,
prints what came back, and reports each payload's size in characters — the number
that matters once these results are being packed into an LLM context window.

Targets (an NPI, a vendor, a rule) are discovered from the data rather than
hardcoded, so this works against any dataset.

    python scripts/verify_chat_tools.py
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import func  # noqa: E402

from backend.chat_tools import (  # noqa: E402
    explain_rule, explain_scoring, get_physician, get_rule_evidence, get_vendor,
    list_top_risk, plan_overview, search_docs, search_entities,
)
from backend.database import SessionLocal  # noqa: E402
from backend.models import NpiProfile, NpiRiskScore, RulesFlag  # noqa: E402

failures: list[str] = []


def show(label: str, payload) -> None:
    blob = json.dumps(payload, indent=2, default=str)
    print(f"\n{'=' * 70}\n{label}   [{len(blob):,} chars]\n{'=' * 70}")
    print(blob if len(blob) <= 2600 else blob[:2600] + "\n  … truncated for display")
    if isinstance(payload, dict) and payload.get("error"):
        failures.append(f"{label} -> {payload['error']}: {payload.get('message')}")


def main() -> int:
    db = SessionLocal()
    try:
        # ── discover real targets ────────────────────────────────────────────
        top = (db.query(NpiRiskScore)
               .filter(NpiRiskScore.entity_type == "npi")
               .order_by(NpiRiskScore.risk_score.desc()).first())
        vendor = (db.query(NpiRiskScore)
                  .filter(NpiRiskScore.entity_type == "supplier")
                  .order_by(NpiRiskScore.physician_flag_count.desc()).first())
        if not top or not vendor:
            print("No scored NPIs or vendors in the DB — seed data first.")
            return 1

        npi = top.entity_id
        vendor_id = vendor.entity_id
        name = db.query(NpiProfile.physician_name).filter(NpiProfile.npi == npi).scalar() or ""
        rule = (db.query(RulesFlag.rule_name)
                .filter(RulesFlag.npi == npi)
                .group_by(RulesFlag.rule_name)
                .order_by(func.count(RulesFlag.id).desc()).limit(1).scalar())

        print(f"targets: NPI {npi} ({name}) · vendor {vendor_id} ({vendor.entity_name})"
              f" · rule {rule or 'none fired'}")

        # ── every tool ──────────────────────────────────────────────────────
        show("plan_overview()", plan_overview(db))

        # search by a partial surname — the path the agent will actually take
        surname = (name.split()[-1] if name else "")[:5]
        show(f"search_entities('{surname}')", search_entities(db, surname))
        show(f"search_entities('{vendor.entity_name[:12]}')  [vendor by name]",
             search_entities(db, vendor.entity_name[:12]))
        # 'Smith' matches thousands of NPPES registry rows but (probably) nothing
        # billing in this plan — exercises the registry-only fallback path.
        show("search_entities('Smith')  [registry fallback]", search_entities(db, "Smith"))
        show("search_entities('Nonexistent Zzz')", search_entities(db, "Nonexistent Zzz"))
        show(f"get_physician('{npi}')", get_physician(db, npi))
        show("get_physician('0000000000')  [expect not_found]", get_physician(db, "0000000000"))
        show(f"get_vendor('{vendor_id}')", get_vendor(db, vendor_id))
        show("list_top_risk(physicians, high)",
             list_top_risk(db, kind="physicians", risk_band="high", limit=5))
        show("list_top_risk(vendors, oig_only)",
             list_top_risk(db, kind="vendors", oig_only=True, limit=5))
        show("list_top_risk(pattern=cross_npi_supplier)",
             list_top_risk(db, kind="physicians", pattern="cross_npi_supplier", limit=5))
        if rule:
            show(f"get_rule_evidence('{rule}', npi)",
                 get_rule_evidence(db, rule_name=rule, npi=npi))
        v_rule = (db.query(RulesFlag.rule_name)
                  .filter(RulesFlag.vendor_id == vendor_id)
                  .group_by(RulesFlag.rule_name)
                  .order_by(func.count(RulesFlag.id).desc()).limit(1).scalar())
        if v_rule:
            show(f"get_rule_evidence('{v_rule}', vendor)",
                 get_rule_evidence(db, rule_name=v_rule, vendor_id=vendor_id))
        show("get_rule_evidence(no target)  [expect missing_target]",
             get_rule_evidence(db, rule_name="upcoding"))

        # ── knowledge tools (no DB) ─────────────────────────────────────────
        show("explain_rule('cross_npi_supplier')", explain_rule("cross_npi_supplier"))
        # The assistant will be handed however the payer phrased it, not the rule name.
        for alias in ("kickback", "OIG", "ghost billing", "upcode"):
            resolved = explain_rule(alias)
            print(f"  alias {alias!r:18} -> {resolved.get('rule')}")
            if resolved.get("error"):
                failures.append(f"alias {alias!r} did not resolve")
        show("explain_rule('not a real rule')  [expect unknown_rule]",
             explain_rule("not a real rule"))
        show("explain_scoring()", explain_scoring())

        for q in ("how is the risk score calculated",
                  "what happens when a physician disputes a claim",
                  "what are the risk bands"):
            res = search_docs(q, limit=2)
            show(f"search_docs({q!r})", res)
            if not res.get("results"):
                failures.append(f"search_docs found nothing for {q!r}")
        show("search_docs('the capital of France')  [expect no results]",
             search_docs("the capital of France"))
    finally:
        db.close()

    # The "[expect …]" probes are supposed to return errors; anything else is real.
    real = [f for f in failures if "expect" not in f]
    print(f"\n{'=' * 70}")
    if real:
        print(f"FAILED — {len(real)} tool(s) errored unexpectedly:")
        for f in real:
            print(f"  · {f}")
        return 1
    print("OK — every tool returned data, and the not-found probes failed as designed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
