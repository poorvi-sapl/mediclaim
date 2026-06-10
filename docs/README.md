# MediClaim

> NPI Intelligence Platform — real-time claims monitoring for physicians and health plans.

---

## What It Does

MediClaim gives physicians visibility into every claim filed under their NPI and gives health plans the analytics to detect fraud at scale.

Every time a home health agency, hospice, DME supplier, or hospital submits a claim to a health plan, that claim is tagged with an ordering physician's NPI. Today, physicians have no visibility into those claims. Fraudulent suppliers exploit this blind spot — billing under real doctors' NPIs for services never ordered, patients never seen, equipment never delivered.

MediClaim closes that gap with two dashboards powered by a single normalized claims feed:

**Physician Dashboard** — A doctor logs in, sees every claim filed under their NPI, and can Confirm, Dispute, Flag Supplier, or mark Unknown Patient on each one. One click. Fires a real-time alert to the plan.

**Plan / Government Dashboard** — The health plan sees all claims across all NPIs, ranked by risk score. Supplier watchlist. Live alert feed. When enough doctors flag the same supplier, the pattern surfaces automatically.

---

## The Core Insight

The doctor's flag is the most powerful fraud signal in the system. No algorithm is more accurate than a physician saying "I have never seen this patient in my life." MediClaim delivers that signal to health plans in real time and uses it to train the ML models that make risk scoring smarter over time.

---

## Current State

**Phase: MVP — Synthetic Data Demo**

The MVP runs on 800 GPT-4 generated claims with 6 fraud patterns baked in. It is a fully functional demonstration used to pitch health plans for a real claims data pilot agreement. No real patient data. No HIPAA compliance required at this stage.

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | Next.js 14 (App Router) + Tailwind CSS | Single codebase for both dashboards |
| Backend | FastAPI (Python 3.11) | Python means rules engine and future ML in the same codebase |
| Database | PostgreSQL 15 | Simple, queryable, reliable |
| Real-time | Server-Sent Events (SSE) | Physician flags appear on plan dashboard instantly |
| AI — Data | GPT-4 API | Synthetic claims generation for MVP demo only |
| Deployment | VPS (Ubuntu + Nginx + Uvicorn) | Self-hosted server, full control, HTTPS via Nginx reverse proxy |

---

## Repository Structure

```
claimlens/
│
├── backend/
│   ├── main.py                        # FastAPI app entry point, CORS, router registration
│   ├── database.py                    # SQLAlchemy engine, session factory, Base
│   ├── models.py                      # All 5 table definitions
│   ├── routers/
│   │   ├── claims.py                  # Physician-facing claim endpoints
│   │   ├── actions.py                 # Confirm / dispute / flag POST endpoint
│   │   ├── dashboard.py               # Plan dashboard aggregation endpoints
│   │   └── alerts.py                  # SSE real-time alert stream
│   ├── rules/
│   │   └── engine.py                  # 5 guardrail rules, run_all_rules()
│   ├── scoring/
│   │   └── risk_score.py              # NPI + supplier risk score calculator
│   └── data/
│       ├── generate_synthetic.py      # GPT-4 data generation script
│       ├── load_oig_leie.py           # OIG exclusion list loader
│       └── demo_reset.py              # Resets DB to clean demo state
│
├── frontend/
│   ├── app/
│   │   ├── layout.tsx                 # Root layout, demo user switcher
│   │   ├── physician/
│   │   │   └── page.tsx               # Physician dashboard
│   │   ├── plan/
│   │   │   ├── page.tsx               # Plan NPI risk leaderboard
│   │   │   ├── suppliers/page.tsx     # Supplier watchlist
│   │   │   └── alerts/page.tsx        # Live alert feed
│   │   └── components/
│   │       ├── ClaimsTable.tsx
│   │       ├── RiskBadge.tsx
│   │       ├── ActionButtons.tsx
│   │       ├── AlertFeed.tsx
│   │       └── SupplierCard.tsx
│   └── lib/
│       └── api.ts                     # All API calls centralized
│
├── docs/
│   ├── HLD.md
│   ├── LLD.md
│   ├── DB_SCHEMA.md
│   ├── DATA_FLOW.md
│   ├── FUNCTIONAL_REQUIREMENTS.md
│   ├── NON_FUNCTIONAL_REQUIREMENTS.md
│   ├── API_SPEC.md
│   ├── RULES_ENGINE_SPEC.md
│   ├── RISK_SCORING_SPEC.md
│   ├── SYNTHETIC_DATA_SPEC.md
│   ├── UI_SPEC.md
│   ├── ENVIRONMENT_SETUP.md
│   ├── DEMO_SCRIPT.md
│   ├── DEPLOYMENT.md
│   └── TESTING_SPEC.md
│
├── docker-compose.yml                 # PostgreSQL + backend + frontend
├── .env.example                       # All required environment variables documented
├── .gitignore
└── README.md
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in every value before running anything.

```env
# Database
DATABASE_URL=postgresql://claimlens:password@localhost:5432/claimlens_db

# OpenAI — used only for synthetic data generation
OPENAI_API_KEY=sk-...

# Security
SECRET_KEY=your-secret-key-here

# CORS — comma-separated list of allowed origins
CORS_ORIGINS=http://localhost:3000

# App
PORT=8000
ENVIRONMENT=development
```

**Never commit `.env` to version control. It is in `.gitignore`.**

---

## Running Locally

### Prerequisites

- Docker Desktop installed and running
- Python 3.11+
- Node.js 18+
- An OpenAI API key (GPT-4 access)

### Step 1 — Clone and configure

```bash
git clone https://github.com/your-org/claimlens.git
cd claimlens
cp .env.example .env
# Fill in .env values
```

### Step 2 — Start PostgreSQL

```bash
docker-compose up -d postgres
```

### Step 3 — Start the backend

```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000
```

### Step 4 — Generate synthetic data

```bash
cd backend
python data/generate_synthetic.py
python data/load_oig_leie.py
```

### Step 5 — Verify data loaded correctly

```bash
# Run these queries against your local PostgreSQL
# All 4 must pass before touching the frontend

# 1. MedSupply Pro bills under 9 NPIs
SELECT COUNT(DISTINCT npi) FROM claims WHERE supplier_name = 'MedSupply Pro LLC';
# Expected: 9

# 2. Dr. Wilson volume spike
SELECT DATE_TRUNC('month', date_of_service), COUNT(*)
FROM claims WHERE npi = '1234567890'
GROUP BY 1 ORDER BY 1;
# Expected: months 1-2 show ~8-10 claims, month 3 shows 40+

# 3. Geographic anomaly claims
SELECT COUNT(*) FROM rules_flags WHERE rule_name = 'geographic_anomaly';
# Expected: 20+

# 4. OIG flagged claims
SELECT COUNT(*) FROM claims WHERE oig_flagged = true;
# Expected: 35+
```

### Step 6 — Start the frontend

```bash
cd frontend
npm install
npm run dev
# Opens at http://localhost:3000
```

### Step 7 — Verify the app

Open http://localhost:3000. You should see the demo user switcher in the top right corner. Switch between Dr. James Wilson (Physician) and Plan Investigator to see both dashboards. The API documentation is at http://localhost:8000/docs.

---

## Server Deployment

MediClaim deploys to a Linux VPS (Ubuntu 22.04 recommended). Nginx acts as a reverse proxy serving both the FastAPI backend and the Next.js frontend over HTTPS.

**Stack on server:**
- Ubuntu 22.04
- Nginx — reverse proxy, SSL termination
- Uvicorn — ASGI server running FastAPI (managed by systemd)
- PM2 or systemd — process management for Next.js
- PostgreSQL 15 — installed directly on server or via Docker
- Certbot — free SSL certificate via Let's Encrypt

**High-level steps:**
1. Provision server, point domain DNS to server IP
2. Install Nginx, PostgreSQL, Python 3.11, Node.js 18
3. Clone repo, configure `.env` for production
4. Run data generation scripts to populate database
5. Configure Nginx reverse proxy — backend on `/api`, frontend on `/`
6. Set up systemd service for Uvicorn
7. Set up PM2 for Next.js
8. Issue SSL certificate with Certbot

Full step-by-step instructions in `docs/DEPLOYMENT.md`.

---

## Demo Reset

Before any pitch meeting, reset the database to a clean known state:

```bash
cd backend
python data/demo_reset.py
```

This drops all data, regenerates from scratch, re-runs the rules engine and scoring, and pre-seeds a handful of physician actions so the plan dashboard shows existing alert history. Runs in under 2 minutes.

---

## Two Dashboards — Quick Reference

### Physician Dashboard (`/physician`)

Accessed as Dr. James Wilson (NPI: 1234567890). Shows all claims filed under his NPI. Physician can Confirm, Dispute, Flag Supplier, or mark Unknown Patient on each claim. Actions fire real-time alerts to the plan dashboard via SSE.

### Plan Dashboard (`/plan`)

Accessed as Plan Investigator. Three views:
- **NPI Risk Leaderboard** — all NPIs sorted by risk score, click any row for full drill-down
- **Supplier Watchlist** — suppliers sorted by physician flag count, OIG badge where applicable
- **Live Alerts** — real-time feed of physician actions via SSE stream

---

## The 6 Fraud Patterns In The Demo Data

| # | Pattern | Supplier | Details |
|---|---------|----------|---------|
| 1 | Hub Supplier | MedSupply Pro LLC | Bills under 9 NPIs, 120 claims, $180K, OIG flagged |
| 2 | Volume Spike | — | Dr. Wilson: 8-10 claims/month → 47 claims in month 3 |
| 3 | Geographic Anomaly | — | 20 claims with patient 200+ miles from physician |
| 4 | OIG Listed | QuickCare Equipment Inc | 15 claims across 3 NPIs, all excluded |
| 5 | New High-Value | Premier Home Solutions | First appears last 15 days, $34K billed |
| 6 | Patient ID Reuse | — | Same patient ID under 3 NPIs, different names + zips |

---

## Data Sources Used

| Source | Used For | Access |
|---|---|---|
| GPT-4 API | Synthetic claims generation | OpenAI API key |
| OIG LEIE Exclusion List | Supplier exclusion check at ingestion | Free download — oig.hhs.gov |
| NPI Registry API | Physician profile enrichment | Free public API — no key needed |

---

## What This Is Not (MVP Scope)

- Not HIPAA compliant — runs on synthetic data only
- Not authenticated — demo users are hardcoded
- Not production infrastructure — MVP server setup, not enterprise-hardened
- Not ML-powered — risk scores are rules-based arithmetic
- Not connected to real claims data — pilot data agreement required

See `docs/FUNCTIONAL_REQUIREMENTS.md` for full MVP scope definition.
See `docs/NON_FUNCTIONAL_REQUIREMENTS.md` for real product compliance requirements.

---

## Roadmap

| Phase | Timeline | Key Additions |
|---|---|---|
| MVP Demo | Week 1 | Synthetic data, rules engine, both dashboards, SSE alerts |
| Phase 1 Pilot | Weeks 2-4 | Real plan data, ETL pipeline, NPI Registry enrichment, Auth0 |
| Phase 2 | Weeks 5-10 | Graph ML, Isolation Forest, XGBoost risk scoring, case management |
| Phase 3 | Weeks 11-20 | Cross-plan signals, EHR integration, SOC 2, enterprise contracts |

---

## Contact

Project: MediClaim — NPI Intelligence Platform
Status: MVP Build — Pre-Pilot
Target: TBD — pilot partner to be confirmed (health plan or MAC)
