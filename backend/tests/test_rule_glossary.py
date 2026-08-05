"""The assistant's rule knowledge stays complete and matches the rest of the app.

No network and no embeddings here — this covers the curated glossary only. The
docs retrieval index is exercised by scripts/verify_chat_tools.py, which needs an
OpenAI key and so doesn't belong in the unit suite.
"""

import pytest
from sqlalchemy import func

from backend.config import get_settings
from backend.database import SessionLocal
from backend.models import RulesFlag
from backend.routers.dashboard import NEW_RULE_BREAKDOWN, RULE_INFO
from backend.rule_glossary import (
    FIXED_POINTS, KNOWN_RULES, RULE_INFO_PAIRS, _ALIASES,
    explain_rule, explain_scoring, rule_label, rule_points,
)
from backend.schemas import RISK_BAND_ORDER


@pytest.fixture
def db():
    session = SessionLocal()
    yield session
    session.close()


# Rules that fire on an exact match rather than crossing a numeric threshold.
EXACT_MATCH_RULES = {"oig_leie_hit", "duplicate_billing"}


@pytest.mark.parametrize("rule", KNOWN_RULES)
def test_every_rule_is_fully_explained(rule):
    """A half-filled entry would have the assistant answer "what is X?" with a
    blank. Every field has to carry real prose."""
    entry = explain_rule(rule)
    assert entry.get("error") is None
    assert entry["label"], f"{rule} has no label"
    for field in ("what_it_is", "how_it_fires", "why_it_matters"):
        assert entry[field] and len(entry[field]) > 40, f"{rule}.{field} is empty or a stub"
    assert entry["points_added_to_risk_score"] > 0, f"{rule} contributes no points"
    # For threshold rules, how_it_fires answers "what number triggers this?" — a
    # purely qualitative sentence isn't an answer. The two exceptions fire on an
    # exact match (a name/NPI on the OIG list; an identical patient+code+date), so
    # they have no threshold to quote.
    if rule not in EXACT_MATCH_RULES:
        assert any(c.isdigit() for c in entry["how_it_fires"]), \
            f"{rule}.how_it_fires states no threshold"


def test_every_rule_the_engine_actually_fires_is_documented(db):
    """The one that matters most: if someone adds a rule to the engine and not to
    the glossary, the assistant can't explain a pattern the payer can see on
    screen. This fails the moment that happens."""
    fired = {r[0] for r in db.query(RulesFlag.rule_name)
             .group_by(RulesFlag.rule_name).all()}
    undocumented = fired - set(KNOWN_RULES)
    assert not undocumented, (
        f"these rules have fired in the data but aren't in rule_glossary: {sorted(undocumented)}")


def test_points_match_configured_weights():
    """Point values are read from settings, never retyped."""
    s = get_settings()
    pts = rule_points()
    assert set(pts) >= set(KNOWN_RULES), "a known rule has no point value"
    assert pts["oig_leie_hit"] == s.weight_oig_hit
    assert pts["cross_npi_supplier"] == s.weight_cross_npi
    assert pts["ghost_billing"] == s.weight_ghost_billing
    for rule, fixed in FIXED_POINTS.items():
        assert pts[rule] == fixed


def test_dashboard_derives_its_rule_copy_from_the_glossary():
    """The NPI/vendor drill-downs and the assistant must describe a rule with the
    same words — dashboard.RULE_INFO is a view onto the glossary, not a second copy."""
    assert RULE_INFO is RULE_INFO_PAIRS or RULE_INFO == RULE_INFO_PAIRS
    assert len(RULE_INFO) == len(KNOWN_RULES)
    for rule, (label, explanation) in RULE_INFO.items():
        assert label == rule_label(rule)
        assert explanation == explain_rule(rule)["what_it_is"]


def test_new_rule_breakdown_matches_fixed_points():
    derived = {rule: pts for rule, _label, pts in NEW_RULE_BREAKDOWN}
    assert derived == FIXED_POINTS


@pytest.mark.parametrize("alias", sorted(_ALIASES))
def test_every_alias_resolves_to_a_real_rule(alias):
    """Aliases are how a payer actually phrases a question ("kickback", "OIG").
    A typo in the alias table would silently send them to the wrong rule."""
    target = _ALIASES[alias]
    assert target in KNOWN_RULES, f"alias {alias!r} points at unknown rule {target!r}"
    assert explain_rule(alias)["rule"] == target


def test_unknown_rule_lists_the_real_ones():
    """A miss has to be honest and useful, not a guess."""
    out = explain_rule("mystery pattern that does not exist")
    assert out["error"] == "unknown_rule"
    assert len(out["known_rules"]) == len(KNOWN_RULES)


def test_scoring_explainer_covers_the_bands_and_the_curve():
    out = explain_scoring()
    assert set(out["risk_bands"]) == set(RISK_BAND_ORDER)
    # The saturating curve is the counter-intuitive part — if the explanation drops
    # it, the assistant will imply rule points sum straight to the score.
    assert out["why_points_do_not_sum_to_the_score"]
    assert len(out["how_it_is_built"]) >= 4
