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
    ("new_vendor_flag", "had a brand-new, high-value supplier relationship appear suddenly"),
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
        "top_supplier": score.top_vendor_name or None,
    }


def _template(f: dict) -> str:
    # One short sentence, ~15-20 words: risk level + the single most serious finding.
    lead = f"{f['physician_name']} is {f['risk_band'].upper()} risk ({f['risk_score']}/100)"
    if not f["fired_rules"] and not f["physician_flags"]:
        return f"{lead} — no fraud rules fired; billing looks consistent."
    if f["fired_rules"]:
        return f"{lead} — driven mainly by having {f['fired_rules'][0]}."
    return f"{lead} — flagged by {f['physician_flags']} physician report(s)."


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
            "Write a risk summary as ONE sentence of 15-20 words. "
            "State the overall risk level and the single most serious finding "
            "(OIG hit, cross-NPI pattern, or duplicate billing — whichever is highest severity). "
            "Be direct and clinical. No preamble, no hedging, no second sentence."
        )
        resp = client.chat.completions.create(
            model=MODEL,
            temperature=0.3,
            max_tokens=60,
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


# rule_name -> vendor-oriented phrase, for the vendor risk summary. Keyed by the
# real rules_flags.rule_name so it covers every rule that can fire on a vendor's
# claims (richer than the 3 supplier score booleans).
_VENDOR_RULE_PHRASES = {
    "oig_leie_hit": "appears on the OIG federal exclusion list — Medicare cannot reimburse it",
    "cross_npi_supplier": "bills under many unrelated physician NPIs (a kickback-ring pattern)",
    "ghost_billing": "billed for services with no matching physician bill on file (ghost billing)",
    "new_high_value_supplier": "appeared suddenly with high-value claims and no prior history",
    "identity_reuse": "is tied to patient identities reused across unrelated physicians",
    "abnormal_hospice_duration": "kept patients enrolled in hospice far longer than is clinically typical",
    "upcoding": "billed well above the category norm (possible upcoding)",
    "unbundling": "split single services into multiple separately-billed codes (unbundling)",
    "duplicate_billing": "billed the same service more than once (duplicate billing)",
    "modifier_abuse": "used near-duplicate line items to bypass duplicate checks (modifier abuse)",
    "impossible_day": "is linked to an implausible number of claims billed in a single day",
    "rapid_cycling": "is linked to an implausible number of distinct patients billed per day",
    "deceased_patient": "billed for patients after long inactivity gaps (possible deceased-patient billing)",
    "volume_spike": "is linked to sharp claim-volume spikes",
    "geographic_anomaly": "billed for patients located far from the practice address",
    "supplier_concentration": "dominates the billing of the physicians it works with (exclusive-arrangement pattern)",
}


def generate_vendor_summary(vendor_name, score, fired_rules, distinct_npis) -> tuple[str, str, bool]:
    """Vendor-level risk summary, grounded strictly in the rules that fired on this
    vendor's claims. Returns (summary_text, source, cached). Mirrors
    generate_npi_summary but reuses the same _llm / _template machinery."""
    cache_key = ("vendor", score.entity_id, score.risk_score,
                 score.physician_flag_count, len(fired_rules or []))
    if cache_key in _cache:
        text, source = _cache[cache_key]
        return text, source, True

    phrases = [_VENDOR_RULE_PHRASES[r] for r in (fired_rules or []) if r in _VENDOR_RULE_PHRASES]
    f = {
        "physician_name": vendor_name or f"Vendor {score.entity_id}",
        "specialty": f"billing vendor across {distinct_npis} physician NPIs" if distinct_npis else "billing vendor",
        "state": "—",
        "risk_score": score.risk_score,
        "risk_band": get_risk_band(score.risk_score),
        "fired_rules": phrases,
        "physician_flags": score.physician_flag_count or 0,
        "total_claims": score.total_claim_count or 0,
        "total_billed": float(score.total_claim_amount or 0),
        "top_supplier": None,
    }
    text = _llm(f)
    source = "llm"
    if not text:
        text, source = _template(f), "rules"
    _cache[cache_key] = (text, source)
    return text, source, False
