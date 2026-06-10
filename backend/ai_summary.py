"""LLM risk-explanation for an NPI.

Generates a short, plain-English summary of *why* a physician is rated at their
risk level — grounded strictly in the rules that actually fired (no invented
facts). Uses GPT-4o when an API key is available, with a deterministic template
fallback so it always returns something. Results are cached in-memory keyed by
(npi, score) so the same NPI isn't re-billed to the API and re-scoring refreshes it.
"""

import logging

from .config import get_settings
from .schemas import get_risk_band

log = logging.getLogger("ai_summary")
settings = get_settings()

MODEL = "gpt-4o"
_cache: dict = {}

# rule flag -> human phrase
_RULE_PHRASES = [
    ("oig_flag", "billed a supplier that appears on the OIG exclusion list"),
    ("cross_npi_flag", "used a supplier that bills under many unrelated physician NPIs (a kickback-ring pattern)"),
    ("volume_flag", "showed a sharp spike in claim volume versus their own baseline"),
    ("geo_flag", "had patients located far from the practice address"),
    ("new_supplier_flag", "had a brand-new, high-value supplier relationship appear suddenly"),
    ("identity_reuse_flag", "billed the same patient under multiple unrelated physician NPIs (identity reuse / phantom billing)"),
    ("hospice_duration_flag", "kept a patient enrolled in hospice far longer than is clinically typical"),
    ("upcoding_flag", "billed amounts far above the norm for the service category (possible upcoding)"),
    ("unbundling_flag", "split single services into multiple separately-billed codes (possible unbundling)"),
]


def _facts(profile, score) -> dict:
    fired = [phrase for attr, phrase in _RULE_PHRASES if getattr(score, attr, False)]
    return {
        "physician_name": profile.physician_name or f"NPI {score.entity_id}",
        "specialty": profile.specialty or "Unknown specialty",
        "state": profile.practice_state or "—",
        "risk_score": score.risk_score,
        "risk_band": get_risk_band(score.risk_score),
        "fired_rules": fired,
        "physician_flags": score.physician_flag_count or 0,
        "total_claims": score.total_claim_count or 0,
        "total_billed": float(score.total_claim_amount or 0),
        "top_supplier": score.top_supplier_name or None,
    }


def _template(f: dict) -> str:
    lead = f"{f['physician_name']} is rated {f['risk_band'].upper()} risk ({f['risk_score']}/100)."
    if not f["fired_rules"] and not f["physician_flags"]:
        return (lead + " No fraud rules fired and there are no physician flags — billing "
                "looks consistent with peers, so risk is low.")
    parts = []
    if f["fired_rules"]:
        parts.append("Key drivers: " + "; ".join(f["fired_rules"]) + ".")
    if f["top_supplier"]:
        parts.append(f"Top supplier is {f['top_supplier']}.")
    if f["physician_flags"]:
        parts.append(f"{f['physician_flags']} physician flag(s) further reinforce the concern.")
    return lead + " " + " ".join(parts)


def _llm(f: dict) -> str | None:
    key = (settings.openai_api_key or "").strip()
    if not key or "your" in key.lower() or len(key) < 20:
        return None
    try:
        from openai import OpenAI
        client = OpenAI(api_key=key, timeout=20)
        rules = "; ".join(f["fired_rules"]) if f["fired_rules"] else "none"
        user = (
            f"Provider: {f['physician_name']} ({f['specialty']}, {f['state']}).\n"
            f"Composite risk score: {f['risk_score']}/100 ({f['risk_band']}).\n"
            f"Fraud rules that fired: {rules}.\n"
            f"Physician flags: {f['physician_flags']}.\n"
            f"Total claims: {f['total_claims']}, total billed: ${f['total_billed']:,.0f}.\n"
            f"Top supplier: {f['top_supplier'] or 'n/a'}.\n\n"
            "Write a risk summary in EXACTLY two sentences. "
            "Sentence 1: State the overall risk level and the single most serious finding "
            "(OIG hit, cross-NPI pattern, or duplicate billing — whichever is highest severity). "
            "Sentence 2: Name one additional supporting pattern and its implication. "
            "Maximum 50 words total. Be direct and clinical. No hedging language."
        )
        resp = client.chat.completions.create(
            model=MODEL,
            temperature=0.3,
            max_tokens=120,
            messages=[
                {"role": "system", "content": (
                    "You are a senior Medicare/Medicaid fraud analyst. Write a concise, "
                    "factual risk explanation using ONLY the signals provided — never invent "
                    "codes, numbers, suppliers, or rules. Plain English, no preamble, no bullet points."
                )},
                {"role": "user", "content": user},
            ],
        )
        return resp.choices[0].message.content.strip()
    except Exception as e:
        log.warning(f"LLM summary failed, using template: {e}")
        return None


def generate_npi_summary(profile, score) -> tuple[str, str, bool]:
    """Returns (summary_text, source, cached) where source is 'llm' or 'rules'."""
    cache_key = (score.entity_id, score.risk_score, score.physician_flag_count)
    if cache_key in _cache:
        text, source = _cache[cache_key]
        return text, source, True

    f = _facts(profile, score)
    text = _llm(f)
    source = "llm"
    if not text:
        text, source = _template(f), "rules"
    _cache[cache_key] = (text, source)
    return text, source, False
