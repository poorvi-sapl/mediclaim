"""Read-only data tools for the payer assistant.

Each function answers one kind of question about the plan's data and returns a
small, JSON-safe dict sized for an LLM context window — never an ORM object and
never a full claims page. Where a dashboard endpoint already computes the answer
the handler is called directly, so the assistant quotes the same numbers the
payer sees on screen; where the handler returns a page-sized payload (or fans
out into per-row queries) the aggregate is rebuilt compactly here instead.

Three constraints hold for every tool in this module:
  * read-only — nothing here writes
  * the `users` table is never touched (password hashes, roles, other orgs)
  * hard caps everywhere — an LLM will happily ask for "all claims"; no tool
    here can return more than a few dozen rows regardless of what it's asked

Calling a dashboard handler directly means passing EVERY parameter explicitly:
their defaults are `Query(...)` objects that only FastAPI resolves into values.
"""

import logging
import re
import uuid
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy import and_, case, func, or_
from sqlalchemy.orm import Session

from backend.models import (
    Action, Claim, DisputeCase, NpiProfile, NpiRiskScore, OigExcludedName,
    OigExcludedNpi, RulesFlag, SupplierProfile,
)
from backend.rules.trigger_engine import serialize_dispute_events
from backend.routers.dashboard import (
    get_npi_risk_list, get_plan_summary, get_supplier_watchlist,
    rule_evidence, supplier_rule_evidence,
)
from backend.doc_index import search_docs
from backend.rule_glossary import explain_rule, explain_scoring, rule_label, rule_points
from backend.schemas import RISK_BAND_BOUNDS, RISK_BAND_ORDER, get_risk_band
from backend.scoring.risk_score import band_counts, physician_feedback

log = logging.getLogger("chat_tools")

MAX_SEARCH_HITS = 8
MAX_LIST_ROWS = 15
MAX_EVIDENCE_CLAIMS = 6
MAX_TOP_VENDORS = 5
MAX_VENDOR_PHYSICIANS = 8

FLAG_ACTIONS = ("flag_supplier", "unknown_patient", "did_not_order", "deceased_patient")
# A dispute is no longer awaiting anyone once it reaches one of these.
CLOSED_DISPUTE_STATUS = ("CLOSED", "RESOLVED_BY_PHYSICIAN")

# Whether the assistant may say a patient's name.
#
# True is correct for this dataset: every patient in it is synthetic (see
# docs/SYNTHETIC_DATA_SPEC.md), and naming them makes identity-reuse and
# deceased-patient findings legible — "Maria Smith was billed under 4 unrelated
# NPIs" is the finding.
#
# FLIP THIS TO FALSE the moment real beneficiary data is loaded. Patient ids and
# counts still work with it off, so every pattern remains investigable; only the
# names disappear. This is the one switch that decides whether the assistant can
# put PHI into a chat transcript.
EXPOSE_PATIENT_NAMES = True


def _money(v) -> float:
    return round(float(v or 0), 2)


def _is_uuid(value: str) -> bool:
    try:
        uuid.UUID(str(value))
        return True
    except (ValueError, AttributeError, TypeError):
        return False


def _truncation_note(total: int, shown: int, noun: str) -> dict:
    """Spell out the difference between "how many matched" and "how many rows you
    got". Without this an LLM reports the row count as the total — it listed 8 of 11
    OIG vendors and said "there are 8"."""
    if total > shown:
        return {"count_warning": (f"{total} {noun} match; only the top {shown} are listed here. "
                                 f"State {total} as the total, not {shown}.")}
    return {}


def _fired_patterns(db: Session, *, npi: Optional[str] = None,
                    vendor_id: Optional[str] = None) -> list[dict]:
    """Which fraud rules actually fired, with how many claims each — grouped from
    rules_flags rather than the NpiRiskScore booleans, so rules that have no
    boolean column (deceased_patient, impossible_day, …) are included too."""
    q = db.query(RulesFlag.rule_name, func.count(RulesFlag.id).label("cnt"))
    if npi:
        q = q.filter(RulesFlag.npi == npi)
    if vendor_id:
        q = q.filter(RulesFlag.vendor_id == vendor_id)
    rows = q.group_by(RulesFlag.rule_name).all()

    pts = rule_points()
    # Deliberately no rule definitions here — they'd repeat for every entity and
    # cost ~1.5k chars per lookup. get_rule_evidence carries the explanation for
    # the one rule being asked about; Phase 2's glossary covers the rest.
    out = [{
        "rule": r.rule_name,
        "label": rule_label(r.rule_name),
        "points": pts.get(r.rule_name, 0),
        "claim_count": r.cnt,
    } for r in rows]
    out.sort(key=lambda x: (-x["points"], -x["claim_count"]))
    return out


def _claim_window(db: Session, *, npi: Optional[str] = None,
                  vendor_id: Optional[str] = None) -> dict:
    q = db.query(
        func.count(Claim.id).label("cnt"),
        func.sum(Claim.claim_amount).label("amt"),
        func.min(Claim.date_of_service).label("first"),
        func.max(Claim.date_of_service).label("last"),
        func.count(func.distinct(Claim.patient_id)).label("patients"),
    )
    if npi:
        q = q.filter(Claim.npi == npi)
    if vendor_id:
        q = q.filter(Claim.vendor_id == vendor_id)
    r = q.one()
    return {
        "claim_count": r.cnt or 0,
        "total_billed": _money(r.amt),
        "distinct_patients": r.patients or 0,
        "first_claim_date": r.first.isoformat() if r.first else None,
        "last_claim_date": r.last.isoformat() if r.last else None,
    }


def _dispute_counts(db: Session, *, npi: Optional[str] = None) -> dict:
    q = db.query(DisputeCase.status, func.count(DisputeCase.case_id))
    if npi:
        q = q.filter(DisputeCase.physician_npi == npi)
    rows = q.group_by(DisputeCase.status).all()
    by_status = {status: cnt for status, cnt in rows}
    return {
        "total": sum(by_status.values()),
        "still_open": sum(c for s, c in by_status.items() if s not in CLOSED_DISPUTE_STATUS),
        "by_status": by_status,
    }


# ---------------------------------------------------------------------------
# search_entities — resolve a name / NPI / vendor id to real entities.
# The one genuinely new query: the payer UI filters whole lists client-side, so
# no endpoint accepts a name.
# ---------------------------------------------------------------------------
def search_entities(db: Session, query: str, limit: int = MAX_SEARCH_HITS) -> dict:
    q = (query or "").strip()
    if len(q) < 2:
        return {"error": "query_too_short",
                "message": "Give at least 2 characters to search for."}

    # Match on tokens, not the raw string. A payer types "Dr Smith" or "Dr. Alvarez"
    # and stored names look like "Dr. JOHN SMITH" — a single ILIKE '%Dr Smith%' finds
    # nothing because of the period and word order. Titles are dropped and every
    # remaining word must appear, so "wilson james" and "james wilson" both hit.
    cleaned = re.sub(r"^\s*(dr|dr\.|doctor|mr|mr\.|mrs|mrs\.|ms|ms\.)\s+", "", q, flags=re.I)
    tokens = [t for t in re.split(r"[\s,]+", cleaned) if len(t) >= 2]
    like = f"%{cleaned or q}%"
    if tokens:
        name_match = and_(*[NpiProfile.physician_name.ilike(f"%{t}%") for t in tokens])
    else:
        name_match = NpiProfile.physician_name.ilike(like)
    name_or_npi = or_(name_match, NpiProfile.npi.like(f"{q}%"))

    # Physicians billing in THIS plan only. npi_profiles is the full ~692k-row
    # NPPES registry while the plan has ~100 scored NPIs, so an unrestricted
    # name search returns thousands of physicians with no claims here (and scans
    # the whole table). Joining through npi_risk_scores keeps both problems away.
    phys_rows = (
        db.query(NpiProfile, NpiRiskScore)
        .join(NpiRiskScore, and_(NpiRiskScore.entity_id == NpiProfile.npi,
                                 NpiRiskScore.entity_type == "npi"))
        .filter(name_or_npi)
        .order_by(NpiRiskScore.risk_score.desc())
        .limit(limit).all()
    )
    physicians = [{
        "npi": p.npi,
        "name": p.physician_name,
        "specialty": p.specialty,
        "state": p.practice_state,
        "risk_score": s.risk_score,
        "risk_band": get_risk_band(s.risk_score),
    } for p, s in phys_rows]

    # Vendor names are multi-word too ("1ST CALEBS SIL & PCA RESTORATION INC"), so
    # they get the same all-tokens-present treatment.
    if tokens:
        vendor_match = and_(*[NpiRiskScore.entity_name.ilike(f"%{t}%") for t in tokens])
    else:
        vendor_match = NpiRiskScore.entity_name.ilike(like)
    vendor_rows = (
        db.query(NpiRiskScore)
        .filter(NpiRiskScore.entity_type == "supplier",
                or_(vendor_match, NpiRiskScore.entity_id.ilike(like)))
        .order_by(NpiRiskScore.risk_score.desc())
        .limit(limit).all()
    )
    vendors = [{
        "vendor_id": v.entity_id,
        "name": v.entity_name,
        "risk_score": v.risk_score,
        "risk_band": get_risk_band(v.risk_score),
        "on_oig_list": bool(v.oig_flag),
        "distinct_npi_count": v.distinct_npi_count,
    } for v in vendor_rows]

    out: dict[str, Any] = {"query": q, "physicians": physicians, "vendors": vendors}
    if not physicians and not vendors:
        # Nothing bills in this plan under that name. Check the national registry
        # too, so "who is Dr X?" can be answered "real NPI, but no claims here"
        # rather than a flat no — a meaningful distinction for an investigator.
        registry = (db.query(NpiProfile).filter(name_or_npi).limit(3).all())
        if registry:
            out["registry_only_matches"] = [{
                "npi": p.npi, "name": p.physician_name,
                "specialty": p.specialty, "state": p.practice_state,
            } for p in registry]
            out["message"] = (
                f"No physician or vendor with claims in this plan matches '{q}'. The "
                "national NPI registry does have similar names (registry_only_matches) "
                "but they have no claims, no risk score and no flags in this plan.")
        else:
            out["message"] = (f"Nothing matches '{q}' — not in this plan's data and not "
                              "in the NPI registry.")
    return out


# ---------------------------------------------------------------------------
# get_physician — everything the assistant needs about one NPI.
# Built from a handful of aggregates rather than get_npi_detail, which loads the
# NPI's full claim set (up to 1000 rows) for the detail screen's client-side
# filters — far too much to hand an LLM, and slow to build per question.
# ---------------------------------------------------------------------------
def get_physician(db: Session, npi: str) -> dict:
    npi = (npi or "").strip()
    profile = db.query(NpiProfile).filter(NpiProfile.npi == npi).first()
    if not profile:
        # A model handed a name instead of an NPI shouldn't get a flat "doesn't
        # exist" — hand back candidates so it can retry with a real NPI.
        out = {"error": "not_found",
               "message": f"No physician with NPI '{npi}' exists in this plan's data."}
        if not npi.isdigit():
            hits = search_entities(db, npi).get("physicians") or []
            if hits:
                out["message"] = (f"'{npi}' is not an NPI. These physicians in the plan match "
                                  "that text — call get_physician again with one of their NPIs.")
                out["did_you_mean"] = hits
        return out

    score = (db.query(NpiRiskScore)
             .filter_by(entity_type="npi", entity_id=npi).first())

    vendor_rows = (
        db.query(Claim.vendor_id, Claim.vendor_name,
                 func.count(Claim.id).label("cnt"),
                 func.sum(Claim.claim_amount).label("amt"))
        .filter(Claim.npi == npi)
        .group_by(Claim.vendor_id, Claim.vendor_name)
        .order_by(func.sum(Claim.claim_amount).desc())
        .limit(MAX_TOP_VENDORS).all()
    )
    # Shared with the scorer and the NPI detail screen's score breakdown, so all
    # three quote the same points for the same flags.
    feedback = physician_feedback(db, Action.npi, npi)

    out: dict[str, Any] = {
        "npi": profile.npi,
        "name": profile.physician_name,
        "specialty": profile.specialty,
        "practice_city": profile.practice_city,
        "practice_state": profile.practice_state,
        "enrollment_date": profile.enrollment_date.isoformat() if profile.enrollment_date else None,
        "on_oig_exclusion_list": bool(profile.oig_excluded),
        "claims": _claim_window(db, npi=npi),
        "fraud_patterns_fired": _fired_patterns(db, npi=npi),
        "top_vendors_by_amount": [{
            "vendor_id": v.vendor_id, "name": v.vendor_name,
            "claim_count": v.cnt, "total_billed": _money(v.amt),
        } for v in vendor_rows],
        "physician_feedback": {
            "total_flags": feedback.count,
            "by_action": feedback.by_action,
            "points_added_to_score": feedback.points,
        },
        "disputes": _dispute_counts(db, npi=npi),
    }

    if score:
        band = get_risk_band(score.risk_score)
        lo, hi = RISK_BAND_BOUNDS[band]
        out["risk"] = {
            "risk_score": score.risk_score,
            "risk_band": band,
            "band_range": f"{lo}-{hi}",
            "top_vendor_name": score.top_vendor_name,
            "physician_flag_count": score.physician_flag_count,
            "last_calculated": score.last_calculated.isoformat() if score.last_calculated else None,
            "scored_out_of": 100,
        }
    else:
        out["risk"] = None
        out["risk_note"] = "This NPI has no risk score yet — it has not been scored."
    return out


# ---------------------------------------------------------------------------
# get_vendor — one supplier, its patterns, and who bills through it.
# Vendors are keyed by claims.vendor_id (== npi_risk_scores.entity_id). Note
# supplier_profiles is keyed by NPI instead, so it's reached via claims.vendor_npi.
# ---------------------------------------------------------------------------
def get_vendor(db: Session, vendor_id: str) -> dict:
    vendor_id = (vendor_id or "").strip()
    score = (db.query(NpiRiskScore)
             .filter_by(entity_type="supplier", entity_id=vendor_id).first())

    # Vendor ids are opaque (sup-6ae3c9720aa4) but people say the NAME, and an LLM
    # asked about "01030712 LLC" will pass that straight in as the id. Resolve a
    # name to its vendor rather than reporting a real vendor as non-existent.
    if not score:
        by_name = (db.query(NpiRiskScore)
                   .filter(NpiRiskScore.entity_type == "supplier",
                           NpiRiskScore.entity_name.ilike(f"%{vendor_id}%"))
                   .order_by(NpiRiskScore.risk_score.desc()).all())
        if len(by_name) == 1:
            score = by_name[0]
            vendor_id = score.entity_id
        elif len(by_name) > 1:
            return {"error": "ambiguous_vendor",
                    "message": f"'{vendor_id}' matches {len(by_name)} vendors — pick one by id.",
                    "matches": [{"vendor_id": v.entity_id, "name": v.entity_name,
                                 "risk_score": v.risk_score} for v in by_name[:MAX_SEARCH_HITS]]}

    name_row = (db.query(Claim.vendor_name, Claim.vendor_npi, Claim.vendor_state)
                .filter(Claim.vendor_id == vendor_id).first())
    if not score and not name_row:
        return {"error": "not_found",
                "message": (f"No vendor matching '{vendor_id}' exists in this plan's data — "
                            "not by id and not by name.")}

    phys_rows = (
        db.query(Claim.npi,
                 func.count(Claim.id).label("cnt"),
                 func.sum(Claim.claim_amount).label("amt"))
        .filter(Claim.vendor_id == vendor_id)
        .group_by(Claim.npi)
        .order_by(func.count(Claim.id).desc())
        .limit(MAX_VENDOR_PHYSICIANS).all()
    )
    name_map = {}
    if phys_rows:
        name_map = dict(
            db.query(NpiProfile.npi, NpiProfile.physician_name)
            .filter(NpiProfile.npi.in_([r.npi for r in phys_rows])).all()
        )
    total_npis = (db.query(func.count(func.distinct(Claim.npi)))
                  .filter(Claim.vendor_id == vendor_id).scalar() or 0)

    out: dict[str, Any] = {
        "vendor_id": vendor_id,
        "name": score.entity_name if score else (name_row.vendor_name if name_row else None),
        "state": name_row.vendor_state if name_row else None,
        "vendor_npi": name_row.vendor_npi if name_row else None,
        "claims": _claim_window(db, vendor_id=vendor_id),
        "distinct_physician_count": total_npis,
        "fraud_patterns_fired": _fired_patterns(db, vendor_id=vendor_id),
        "top_physicians_by_claims": [{
            "npi": r.npi,
            "name": name_map.get(r.npi) or f"NPI {r.npi}",
            "claim_count": r.cnt,
            "total_billed": _money(r.amt),
        } for r in phys_rows],
    }
    if total_npis > len(phys_rows):
        out["top_physicians_note"] = (f"Showing the {len(phys_rows)} busiest of "
                                      f"{total_npis} physicians billing this vendor.")

    if score:
        out["risk"] = {
            "risk_score": score.risk_score,
            "risk_band": get_risk_band(score.risk_score),
            "on_oig_list": bool(score.oig_flag),
            "distinct_npi_count": score.distinct_npi_count,
            "physician_flag_count": score.physician_flag_count,
            "last_calculated": score.last_calculated.isoformat() if score.last_calculated else None,
        }
    else:
        out["risk"] = None
        out["risk_note"] = "This vendor has claims but no risk score yet."

    if name_row and name_row.vendor_npi:
        sp = (db.query(SupplierProfile)
              .filter(SupplierProfile.npi == name_row.vendor_npi).first())
        if sp:
            out["profile"] = {
                "supplier_name": sp.supplier_name,
                "supplier_type": sp.supplier_type,
                "city": sp.city,
                "state": sp.state,
                "enrollment_date": sp.enrollment_date.isoformat() if sp.enrollment_date else None,
                "on_oig_exclusion_list": bool(sp.oig_excluded),
            }
    return out


# ---------------------------------------------------------------------------
# get_rule_evidence — the actual flagged claims behind one pattern, so an answer
# can cite specifics instead of asserting a rule fired.
# ---------------------------------------------------------------------------
def get_rule_evidence(db: Session, rule_name: str, npi: Optional[str] = None,
                      vendor_id: Optional[str] = None,
                      limit: int = MAX_EVIDENCE_CLAIMS) -> dict:
    if not npi and not vendor_id:
        return {"error": "missing_target",
                "message": "Pass either an npi or a vendor_id to pull evidence for."}
    limit = max(1, min(limit, MAX_EVIDENCE_CLAIMS))

    try:
        if npi:
            raw = rule_evidence(npi=npi, rule_name=rule_name, db=db)
        else:
            raw = supplier_rule_evidence(supplier_id=vendor_id, rule_name=rule_name, db=db)
    except HTTPException as e:
        detail = e.detail if isinstance(e.detail, dict) else {"error": str(e.detail)}
        log.info(f"rule evidence miss: rule={rule_name} npi={npi} vendor={vendor_id} -> {detail}")
        return {"error": detail.get("code", "not_found"),
                "message": detail.get("error", "Could not load evidence.")}

    # The NPI-side handler returns every matching claim uncapped (the vendor side
    # caps at 300); either way the slice here is what bounds the context.
    claims = raw.get("claims") or []
    total = raw.get("count", len(claims))

    # Each handler omits whichever party is the subject of the query — the NPI one
    # has no vendor_name per claim, the vendor one no physician_name. Name the
    # subject once here and drop the empty per-claim key rather than emitting nulls.
    if npi:
        target = {"npi": npi, "physician_name": raw.get("physician_name")}
    else:
        vendor_name = (db.query(NpiRiskScore.entity_name)
                       .filter_by(entity_type="supplier", entity_id=vendor_id).scalar())
        target = {"vendor_id": vendor_id, "vendor_name": vendor_name}

    examples = []
    for c in claims[:limit]:
        row = {
            "patient_name": c.get("patient_name"),
            "date_of_service": c.get("date_of_service"),
            "service": c.get("service_description"),
            "service_category": c.get("service_category"),
            "amount": c.get("claim_amount"),
            "why_flagged": c.get("why"),
            "severity": c.get("severity"),
        }
        # The counterparty — vendor on an NPI query, physician on a vendor query.
        if c.get("vendor_name"):
            row["vendor_name"] = c["vendor_name"]
        if c.get("physician_name"):
            row["physician_name"] = c["physician_name"]
        examples.append(row)

    out = {
        "rule": rule_name,
        "label": raw.get("label"),
        "what_it_means": raw.get("explanation"),
        "flagged_claim_count": total,
        "target": target,
        "example_claims": examples,
    }
    if total > len(out["example_claims"]):
        out["example_claims_note"] = (f"Showing {len(out['example_claims'])} of {total} "
                                      "flagged claims.")
    return out


# ---------------------------------------------------------------------------
# list_top_risk — ranked physicians or vendors, optionally filtered.
# ---------------------------------------------------------------------------
def list_top_risk(db: Session, kind: str = "physicians", risk_band: Optional[str] = None,
                  pattern: Optional[str] = None, state: Optional[str] = None,
                  specialty: Optional[str] = None, oig_only: bool = False,
                  min_flags: int = 0, limit: int = 10) -> dict:
    limit = max(1, min(limit, MAX_LIST_ROWS))
    kind = (kind or "physicians").lower()

    if kind.startswith("vendor") or kind.startswith("supplier"):
        page = get_supplier_watchlist(page=0, page_size=limit, oig_only=bool(oig_only),
                                      min_flags=int(min_flags or 0), db=db)
        return {
            "kind": "vendors",
            "total_matching": page.total,
            "shown": len(page.items),
            **_truncation_note(page.total, len(page.items), "vendors"),
            "vendors": [{
                "vendor_id": v.vendor_id, "name": v.vendor_name,
                "risk_score": v.risk_score, "risk_band": v.risk_band,
                "on_oig_list": bool(v.oig_flag),
                "distinct_npi_count": v.distinct_npi_count,
                "physician_flag_count": v.physician_flag_count,
                "claim_count": v.total_claim_count,
                "total_billed": _money(v.total_claim_amount),
            } for v in page.items],
            "sorted_by": "physician flag count, then risk score",
        }

    band = (risk_band or "").lower() or None
    if band not in (None, "all", *RISK_BAND_ORDER):
        band = None

    page = get_npi_risk_list(page=0, page_size=limit, min_score=0, state=state,
                             specialty=specialty, risk_band=band,
                             pattern_filter=pattern, db=db)
    return {
        "kind": "physicians",
        "total_matching": page.total,
        "shown": len(page.items),
        **_truncation_note(page.total, len(page.items), "physicians"),
        "filters_applied": {"risk_band": band, "pattern": pattern,
                            "state": state, "specialty": specialty},
        "physicians": [{
            "npi": p.npi, "name": p.physician_name, "specialty": p.specialty,
            "city": p.practice_city, "state": p.practice_state,
            "risk_score": p.risk_score, "risk_band": p.risk_band,
            "claim_count": p.total_claim_count,
            "total_billed": _money(p.total_claim_amount),
            "physician_flag_count": p.physician_flag_count,
            "top_vendor_name": p.top_vendor_name,
        } for p in page.items],
        "sorted_by": "risk score, then physician flag count",
    }


# ---------------------------------------------------------------------------
# plan_overview — the plan-wide numbers, for "how many…" / "overall" questions.
# ---------------------------------------------------------------------------
def plan_overview(db: Session) -> dict:
    summary = get_plan_summary(db=db)

    npi_bands = band_counts(db, "npi")
    vendor_bands = band_counts(db, "supplier")

    vendor_stats = db.query(
        func.count(NpiRiskScore.id).label("total"),
        func.sum(case((NpiRiskScore.oig_flag.is_(True), 1), else_=0)).label("oig"),
    ).filter(NpiRiskScore.entity_type == "supplier").one()

    rule_rows = (
        db.query(RulesFlag.rule_name, func.count(RulesFlag.id).label("cnt"))
        .group_by(RulesFlag.rule_name)
        .order_by(func.count(RulesFlag.id).desc()).all()
    )
    pts = rule_points()

    # Band names and ranges come from the shared definition, so the assistant
    # describes risk in the same four buckets the payer sees on screen.
    def _by_band(counts: dict) -> dict:
        return {f"{b} ({RISK_BAND_BOUNDS[b][0]}-{RISK_BAND_BOUNDS[b][1]})": counts[b]
                for b in RISK_BAND_ORDER}

    return {
        "risk_bands_explained": "critical 81-100, high 61-80, medium 31-60, low 0-30",
        "physicians": {
            "total_scored": npi_bands["total"],
            "by_band": _by_band(npi_bands),
        },
        "vendors": {
            "total_scored": vendor_stats.total or 0,
            "by_band": _by_band(vendor_bands),
            "on_oig_exclusion_list": int(vendor_stats.oig or 0),
        },
        "claims": _claim_window(db),
        "physician_feedback": {
            "total_flags_all_time": summary.total_physician_flags,
            "flags_today": summary.alerts_today,
        },
        "fraud_patterns_fired": [{
            "rule": r.rule_name, "label": rule_label(r.rule_name),
            "points": pts.get(r.rule_name, 0), "claim_count": r.cnt,
        } for r in rule_rows],
        "disputes": _dispute_counts(db),
    }


# ---------------------------------------------------------------------------
# get_patient — the beneficiary side. Identity reuse and deceased-patient billing
# are patient-centred patterns, so "who is this patient and who billed them" is a
# real investigative question that none of the entity tools can answer.
# ---------------------------------------------------------------------------
def get_patient(db: Session, patient: str) -> dict:
    p = (patient or "").strip()
    if len(p) < 2:
        return {"error": "query_too_short", "message": "Give a patient id or name."}

    rows = db.query(Claim.patient_id).filter(Claim.patient_id == p).limit(1).all()
    if rows:
        patient_id = p
    else:
        # Name lookup, tokenised like search_entities so "Maria Smith" matches.
        tokens = [t for t in re.split(r"[\s,]+", p) if len(t) >= 2]
        match = (and_(*[Claim.patient_name.ilike(f"%{t}%") for t in tokens])
                 if tokens else Claim.patient_name.ilike(f"%{p}%"))
        ids = [r[0] for r in db.query(Claim.patient_id).filter(match).distinct().limit(6).all()]
        if not ids:
            return {"error": "not_found",
                    "message": f"No patient matching '{p}' appears on any claim in this plan."}
        if len(ids) > 1:
            people = (db.query(Claim.patient_id, Claim.patient_name, Claim.patient_state)
                      .filter(Claim.patient_id.in_(ids)).distinct().all())
            return {"error": "ambiguous_patient",
                    "message": f"'{p}' matches {len(ids)} patients — ask again with a patient id.",
                    "matches": [{"patient_id": i, "name": n if EXPOSE_PATIENT_NAMES else None,
                                 "state": s} for i, n, s in people]}
        patient_id = ids[0]

    head = (db.query(Claim.patient_name, Claim.patient_state, Claim.patient_zip)
            .filter(Claim.patient_id == patient_id).first())

    phys = (db.query(Claim.npi, func.count(Claim.id).label("cnt"),
                     func.sum(Claim.claim_amount).label("amt"))
            .filter(Claim.patient_id == patient_id)
            .group_by(Claim.npi).order_by(func.count(Claim.id).desc()).all())
    names = dict(db.query(NpiProfile.npi, NpiProfile.physician_name)
                 .filter(NpiProfile.npi.in_([r.npi for r in phys])).all()) if phys else {}
    vendors = (db.query(Claim.vendor_id, Claim.vendor_name, func.count(Claim.id).label("cnt"))
               .filter(Claim.patient_id == patient_id)
               .group_by(Claim.vendor_id, Claim.vendor_name)
               .order_by(func.count(Claim.id).desc()).limit(MAX_TOP_VENDORS).all())
    window = db.query(func.count(Claim.id).label("cnt"),
                      func.sum(Claim.claim_amount).label("amt"),
                      func.min(Claim.date_of_service).label("first"),
                      func.max(Claim.date_of_service).label("last")
                      ).filter(Claim.patient_id == patient_id).one()
    fired = (db.query(RulesFlag.rule_name, func.count(RulesFlag.id).label("cnt"))
             .join(Claim, Claim.id == RulesFlag.claim_id)
             .filter(Claim.patient_id == patient_id)
             .group_by(RulesFlag.rule_name).all())
    pts = rule_points()

    out = {
        "patient_id": patient_id,
        "state": head.patient_state if head else None,
        "zip": head.patient_zip if head else None,
        "claims": {
            "claim_count": window.cnt or 0,
            "total_billed": _money(window.amt),
            "first_claim_date": window.first.isoformat() if window.first else None,
            "last_claim_date": window.last.isoformat() if window.last else None,
        },
        "distinct_physician_count": len(phys),
        "billed_by_physicians": [{
            "npi": r.npi, "name": names.get(r.npi) or f"NPI {r.npi}",
            "claim_count": r.cnt, "total_billed": _money(r.amt),
        } for r in phys[:MAX_VENDOR_PHYSICIANS]],
        "billed_by_vendors": [{
            "vendor_id": v.vendor_id, "name": v.vendor_name, "claim_count": v.cnt,
        } for v in vendors],
        "fraud_patterns_on_their_claims": sorted(
            [{"rule": r.rule_name, "label": rule_label(r.rule_name),
              "points": pts.get(r.rule_name, 0), "claim_count": r.cnt} for r in fired],
            key=lambda x: (-x["points"], -x["claim_count"])),
    }
    if EXPOSE_PATIENT_NAMES and head:
        out["name"] = head.patient_name
    if len(phys) >= 3:
        out["identity_reuse_note"] = (
            f"This patient is billed under {len(phys)} different physician NPIs, which is "
            "the identity-reuse threshold — worth checking whether the physicians are related.")
    return out


# ---------------------------------------------------------------------------
# get_claim — one claim by the CCN users actually see on screen.
# ---------------------------------------------------------------------------
def get_claim(db: Session, ccn: str) -> dict:
    ref = (ccn or "").strip()
    if not ref:
        return {"error": "missing_ccn", "message": "Give a claim control number (CCN)."}

    claim = db.query(Claim).filter(Claim.ccn == ref).first()
    if not claim and _is_uuid(ref):
        # Users sometimes paste the internal UUID from a URL instead of the CCN.
        # Guarded by _is_uuid because querying a uuid column with a non-uuid string
        # raises in postgres and leaves the transaction aborted — which would break
        # every later tool call in the same conversation turn, not just this one.
        claim = db.query(Claim).filter(Claim.id == ref).first()
    if not claim:
        return {"error": "not_found",
                "message": f"No claim with CCN '{ref}' exists in this plan's data."}

    physician = (db.query(NpiProfile.physician_name)
                 .filter(NpiProfile.npi == claim.npi).scalar())
    flags = (db.query(RulesFlag.rule_name, RulesFlag.rule_description, RulesFlag.severity)
             .filter(RulesFlag.claim_id == claim.id).all())
    actions = (db.query(Action.action_type, Action.note, Action.created_at)
               .filter(Action.claim_id == claim.id)
               .order_by(Action.created_at.asc()).all())

    out = {
        "ccn": claim.ccn,
        "date_of_service": claim.date_of_service.isoformat() if claim.date_of_service else None,
        "physician": {"npi": claim.npi, "name": physician or f"NPI {claim.npi}"},
        "vendor": {"vendor_id": claim.vendor_id, "name": claim.vendor_name},
        "service": claim.service_description,
        "service_category": claim.service_category,
        "codes": {"cpt": claim.cpt_code, "hcpcs": claim.hcpcs_code},
        "amount": _money(claim.claim_amount),
        "oig_flagged": bool(claim.oig_flagged),
        "reviewed": bool(claim.reviewed),
        "verification_status": claim.verification_status,
        "flags_fired": [{"rule": r.rule_name, "label": rule_label(r.rule_name),
                         "why": r.rule_description, "severity": r.severity} for r in flags],
        "physician_actions": [{
            "action": a.action_type, "note": a.note,
            "at": a.created_at.isoformat() if a.created_at else None,
        } for a in actions],
    }
    if EXPOSE_PATIENT_NAMES:
        out["patient"] = {"patient_id": claim.patient_id, "name": claim.patient_name,
                          "state": claim.patient_state}
    else:
        out["patient"] = {"patient_id": claim.patient_id, "state": claim.patient_state}
    return out


# ---------------------------------------------------------------------------
# get_dispute_case — status plus the append-only timeline, which is what actually
# answers "why is this case still open".
# ---------------------------------------------------------------------------
# Plain-English status names. Mirrors PLAN_STATUS_LABEL in frontend/src/App.jsx so
# the assistant calls a status what the payer's screen calls it.
DISPUTE_STATUS_LABEL = {
    "OPEN": "Open — awaiting the vendor's documents",
    "PENDING_PHYSICIAN_REVIEW": "Awaiting physician review of the vendor's documents",
    "RESPONDED_TO_MEDICARE": "Vendor responded to Medicare",
    "RESOLVED_BY_PHYSICIAN": "Resolved by the physician",
    "NON_RESPONSIVE": "Non-responsive — the vendor missed the deadline",
    "REFERRED_TO_PAYER": "Physician declined the documents — now with the payer",
    "REFERRED_OIG": "Referred to OIG",
    "CLOSED": "Closed",
    "PENDING_PHYSICIAN_CONFIRMATION": "Legacy status from the retired confirmation flow",
}

# What the case is waiting on, so "why is it still open" gets an actual answer.
DISPUTE_NEXT_STEP = {
    "OPEN": "The vendor still has time to upload proof-of-work documents.",
    "PENDING_PHYSICIAN_REVIEW": ("The vendor has uploaded documents; the physician must "
                                 "approve them (case resolves) or decline them (case comes "
                                 "to the payer)."),
    "NON_RESPONSIVE": "The vendor never responded — this is ready for payer escalation.",
    "REFERRED_TO_PAYER": "The physician rejected the vendor's documents. The payer owns it now.",
    "RESOLVED_BY_PHYSICIAN": "Nothing pending — the physician accepted the vendor's response.",
    "RESPONDED_TO_MEDICARE": "The vendor escalated to Medicare directly; nothing pending here.",
}


def get_dispute_case(db: Session, case_id: int) -> dict:
    try:
        cid = int(case_id)
    except (TypeError, ValueError):
        return {"error": "bad_case_id", "message": f"'{case_id}' is not a case number."}

    case = db.query(DisputeCase).filter(DisputeCase.case_id == cid).first()
    if not case:
        return {"error": "not_found", "message": f"No dispute case {cid} exists."}

    physician = (db.query(NpiProfile.physician_name)
                 .filter(NpiProfile.npi == case.physician_npi).scalar())
    # Reuses the timeline serializer the three portals' own timelines use, so the
    # assistant's history and the on-screen history can't diverge. Doc download
    # links are dropped — a chat answer can't use them.
    timeline = [{
        "event": e["event_type"], "actor": e["actor"], "note": e["note"],
        "at": e["created_at"], "document_count": len(e.get("docs") or []),
    } for e in serialize_dispute_events(db, cid, base_url="")]

    return {
        "case_id": cid,
        "status": case.status,
        "status_meaning": DISPUTE_STATUS_LABEL.get(case.status, case.status),
        "waiting_on": DISPUTE_NEXT_STEP.get(case.status, "No further action is recorded."),
        "dispute_type": case.dispute_type,
        "physician": {"npi": case.physician_npi, "name": physician or f"NPI {case.physician_npi}"},
        "vendor_npi": case.vendor_npi,
        "opened_at": case.opened_at.isoformat() if case.opened_at else None,
        "response_due_date": case.response_due_date.isoformat() if case.response_due_date else None,
        "vendor_responded_at": case.vendor_responded_at.isoformat() if case.vendor_responded_at else None,
        "closed_at": case.closed_at.isoformat() if case.closed_at else None,
        "vendor_response": case.vendor_response,
        "document_count": len(case.vendor_docs or []),
        "physician_notes": case.physician_notes,
        "resolution_notes": case.resolution_notes,
        "timeline": timeline,
    }


# ---------------------------------------------------------------------------
# check_oig — the federal exclusion list itself, not the derived oig_flag.
# ---------------------------------------------------------------------------
def check_oig(db: Session, npi_or_name: str) -> dict:
    q = (npi_or_name or "").strip()
    if len(q) < 2:
        return {"error": "query_too_short", "message": "Give an NPI or entity name to check."}

    if q.isdigit():
        row = db.query(OigExcludedNpi).filter(OigExcludedNpi.npi == q).first()
        if row:
            return {"query": q, "excluded": True, "matched_on": "npi",
                    "entity_name": row.entity_name, "exclusion_type": row.exclusion_type,
                    "exclusion_date": row.exclusion_date.isoformat() if row.exclusion_date else None,
                    "state": row.state,
                    "consequence": ("Medicare and Medicaid cannot reimburse an excluded entity, "
                                    "so claims involving it are recoverable.")}
        return {"query": q, "excluded": False,
                "message": f"NPI {q} is not on the OIG exclusion list."}

    tokens = [t for t in re.split(r"[\s,]+", q) if len(t) >= 2]
    match = (and_(*[OigExcludedName.entity_name.ilike(f"%{t}%") for t in tokens])
             if tokens else OigExcludedName.entity_name.ilike(f"%{q}%"))
    rows = db.query(OigExcludedName).filter(match).limit(MAX_SEARCH_HITS).all()
    if rows:
        return {"query": q, "excluded": True, "matched_on": "name",
                "matches": [{"entity_name": r.entity_name, "exclusion_type": r.exclusion_type,
                             "exclusion_date": r.exclusion_date.isoformat() if r.exclusion_date else None,
                             "state": r.state} for r in rows],
                "caveat": ("Name matches are not conclusive — different entities share names. "
                           "Confirm by NPI before acting.")}
    return {"query": q, "excluded": False,
            "message": f"No OIG exclusion record matches the name '{q}'."}


# Name -> callable, for the agent loop and the verification script.
# Data tools take a Session first; the knowledge tools don't touch the DB at all.
TOOL_FUNCTIONS = {
    "search_entities": search_entities,
    "get_physician": get_physician,
    "get_vendor": get_vendor,
    "get_rule_evidence": get_rule_evidence,
    "list_top_risk": list_top_risk,
    "plan_overview": plan_overview,
    "get_patient": get_patient,
    "get_claim": get_claim,
    "get_dispute_case": get_dispute_case,
    "check_oig": check_oig,
}

# Knowledge tools — no DB access. explain_rule/explain_scoring answer from the
# curated glossary; search_docs retrieves from the product's own specs in docs/.
KNOWLEDGE_TOOL_FUNCTIONS = {
    "explain_rule": explain_rule,
    "explain_scoring": explain_scoring,
    "search_docs": search_docs,
}
