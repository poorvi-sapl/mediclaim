"""
Debounced background refresh of the fraud-analytics pipeline — the real-time
bridge between claim ingest and the payer dashboards.

Why a full recompute instead of per-claim incremental updates:
  - Most rules are cross-claim aggregates (cross_npi_supplier crossing its
    threshold retro-flags EVERY claim of that vendor; identity_reuse spans
    other NPIs via the patient; volume_spike flags an NPI's whole recent
    window). A single new claim can legitimately change flags on rows that
    predate it, so "evaluate just this claim" would silently under-flag.
  - Risk scores are population-percentile blended (see risk_score.py) — one
    entity's score depends on every other entity's volume/amount/breadth
    distribution, so a correct single-entity recalc needs the population scan
    anyway.

Why this still scales for real-time feeds: refresh_fraud_analytics() coalesces
callers with a running/dirty flag pair — a burst of N ingested claims triggers
at most two pipeline runs (the one in flight plus one catch-up that folds in
everything that arrived mid-run), not N. Callers fire it via FastAPI
BackgroundTasks so the ingest response never waits on it.
"""

import logging
import threading

from backend.database import SessionLocal
from backend.config import get_settings
from backend.rules.engine import run_all_rules
from backend.scoring.risk_score import calculate_all_scores

log = logging.getLogger("rules.refresh")

_lock = threading.Lock()
_state = {"running": False, "dirty": False}


def _run_once() -> None:
    db = SessionLocal()
    try:
        settings = get_settings()
        flags = run_all_rules(db, settings)
        calculate_all_scores(db, settings)
        log.info(f"Fraud analytics refreshed — {flags} rule flags written, scores recalculated")
    finally:
        db.close()


def refresh_fraud_analytics() -> None:
    """Recompute rules_flags + npi_risk_scores now, coalescing concurrent
    requests. If a run is already in flight, mark it dirty and return — the
    in-flight runner loops one more time when it finishes, so any claim
    committed before that catch-up pass is guaranteed to be covered.
    Never raises (background-task contract)."""
    with _lock:
        if _state["running"]:
            _state["dirty"] = True
            return
        _state["running"] = True

    try:
        while True:
            _run_once()
            with _lock:
                if _state["dirty"]:
                    _state["dirty"] = False
                    continue
                return
    except Exception:
        log.exception("Fraud analytics refresh failed")
    finally:
        with _lock:
            _state["running"] = False
