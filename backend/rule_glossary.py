"""What each fraud rule means, when it fires, and how the risk score is built.

The single source of rule prose and point values in the product. The payer
assistant answers "what is cross-NPI billing?" from here, the NPI/vendor detail
screens render their drill-down copy from here (routers/dashboard.py derives its
RULE_INFO from RULE_GLOSSARY), and chat_tools reads its point values from here —
so the bot and the UI can never describe the same rule differently.

Thresholds are never retyped. Configurable ones are read from settings, and the
ones hardcoded in a rule's implementation are imported from that module, so the
text below cannot drift from the code that actually fires.
"""

from backend.config import get_settings
from backend.rules.deceased_patient import GAP_DAYS
from backend.rules.impossible_day import MIN_CLAIMS_PER_DAY
from backend.rules.modifier_abuse import SIM_HIGH, SIM_LOW, WINDOW_DAYS
from backend.rules.rapid_cycling import MIN_DISTINCT_PATIENTS
from backend.rules.supplier_concentration import CONCENTRATION_THRESHOLD
from backend.schemas import RISK_BAND_BOUNDS, RISK_BAND_ORDER

_s = get_settings()

# Rules with no configurable weight of their own — these are the representative
# point values the detail screens show. (dashboard.NEW_RULE_BREAKDOWN derives
# from this.)
FIXED_POINTS = {
    "deceased_patient": 30,
    "impossible_day": 40,
    "modifier_abuse": 24,
    "rapid_cycling": 30,
    "supplier_concentration": 18,
}

# rule_name -> (label, what_it_is, how_it_fires, why_it_matters)
# `what_it_is` is the exact copy the detail screens already show; the other two
# fields are the deeper answer the assistant gives when asked about a pattern.
_RULES = {
    "volume_spike": (
        "Volume Spike",
        "This provider's claim rate in the last 30 days is far above their own prior baseline — a sign of sudden over-billing.",
        f"Fires when the last-30-day claim rate is at least {_s.volume_spike_multiplier}x the provider's own earlier baseline. The comparison is always against that provider's own history, never against other providers.",
        "A legitimate practice grows gradually. A step change usually means either a billing system change or deliberate inflation before an expected audit or shutdown.",
    ),
    "geographic_anomaly": (
        "Geographic Anomaly",
        "Claims were filed for patients located far from the provider's practice address — unusual for legitimate care.",
        f"Fires when the straight-line distance from the practice address to the patient's ZIP exceeds {_s.geographic_anomaly_miles:.0f} miles.",
        "Home health and DME are inherently local. Distant patients suggest the patient list was bought or fabricated rather than actually treated.",
    ),
    "cross_npi_supplier": (
        "Cross-NPI Vendor",
        "A vendor on these claims bills under many unrelated physician NPIs — the classic kickback-ring pattern.",
        f"Fires when one vendor bills under at least {_s.cross_npi_threshold} distinct physician NPIs that have no practice relationship to each other.",
        "One vendor spread thin across unrelated physicians is the signature of a kickback ring: the vendor is buying access to NPIs rather than serving one practice's patients.",
    ),
    "oig_leie_hit": (
        "OIG LEIE Hit",
        "A vendor on these claims appears on the federal OIG exclusion list — Medicare/Medicaid cannot reimburse excluded providers.",
        "Fires when the vendor's NPI or legal name matches the federal OIG List of Excluded Individuals/Entities.",
        "This is the one rule that is a hard legal bar rather than a statistical signal: payment to an excluded entity is not reimbursable at all, so every such claim is recoverable.",
    ),
    "new_high_value_supplier": (
        "New High-Value Vendor",
        "A brand-new vendor relationship appeared with unusually high-dollar claims.",
        f"Fires when a vendor with no prior history appears within {_s.new_vendor_days_lookback} days and bills more than ${_s.new_vendor_amount_threshold:,.0f}.",
        "Fraudulent vendors are disposable — set up, billed hard, abandoned before an audit lands. High value with no history is the start of that arc.",
    ),
    "identity_reuse": (
        "Patient Identity Reuse",
        "The same patient is billed under multiple unrelated physician NPIs — a phantom-billing / identity-reuse signal.",
        f"Fires when one patient ID appears under at least {_s.identity_reuse_min_npis} unrelated physician NPIs.",
        "A stolen or purchased beneficiary identity gets reused across whatever NPIs the ring controls. The patient is usually real; the visits are not.",
    ),
    "abnormal_hospice_duration": (
        "Abnormal Hospice Duration",
        "A hospice patient was kept enrolled far longer than is clinically typical — a known hospice fraud pattern.",
        f"Fires when hospice enrollment runs longer than {_s.hospice_duration_days} days.",
        "Hospice pays a daily rate for patients certified as terminally ill. Keeping an ineligible patient enrolled is a steady, low-visibility revenue stream.",
    ),
    "upcoding": (
        "Upcoding",
        "Claim amounts are far above the norm for the service category — a sign of billing a higher-paying code than warranted.",
        f"Fires when a claim is at least {_s.upcoding_amount_multiplier}x the norm for its service category and above ${_s.upcoding_amount_floor:,.0f} (the floor keeps small-dollar noise out).",
        "The service may have genuinely happened — just billed as a more expensive version of itself. Hard to spot per claim, obvious in aggregate.",
    ),
    "unbundling": (
        "Unbundling",
        "A single service was split into multiple separately-billed component codes to inflate reimbursement.",
        f"Fires when at least {_s.unbundling_min_codes} component codes are billed for one patient and date where a single bundled code was appropriate.",
        "The mirror image of upcoding: instead of one inflated code, several legitimate-looking small ones that together pay more than the bundle.",
    ),
    "duplicate_billing": (
        "Duplicate Billing",
        "The same service was billed twice for one patient within a short window — a duplicate-billing signal.",
        "Fires when the same patient, same HCPCS code and same date of service under one NPI is billed by more than one supplier.",
        "Sometimes a genuine clerical error, which is why it carries low points. Repeated across many claims it stops looking clerical.",
    ),
    "deceased_patient": (
        "Deceased Patient",
        "Claims were filed for patients with no prior activity in over six months, then resurfacing under a different physician — consistent with billing after patient death or identity reuse.",
        f"Fires when a patient has a gap of more than {GAP_DAYS} days with no activity and then reappears under a different NPI.",
        "Billing after a patient's death is unambiguous fraud. The same footprint also appears when a dormant identity is resold, which is why the rule keys on the gap rather than a death record.",
    ),
    "impossible_day": (
        "Impossible Day",
        "The provider billed an implausible number of claims on a single day — more patients than is physically possible to see.",
        f"Fires when a provider bills {MIN_CLAIMS_PER_DAY} or more claims on one calendar day.",
        "A physical impossibility argument is the hardest kind for a provider to explain away, which makes this one of the strongest single signals available.",
    ),
    "modifier_abuse": (
        "Modifier Abuse",
        "Near-identical services were billed separately for the same patient on the same date — consistent with reworded line items to bypass duplicate checks.",
        f"Fires when two service descriptions for the same patient are between {SIM_LOW:.0%} and {SIM_HIGH:.0%} similar within {WINDOW_DAYS} days — similar enough to be the same service, different enough to slip past an exact-match duplicate check.",
        "This is duplicate billing by someone who knows a duplicate check exists. The deliberate rewording is itself evidence of intent.",
    ),
    "rapid_cycling": (
        "Rapid Patient Cycling",
        "The provider billed an unusually high number of distinct patients in one day — implausible patient turnover.",
        f"Fires when a provider bills {MIN_DISTINCT_PATIENTS} or more distinct patients in a single day.",
        "Distinct from Impossible Day: the volume could be plausible for repeat visits, but not for that many different people.",
    ),
    "supplier_concentration": (
        "Vendor Concentration",
        "An unusually large share of this provider's billing flows through a single vendor — consistent with a kickback or referral relationship.",
        f"Fires when at least {CONCENTRATION_THRESHOLD:.0%} of a provider's billing goes through one vendor.",
        "Exclusivity is the payoff side of a kickback: the vendor pays for referrals and receives effectively all of that provider's business.",
    ),
    "ghost_billing": (
        "Ghost Billing",
        "The vendor billed for a service that has no matching physician bill on file — the service may never have actually been provided.",
        "Fires when a vendor's claim has no corresponding physician bill for that patient within a 3-day window either side.",
        "If no physician billed for ordering or supervising the service, there is a real chance nothing was delivered and the patient never knew.",
    ),
}


def rule_points() -> dict:
    """rule_name -> its contribution to the risk score. Configurable weights come
    from settings; the rest are the fixed representative values above."""
    pts = {
        "volume_spike": _s.weight_volume_spike,
        "geographic_anomaly": _s.weight_geo_anomaly,
        "cross_npi_supplier": _s.weight_cross_npi,
        "oig_leie_hit": _s.weight_oig_hit,
        "new_high_value_supplier": _s.weight_new_vendor,
        "identity_reuse": _s.weight_identity_reuse,
        "abnormal_hospice_duration": _s.weight_hospice_duration,
        "upcoding": _s.weight_upcoding,
        "unbundling": _s.weight_unbundling,
        "duplicate_billing": _s.weight_duplicate_billing,
        "ghost_billing": _s.weight_ghost_billing,
    }
    pts.update(FIXED_POINTS)
    return pts


def rule_label(rule_name: str) -> str:
    entry = _RULES.get(rule_name)
    return entry[0] if entry else rule_name.replace("_", " ").title()


# rule_name -> (label, what_it_is). routers/dashboard.py's RULE_INFO derives from
# this, so the drill-down copy on screen and the assistant's answer are one text.
RULE_INFO_PAIRS = {k: (v[0], v[1]) for k, v in _RULES.items()}

KNOWN_RULES = tuple(_RULES.keys())

# Common ways a payer might refer to a rule in a question, mapped to its real name.
_ALIASES = {
    "kickback": "cross_npi_supplier", "cross npi": "cross_npi_supplier",
    "cross-npi": "cross_npi_supplier", "ring": "cross_npi_supplier",
    "oig": "oig_leie_hit", "leie": "oig_leie_hit", "exclusion": "oig_leie_hit",
    "excluded": "oig_leie_hit",
    "ghost": "ghost_billing", "phantom": "identity_reuse",
    "identity": "identity_reuse", "identity theft": "identity_reuse",
    "hospice": "abnormal_hospice_duration",
    "duplicate": "duplicate_billing", "double billing": "duplicate_billing",
    "modifier": "modifier_abuse", "upcode": "upcoding", "upcoded": "upcoding",
    "unbundle": "unbundling", "unbundled": "unbundling",
    "spike": "volume_spike", "volume": "volume_spike",
    "geographic": "geographic_anomaly", "geo": "geographic_anomaly",
    "distance": "geographic_anomaly", "distant": "geographic_anomaly",
    "deceased": "deceased_patient", "dead": "deceased_patient",
    "impossible": "impossible_day", "cycling": "rapid_cycling",
    "turnover": "rapid_cycling", "concentration": "supplier_concentration",
    "exclusive": "supplier_concentration", "new vendor": "new_high_value_supplier",
}


def _resolve(name: str) -> str | None:
    q = (name or "").strip().lower().replace("-", "_").replace(" ", "_")
    if q in _RULES:
        return q
    plain = q.replace("_", " ")
    if plain in _ALIASES:
        return _ALIASES[plain]
    # Substring match, longest alias first so "cross npi" beats "npi".
    for alias in sorted(_ALIASES, key=len, reverse=True):
        if alias in plain:
            return _ALIASES[alias]
    for rule in _RULES:
        if q in rule or rule in q:
            return rule
    return None


def explain_rule(rule_name: str) -> dict:
    """Definition, trigger threshold, score contribution and significance for one
    fraud rule. Accepts the exact rule name or how a person would say it
    ("kickback", "OIG", "ghost billing")."""
    resolved = _resolve(rule_name)
    if not resolved:
        return {
            "error": "unknown_rule",
            "message": f"There is no fraud rule matching '{rule_name}' in this product.",
            "known_rules": [{"rule": r, "label": _RULES[r][0]} for r in KNOWN_RULES],
        }
    label, what, how, why = _RULES[resolved]
    return {
        "rule": resolved,
        "label": label,
        "what_it_is": what,
        "how_it_fires": how,
        "why_it_matters": why,
        "points_added_to_risk_score": rule_points().get(resolved, 0),
        "score_note": ("Points are the rule's raw contribution. They are not added "
                       "straight onto the 0-100 score — see explain_scoring."),
    }


def explain_scoring() -> dict:
    """How a 0-100 risk score is actually built. The answer to "why is this
    physician an 82?" beyond listing which rules fired."""
    bands = {b: f"{RISK_BAND_BOUNDS[b][0]}-{RISK_BAND_BOUNDS[b][1]}" for b in RISK_BAND_ORDER}
    return {
        "scale": "0-100, higher is riskier",
        "risk_bands": bands,
        "how_it_is_built": [
            f"1. Every fraud rule that fired contributes its points (see explain_rule). "
            f"Physician feedback adds more: {_s.weight_per_physician_flag} points per flag and "
            f"{_s.weight_did_not_order} per did-not-order denial, capped at "
            f"{_s.max_physician_flag_contribution} points in total.",
            f"2. Those raw points are put through a saturating curve into 0-"
            f"{_s.score_severity_max:.0f}. It flattens as points grow, so a provider with "
            f"eight rules does not simply pin at 100 — severe cases stay distinguishable.",
            f"3. Continuous signals add up to {_s.score_continuous_max:.0f} more points: claim "
            f"volume ({_s.score_w_volume:.0%}), dollars billed ({_s.score_w_amount:.0%}), "
            f"breadth of distinct counterparties ({_s.score_w_breadth:.0%}) and the share of "
            f"claims OIG-flagged ({_s.score_w_flagged:.0%}).",
            "4. The two parts are added and capped at 100.",
        ],
        "why_points_do_not_sum_to_the_score": (
            "The curve in step 2 is deliberate. A straight sum would put every serious "
            "offender at exactly 100 and make ranking them impossible — the whole point of "
            "the score is deciding who to investigate first."
        ),
        "recalculated_when": ("Scores are recomputed when the fraud check is re-run for an "
                             "entity, so last_calculated on a score tells you how fresh it is."),
    }
