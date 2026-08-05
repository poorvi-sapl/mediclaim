"""Risk-band and score-explanation consistency.

These invariants had no coverage, which is how the product ended up classifying
the same score seven different ways (cuts at 80, 70 and 65, a rival 3-band
high/mid/low scheme, and a "Clean" label covering everything under 65) and how
the physician-feedback arithmetic ended up copied into three files.

Read-only: every test here queries, none mutate.
"""

import pytest
from sqlalchemy.orm import Session

from backend.database import SessionLocal
from backend.models import Action, NpiRiskScore
from backend.routers.analytics import overview_risk_distribution
from backend.routers.dashboard import get_npi_detail, get_plan_summary
from backend.schemas import (
    RISK_BAND_BOUNDS, RISK_BAND_ORDER, get_risk_band,
)
from backend.scoring.risk_score import band_counts, physician_feedback


@pytest.fixture
def db():
    session = SessionLocal()
    yield session
    session.close()


# ── the band function itself ────────────────────────────────────────────────
@pytest.mark.parametrize("score,expected", [
    (0, "low"), (30, "low"),
    (31, "medium"), (60, "medium"),
    (61, "high"), (80, "high"),
    (81, "critical"), (100, "critical"),
    (None, "low"),
])
def test_band_boundaries(score, expected):
    assert get_risk_band(score) == expected


def test_bands_tile_0_to_100_with_no_gaps_or_overlaps():
    """Every score 0-100 lands in exactly one band, and the declared bounds agree
    with what get_risk_band actually returns."""
    for score in range(0, 101):
        band = get_risk_band(score)
        lo, hi = RISK_BAND_BOUNDS[band]
        assert lo <= score <= hi, f"{score} -> {band} but bounds are {lo}-{hi}"

    covered = sorted(RISK_BAND_BOUNDS.values())
    assert covered[0][0] == 0 and covered[-1][1] == 100
    for (_, prev_hi), (next_lo, _) in zip(covered, covered[1:]):
        assert next_lo == prev_hi + 1, "bands must be contiguous"


# ── the counting query vs the band function ─────────────────────────────────
@pytest.mark.parametrize("entity_type", ["npi", "supplier"])
def test_band_counts_match_row_by_row_classification(db: Session, entity_type):
    """The SQL bucketing in band_counts and the Python get_risk_band must never
    disagree — this is the invariant that quietly broke before."""
    counts = band_counts(db, entity_type)
    scores = [r.risk_score for r in db.query(NpiRiskScore.risk_score)
              .filter(NpiRiskScore.entity_type == entity_type).all()]

    expected = {band: 0 for band in RISK_BAND_ORDER}
    for s in scores:
        expected[get_risk_band(s)] += 1

    assert {b: counts[b] for b in RISK_BAND_ORDER} == expected
    assert counts["total"] == len(scores)
    assert sum(counts[b] for b in RISK_BAND_ORDER) == counts["total"]


# ── every surface that reports bands ────────────────────────────────────────
def test_plan_summary_and_risk_distribution_agree(db: Session):
    """/plan/summary, the risk-distribution chart and the shared helper must all
    report the same numbers. They previously used 80, 70 and 70 respectively."""
    bands = band_counts(db, "npi")
    summary = get_plan_summary(db=db)
    ring = overview_risk_distribution(db=db)

    assert summary.high_risk_npis == bands["critical"]
    assert summary.total_npis == bands["total"]
    assert summary.band_counts == {b: bands[b] for b in RISK_BAND_ORDER}
    assert ring == bands


# ── the deduped score explanation ───────────────────────────────────────────
def test_physician_feedback_matches_score_breakdown(db: Session):
    """The "Physician feedback" row on the NPI detail screen must quote the same
    points the scorer used to build the score it's explaining. Both now come from
    one helper; this fails if either grows its own copy of the arithmetic again."""
    scored = (db.query(NpiRiskScore)
              .filter(NpiRiskScore.entity_type == "npi",
                      NpiRiskScore.physician_flag_count > 0)
              .order_by(NpiRiskScore.physician_flag_count.desc()).first())
    if not scored:
        pytest.skip("no scored NPI with physician flags in this dataset")

    npi = scored.entity_id
    feedback = physician_feedback(db, Action.npi, npi)
    detail = get_npi_detail(npi=npi, db=db)
    rows = [b for b in detail.score["score_breakdown"] if b["rule"] is None]

    assert len(rows) == 1, "expected exactly one physician-feedback breakdown row"
    assert rows[0]["points"] == feedback.points
    assert feedback.count == sum(feedback.by_action.values())
    assert feedback.count == scored.physician_flag_count


def test_physician_feedback_is_capped(db: Session):
    """Points can never exceed the configured cap, however many flags exist."""
    from backend.config import get_settings
    cap = get_settings().max_physician_flag_contribution
    rows = (db.query(NpiRiskScore.entity_id)
            .filter(NpiRiskScore.entity_type == "npi",
                    NpiRiskScore.physician_flag_count > 0)
            .limit(10).all())
    for (npi,) in rows:
        assert physician_feedback(db, Action.npi, npi).points <= cap
