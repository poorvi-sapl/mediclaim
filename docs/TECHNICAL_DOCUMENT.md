# Technical Document
## ClaimLens — NPI Intelligence & Medicare Fraud-Detection Platform
### (Project repo: *MediClaim*)

> **Purpose of this file:** a complete, self-contained technical reference for the system — architecture, stack, data model, detection engine, APIs, security, workflows, and deployment. It is written so it can be handed to a document generator (e.g., Claude) to produce a formatted `.docx`.

---

## 1. Document Control

| Field | Detail |
|---|---|
| Title | Technical Document — ClaimLens |
| Version | 1.0 (Draft) |
| Author | *[Your name]* |
| Date | *[Date]* |
| Status | Draft — for review |

---

## 2. Introduction

**ClaimLens** is a web-based platform that detects fraud, waste, and abuse (FWA) in Medicare claims. It ingests claims data, runs a rules-based **fraud-detection engine** across 16 patterns, computes **risk scores** for both physicians (NPIs) and vendors (suppliers), and presents findings through three role-based portals with a governed **dispute-and-resolution workflow** and **real-time alerts**.

This document describes the system's architecture, technology, data model, algorithms, APIs, security model, and deployment.

---

## 3. System Overview

- **Type:** Multi-tenant, role-based web application (3 portals: Payer/Investigator, Physician, Vendor).
- **Core capabilities:** claims ingestion & screening → automated fraud rules → risk scoring → investigator dashboards → dispute lifecycle → real-time notifications → analytics.
- **Current dataset:** ~18,000 synthetic claims, 100 physicians, 100 vendors (demo/pilot scale).
- **Detection approach:** deterministic rules engine (not ML) + LLM (GPT-4o) for plain-English risk summaries and natural-language querying.

---

## 4. Architecture Overview

Three-tier architecture:

```
┌─────────────────────────────────────────────────────────────┐
│  CLIENT (Browser)                                            │
│  React 18 SPA (Vite) — 3 portals, URL-based routing          │
└───────────────┬─────────────────────────────────────────────┘
                │ HTTPS/JSON (REST) + Server-Sent Events (SSE)
                │ httpOnly JWT cookie (credentials: include)
┌───────────────▼─────────────────────────────────────────────┐
│  APPLICATION (FastAPI / Uvicorn, port 4001)                  │
│  Auth middleware + CORS → modular routers                    │
│  Rules engine · Risk scoring · Dispute/notify engine · SSE   │
│  OpenAI (GPT-4o) for summaries & NL query                    │
└───────────────┬─────────────────────────────────────────────┘
                │ SQLAlchemy 2.0 ORM  (Alembic migrations)
┌───────────────▼─────────────────────────────────────────────┐
│  DATA (PostgreSQL)  — 18 tables                              │
│  claims, actions, rules_flags, npi_risk_scores, disputes …   │
└─────────────────────────────────────────────────────────────┘
```

- **Frontend ↔ Backend:** REST JSON + SSE for live updates. Auth via httpOnly JWT cookie (`credentials: 'include'`).
- **Backend ↔ DB:** SQLAlchemy ORM; schema evolution via Alembic.
- **External:** OpenAI API (LLM); SMTP (email OTP/notifications); geocoding (offline `pgeocode`); CMS/NPPES/OIG (snapshot/mocked).

---

## 5. Technology Stack

### 5.1 Frontend
| Component | Choice |
|---|---|
| Framework | React 18.3 |
| Build tool / dev server | Vite 5.4 |
| Routing | react-router-dom 6.30 (URL-driven; see §7) |
| Charts | Recharts |
| Icons / animation | lucide-react, framer-motion |
| Maps | @react-google-maps/api (geographic anomaly view) |
| MFA QR | qrcode |
| Styling | Tailwind CSS + PostCSS |

### 5.2 Backend
| Component | Choice |
|---|---|
| Framework | FastAPI 0.111 |
| ASGI server | Uvicorn 0.29 |
| ORM | SQLAlchemy 2.0.30 |
| Migrations | Alembic 1.18.5 |
| Config | pydantic-settings 2.14 (env-driven) / pydantic 2.13 |
| Auth (JWT) | python-jose |
| Password hashing | passlib + bcrypt |
| Email OTP | fastapi-mail / aiosmtplib |
| TOTP MFA | pyotp (+ Fernet from `cryptography` to encrypt secrets at rest) |
| LLM | openai (GPT-4o) |
| Geocoding | pgeocode (offline zip→lat/lng) |
| Fuzzy matching | rapidfuzz (supplier entity resolution) |
| Data | pandas, numpy |
| Reports | python-docx, reportlab, openpyxl |
| DB driver | psycopg2-binary |

### 5.3 Infrastructure
| Component | Choice |
|---|---|
| Database | PostgreSQL 14 |
| Hosting | AWS EC2 (Ubuntu 22.04) |
| Process management | systemd services |

---

## 6. Application Structure — Portals

| Portal | Route prefix | Key screens |
|---|---|---|
| **Payer / Investigator** | `/payer/*` | Fraud command centre (dashboard), Physician risk leaderboard, All physicians, NPI detail, Vendor watchlist, Vendor case, NPI disputes, Dispute detail |
| **Physician** | `/physician/*` | My Dashboard, My Claims, Claim detail, My Disputes, Dispute detail |
| **Vendor** | `/vendor/portal/*` | Dashboard, Claims, Action Required, Dispute detail (respond + upload docs) |

Public/auth screens: landing, login, OTP, register, MFA setup/backup, and a public vendor dispute page (`/vendor/disputes/:case_id`, signed-token gated).

---

## 7. Frontend Routing Architecture

The URL is the single source of truth for every screen (navigation, deep-links, browser back/forward, and refresh all work). Two implementation styles are in use:

- **Payer & Vendor portals — "pathname-parse" (L1):** a single container derives the current screen and any entity id by parsing `location.pathname` (`parsePlanRoute` / `parseVendorRoute`), and navigation uses `navigate()`. Screens render conditionally.
- **Physician portal — nested routes (L2):** a layout component renders `<Shell>` + `<Outlet>` and holds shared state via Outlet context; each screen is its own route component using `useParams`. The physician portal is extracted into its own module (`src/physician/PhysicianPortal.jsx`).

**Detail screens resolve by id:** in-session navigation passes the row via `navigate(..,{state})` for instant paint; a deep-link/refresh (no state) fetches the entity by id (`GET .../claims/:id`, supplier-by-id, dispute list find). Route-derived breadcrumbs; no hand-rolled history stack.

---

## 8. Backend Design

- **Modular routers** (`backend/routers/*.py`): `auth`, `mfa`, `actions`, `claims`, `dashboard` (payer/plan), `analytics`, `admin`, `documents`, `ingest`, `npi_watch` (physician alerts), `vendor`, `alerts`, `respond`.
- **Middleware:** an **Auth middleware** (validates the JWT cookie, attaches the user) added inner, and **CORS middleware** added outermost so CORS headers attach even to 401/403.
- **Engines / services:**
  - `rules/engine.py` + per-rule modules — the fraud detection engine.
  - `scoring/risk_score.py` — risk scoring (NPI + supplier).
  - `rules/trigger_engine.py` — dispute/vendor-notification lifecycle.
  - `sse.py` — real-time event broker.
- **Config:** `config.py` via pydantic-settings, all values env-driven (`.env`).

---

## 9. Data Model (18 tables)

| Table | Purpose |
|---|---|
| `claims` | Core claim records (npi, patient, vendor, service, amount, dates, ccn, oig_flagged) |
| `users` | Auth accounts (role, credentials, MFA, verification) |
| `npi_profiles` | Provider reference data (specialty, practice location, geocode) |
| `physicians` | Registered physician accounts & preferences (contact, notification settings, verification) |
| `supplier_profiles` | Vendor reference data (name, type, address, OIG flag, contact, npi_watch_registered) |
| `actions` | Physician/investigator decisions on a claim (confirm, dispute, fraud, flag_supplier, unknown_patient, did_not_order, deceased_patient) |
| `action_status_log` | Audit trail of action status changes |
| `rules_flags` | Fired fraud-rule flags (rule_name, severity, npi, vendor_id, claim_id) |
| `npi_risk_scores` | Computed risk scores per entity (entity_type = npi \| supplier) + breakdown |
| `claim_notifications` | Notification records that drive physician "NPI Watch" + dispute creation |
| `dispute_cases` | The dispute/fraud-report case (status, type, response window, vendor response, escalation) |
| `dispute_case_events` | Ordered event log per case (raised → notified → responded → confirmed/escalated) |
| `documents` | Vendor-uploaded proof-of-work files |
| `physician_bills` | Physician billing coverage data (used by ghost-billing rule) |
| `oig_excluded_npis` | OIG LEIE exclusion list (by NPI) |
| `oig_excluded_names` | OIG LEIE exclusion list (by name) |

**Key relationships:** `claims.npi → npi_profiles`; `claims.vendor_id → supplier_profiles`; `rules_flags.claim_id → claims` (and carries both `npi` and `vendor_id`); `dispute_cases.notification_id → claim_notifications`; `dispute_case_events.case_id → dispute_cases`; `actions.claim_id → claims`.

---

## 10. Fraud-Detection Engine

Deterministic rules run over the claims set (via `run_all_rules`), each writing `rules_flags` rows (rule_name, severity, `npi`, `vendor_id`, claim_id). **Each flag is attributed to both the physician NPI and the vendor**, so it can feed both scores.

**The 16 rules:**

| Rule | Detects |
|---|---|
| volume_spike | NPI claim-rate surge vs its own baseline |
| geographic_anomaly | Patient location implausibly far from provider practice |
| cross_npi_supplier | One vendor billing across many unrelated physicians |
| new_high_value_supplier | New vendor billing high-value claims |
| oig_leie_hit | Vendor/provider on OIG exclusion list |
| duplicate_billing | Same service billed more than once |
| identity_reuse | Patient identity reused implausibly |
| abnormal_hospice_duration | Hospice episodes of implausible length |
| upcoding | Higher-complexity code than warranted |
| unbundling | Bundled service split into separate codes |
| deceased_patient | Claims dated after patient death |
| impossible_day | More services/hours in a day than physically possible |
| modifier_abuse | Improper billing modifiers |
| rapid_cycling | Rapid repeated billing cycles |
| supplier_concentration | A physician's claims abnormally concentrated in one vendor |
| ghost_billing | Billing for services never provided |

---

## 11. Risk-Scoring Methodology

`scoring/risk_score.py` computes a 0–100 score **per physician NPI** (`calculate_npi_scores`) and **per vendor** (`calculate_supplier_scores`), upserting into `npi_risk_scores` (`entity_type` = `npi` or `supplier`).

- **Inputs:** fired rules + physician actions + continuous signals (supplier count, flagged fraction, dominant-supplier share).
- **Weights (configurable via env):** volume_spike 25, geo_anomaly 15, cross_npi 30, oig_hit 35, new_supplier 10, per-physician-flag 5 (capped at 20).
- **Note:** `volume_spike` and `geographic_anomaly` are physician-only and are excluded from supplier scoring.
- **Bands:** Critical (>80) · High (>60) · Medium (>30) · Low (≤30).
- **LLM assist:** GPT-4o generates a plain-English risk explanation per NPI, grounded in the fired rules.

---

## 12. Dispute & Notification Workflow

- **Entities:** `claim_notifications` (drives physician alerts + creates the case), `dispute_cases` (the case), `dispute_case_events` (immutable event log).
- **Dispute types:** DISPUTE · FRAUD_REPORT · DECEASED_PATIENT.
- **Case states:** Open · Pending Physician Review · Pending Physician Confirmation · Responded to Medicare · Resolved by Physician · Non-Responsive · Referred to Payer.
- **Flow:** physician disputes/reports a claim → after a configurable **undo window** (`VENDOR_NOTIFY_DELAY_HOURS`) the vendor is notified (`trigger_engine.notify_vendor_from_claim_action`) → vendor responds within an **SLA (~15 days)**, uploading documents → physician confirms/rejects → non-responsive cases escalate to compliance/payer.
- **Idempotency:** notification creation is idempotent (skips duplicates for the same claim).

---

## 13. Real-Time Alerts (SSE)

- `backend/sse.py` implements an in-process broker: each subscriber gets its own `asyncio.Queue`; `publish()` fans an event out to all subscribers.
- SSE endpoints: `/plan/alerts/stream` (payer), `/vendor/portal/alerts/stream` (vendor), physician NPI-watch alerts stream — all return `StreamingResponse` of `data: {...}` events.
- **Constraint:** the broker is **in-memory per process** — the API must run as a **single Uvicorn worker**; horizontal scaling would require a shared broker (e.g., Redis pub/sub). (See §18.)

---

## 14. API Reference (grouped)

**Auth & MFA** — `POST /login`, `POST /demo-login`, `POST /register`, `POST /register/payer`, `POST /register/vendor`, `GET /verify-npi|/verify-uei|/verify-vendor-npi`, `POST /logout`, `GET /me`, `GET /notifications/count`, `POST /notifications/seen`; `POST /mfa/setup|/verify-setup|/login|/backup`.

**Physician (claims)** — `GET /physician/{npi}/summary`, `GET /physician/{npi}/claims`, `GET /physician/{npi}/claims/{id}`, `GET /physician/{npi}/claims/{id}/actions`, `GET /physician/{npi}/flagged-suppliers`. Actions: `POST /actions`, `DELETE /actions/{id}`, `POST /physician/reset-actions`.

**Physician NPI-Watch** — `GET /alerts/stream`, `GET /notifications`, `GET /notifications/bell`, `GET /stats`, `POST /disputes/{case_id}/confirm`, `POST /disputes/{case_id}/decide`.

**Payer / Plan** — `GET /plan/summary`, `GET /plan/npi-risk-list`, `GET /plan/npi/{npi}/detail`, `GET /plan/npi/{npi}/summary`, `GET /plan/npi/{npi}/rule/{rule}`, `POST /plan/npi/{npi}/run-fraud-check`, `GET /plan/suppliers`, `GET /plan/suppliers/{id}/physicians`, `GET /plan/alerts`, `GET /plan/actions/{id}`, `PATCH /plan/actions/{id}/status`, `GET /plan/disputes`, `POST /plan/disputes/{case_id}/compliance-action`, `GET /plan/notifications`, `GET /plan/alerts/stream`.

**Analytics** — overview: `/overview/risk-distribution`, `/top-npis`, `/claims-trend`, `/rule-breakdown`; physician: `/physician/claims-trend`, `/claims-by-supplier`, `/flagged-vs-clean`, `/top-suppliers-by-amount`, `/claims-by-category`, `/flag-timeline`, `/reviews-trend`; `POST /query` (NL query via LLM).

**Vendor** — `GET /portal/claims|/portal/disputes|/portal/stats|/portal/notifications`, `GET /portal/alerts/stream`, `GET /disputes/{case_id}`, `GET /disputes/{case_id}/docs/{name}`, `POST /disputes/{case_id}/respond`, `POST /portal/disputes/{case_id}/respond`.

**Documents / Ingest / Admin** — `POST /upload`, `GET /status`; `POST /ingest/single`; `GET /users/pending`, `POST /users/{id}/activate`.

---

## 15. Authentication & Security

- **Sessions:** JWT (python-jose) stored in an **httpOnly cookie**; frontend calls use `credentials: 'include'`.
- **Passwords:** hashed with bcrypt (passlib).
- **Second factor:** email **OTP** (fastapi-mail/aiosmtplib). Optional **TOTP MFA** (pyotp) with QR enrolment; TOTP secrets encrypted at rest with **Fernet** (cryptography). MFA has attempt-limit + lockout.
- **Registration verification:** NPI/NPPES, OIG, DEA, State License, PTAN, SAM/UEI (behind mock flags in the current phase).
- **Authorisation:** role-based — a physician sees only their NPI's data; a vendor sees only their claims; investigators see network-wide.
- **CORS:** restricted to the configured frontend origin(s); credentials enabled.

---

## 16. Data Ingestion & Seeding

- `scripts/generate_expanded.py` — generates the synthetic claims dataset (100 physicians / 100 vendors / ~18k claims, tiered clean/suspicious/high-risk).
- `oig_seed.py` — loads OIG exclusion tables; `geocode_physicians` — geocodes via pgeocode.
- `backend/rules/engine.run_all_rules` + `scoring.calculate_*` — flags + scores.
- Orchestrators: `backend/data/init_db.py` (users + synthetic + rules) and `backend/data/demo_reset.py` (full rebuild of per-demo tables + verification checks).

---

## 17. Deployment Architecture

| Layer | Setup |
|---|---|
| Host | AWS EC2, Ubuntu 22.04 |
| Backend | `mediclaim-backend.service` (systemd) → Uvicorn on **:4001**, single worker |
| Frontend | `mediclaim-frontend.service` (systemd) → Vite on **:4002** |
| Database | PostgreSQL 14 (local, port 5432) |
| Access | Direct IP:port (no reverse proxy / TLS in current setup) |
| Config | `.env` files (root + backend) loaded by pydantic-settings |
| Schema | Alembic migrations; DB tracked at head |

**Frontend build note:** `VITE_API_URL` is inlined at build time and must point to the backend origin. In production the app should be served as a **built `dist/`** (see §18).

---

## 18. Known Limitations / Technical Debt

1. **Frontend served in dev mode** — currently `vite dev`; should be a production build (`vite build` + static serve) for performance, especially over WAN latency.
2. **Single-worker API (SSE constraint)** — real-time broker is in-process; scaling to multiple workers requires a shared broker (Redis pub/sub).
3. **Mocked external verifications** — NPPES/OIG/DEA/SAM verifications are mocked; live integration required for production.
4. **Rules-based detection** — no ML models yet; thresholds/weights are configuration-tuned.
5. **Synthetic data** — the current dataset is generated, not real claims.
6. **No reverse proxy / TLS** in the current deployment (direct IP:port); nginx + HTTPS recommended for production.
7. **Vendor-side fraud-pattern reporting** — per-rule breakdown is surfaced richly on the physician NPI detail but not yet on the vendor case (data exists via `rules_flags.vendor_id`; a reporting enhancement).

---

## 19. Configuration (key environment variables)

`DATABASE_URL`, `CORS_ORIGINS`, `SECRET_KEY`/`JWT_*`, `MFA_ENCRYPTION_KEY`, `MAIL_*` + `ALL_OTP_STUB` + `OTP_EXPIRY_MINUTES`, `OPENAI_API_KEY`, rule weights (`WEIGHT_*`) & thresholds (`VOLUME_SPIKE_MULTIPLIER`, `GEOGRAPHIC_ANOMALY_MILES`, …), `VENDOR_NOTIFY_DELAY_HOURS`, `*_MOCK` verification flags, `BASE_URL`/`FRONTEND_BASE_URL`, and frontend `VITE_API_URL`.

---

## 20. Glossary & References
- **NPI, CCN, HCPCS/CPT, MBI, OIG LEIE, NPPES, FWA, SLA, SSE** — see BRD glossary.
- Related docs: `BRD.md`, `HLD.md`, `LLD.md`, `DB_SCHEMA.md`, `DATA_FLOW.md`, `API_SPEC.md`, `DEPLOYMENT.md`, `FUNCTIONAL_REQUIREMENTS.md`.
