# ClaimLens — Project Overview

_Last updated: 2026-06-05_

## 1. What it is

**ClaimLens** is a healthcare fraud-detection MVP for **Medicare / Medicaid** claims
(California Medi-Cal focus). It ingests claim records, runs them through a set of
fraud-detection rules, scores every physician (NPI) and supplier on a 0–100 risk
scale, and presents the results through **two role-based dashboards** — one for
physicians to review their own claims, one for plan investigators to hunt fraud.
Physician feedback (flags) streams to investigators in **real time**.

It is a **structured-claims fraud-detection system** — detection runs on claim
*data*, not documents. There is no OCR, PDF upload, keyword engine, or prior-auth
workflow in this build.

**Core demo story:** a kickback ring (supplier *MedSupply Pro LLC* billing under
9 unrelated physicians, on the OIG exclusion list) is surfaced automatically;
Dr. James Wilson sits near the top of the risk leaderboard; a physician flags a
claim and the investigator sees the alert live.

---

## 2. Tech stack

| Layer | Technology |
|---|---|
| Backend | FastAPI (Python 3.11), SQLAlchemy ORM, Uvicorn |
| Database | PostgreSQL 17 (Docker, host port **5433**) |
| Auth | JWT (python-jose) + bcrypt; httpOnly cookie + Bearer header |
| Real-time | Server-Sent Events (in-process broker) |
| Data generation | GPT-4o (synthetic claim descriptions only — not in the detection path) |
| Geocoding | pgeocode (zip → lat/lng for the distance rule) |
| Frontend | Vite 5 + React 18 + React Router 6 + Tailwind CSS |

> Note: the original deck specified Next.js 14; the delivered frontend is Vite + React
> (functionally equivalent SPA).

---

## 3. Architecture

```
                ┌─────────────────────────────────────────────┐
   build /      │  generate → augment → geocode → RULES →      │
   demo_reset   │  seed actions → SCORING → verify             │
                └─────────────────────────────────────────────┘
                                   │ writes
                                   ▼
   ┌──────────┬───────────┬──────────┬─────────────────┬───────────────┐
   │ claims   │ rule_flags│ actions  │ npi_risk_scores │ npi_profiles  │  (PostgreSQL)
   └──────────┴───────────┴──────────┴─────────────────┴───────────────┘
                                   │ reads
                ┌──────────────────┴───────────────────┐
                │            FastAPI + JWT guard         │
                │  /auth/*  /physician/*  /plan/*  /health│
                └──────────────────┬───────────────────┘
                       cookie / SSE │ JSON
                ┌──────────────────┴───────────────────┐
                │     React SPA (role-based routing)     │
                │  /login → /physician/* | /plan/*       │
                └────────────────────────────────────────┘
```

---

## 4. Database (5 application tables + reference tables)

| Table | Purpose |
|---|---|
| `claims` | The claim records (patient, NPI, supplier, service, amount, zip, OIG flag, reviewed). |
| `rule_flags` | One row per fraud-rule hit (rule name, severity, description) → powers the flag chips. |
| `actions` | Physician review actions (confirm / dispute / flag / unknown / did-not-order). |
| `npi_risk_scores` | Composite 0–100 score + flag booleans per NPI **and** per supplier. |
| `npi_profiles` | Physician reference data (name, specialty, practice address/geo). |
| `users` | **(new)** auth — email, bcrypt password, role, npi, last_login. |

Reference/seed tables also present: `physicians`, `suppliers`, `oig_excluded_npis`,
`oig_excluded_names`, `supplier_profiles`.

---

## 5. Fraud detection — the 6 rules

Deterministic SQL rules (`backend/rules/engine.py`) — fully explainable, each writes
to `rule_flags`:

| Rule | Catches | Severity |
|---|---|---|
| `oig_leie_hit` | Supplier on the OIG exclusion list | Critical |
| `cross_npi_supplier` | One supplier billing under many physicians (kickback hub) | Critical |
| `volume_spike` | Claim rate jumps vs. the physician's own 60-day baseline | High |
| `geographic_anomaly` | Patient > 150 miles from the practice | Medium |
| `new_high_value_supplier` | Brand-new supplier with a big-dollar claim | Medium |
| `duplicate_billing` | Same patient + service + date billed by 2 suppliers | High |

---

## 6. Risk scoring model

`backend/scoring/risk_score.py` — a weighted sum, capped at 100, per NPI and per
supplier. Weights (`backend/config.py`):

| Factor | Points |
|---|---|
| OIG LEIE hit | 35 |
| Cross-NPI supplier | 30 |
| Volume spike | 25 |
| Duplicate billing | 20 |
| Geographic anomaly | 15 |
| New high-value supplier | 10 |
| Per physician flag | 5 (capped at 20) |

Risk bands shown in the UI: Critical > 80, High > 60, Medium > 30, Low otherwise.

**Feedback loop:** physician flags feed back into the scores on the next scoring
pass — and every flag is a labeled fraud example, which is the foundation for a
future ML model.

---

## 7. The data

- **3,000 synthetic claims**, **~4,157 rule flags**, **36 risk scores** (17 physicians + 19 suppliers).
- **10 planted fraud patterns** modeled on real OIG/DOJ enforcement cases: MedSupply
  kickback ring, volume spike, geographic anomalies, OIG-excluded supplier, new
  high-value supplier, patient-identity reuse, Pacific Coast kickback cluster,
  duplicate billing, unbundling, upcoding (+ long-hospice and drug-mismatch edge cases).
- Note: the 10 *patterns* (in the data) ≠ the 6 *rules* (the detectors). Patterns like
  upcoding/unbundling are planted but have no dedicated rule yet.

---

## 8. API (12 endpoints + 3 auth)

**Auth** — `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
**Physician** (role: physician) — `/physician/{npi}/summary`, `/physician/{npi}/claims`,
`/physician/{npi}/flagged-suppliers`, `POST /actions`
**Plan** (role: plan_investigator) — `/plan/summary`, `/plan/npi-risk-list`,
`/plan/npi/{npi}/detail`, `/plan/suppliers`, `/plan/suppliers/{id}/physicians`,
`/plan/alerts/stream` (SSE)
**Public** — `/health`

---

## 9. Frontend — two portals

**Physician portal** (`/physician/*`)
- Overview / summary card, self-loading **Claims table** (server-side filters,
  pagination, All / Unreviewed / Reviewed), 5 action buttons, Flagged Suppliers.

**Plan Investigator portal** (`/plan/*`)
- Fraud Intelligence dashboard (4 stat cards + top-5), **NPI Risk Leaderboard**,
  **NPI Detail** (score breakdown + that physician's actions), **Supplier Watchlist**,
  **Live Alerts** (real-time SSE feed).

---

## 10. Authentication (delivered)

- JWT, 8-hour expiry (30 days with "keep me signed in"), bcrypt password hashing.
- Token in an **httpOnly cookie** (browser) or `Authorization: Bearer` (API clients).
- Route protection: `/physician/*` + `/actions` → physician role; `/plan/*` →
  plan_investigator; `/health` + `/auth/*` public.
- Frontend: `/login` page, React Router guards (deep-link → `/login`, role redirects),
  logout in nav. The old hardcoded user-switcher was removed.
- **Demo users:** `physician@mediclaim.com` / `demo1234`, `payer@mediclaim.com` / `demo1234`.

---

## 11. Current status

✅ Backend complete and stable (Days 1–8 of the plan): data, rules, scoring, all APIs,
SSE, demo reset.
✅ Both dashboards fully functional.
✅ Real authentication with role-based access.
✅ Demo data verified: 3,000 claims / 4,157 flags / 36 scores; MedSupply = supplier
row 1; Dr. Wilson in the leaderboard top 3.

---

## 12. Known gaps / not in this build

- **Not deployed** — runs on localhost (backend :8000, frontend :3000, Docker PG :5433);
  no live HTTPS URL yet.
- **No ML** — detection is rules + weighted scoring by design (explainable, regulator-
  friendly; the flag workflow generates the labels a future model would need).
- **Auth hardening** — `JWT_SECRET_KEY` is the dev default and the cookie is non-Secure
  for localhost http; both must change before any real-data deployment.
- **No OCR / PDF / prior-authorization / keyword engine** — out of scope for this
  structured-claims system.
- **No live claims ingestion** — data is synthetic, batch-generated.
- **No Medicare Parts A/B/C/D hierarchy** — uses service categories instead.
- A few planted fraud patterns (upcoding, unbundling, identity reuse) have no dedicated
  detection rule yet.

---

## 13. Suggested roadmap

1. **Deploy** to a live HTTPS URL (harden JWT secret, Secure cookies, CORS).
2. **Add the missing rules** (upcoding, unbundling, identity reuse) for 1:1 pattern coverage.
3. **Unify the flag definition** — `did_not_order` should count toward NPI scores too.
4. **LLM alert explanations** — plain-English "why is this suspicious" (genuine, useful AI touchpoint).
5. **Phase 2: ML model** trained on accumulated physician-flag labels, with rules kept as the explainable safety net.
6. **Real data sourcing** — see the data-provider research (ResDAC, State APCD, Komodo, Definitive).
```
