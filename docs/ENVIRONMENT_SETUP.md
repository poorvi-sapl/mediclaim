# ENVIRONMENT_SETUP — Local Development Setup
## ClaimLens — NPI Intelligence Platform

---

## Document Purpose

This document takes a developer from a completely blank machine to a fully running local ClaimLens environment with synthetic data loaded and both dashboards working. Follow every step in order. Do not skip steps. Every command is copy-paste ready.

**Estimated time:** 30–45 minutes on a clean machine.

**Target OS:** macOS or Ubuntu 22.04. Windows users should use WSL2 (Ubuntu).

---

## Prerequisites Check

Before starting, verify you have these installed. Run each check command. If a command fails, follow the install link.

### 1. Git
```bash
git --version
# Expected: git version 2.x.x or higher
# Install: https://git-scm.com/downloads
```

### 2. Docker Desktop
```bash
docker --version
# Expected: Docker version 24.x.x or higher
docker compose version
# Expected: Docker Compose version v2.x.x or higher
# Install: https://docs.docker.com/desktop/
# IMPORTANT: Docker Desktop must be running before proceeding
```

### 3. Python 3.11+
```bash
python3 --version
# Expected: Python 3.11.x or higher
# Install (macOS): brew install python@3.11
# Install (Ubuntu): sudo apt install python3.11 python3.11-venv python3.11-pip
```

### 4. Node.js 18+
```bash
node --version
# Expected: v18.x.x or higher
npm --version
# Expected: 9.x.x or higher
# Install: https://nodejs.org/en/download
# Recommended: use nvm — https://github.com/nvm-sh/nvm
```

### 5. OpenAI API Key
You need a valid OpenAI API key with access to GPT-4.
- Get one at: https://platform.openai.com/api-keys
- Verify GPT-4 access — not all API keys have it
- Keep it ready for the `.env` setup step

---

## Step 1 — Clone the Repository

```bash
git clone https://github.com/your-org/claimlens.git
cd claimlens
```

Verify the structure looks correct:
```bash
ls -la
# Expected output includes: backend/  frontend/  docs/  docker-compose.yml  .env.example
```

---

## Step 2 — Configure Environment Variables

### 2.1 — Copy the example file

```bash
cp .env.example .env
```

### 2.2 — Open `.env` and fill in every value

```bash
# Use any text editor
nano .env
# or
code .env
```

The `.env` file contents:

```env
# ─── DATABASE ───────────────────────────────────────────────
# PostgreSQL connection string
# Do not change this for local development — matches docker-compose.yml
DATABASE_URL=postgresql://claimlens:claimlens_password@localhost:5432/claimlens_db

# ─── OPENAI ─────────────────────────────────────────────────
# Required for synthetic data generation (Day 2)
# Must have GPT-4 access
OPENAI_API_KEY=sk-your-key-here

# ─── SECURITY ───────────────────────────────────────────────
# Any random string — used for internal signing
# Generate one: python3 -c "import secrets; print(secrets.token_hex(32))"
SECRET_KEY=your-secret-key-here

# ─── CORS ───────────────────────────────────────────────────
# Comma-separated list of allowed frontend origins
# Do not change for local development
CORS_ORIGINS=http://localhost:3000

# ─── APP ────────────────────────────────────────────────────
PORT=8000
ENVIRONMENT=development

# ─── RULES ENGINE THRESHOLDS ────────────────────────────────
# All configurable — change these to tune rule sensitivity
VOLUME_SPIKE_MULTIPLIER=2.0
GEOGRAPHIC_ANOMALY_MILES=150.0
CROSS_NPI_THRESHOLD=3
NEW_SUPPLIER_DAYS_LOOKBACK=30
NEW_SUPPLIER_AMOUNT_THRESHOLD=500.00

# ─── RISK SCORING WEIGHTS ───────────────────────────────────
WEIGHT_VOLUME_SPIKE=25
WEIGHT_GEO_ANOMALY=15
WEIGHT_CROSS_NPI=30
WEIGHT_OIG_HIT=35
WEIGHT_NEW_SUPPLIER=10
WEIGHT_PER_PHYSICIAN_FLAG=5
MAX_PHYSICIAN_FLAG_CONTRIBUTION=20

# ─── SSE ────────────────────────────────────────────────────
SSE_KEEPALIVE_SECONDS=15
```

**Fill in:**
- `OPENAI_API_KEY` — your actual OpenAI API key
- `SECRET_KEY` — run the generation command shown in the comment

Leave everything else as-is for local development.

### 2.3 — Verify `.gitignore` includes `.env`

```bash
cat .gitignore | grep ".env"
# Expected output: .env
# If not present, add it: echo ".env" >> .gitignore
```

**Never commit the `.env` file. This is critical.**

---

## Step 3 — Start PostgreSQL

### 3.1 — Start the database container

```bash
docker compose up -d postgres
```

Expected output:
```
[+] Running 1/1
 ✔ Container claimlens-postgres-1  Started
```

### 3.2 — Verify PostgreSQL is running

```bash
docker compose ps
```

Expected output:
```
NAME                    STATUS          PORTS
claimlens-postgres-1    running         0.0.0.0:5432->5432/tcp
```

### 3.3 — Test the database connection

```bash
docker exec -it claimlens-postgres-1 psql -U claimlens -d claimlens_db -c "\dt"
```

Expected output:
```
Did not find any relations.
```

This means the database is empty and ready. Tables will be created when the backend starts.

**If connection fails:**
```bash
# Check Docker Desktop is running
docker ps

# Check the container logs
docker compose logs postgres

# Most common fix: wait 10 seconds and retry
sleep 10 && docker exec -it claimlens-postgres-1 psql -U claimlens -d claimlens_db -c "\dt"
```

---

## Step 4 — Set Up the Python Backend

### 4.1 — Navigate to backend directory

```bash
cd backend
```

### 4.2 — Create a Python virtual environment

```bash
python3 -m venv venv
```

### 4.3 — Activate the virtual environment

```bash
# macOS / Linux
source venv/bin/activate

# You should see (venv) at the start of your terminal prompt
# Example: (venv) user@machine:~/claimlens/backend$
```

**Important:** The virtual environment must be active for all subsequent Python commands. If you open a new terminal window, you must run the activate command again.

### 4.4 — Install Python dependencies

```bash
pip install -r requirements.txt
```

This installs all packages from `requirements.txt`. Takes 2–5 minutes on first run.

Expected final line:
```
Successfully installed fastapi-0.111.0 uvicorn-0.29.0 ...
```

**If pip install fails on psycopg2-binary:**
```bash
# macOS
brew install libpq
pip install psycopg2-binary --no-cache-dir

# Ubuntu
sudo apt-get install libpq-dev python3-dev
pip install psycopg2-binary
```

### 4.5 — Start the backend server

```bash
python -m uvicorn main:app --reload --port 8000
```

Expected output:
```
INFO:     Will watch for changes in these directories: ['/path/to/claimlens/backend']
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
INFO:     Started reloader process [12345] using WatchFiles
INFO:     Started server process [12346]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
```

### 4.6 — Verify the backend is running

Open a new terminal window and run:

```bash
curl http://localhost:8000/health
```

Expected response:
```json
{
  "status": "ok",
  "database": "connected",
  "total_claims": 0,
  "total_flags": 0,
  "timestamp": "2024-11-15T10:00:00.000Z"
}
```

`total_claims: 0` is correct at this point — data hasn't been generated yet.

Also verify the API docs are accessible:
```
Open in browser: http://localhost:8000/docs
```

You should see the FastAPI Swagger UI with all endpoints listed.

---

## Step 5 — Generate Synthetic Data

**Keep the backend server running in its terminal window. Open a new terminal for this step.**

### 5.1 — Navigate to backend and activate virtual environment

```bash
cd claimlens/backend
source venv/bin/activate
```

### 5.2 — Download the OIG LEIE exclusion list

```bash
python data/load_oig_leie.py
```

This downloads the OIG exclusion list CSV and loads it into memory for the OIG check step. Expected output:

```
INFO: Downloading OIG LEIE exclusion list...
INFO: Loaded 76,432 excluded entities
INFO: OIG LEIE data ready
```

**If download fails (network issue):**
```bash
# Download manually from:
# https://oig.hhs.gov/exclusions/exclusions_list.asp
# Save as: backend/data/oig_leie.csv
# Then run: python data/load_oig_leie.py --local
```

### 5.3 — Generate synthetic claims data

```bash
python data/generate_synthetic.py
```

This calls GPT-4 in 8 batches and loads all data into PostgreSQL. Expected output:

```
INFO: Generating synthetic data for ClaimLens MVP...
INFO: [Batch 1/8] Generating MedSupply Pro fraud claims (120 records)...
INFO: [Batch 1/8] Complete — 120 records generated
INFO: [Batch 2/8] Generating QuickCare Equipment claims (15 records)...
INFO: [Batch 2/8] Complete — 15 records generated
INFO: [Batch 3/8] Generating Premier Home Solutions claims (22 records)...
INFO: [Batch 3/8] Complete — 22 records generated
INFO: [Batch 4/8] Generating geographic anomaly claims (20 records)...
INFO: [Batch 4/8] Complete — 20 records generated
INFO: [Batch 5/8] Generating patient ID reuse claims (8 records)...
INFO: [Batch 5/8] Complete — 8 records generated
INFO: [Batch 6/8] Generating Dr. Wilson baseline claims (9 records)...
INFO: [Batch 6/8] Complete — 9 records generated
INFO: [Batch 7/8] Generating Dr. Wilson recent volume claims (27 records)...
INFO: [Batch 7/8] Complete — 27 records generated
INFO: [Batch 8/8] Generating legitimate claims (579 records)...
INFO: [Batch 8/8] Complete — 579 records generated
INFO: Running entity resolution on 800 claims...
INFO: Running geocoding on 800 claims...
INFO: Running OIG LEIE check on 800 claims...
INFO: Inserting 15 NPI profiles...
INFO: Inserting 800 claims...
INFO: Data generation complete in 4m 12s
```

**Estimated time:** 3–6 minutes depending on OpenAI API response time.

**If a batch fails:**
The script saves progress. Re-running resumes from the failed batch. Do not start fresh unless explicitly needed.

### 5.4 — Run the rules engine

```bash
python -c "
from database import SessionLocal
from config import get_settings
from rules.engine import run_all_rules

db = SessionLocal()
settings = get_settings()
count = run_all_rules(db, settings)
print(f'Rules engine complete: {count} flags written')
db.close()
"
```

Expected output:
```
INFO: Rules engine starting...
INFO: Cleared 0 existing flags
INFO: Rule 'oig_leie_hit': 135 flags fired in 0.04s
INFO: Rule 'cross_npi_supplier': 120 flags fired in 0.08s
INFO: Rule 'volume_spike': 47 flags fired in 0.12s
INFO: Rule 'geographic_anomaly': 20 flags fired in 0.34s
INFO: Rule 'new_high_value_supplier': 22 flags fired in 0.09s
INFO: Rules engine complete: 344 total flags written
Rules engine complete: 344 flags written
```

### 5.5 — Run risk scoring

```bash
python -c "
from database import SessionLocal
from config import get_settings
from scoring.risk_score import calculate_all_scores

db = SessionLocal()
settings = get_settings()
calculate_all_scores(db, settings)
print('Risk scoring complete')
db.close()
"
```

Expected output:
```
INFO: Calculating NPI scores for 15 NPIs...
INFO: Calculating supplier scores for 12 suppliers...
INFO: Risk scoring complete
Risk scoring complete
```

### 5.6 — Seed demo actions

```bash
python data/seed_demo_actions.py
```

This pre-populates 5 physician flag actions so the plan dashboard shows existing alert history from the start of the demo.

Expected output:
```
INFO: Seeding 5 demo actions...
INFO: Seeded: Dr. James Wilson flagged MedSupply Pro LLC
INFO: Seeded: Dr. James Wilson flagged MedSupply Pro LLC
INFO: Seeded: Dr. Sarah Chen flagged MedSupply Pro LLC
INFO: Seeded: Dr. Michael Torres flagged QuickCare Equipment Inc
INFO: Seeded: Dr. James Wilson marked unknown patient
INFO: Demo actions seeded successfully
```

---

## Step 6 — Verify Data Loaded Correctly

Run the 4 critical verification queries. Every query must pass before proceeding.

```bash
# Connect to PostgreSQL
docker exec -it claimlens-postgres-1 psql -U claimlens -d claimlens_db
```

Run each query inside the psql shell:

```sql
-- Query 1: MedSupply Pro bills under 9 NPIs
SELECT COUNT(DISTINCT npi) FROM claims WHERE supplier_name = 'MedSupply Pro LLC';
-- MUST return: 9

-- Query 2: Dr. Wilson volume spike
SELECT
    CASE WHEN date_of_service >= CURRENT_DATE - INTERVAL '30 days'
         THEN 'recent_30_days' ELSE 'prior_60_days' END as period,
    COUNT(*) as claim_count
FROM claims
WHERE npi = '1234567890'
AND date_of_service >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY 1;
-- MUST show: recent_30_days >= 40, prior_60_days <= 15

-- Query 3: Geographic anomaly flags
SELECT COUNT(*) FROM rules_flags WHERE rule_name = 'geographic_anomaly';
-- MUST return: >= 20

-- Query 4: OIG flagged suppliers
SELECT supplier_name, COUNT(*) as claims
FROM claims WHERE oig_flagged = true GROUP BY supplier_name;
-- MUST show: MedSupply Pro LLC and QuickCare Equipment Inc each with their expected counts

-- Exit psql
\q
```

**If any query fails:** Fix the data issue before proceeding. Do not start building the frontend against broken data. See the Troubleshooting section at the end of this document.

Check the health endpoint one more time:
```bash
curl http://localhost:8000/health
```

Expected now:
```json
{
  "status": "ok",
  "database": "connected",
  "total_claims": 800,
  "total_flags": 344,
  "timestamp": "..."
}
```

---

## Step 7 — Set Up the Next.js Frontend

**Open a new terminal window for this step. Keep the backend running.**

### 7.1 — Navigate to frontend directory

```bash
cd claimlens/frontend
```

### 7.2 — Install Node dependencies

```bash
npm install
```

Expected final output:
```
added 312 packages in 45s
```

### 7.3 — Create the frontend environment file

```bash
cp .env.local.example .env.local
```

The `.env.local` file:
```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

This tells the frontend where the backend is. No other variables needed for local development.

### 7.4 — Start the frontend development server

```bash
npm run dev
```

Expected output:
```
▲ Next.js 14.x.x
- Local:        http://localhost:3000
- Environments: .env.local

✓ Ready in 2.1s
```

---

## Step 8 — Verify the Full Stack is Working

### 8.1 — Open the application

```
http://localhost:3000
```

You should see the ClaimLens application with the physician dashboard.

### 8.2 — Verify physician dashboard loads

- Summary card shows Dr. James Wilson's data
- Claims table shows claims with flag badges
- Summary card "Unknown Suppliers" shows > 0 in red

### 8.3 — Switch to plan view

- Click the demo user switcher in the top-right
- Select "Plan Investigator"
- NPI risk leaderboard should load
- Dr. Wilson should appear in the top 3

### 8.4 — Test the SSE alert stream

**Open two browser windows side by side:**
- Window 1: http://localhost:3000/plan/alerts — plan alerts page
- Window 2: http://localhost:3000/physician — physician dashboard

**In Window 2 (physician):**
1. Find any unreviewed claim
2. Click "⚑ Flag Supplier"
3. The button should show a loading spinner, then the row should gray out

**In Window 1 (plan alerts):**
1. Within 1 second of clicking in Window 2, a new alert card should appear at the top
2. The card shows Dr. Wilson's name, the supplier name, patient name, and amount

**If the alert does not appear within 2 seconds:** See SSE troubleshooting below.

### 8.5 — Verify the health endpoint

```bash
curl http://localhost:8000/health
```

Expected:
```json
{
  "status": "ok",
  "database": "connected",
  "total_claims": 800,
  "total_flags": 344,
  "timestamp": "..."
}
```

**If all 5 checks pass — the environment is fully set up and working.**

---

## Running Services Summary

After full setup you should have these running simultaneously:

| Service | Terminal | Command | URL |
|---|---|---|---|
| PostgreSQL | Docker (background) | `docker compose up -d postgres` | localhost:5432 |
| FastAPI backend | Terminal 1 | `uvicorn main:app --reload --port 8000` | http://localhost:8000 |
| Next.js frontend | Terminal 2 | `npm run dev` | http://localhost:3000 |

---

## Demo Reset

Before every pitch meeting, reset the database to a clean known state:

```bash
# From the backend directory with venv active
cd claimlens/backend
source venv/bin/activate
python data/demo_reset.py
```

This runs in under 3 minutes and restores the database to the post-setup state — all 800 claims, all rules flags, all risk scores, and the 5 pre-seeded demo actions.

Expected output:
```
INFO: Resetting ClaimLens demo data...
INFO: Truncating all tables...
INFO: Generating synthetic data...
INFO: Running rules engine...
INFO: Running risk scoring...
INFO: Seeding demo actions...
INFO: Demo reset complete in 2m 47s
INFO: Verification: 800 claims, 344 flags, 27 risk score rows
```

---

## Daily Development Workflow

### Starting up after the machine has been off

```bash
# Terminal 1: Start PostgreSQL
cd claimlens
docker compose up -d postgres

# Terminal 1: Start backend
cd backend
source venv/bin/activate
python -m uvicorn main:app --reload --port 8000

# Terminal 2: Start frontend
cd claimlens/frontend
npm run dev
```

### Stopping everything

```bash
# Stop frontend: Ctrl+C in Terminal 2
# Stop backend: Ctrl+C in Terminal 1
# Stop PostgreSQL:
docker compose down
```

### After pulling new code from git

```bash
# Backend: check for new dependencies
cd backend
source venv/bin/activate
pip install -r requirements.txt

# Frontend: check for new dependencies
cd ../frontend
npm install
```

---

## Troubleshooting

### PostgreSQL won't start

```bash
# Check if port 5432 is already in use
lsof -i :5432

# If something is using 5432, find and stop it
# Or change the port in docker-compose.yml and .env DATABASE_URL

# Check Docker Desktop is running
docker ps

# View PostgreSQL container logs
docker compose logs postgres
```

### Backend fails to connect to database

```bash
# Verify DATABASE_URL in .env matches docker-compose.yml
# Should be: postgresql://claimlens:claimlens_password@localhost:5432/claimlens_db

# Test connection directly
docker exec -it claimlens-postgres-1 psql -U claimlens -d claimlens_db -c "SELECT 1"
```

### Synthetic data generation fails midway

```bash
# The script is designed to be re-run
# It skips already-inserted records using ON CONFLICT DO NOTHING
# Simply re-run: python data/generate_synthetic.py
# If you want a completely fresh start: python data/demo_reset.py
```

### GPT-4 API returns invalid JSON

```bash
# This happens occasionally — the script retries up to 3 times per batch
# If a batch fails 3 times, it logs the raw response for debugging
# Check: backend/data/generation_errors.log
# Fix: re-run the script, it will resume from the failed batch
```

### SSE alerts not appearing in plan dashboard

```bash
# 1. Check browser console for EventSource errors
# 2. Verify CORS is configured correctly in backend/main.py
# 3. Check the backend terminal for SSE connection logs
# 4. Verify the SSE endpoint is accessible:
curl -N http://localhost:8000/plan/alerts/stream
# Should see: ": keep-alive" appear every 15 seconds
```

### Frontend shows "Unable to load" on all pages

```bash
# Check NEXT_PUBLIC_API_URL in frontend/.env.local
# Must be: NEXT_PUBLIC_API_URL=http://localhost:8000

# Check backend is running
curl http://localhost:8000/health

# Check CORS in backend — frontend origin must be in CORS_ORIGINS
```

### Port 3000 is already in use

```bash
# Find what is using port 3000
lsof -i :3000

# Kill the process or use a different port
npm run dev -- --port 3001
# Then update NEXT_PUBLIC_API_URL is still pointing to 8000
```

### Verification queries fail after data generation

```bash
# Full reset and regeneration
cd backend
source venv/bin/activate
python data/demo_reset.py

# If reset also fails, check the error log
cat data/generation_errors.log

# Nuclear option: drop and recreate the database
docker compose down -v    # removes volumes — deletes all data
docker compose up -d postgres
# Wait 10 seconds for PostgreSQL to initialize
# Then start from Step 5 again
```

---

## Docker Compose Reference

`docker-compose.yml` contents:

```yaml
version: "3.9"

services:
  postgres:
    image: postgres:15
    container_name: claimlens-postgres
    environment:
      POSTGRES_USER: claimlens
      POSTGRES_PASSWORD: claimlens_password
      POSTGRES_DB: claimlens_db
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U claimlens -d claimlens_db"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
```

**Note:** `postgres_data` is a named Docker volume. It persists between `docker compose down` and `docker compose up` restarts. To delete all data: `docker compose down -v` (the `-v` flag removes volumes).
