# HLD — High Level Design
## ClaimLens — NPI Intelligence Platform

---

## 1. System Overview

ClaimLens is a claims monitoring and fraud intelligence platform built on a single normalized claims data feed. It takes claims data from a health plan or MAC, runs it through an NPI Intelligence Engine, and routes the output to two separate dashboards — one for physicians, one for the health plan.

The system does not process, approve, or deny claims. It sits downstream of the payment chain as a monitoring and alerting layer. It has no role in whether a claim gets paid. Its role is to surface what has already been billed, make it visible to the right people, and create a feedback loop between physician knowledge and plan analytics.

**The fundamental architecture in one sentence:**
Same data feed → one normalization engine → two output lenses → one feedback loop.

---

## 2. The Three Layers

### Layer 1 — Claim Submission (External, Outside ClaimLens)

Providers and suppliers submit claims to the health plan. This happens entirely outside ClaimLens. Types of submitters:

- Home Health Agencies
- Hospice Providers
- DME (Durable Medical Equipment) Suppliers
- Hospitals
- Physician practices

Each claim is tagged with the ordering physician's NPI — the 10-digit National Provider Identifier that links the claim to a specific doctor.

The plan receives the claim, validates it, and pays it. ClaimLens has no involvement in this layer. By the time ClaimLens sees a claim, it has already been processed.

### Layer 2 — Data Source (Health Plan or MAC)

The health plan or MAC holds the processed claims data in their systems. ClaimLens requires a data sharing agreement with the plan to access this data.

**For the MVP:** GPT-4 generated synthetic claims replace this layer entirely. No real plan data. No agreement required.

**For the pilot:** The plan provides a 90-day de-identified sample export — CSV, JSON, or EDI 837. ClaimLens ingests it once via the ETL pipeline.

**For production:** The plan provides ongoing API access or automated batch exports. The ETL pipeline runs on a schedule — daily batch or near real-time depending on plan infrastructure.

### Layer 3 — ClaimLens Platform (This System)

Four internal components in sequence:

```
ETL Pipeline → NPI Intelligence Engine → AI/ML Layer → Output Router
```

Output splits into two dashboards:

```
                    ┌─────────────────────┐
                    │   Physician Dashboard│
ETL → Engine → ML →│                     │
                    │   Plan/Gov Dashboard │
                    └─────────────────────┘
```

The physician's flag actions write back into the system and feed the ML layer as training labels — completing the feedback loop.

---

## 3. Component Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLAIMLENS PLATFORM                           │
│                                                                     │
│  ┌─────────────┐    ┌──────────────────┐    ┌───────────────────┐  │
│  │ ETL Pipeline│───▶│  NPI Intelligence│───▶│   AI / ML Layer   │  │
│  │             │    │     Engine       │    │                   │  │
│  │ • Ingest    │    │                  │    │ MVP:              │  │
│  │ • Normalize │    │ • NPI linkage    │    │ • Rules engine    │  │
│  │ • Enrich    │    │ • Data enrichment│    │ • Risk scoring    │  │
│  │ • Validate  │    │ • Deduplication  │    │                   │  │
│  │ • OIG check │    │ • Geocoding      │    │ Real product:     │  │
│  └─────────────┘    └──────────────────┘    │ • Isolation Forest│  │
│                                             │ • XGBoost         │  │
│                                             │ • Graph ML        │  │
│                                             │ • LLM summaries   │  │
│                                             └────────┬──────────┘  │
│                                                      │             │
│                              ┌───────────────────────┤             │
│                              │                       │             │
│                    ┌─────────▼──────┐    ┌───────────▼──────────┐  │
│                    │   Physician    │    │   Plan / Government  │  │
│                    │   Dashboard   │    │      Dashboard        │  │
│                    │               │    │                       │  │
│                    │ • Claims table│    │ • NPI risk leaderboard│  │
│                    │ • Action btns │    │ • Supplier watchlist  │  │
│                    │ • Flag flow   │    │ • Live alerts (SSE)   │  │
│                    └───────┬───────┘    └───────────────────────┘  │
│                            │                       ▲               │
│                            │   Physician flags     │               │
│                            └───────────────────────┘               │
│                              (feedback loop)                        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. Component Descriptions

### 4.1 ETL Pipeline

**Responsibility:** Ingest raw claims data from any plan format and produce a normalized, enriched, deduplicated dataset in the ClaimLens canonical schema.

**Inputs:**
- Raw claims file or API feed from plan (CSV, JSON, EDI 837, flat file)
- OIG LEIE exclusion list (downloaded once, stored locally)
- NPI Registry API (called per physician NPI for enrichment)

**Processing steps in order:**
1. Parse raw file into memory regardless of source format
2. Map all fields to the ClaimLens canonical schema
3. Run entity resolution on supplier names — fuzzy match variants to a single supplier entity ID
4. Enrich each NPI with physician profile data from NPI Registry API
5. Geocode physician practice zip and patient zip to latitude/longitude
6. Standardize all CPT and HCPCS codes
7. Normalize dates to ISO 8601
8. Remove duplicate claim submissions (same patient, same service, same date, same supplier)
9. Check every supplier name against OIG LEIE exclusion list — set oig_flagged boolean
10. Write all clean records to PostgreSQL claims table

**Outputs:** Populated claims table and npi_profiles table in PostgreSQL.

**For MVP:** Steps 1-10 run once against the GPT-4 generated synthetic dataset.

---

### 4.2 NPI Intelligence Engine

**Responsibility:** Link every claim to its ordering physician NPI, run all guardrail rules, and produce structured flag data ready for risk scoring.

**Inputs:** Populated claims table and npi_profiles table from ETL.

**Processing:**
1. For each claim, confirm NPI linkage — every claim must have a valid ordering physician NPI
2. Cross-reference NPI against npi_profiles table — attach physician metadata
3. Run rules engine — all 5 guardrail rules execute against every claim
4. Write all fired rule flags to rules_flags table with severity and description

**Outputs:** Populated rules_flags table.

**Runs:** At startup after ETL. Re-runs on a schedule in production as new claims arrive.

---

### 4.3 Rules Engine (MVP AI/ML Layer)

**Responsibility:** Apply 5 deterministic guardrail rules to surface fraud patterns without requiring ML models or labeled training data.

**Rules:**
1. Volume Spike — NPI claim rate in last 30 days vs prior 60-day baseline
2. Geographic Anomaly — patient zip vs physician practice zip distance
3. Cross-NPI Supplier — supplier billing under more than 3 distinct NPIs
4. New High-Value Supplier — first-time supplier with claim amount above threshold
5. OIG LEIE Hit — supplier name matches exclusion list

Full logic specification in `docs/RULES_ENGINE_SPEC.md`.

---

### 4.4 Risk Scoring

**Responsibility:** Produce a single composite risk score 0-100 for every NPI and every supplier. Store scores for dashboard consumption.

**MVP approach:** Weighted arithmetic sum of fired rules flags. No ML model.

**Real product approach:** XGBoost model trained on physician flag history as labels.

Full scoring specification in `docs/RISK_SCORING_SPEC.md`.

---

### 4.5 FastAPI Backend

**Responsibility:** Serve all data to both frontends via REST endpoints and stream real-time alerts via SSE.

**Endpoint groups:**
- `/physician/*` — claims and summary data scoped to one NPI
- `/actions` — physician confirm/dispute/flag POST endpoint
- `/plan/*` — cross-NPI aggregations, risk leaderboard, supplier watchlist
- `/plan/alerts/stream` — SSE endpoint for real-time alert feed
- `/health` — health check

Full endpoint specification in `docs/API_SPEC.md`.

---

### 4.6 Physician Dashboard (Next.js)

**Responsibility:** Show a physician every claim filed under their NPI. Allow them to take action on each claim. Scoped strictly to their NPI — no cross-physician visibility.

**Key screens:**
- Summary card — claim counts, unknown supplier alert
- Claims table — all claims with action buttons
- Flagged suppliers list

**Data scope:** All queries filtered by NPI. A physician never sees another doctor's data.

---

### 4.7 Plan / Government Dashboard (Next.js)

**Responsibility:** Show the health plan cross-NPI analytics, risk rankings, supplier intelligence, and real-time physician alert feed.

**Key screens:**
- Summary cards — system-wide counts
- NPI risk leaderboard — all NPIs sorted by score
- NPI detail page — drill-down for one NPI
- Supplier watchlist — sorted by flag count and risk
- Live alert feed — SSE stream of physician actions

**Data scope:** Full dataset. No NPI filtering.

---

### 4.8 SSE Alert Stream (Real-Time Feedback Loop)

**Responsibility:** Deliver physician flag actions to the plan dashboard in real time without polling.

**Flow:**
1. Plan dashboard opens SSE connection to `/plan/alerts/stream`
2. Connection stays open — server holds it
3. Physician hits Flag Supplier on their dashboard
4. POST `/actions` writes to actions table
5. Backend broadcasts event to all open SSE connections
6. Plan dashboard receives event — new alert card slides in instantly

**Technology:** Server-Sent Events via FastAPI `StreamingResponse`. No WebSocket. No external message broker. asyncio queue in memory for event broadcasting.

---

## 5. Data Architecture

### 5.1 Database

Single PostgreSQL instance. Five tables.

```
claims              — every normalized claim record
npi_profiles        — one row per physician NPI
actions             — every physician flag/confirm/dispute
rules_flags         — output of rules engine per claim
npi_risk_scores     — composite risk score per NPI and supplier
```

Full schema in `docs/DB_SCHEMA.md`.

### 5.2 Data Ownership and Access Control

**MVP:** No authentication. Demo users hardcoded. All data is synthetic.

**Real product:**
- Physician queries always filtered by NPI — enforced at API layer
- Plan queries have no NPI filter — full dataset visible
- Every data access logged to audit table
- Auth0 for physician identity verification against NPI Registry

### 5.3 Data Sensitivity

**MVP:** Zero PHI. All data is GPT-4 generated. No HIPAA obligations.

**Pilot (real plan data):** De-identified only. Patient names replaced with IDs. HIPAA BAA required before ingestion. Encrypted at rest and in transit.

**Production:** Full PHI possible. HIPAA-compliant infrastructure required. AWS/GCP/Azure HIPAA-eligible configurations. Railway and similar platforms are not acceptable.

---

## 6. Technology Decisions

### Why FastAPI over Django or Flask

Python is the language of ML. When the rules engine graduates to Isolation Forest and XGBoost, those models live in Python alongside the API. FastAPI also has native async support — critical for the SSE streaming endpoint — and auto-generates OpenAPI documentation that the frontend developer uses directly.

### Why PostgreSQL over MongoDB or DynamoDB

Claims data is inherently relational. A claim belongs to an NPI, an NPI belongs to a physician, a flag belongs to a claim, a score aggregates flags. SQL joins are the natural query pattern. PostgreSQL also supports pgvector for semantic search in Phase 2 without needing a separate vector database.

### Why SSE over WebSockets

WebSockets are bidirectional. The alert stream is unidirectional — server pushes to client. SSE is simpler, requires no handshake protocol, works through standard HTTP, and is natively supported by browsers. FastAPI handles it with `StreamingResponse` and no additional library.

### Why Next.js over React + Vite

App Router gives file-based routing for both dashboards in a single codebase. Server Components reduce client-side bundle size. The frontend developer gets clean separation between `/physician/*` and `/plan/*` routes without any routing configuration.

### Why rules-based scoring in MVP instead of ML

You need labeled data to train a supervised model. Labeled data means physician flags. Physician flags require a working product. A working product requires a demo. The demo requires a rules engine that works on day one with no historical data. Rules-based scoring in the MVP is not a shortcut — it is the correct architectural sequence. The physician flag history produced by the pilot becomes the training data for the XGBoost model in Phase 2.

---

## 7. Deployment Architecture

### MVP / Demo

```
Developer machine
    ↓
VPS (Ubuntu 22.04)
    ├── Nginx (reverse proxy + SSL via Certbot)
    │     ├── /api  →  Uvicorn (FastAPI on port 8000)
    │     └── /     →  Next.js (PM2 on port 3000)
    └── PostgreSQL (port 5432, internal only)
```

### Production (Phase 1+)

```
Load Balancer
    ↓
Application Server(s)
    ├── Nginx
    ├── Uvicorn workers (multiple)
    └── Next.js (PM2 cluster mode)
PostgreSQL (managed instance — RDS or Cloud SQL)
Redis (session cache, SSE pub/sub at scale)
Object Storage (S3 or equivalent for file exports)
```

---

## 8. Security Boundaries

### MVP

- No authentication — hardcoded demo users for pitch purposes only
- HTTPS enforced via Nginx + Certbot
- PostgreSQL not exposed to public internet — internal only
- `.env` never committed to version control
- No real patient data ever touches the MVP system

### Real Product (non-negotiable before pilot)

- Auth0 authentication with MFA
- Physician identity verified against NPI Registry at registration
- Role-based access control — physician, plan investigator, admin
- All PHI encrypted at rest (AES-256) and in transit (TLS 1.3)
- Audit log — every API call touching patient data logged immutably
- HIPAA BAA signed with all vendors before pilot data ingestion
- Penetration testing before production launch

---

## 9. Integration Points

| System | Purpose | When | How |
|---|---|---|---|
| GPT-4 API | Synthetic data generation | MVP only, run once | OpenAI Python SDK |
| OIG LEIE | Supplier exclusion check | At ETL load time | Static CSV download, local lookup |
| NPI Registry API | Physician profile enrichment | At ETL load time | REST API, no key required |
| Health Plan Claims Feed | Real claims data | Pilot onward | File export or REST API, plan-specific |
| Auth0 | Physician authentication | Phase 1 onward | Auth0 Python SDK + Next.js Auth0 SDK |

---

## 10. Key Design Principles

**Plan agnostic.** The ETL normalization layer handles any claims format. Different plans format data differently. ClaimLens abstracts that at ingestion and every downstream component works on the canonical schema.

**Human signal first.** The physician flag is ground truth. Every ML model in the real product is trained on or validated against physician flags. The product gets smarter the more doctors use it — not the more data scientists tune it.

**Monitoring layer only.** ClaimLens never touches the payment chain. It never approves or denies a claim. It reads what has already been processed and routes intelligence to the right people. This keeps legal liability simple and integration complexity low.

**Same data, two lenses.** The physician sees their NPI slice. The plan sees the full picture. Same database, same claims table, different query filters and different aggregations. No data duplication.

**Feedback loop is the product.** The physician dashboard creates flags. The flags feed the plan dashboard. The plan confirms fraud. The confirmed fraud trains the ML. The ML improves the risk scores. Better scores surface more suspicious claims to physicians. The loop is what makes ClaimLens compound in value over time — each flag makes the next one more valuable.

---

## 11. What HLD Does Not Cover

- Exact table schemas → `docs/DB_SCHEMA.md`
- Exact API endpoint contracts → `docs/API_SPEC.md`
- Rules engine logic → `docs/RULES_ENGINE_SPEC.md`
- Risk scoring formula → `docs/RISK_SCORING_SPEC.md`
- Synthetic data specification → `docs/SYNTHETIC_DATA_SPEC.md`
- UI screen specifications → `docs/UI_SPEC.md`
- Deployment step-by-step → `docs/DEPLOYMENT.md`
- Functional requirements → `docs/FUNCTIONAL_REQUIREMENTS.md`
- Non-functional requirements → `docs/NON_FUNCTIONAL_REQUIREMENTS.md`
