import json
import logging
import time
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from backend.config import get_settings
from backend.database import get_db
from backend.models import Action, Claim, NpiProfile, NpiRiskScore, RulesFlag

router = APIRouter()
log = logging.getLogger("analytics")

FLAG_ACTIONS = ("flag_supplier", "unknown_patient", "did_not_order")

# Simple in-memory context cache — avoids re-running all DB queries on every request
_ctx_cache: dict = {}
_CACHE_TTL = 45  # seconds

SYSTEM_PROMPT = (
    "You are a Medicare/Medicaid fraud analytics AI. "
    "Given aggregated claims data and a query, return ONLY this JSON (no markdown):\n"
    '{"chart_type":"bar|line|pie|scatter|table|stat","title":"...","insight":"1-2 sentences",'
    '"data":<structure>,"x_label":"...|null","y_label":"...|null"}\n'
    "chart_type rules: bar=comparisons, line=trends, pie=proportions, scatter=correlation, table=detail, stat=single KPI.\n"
    "data shapes: bar/line={labels:[],values:[]}, pie={labels:[],values:[]}, "
    "scatter={points:[{x,y,label}]}, table={columns:[],rows:[[]]}, stat={value,label,sublabel}.\n"
    "CRITICAL: ONLY include rows/data points that are EXPLICITLY listed in the context. "
    "NEVER invent, hallucinate, or fill in fictional names, NPIs, or values. "
    "If the context has 5 items and the query asks for 10, return only 5 real items. "
    "All values in table rows must be real numbers or strings from the data — never null. "
    "If unanswerable: chart_type=stat, value='No data', explain in insight."
)


class AnalyticsFilters(BaseModel):
    vendor_id: Optional[str] = None
    npi: Optional[str] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    amount_min: Optional[float] = None
    amount_max: Optional[float] = None


class AnalyticsQueryRequest(BaseModel):
    query: str
    conversation_history: List[Dict[str, Any]] = []
    portal: str
    npi: Optional[str] = None
    filters: Optional[AnalyticsFilters] = None


def _apply_claim_filters(q, filters: Optional[AnalyticsFilters]):
    if not filters:
        return q
    if filters.vendor_id:
        q = q.filter(Claim.vendor_id == filters.vendor_id)
    if filters.date_from:
        q = q.filter(Claim.date_of_service >= filters.date_from)
    if filters.date_to:
        q = q.filter(Claim.date_of_service <= filters.date_to)
    if filters.amount_min is not None:
        q = q.filter(Claim.claim_amount >= filters.amount_min)
    if filters.amount_max is not None:
        q = q.filter(Claim.claim_amount <= filters.amount_max)
    return q


def _build_physician_context(db: Session, npi: str, filters: Optional[AnalyticsFilters]) -> str:
    base = db.query(Claim).filter(Claim.npi == npi)
    base = _apply_claim_filters(base, filters)

    total_claims = base.count()
    total_amount = db.query(func.sum(Claim.claim_amount)).filter(Claim.npi == npi).scalar() or 0

    supplier_rows = (
        db.query(
            Claim.vendor_name,
            func.count(Claim.id).label("cnt"),
            func.sum(Claim.claim_amount).label("amt"),
        )
        .filter(Claim.npi == npi)
        .group_by(Claim.vendor_name)
        .order_by(func.count(Claim.id).desc())
        .limit(10)
        .all()
    )

    monthly_rows = (
        db.query(
            func.to_char(Claim.date_of_service, "YYYY-MM").label("month"),
            func.count(Claim.id).label("cnt"),
            func.sum(Claim.claim_amount).label("amt"),
        )
        .filter(Claim.npi == npi)
        .group_by(func.to_char(Claim.date_of_service, "YYYY-MM"))
        .order_by(func.to_char(Claim.date_of_service, "YYYY-MM").desc())
        .limit(12)
        .all()
    )

    category_rows = (
        db.query(
            Claim.service_category,
            func.count(Claim.id).label("cnt"),
            func.sum(Claim.claim_amount).label("amt"),
        )
        .filter(Claim.npi == npi)
        .group_by(Claim.service_category)
        .order_by(func.count(Claim.id).desc())
        .all()
    )

    rule_rows = (
        db.query(RulesFlag.rule_name, func.count(RulesFlag.id).label("cnt"))
        .join(Claim, Claim.id == RulesFlag.claim_id)
        .filter(RulesFlag.npi == npi)
        .group_by(RulesFlag.rule_name)
        .order_by(func.count(RulesFlag.id).desc())
        .all()
    )

    flagged_count = (
        db.query(func.count(func.distinct(Action.claim_id)))
        .filter(Action.npi == npi, Action.action_type.in_(FLAG_ACTIONS))
        .scalar()
    ) or 0

    lines = [
        f"PHYSICIAN ANALYTICS DATA (NPI: {npi})",
        f"Total claims: {total_claims}",
        f"Total amount billed: ${float(total_amount):,.2f}",
        f"Flagged claims (physician actions): {flagged_count}",
        "",
        "Claims by supplier (top 10):",
    ]
    for r in supplier_rows:
        lines.append(f"  {r.vendor_name}: {r.cnt} claims, ${float(r.amt or 0):,.2f}")

    lines += ["", "Claims by month (last 12, newest first):"]
    for r in monthly_rows:
        lines.append(f"  {r.month}: {r.cnt} claims, ${float(r.amt or 0):,.2f}")

    lines += ["", "Claims by service category:"]
    for r in category_rows:
        lines.append(f"  {r.service_category or 'Unknown'}: {r.cnt} claims, ${float(r.amt or 0):,.2f}")

    lines += ["", "Fraud rule flags fired (by rule):"]
    if rule_rows:
        for r in rule_rows:
            lines.append(f"  {r.rule_name}: {r.cnt} times")
    else:
        lines.append("  None")

    return "\n".join(lines)


def _build_plan_context(db: Session, filters: Optional[AnalyticsFilters]) -> str:
    today = date.today()
    ninety_days_ago = today - timedelta(days=90)
    current_month_str = today.strftime("%Y-%m")

    # Single query for risk summary counts using CASE — 1 round-trip instead of 4
    risk_counts = db.query(
        func.count(NpiRiskScore.id).label("total"),
        func.sum(case((NpiRiskScore.risk_score > 70, 1), else_=0)).label("high"),
        func.sum(case(((NpiRiskScore.risk_score > 30) & (NpiRiskScore.risk_score <= 70), 1), else_=0)).label("med"),
        func.sum(case((NpiRiskScore.risk_score <= 30, 1), else_=0)).label("low"),
    ).filter(NpiRiskScore.entity_type == "npi").one()

    # Top 10 NPIs by risk (includes amount + flags — covers "top 10" queries)
    top_risk_rows = (
        db.query(NpiRiskScore, NpiProfile)
        .join(NpiProfile, NpiProfile.npi == NpiRiskScore.entity_id)
        .filter(NpiRiskScore.entity_type == "npi")
        .order_by(NpiRiskScore.risk_score.desc())
        .limit(10).all()
    )
    # Top 10 by amount (for "who billed most" queries)
    top_amount_rows = (
        db.query(NpiRiskScore, NpiProfile)
        .join(NpiProfile, NpiProfile.npi == NpiRiskScore.entity_id)
        .filter(NpiRiskScore.entity_type == "npi")
        .order_by(NpiRiskScore.total_claim_amount.desc())
        .limit(10).all()
    )

    rule_rows = (
        db.query(RulesFlag.rule_name, func.count(RulesFlag.id).label("cnt"))
        .group_by(RulesFlag.rule_name)
        .order_by(func.count(RulesFlag.id).desc())
        .limit(8).all()
    )

    claim_q = db.query(
        func.to_char(Claim.date_of_service, "YYYY-MM").label("month"),
        func.count(Claim.id).label("cnt"),
        func.sum(Claim.claim_amount).label("amt"),
    )
    if filters and filters.npi:
        claim_q = claim_q.filter(Claim.npi == filters.npi)
    monthly_rows = (
        claim_q.group_by(func.to_char(Claim.date_of_service, "YYYY-MM"))
        .order_by(func.to_char(Claim.date_of_service, "YYYY-MM").desc())
        .limit(6).all()
    )

    supplier_rows = (
        db.query(NpiRiskScore)
        .filter(NpiRiskScore.entity_type == "supplier")
        .order_by(NpiRiskScore.total_claim_amount.desc())
        .limit(10).all()
    )

    flag_trend_rows = (
        db.query(
            func.to_char(RulesFlag.fired_at, "YYYY-MM").label("month"),
            func.count(RulesFlag.id).label("cnt"),
        )
        .filter(RulesFlag.fired_at >= ninety_days_ago)
        .group_by(func.to_char(RulesFlag.fired_at, "YYYY-MM"))
        .order_by(func.to_char(RulesFlag.fired_at, "YYYY-MM"))
        .all()
    )

    action_trend_rows = (
        db.query(
            func.to_char(Action.created_at, "YYYY-MM").label("month"),
            func.count(Action.id).label("cnt"),
        )
        .filter(Action.action_type.in_(FLAG_ACTIONS), Action.created_at >= ninety_days_ago)
        .group_by(func.to_char(Action.created_at, "YYYY-MM"))
        .order_by(func.to_char(Action.created_at, "YYYY-MM"))
        .all()
    )

    top_month_npi_rows = (
        db.query(
            Claim.npi,
            NpiProfile.physician_name,
            func.count(Claim.id).label("cnt"),
            func.sum(Claim.claim_amount).label("amt"),
        )
        .join(NpiProfile, NpiProfile.npi == Claim.npi)
        .filter(func.to_char(Claim.date_of_service, "YYYY-MM") == current_month_str)
        .group_by(Claim.npi, NpiProfile.physician_name)
        .order_by(func.sum(Claim.claim_amount).desc())
        .limit(10).all()
    )

    lines = [
        "PLAN DATA",
        f"NPIs: {risk_counts.total} total | {risk_counts.high} high-risk(>70) | {risk_counts.med} medium | {risk_counts.low} low",
        "",
        "Top 5 NPIs by risk score (name, NPI, score, claims, amount, flags):",
    ]
    for s, p in top_risk_rows:
        lines.append(f"  {p.physician_name}|{s.entity_id}|score={s.risk_score}|{s.total_claim_count}claims|${float(s.total_claim_amount or 0):,.0f}|{s.physician_flag_count}flags")

    lines += ["", "Top 5 NPIs by total billed amount:"]
    for s, p in top_amount_rows:
        lines.append(f"  {p.physician_name}|{s.entity_id}|${float(s.total_claim_amount or 0):,.0f}|score={s.risk_score}")

    lines += ["", "Fraud rules fired (rule: count):"]
    lines += [f"  {r.rule_name}: {r.cnt}" for r in rule_rows] or ["  None"]

    lines += ["", "Claims by month (last 6, newest first):"]
    for r in monthly_rows:
        lines.append(f"  {r.month}: {r.cnt} claims, ${float(r.amt or 0):,.0f}")

    lines += ["", "Top 5 suppliers by claim volume:"]
    for s in supplier_rows:
        lines.append(f"  {s.entity_name}|${float(s.total_claim_amount or 0):,.0f}|{s.distinct_npi_count}NPIs|{s.physician_flag_count}flags")

    lines += ["", f"Top 5 NPIs by billing in {current_month_str}:"]
    if top_month_npi_rows:
        for r in top_month_npi_rows:
            lines.append(f"  {r.physician_name}|{r.npi}|{r.cnt}claims|${float(r.amt or 0):,.0f}")
    else:
        lines.append(f"  No claims in {current_month_str}.")

    lines += ["", f"Rules flags by month (last 90 days):"]
    lines += [f"  {r.month}: {r.cnt}" for r in flag_trend_rows] or ["  None"]

    lines += ["", f"Physician flag actions by month (last 90 days):"]
    lines += [f"  {r.month}: {r.cnt}" for r in action_trend_rows] or ["  None"]

    return "\n".join(lines)


def _cached_plan_context(db: Session, filters: Optional[AnalyticsFilters]) -> str:
    npi_key = (filters.npi or "") if filters else ""
    date_key = f"{(filters.date_from or '')}-{(filters.date_to or '')}" if filters else ""
    cache_key = f"plan:{npi_key}:{date_key}"
    now = time.monotonic()
    if cache_key in _ctx_cache:
        ts, ctx = _ctx_cache[cache_key]
        if now - ts < _CACHE_TTL:
            return ctx
    ctx = _build_plan_context(db, filters)
    _ctx_cache[cache_key] = (now, ctx)
    return ctx


def _risk_band(score) -> str:
    if score is None:
        return "low"
    if score > 70:
        return "high"
    if score > 30:
        return "mid"
    return "low"


_RULE_LABELS = {
    "geographic_anomaly": "Geographic Anomaly",
    "oig_leie_hit": "OIG LEIE Hit",
    "cross_npi_supplier": "Cross-NPI Supplier",
    "volume_spike": "Volume Spike",
    "duplicate_billing": "Duplicate Billing",
    "identity_reuse": "Identity Reuse",
    "abnormal_hospice_duration": "Hospice Duration",
    "upcoding": "Upcoding",
    "unbundling": "Unbundling",
    "impossible_day": "Impossible Day",
    "rapid_cycling": "Rapid Cycling",
    "modifier_abuse": "Modifier Abuse",
    "new_high_value_supplier": "New High-Value Supplier",
    "deceased_patient": "Deceased Patient",
    "supplier_concentration": "Supplier Concentration",
}


@router.get("/overview/risk-distribution")
def overview_risk_distribution(db: Session = Depends(get_db)):
    counts = db.query(
        func.sum(case((NpiRiskScore.risk_score > 70, 1), else_=0)).label("high"),
        func.sum(case(((NpiRiskScore.risk_score > 30) & (NpiRiskScore.risk_score <= 70), 1), else_=0)).label("mid"),
        func.sum(case((NpiRiskScore.risk_score <= 30, 1), else_=0)).label("low"),
    ).filter(NpiRiskScore.entity_type == "npi").one()
    return {
        "high": int(counts.high or 0),
        "mid": int(counts.mid or 0),
        "low": int(counts.low or 0),
    }


@router.get("/overview/top-npis")
def overview_top_npis(db: Session = Depends(get_db)):
    rows = (
        db.query(NpiRiskScore, NpiProfile)
        .join(NpiProfile, NpiProfile.npi == NpiRiskScore.entity_id)
        .filter(NpiRiskScore.entity_type == "npi")
        .order_by(NpiRiskScore.risk_score.desc())
        .limit(10).all()
    )
    return {
        "npis": [
            {
                "npi": s.entity_id,
                "name": p.physician_name or s.entity_id,
                "risk_score": round(float(s.risk_score or 0), 1),
                "total_claims": int(s.total_claim_count or 0),
                "risk_band": _risk_band(s.risk_score),
            }
            for s, p in rows
        ]
    }


@router.get("/overview/claims-trend")
def overview_claims_trend(db: Session = Depends(get_db)):
    today = date.today()
    m = today.month - 5
    y = today.year
    if m <= 0:
        m += 12
        y -= 1
    six_months_start = date(y, m, 1)

    months_keys, months_labels = [], []
    for i in range(6):
        mo = six_months_start.month + i
        yr = six_months_start.year
        if mo > 12:
            mo -= 12
            yr += 1
        months_keys.append(f"{yr:04d}-{mo:02d}")
        months_labels.append(datetime(yr, mo, 1).strftime("%b %Y"))

    total_rows = (
        db.query(
            func.to_char(Claim.date_of_service, "YYYY-MM").label("month"),
            func.count(Claim.id).label("cnt"),
        )
        .filter(Claim.date_of_service >= six_months_start)
        .group_by(func.to_char(Claim.date_of_service, "YYYY-MM"))
        .all()
    )
    flagged_rows = (
        db.query(
            func.to_char(Claim.date_of_service, "YYYY-MM").label("month"),
            func.count(func.distinct(Claim.id)).label("cnt"),
        )
        .join(RulesFlag, RulesFlag.claim_id == Claim.id)
        .filter(Claim.date_of_service >= six_months_start)
        .group_by(func.to_char(Claim.date_of_service, "YYYY-MM"))
        .all()
    )

    total_dict = {r.month: r.cnt for r in total_rows}
    flagged_dict = {r.month: r.cnt for r in flagged_rows}
    return {
        "months": months_labels,
        "total": [total_dict.get(k, 0) for k in months_keys],
        "flagged": [flagged_dict.get(k, 0) for k in months_keys],
    }


@router.get("/overview/rule-breakdown")
def overview_rule_breakdown(db: Session = Depends(get_db)):
    rows = (
        db.query(RulesFlag.rule_name, func.count(RulesFlag.id).label("cnt"))
        .group_by(RulesFlag.rule_name)
        .order_by(func.count(RulesFlag.id).desc())
        .limit(12).all()
    )
    return {
        "rules": [
            {
                "rule_name": r.rule_name,
                "label": _RULE_LABELS.get(r.rule_name, r.rule_name.replace("_", " ").title()),
                "count": int(r.cnt),
            }
            for r in rows
        ]
    }


def _six_month_window():
    """Return (six_months_start date, months_keys list, months_labels list)."""
    from datetime import date as _date
    today = _date.today()
    m = today.month - 5
    y = today.year
    if m <= 0:
        m += 12
        y -= 1
    start = _date(y, m, 1)
    keys, labels = [], []
    for i in range(6):
        mo = start.month + i
        yr = start.year
        if mo > 12:
            mo -= 12
            yr += 1
        keys.append(f"{yr:04d}-{mo:02d}")
        labels.append(datetime(yr, mo, 1).strftime("%b %Y"))
    return start, keys, labels


@router.get("/physician/claims-trend")
def physician_claims_trend(npi: str = Query(...), db: Session = Depends(get_db)):
    start, keys, labels = _six_month_window()
    rows = (
        db.query(
            func.to_char(Claim.date_of_service, "YYYY-MM").label("month"),
            func.count(Claim.id).label("cnt"),
        )
        .filter(Claim.npi == npi, Claim.date_of_service >= start)
        .group_by(func.to_char(Claim.date_of_service, "YYYY-MM"))
        .all()
    )
    cnt_dict = {r.month: r.cnt for r in rows}
    return {"months": labels, "counts": [cnt_dict.get(k, 0) for k in keys]}


@router.get("/physician/claims-by-supplier")
def physician_claims_by_supplier(npi: str = Query(...), db: Session = Depends(get_db)):
    rows = (
        db.query(
            Claim.vendor_name,
            func.count(Claim.id).label("cnt"),
            func.sum(Claim.claim_amount).label("amt"),
        )
        .filter(Claim.npi == npi)
        .group_by(Claim.vendor_name)
        .order_by(func.count(Claim.id).desc())
        .limit(6).all()
    )
    return {
        "suppliers": [
            {
                "vendor_name": r.vendor_name,
                "claim_count": int(r.cnt),
                "total_amount": round(float(r.amt or 0), 2),
            }
            for r in rows
        ]
    }


@router.get("/physician/flagged-vs-clean")
def physician_flagged_vs_clean(npi: str = Query(...), db: Session = Depends(get_db)):
    total = db.query(func.count(Claim.id)).filter(Claim.npi == npi).scalar() or 0
    flagged = (
        db.query(func.count(func.distinct(RulesFlag.claim_id)))
        .filter(RulesFlag.npi == npi)
        .scalar()
    ) or 0
    clean = total - flagged
    flagged_pct = round(flagged / total * 100, 1) if total > 0 else 0.0
    return {"total": total, "flagged": flagged, "clean": clean, "flagged_pct": flagged_pct}


@router.get("/physician/top-suppliers-by-amount")
def physician_top_suppliers_by_amount(npi: str = Query(...), db: Session = Depends(get_db)):
    rows = (
        db.query(
            Claim.vendor_name,
            func.sum(Claim.claim_amount).label("amt"),
            func.count(Claim.id).label("cnt"),
        )
        .filter(Claim.npi == npi)
        .group_by(Claim.vendor_name)
        .order_by(func.sum(Claim.claim_amount).desc())
        .limit(6).all()
    )
    def _trunc(s, n=25):
        return s[:n - 3] + "..." if len(s) > n else s
    return {
        "suppliers": [
            {
                "vendor_name": _trunc(r.vendor_name),
                "total_amount": round(float(r.amt or 0), 2),
                "claim_count": int(r.cnt),
            }
            for r in rows
        ]
    }


@router.get("/physician/claims-by-category")
def physician_claims_by_category(npi: str = Query(...), db: Session = Depends(get_db)):
    LABELS = {
        "home_health": "Home Health",
        "hospice": "Hospice",
        "dme": "DME",
        "drugs": "Drugs",
        "hospital": "Hospital",
    }
    rows = (
        db.query(
            Claim.service_category,
            func.count(Claim.id).label("cnt"),
            func.sum(Claim.claim_amount).label("amt"),
        )
        .filter(Claim.npi == npi)
        .group_by(Claim.service_category)
        .order_by(func.count(Claim.id).desc())
        .all()
    )
    return {
        "categories": [
            {
                "category": r.service_category,
                "label": LABELS.get(r.service_category, r.service_category),
                "count": int(r.cnt),
                "total_amount": round(float(r.amt or 0), 2),
            }
            for r in rows
            if r.cnt and r.cnt > 0
        ]
    }


@router.get("/physician/flag-timeline")
def physician_flag_timeline(npi: str = Query(...), db: Session = Depends(get_db)):
    start, keys, labels = _six_month_window()
    rows = (
        db.query(
            func.to_char(RulesFlag.fired_at, "YYYY-MM").label("month"),
            func.count(func.distinct(RulesFlag.claim_id)).label("cnt"),
        )
        .filter(RulesFlag.npi == npi, RulesFlag.fired_at >= start)
        .group_by(func.to_char(RulesFlag.fired_at, "YYYY-MM"))
        .all()
    )
    cnt_dict = {r.month: r.cnt for r in rows}
    return {"months": labels, "flagged_counts": [cnt_dict.get(k, 0) for k in keys]}


@router.post("/query")
def analytics_query(body: AnalyticsQueryRequest, db: Session = Depends(get_db)):
    settings = get_settings()

    if body.portal == "physician":
        if not body.npi:
            raise HTTPException(
                status_code=422,
                detail={"error": "npi is required for physician portal", "code": "MISSING_NPI"},
            )
        data_context = _build_physician_context(db, body.npi, body.filters)
    else:
        data_context = _cached_plan_context(db, body.filters)

    api_key = (settings.openai_api_key or "").strip()
    if not api_key or len(api_key) < 20:
        return {
            "chart_type": "stat",
            "title": "Analytics Unavailable",
            "insight": "No OpenAI API key is configured. Set OPENAI_API_KEY in your .env file to enable analytics.",
            "data": {"value": "—", "label": "API Key Required", "sublabel": "Set OPENAI_API_KEY in .env"},
            "x_label": None,
            "y_label": None,
        }

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.append({"role": "user", "content": f"Here is the current data context:\n\n{data_context}"})
    messages.append({"role": "assistant", "content": "Data context received. Ready to answer analytics questions."})

    for turn in body.conversation_history:
        role = turn.get("role", "")
        content = turn.get("content", "")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": str(content)})

    messages.append({"role": "user", "content": body.query})

    try:
        from openai import OpenAI

        client = OpenAI(api_key=api_key, timeout=30)
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            temperature=0.2,
            max_tokens=600,
            messages=messages,
            response_format={"type": "json_object"},
        )
        parsed = json.loads(resp.choices[0].message.content.strip())
        return {
            "chart_type": parsed.get("chart_type", "stat"),
            "title": parsed.get("title", ""),
            "insight": parsed.get("insight", ""),
            "data": parsed.get("data", {}),
            "x_label": parsed.get("x_label"),
            "y_label": parsed.get("y_label"),
        }
    except Exception as e:
        log.warning(f"Analytics query failed: {e}")
        raise HTTPException(
            status_code=500,
            detail={"error": "Analytics query failed", "code": "ANALYTICS_ERROR"},
        )
