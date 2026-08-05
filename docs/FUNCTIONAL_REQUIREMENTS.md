# FUNCTIONAL_REQUIREMENTS — Functional Requirements
## ClaimLens — NPI Intelligence Platform

---

## Document Purpose

This document defines everything the ClaimLens system must do. Every feature is written as a user story with acceptance criteria. This is the document you test against. If a feature is not in this document, it is not in scope. If a feature is in this document, it must be verifiable before the MVP is considered complete.

---

## Users

**Physician** — A licensed healthcare provider (doctor) who has claims filed under their NPI. In the MVP, this is Dr. James Wilson, NPI 1234567890. In production, any physician registered in the system.

**Plan Investigator** — A fraud, waste, and abuse (FWA) analyst or investigator employed by the health plan. In the MVP, this is the hardcoded Plan Investigator demo user. In production, an authenticated plan employee.

**System** — Background processes — ETL pipeline, rules engine, risk scoring — that run without user interaction.

---

## MVP Scope Boundary

The following requirements are **in scope for the 10-day MVP**. Requirements marked `[PHASE 2]` or `[PHASE 3]` are documented here for completeness but are not built in the MVP.

---

## Section 1 — Data Ingestion (System)

---

### FR-001 — Synthetic Data Generation

**As the system**, it must generate 800 realistic synthetic claims records using GPT-4 and load them into PostgreSQL so that both dashboards have data to display.

**Acceptance criteria:**
- [ ] Running `python data/generate_synthetic.py` completes without error
- [ ] claims table contains exactly 800 rows after script completes
- [ ] All 800 rows have non-null values for: npi, patient_name, patient_zip, date_of_service, service_description, service_category, supplier_name, supplier_id, claim_amount, plan_name
- [ ] service_category values are exclusively: home_health, hospice, dme, drugs, hospital
- [ ] date_of_service values span a 90-day window ending at current date
- [ ] claim_amount is > 0 for all records
- [ ] npi_profiles table contains 15 rows after script completes
- [ ] Dr. James Wilson exists in npi_profiles with NPI 1234567890 and practice_zip 94102

---

### FR-002 — OIG LEIE Exclusion Check at Ingestion

**As the system**, it must check every supplier name against the OIG LEIE exclusion list during ingestion and flag matching suppliers so that excluded providers are surfaced immediately.

**Acceptance criteria:**
- [ ] OIG LEIE CSV is loaded from local storage before ingestion begins
- [ ] Every claims record has oig_flagged set to either true or false — never null
- [ ] MedSupply Pro LLC has oig_flagged = true on all its claims
- [ ] QuickCare Equipment Inc has oig_flagged = true on all its claims
- [ ] All other synthetic suppliers have oig_flagged = false
- [ ] Query `SELECT COUNT(*) FROM claims WHERE oig_flagged = true` returns 35 or more

---

### FR-003 — Supplier Entity Resolution

**As the system**, it must assign a consistent supplier_id to name variants of the same supplier so that cross-NPI analysis works correctly.

**Acceptance criteria:**
- [ ] All claims from "MedSupply Pro LLC" share the same supplier_id
- [ ] supplier_id is populated for every claims row — never null
- [ ] Distinct supplier_id count is less than distinct supplier_name count (variants collapsed)

---

### FR-004 — Geocoding

**As the system**, it must populate latitude and longitude for every physician practice zip and every patient zip so that the geographic anomaly rule can calculate distances.

**Acceptance criteria:**
- [ ] All 15 npi_profiles rows have non-null practice_lat and practice_lng
- [ ] All 800 claims rows have non-null patient_lat and patient_lng
- [ ] Dr. Wilson's practice_lat and practice_lng correspond to zip 94102 (San Francisco, CA)

---

### FR-005 — Data Verification Queries

**As a developer**, I must be able to run 4 SQL verification queries after ingestion that confirm all 6 fraud patterns loaded correctly so that the demo data is reliable before any pitch meeting.

**Acceptance criteria:**
- [ ] `SELECT COUNT(DISTINCT npi) FROM claims WHERE supplier_name = 'MedSupply Pro LLC'` returns 9
- [ ] Dr. Wilson claim count in last 30 days of the dataset is at least 40
- [ ] Dr. Wilson claim count in the 60 days before that is less than 20
- [ ] `SELECT COUNT(*) FROM rules_flags WHERE rule_name = 'geographic_anomaly'` returns 20 or more after rules engine runs
- [ ] `SELECT COUNT(*) FROM claims WHERE oig_flagged = true` returns 35 or more

---

## Section 2 — Rules Engine (System)

---

### FR-006 — Volume Spike Rule

**As the system**, it must detect NPIs whose claim rate in the last 30 days is more than double their rate in the prior 60-day baseline and flag them so that sudden billing surges are surfaced.

**Acceptance criteria:**
- [ ] Rule fires for Dr. Wilson NPI 1234567890
- [ ] Rule does not fire for NPIs with consistent claim volume across both periods
- [ ] Fired flags have rule_name = 'volume_spike' and severity = 'high'
- [ ] rule_description contains the NPI, the last-30-day count, and the baseline rate
- [ ] Running rules engine twice produces the same flag count (idempotent)

---

### FR-007 — Geographic Anomaly Rule

**As the system**, it must detect claims where the patient zip code is more than 150 miles from the ordering physician's practice zip and flag them so that geographically implausible claims are surfaced.

**Acceptance criteria:**
- [ ] At least 20 claims in the synthetic dataset fire this rule
- [ ] Fired flags have rule_name = 'geographic_anomaly' and severity = 'medium'
- [ ] rule_description contains the patient zip, physician zip, and calculated distance in miles
- [ ] Claims where patient and physician are in the same metropolitan area do not fire this rule
- [ ] Distance calculation uses haversine formula against geocoded lat/lng values

---

### FR-008 — Cross-NPI Supplier Rule

**As the system**, it must detect suppliers billing under more than 3 distinct physician NPIs and flag all their claims so that hub suppliers are identified.

**Acceptance criteria:**
- [ ] All 120 MedSupply Pro LLC claims have a cross_npi_supplier flag
- [ ] Fired flags have rule_name = 'cross_npi_supplier' and severity = 'critical'
- [ ] rule_description states the supplier name and how many distinct NPIs they bill under
- [ ] Suppliers billing under 3 or fewer NPIs do not fire this rule
- [ ] Threshold of 3 is configurable without code change (environment variable or config)

---

### FR-009 — New High-Value Supplier Rule

**As the system**, it must detect suppliers appearing for the first time under an NPI within the last 30 days with a claim amount above $500 and flag them so that new entrants billing at suspicious volumes are surfaced.

**Acceptance criteria:**
- [ ] Premier Home Solutions claims fire this rule
- [ ] Fired flags have rule_name = 'new_high_value_supplier' and severity = 'medium'
- [ ] rule_description states the supplier name, the NPI, and the claim amount
- [ ] Established suppliers (with claims older than 30 days) do not fire this rule even at high amounts
- [ ] Claims under $500 from new suppliers do not fire this rule

---

### FR-010 — OIG LEIE Hit Rule

**As the system**, it must flag every claim where the supplier is on the OIG LEIE exclusion list so that excluded providers are immediately visible in the dashboard.

**Acceptance criteria:**
- [ ] All claims with oig_flagged = true have a corresponding oig_leie_hit flag in rules_flags
- [ ] Fired flags have rule_name = 'oig_leie_hit' and severity = 'critical'
- [ ] rule_description states the supplier name and that they appear on the OIG exclusion list
- [ ] Claims with oig_flagged = false never fire this rule

---

### FR-011 — Rules Engine Idempotency

**As a developer**, running the rules engine multiple times against the same dataset must produce the same result so that re-runs during development do not corrupt flag data.

**Acceptance criteria:**
- [ ] Running rules engine twice results in the same total row count in rules_flags
- [ ] No duplicate flags are created on re-run
- [ ] Total rules_flags row count is stable after first run

---

## Section 3 — Risk Scoring (System)

---

### FR-012 — NPI Risk Score Calculation

**As the system**, it must calculate a composite risk score 0-100 for every physician NPI and store it in npi_risk_scores so that the plan dashboard can rank NPIs by risk.

**Acceptance criteria:**
- [ ] Every NPI in npi_profiles has a corresponding row in npi_risk_scores with entity_type = 'npi'
- [ ] Dr. Wilson has a risk_score of 70 or above (volume spike + cross-NPI supplier)
- [ ] NPIs with no fired rules have a risk_score of 0
- [ ] risk_score never exceeds 100
- [ ] All 5 flag boolean columns are populated correctly reflecting which rules fired
- [ ] total_claim_count and total_claim_amount are accurate for each NPI
- [ ] top_supplier_name is populated with the most frequent supplier for each NPI

---

### FR-013 — Supplier Risk Score Calculation

**As the system**, it must calculate a composite risk score 0-100 for every supplier entity and store it in npi_risk_scores so that the plan dashboard supplier watchlist can rank suppliers by risk.

**Acceptance criteria:**
- [ ] Every distinct supplier_id has a row in npi_risk_scores with entity_type = 'supplier'
- [ ] MedSupply Pro LLC has risk_score of 65 or above (cross-NPI + OIG flag)
- [ ] QuickCare Equipment Inc has risk_score of 35 or above (OIG flag)
- [ ] distinct_npi_count is populated correctly for every supplier row
- [ ] physician_flag_count starts at 0 for all suppliers and increments when physicians flag

---

### FR-014 — Risk Score Recalculation After Physician Flag

**As the system**, when a physician submits a flag action, the relevant supplier's physician_flag_count in npi_risk_scores must be updated so that the plan dashboard reflects the new signal immediately.

**Acceptance criteria:**
- [ ] Immediately after POST /actions with action_type = 'flag_supplier', the supplier's physician_flag_count in npi_risk_scores increments by 1
- [ ] The supplier's risk_score is recalculated to reflect the new flag count
- [ ] The update completes before the SSE event is broadcast

---

## Section 4 — Physician Dashboard

---

### FR-015 — Physician Identity Display

**As a physician**, when I open the dashboard I must see my name, NPI, specialty, and practice state so that I can confirm I am viewing my own data.

**Acceptance criteria:**
- [ ] Summary card displays physician_name from npi_profiles
- [ ] Summary card displays the NPI number
- [ ] Summary card displays specialty from npi_profiles
- [ ] Summary card displays practice_state from npi_profiles
- [ ] All values are correct for Dr. James Wilson in the demo

---

### FR-016 — Summary Counts Display

**As a physician**, I must see total claims this month, unreviewed claim count, unknown supplier count, and total claim amount this month so that I understand my NPI activity at a glance.

**Acceptance criteria:**
- [ ] Total claims this month count is accurate
- [ ] Unreviewed count shows only claims with reviewed = false
- [ ] Unknown supplier count shows distinct suppliers flagged by this physician
- [ ] Total amount this month is the sum of claim_amount for this NPI in current month
- [ ] Unknown supplier count is displayed in red when greater than zero
- [ ] All four counts update correctly after a physician takes an action

---

### FR-017 — Claims Table Display

**As a physician**, I must see a table of all claims filed under my NPI with the following columns so that I can review each one: date of service, patient name, service description, CPT or HCPCS code, service category chip, supplier name, claim amount, review status.

**Acceptance criteria:**
- [ ] Table displays all claims for NPI 1234567890 by default
- [ ] Date of service column shows date in MM/DD/YYYY format
- [ ] Service category displayed as a colored chip — dme=blue, hospice=purple, home_health=green, drugs=yellow, hospital=gray
- [ ] Claims with rules flags show a colored indicator badge on the row
- [ ] Table default sort: unreviewed claims first, then by date_of_service descending
- [ ] Reviewed claims appear visually distinct (grayed out) from unreviewed
- [ ] Table is paginated — 50 claims per page
- [ ] Total claim count and page number displayed

---

### FR-018 — Claims Table Filtering

**As a physician**, I must be able to filter my claims by category, date range, and review status so that I can focus on the most important claims efficiently.

**Acceptance criteria:**
- [ ] Category dropdown filters claims to selected service_category value
- [ ] Date range picker filters claims to selected date_from and date_to range
- [ ] Reviewed/Unreviewed toggle shows only claims matching selected reviewed status
- [ ] Supplier name search filters claims by supplier_name partial match
- [ ] All filters can be combined — applying multiple filters narrows results correctly
- [ ] Clearing a filter restores the full unfiltered result
- [ ] Filter state persists during the session — navigating away and back preserves filters

---

### FR-019 — Confirm Action

**As a physician**, I must be able to confirm a claim as legitimate so that the plan knows I recognize this patient and authorized this service.

**Acceptance criteria:**
- [ ] Each claim row has a Confirm button
- [ ] Clicking Confirm sends POST /actions with action_type = 'confirm'
- [ ] On success, the claim row is marked as reviewed (visually grayed out)
- [ ] The confirmed claim's reviewed column is set to true in the database
- [ ] Unreviewed count in summary card decrements by 1
- [ ] Confirm action does NOT trigger an SSE alert to the plan dashboard
- [ ] Confirm button shows a loading state while the request is in flight
- [ ] Confirm button shows a success state after the action is recorded

---

### FR-020 — Dispute Action

**As a physician**, I must be able to dispute a claim that appears incorrect so that the plan knows this claim is questionable.

**Acceptance criteria:**
- [ ] Each claim row has a Dispute button
- [ ] Clicking Dispute sends POST /actions with action_type = 'dispute'
- [ ] On success, the claim row is marked as reviewed
- [ ] Dispute action does NOT trigger an SSE alert to the plan dashboard
- [ ] All other acceptance criteria identical to FR-019 (Confirm)

---

### FR-021 — Flag Supplier Action

**As a physician**, I must be able to flag an unfamiliar supplier so that the plan is immediately alerted that this supplier may be fraudulent.

**Acceptance criteria:**
- [ ] Each claim row has a Flag Supplier button
- [ ] Clicking Flag Supplier sends POST /actions with action_type = 'flag_supplier'
- [ ] On success, the claim row is marked as reviewed
- [ ] Flag Supplier action DOES trigger an SSE alert to the plan dashboard
- [ ] The alert appears on the plan dashboard within 1 second of the button click
- [ ] The supplier's physician_flag_count in npi_risk_scores increments immediately
- [ ] All other acceptance criteria identical to FR-019

---

### FR-022 — Unknown Patient Action

**As a physician**, I must be able to mark a patient as unknown so that the plan is immediately alerted that this claim may involve a fictitious or stolen patient identity.

**Acceptance criteria:**
- [ ] Each claim row has an Unknown Patient button
- [ ] Clicking Unknown Patient sends POST /actions with action_type = 'unknown_patient'
- [ ] Unknown Patient action DOES trigger an SSE alert to the plan dashboard
- [ ] All other acceptance criteria identical to FR-021

---

### FR-023 — Flagged Suppliers List

**As a physician**, I must be able to view a list of all suppliers I have flagged so that I can track which suppliers I have reported and see if the plan has acknowledged them.

**Acceptance criteria:**
- [ ] Flagged suppliers page shows all distinct suppliers this physician has flagged
- [ ] Each row shows supplier name, number of claims from this supplier under this NPI, total claim amount, and date of first flag
- [ ] List is sorted by date of first flag descending
- [ ] Empty state displayed if no suppliers have been flagged

---

## Section 5 — Plan / Government Dashboard

---

### FR-024 — Plan Summary Cards

**As a plan investigator**, I must see four summary counts on the dashboard home — total NPIs monitored, high-risk NPI count, alerts today, and total physician flags — so that I understand system-wide activity at a glance.

**Acceptance criteria:**
- [ ] Total NPIs monitored = COUNT of rows in npi_risk_scores WHERE entity_type = 'npi'
- [ ] High-risk NPI count = COUNT WHERE entity_type = 'npi' AND risk_score >= 81 (the critical band)
- [ ] Alerts today = COUNT of actions created today WHERE action_type IN ('flag_supplier','unknown_patient')
- [ ] Total physician flags = COUNT of all actions WHERE action_type IN ('flag_supplier','unknown_patient')
- [ ] All four counts update correctly after new physician actions are received

---

### FR-025 — NPI Risk Leaderboard

**As a plan investigator**, I must see all monitored NPIs ranked by risk score so that I can prioritize which physicians' claim histories to investigate first.

**Acceptance criteria:**
- [ ] Table shows all NPIs sorted by risk_score descending
- [ ] Each row shows: physician name, NPI, specialty, state, risk score, total claim count, total claim amount, physician flag count, top supplier name
- [ ] Risk score displayed with the four standard bands: critical (81-100), high (61-80), medium (31-60), low (0-30) — colors come from `RISK_BANDS` in `frontend/src/lib/risk.js`
- [ ] Dr. Wilson appears in the top 3 rows
- [ ] Each row is clickable and navigates to the NPI detail page
- [ ] Table supports filtering by state, specialty, and minimum risk score
- [ ] Table is paginated — 50 rows per page

---

### FR-026 — NPI Detail Page

**As a plan investigator**, when I click on an NPI in the leaderboard I must see the full claim history, all rules flags, and all physician actions for that NPI so that I can understand the complete picture before opening an investigation.

**Acceptance criteria:**
- [ ] Page header shows physician name, NPI, specialty, state, risk score, and score breakdown
- [ ] Score breakdown shows which of the 5 rules fired and their individual point contributions
- [ ] Claims table shows all claims for this NPI with rules flag badges per row
- [ ] Each flag badge shows the rule name and is colored by severity: critical=red, high=orange, medium=yellow
- [ ] Physician actions section shows all confirm/dispute/flag/unknown actions with timestamp
- [ ] All three sections (header, claims, actions) load on a single page — no additional navigation required

---

### FR-027 — Supplier Watchlist

**As a plan investigator**, I must see all suppliers ranked by physician flag count so that I can identify which suppliers are being reported across multiple physicians.

**Acceptance criteria:**
- [ ] Table shows all suppliers sorted by physician_flag_count descending, then by risk_score descending
- [ ] Each row shows: supplier name, OIG status badge, distinct NPI count, physician flag count, total claim amount, risk score
- [ ] OIG status displayed as a red "OIG EXCLUDED" badge where oig_flag = true
- [ ] MedSupply Pro LLC appears at or near row 1
- [ ] Each row is clickable and shows a supplier detail panel with all claims from this supplier
- [ ] Table supports filtering by OIG status and minimum flag count

---

### FR-028 — Live Alert Feed

**As a plan investigator**, I must see physician flags appear in real time on the alerts page so that I can act on fraud signals the moment a doctor identifies them.

**Acceptance criteria:**
- [ ] Alerts page establishes SSE connection to /plan/alerts/stream on load
- [ ] New alerts appear at the top of the feed without page refresh
- [ ] Each alert card shows: action type with icon, physician name, supplier name, patient name, claim amount, time elapsed since action
- [ ] Only flag_supplier and unknown_patient actions appear in the feed — not confirm or dispute
- [ ] New alert cards slide in with a subtle animation
- [ ] Feed shows the last 50 alerts on initial load (pre-existing from database)
- [ ] If the SSE connection drops, the browser automatically reconnects within 3 seconds
- [ ] On reconnection, any alerts missed during the disconnection are replayed

---

### FR-029 — Demo User Switcher

**As a demo presenter**, I must be able to switch between the physician view and the plan investigator view in a single click so that I can demonstrate both dashboards during a live pitch without a login flow.

**Acceptance criteria:**
- [ ] A dropdown or toggle is visible in the top-right corner of every page
- [ ] Options: "Dr. James Wilson (Physician)" and "Plan Investigator"
- [ ] Selecting an option immediately navigates to the correct dashboard
- [ ] The selected user is displayed clearly in the header at all times
- [ ] Switching users does not reset any data or in-progress actions

---

## Section 6 — API

---

### FR-030 — Health Check Endpoint

**As a developer or operator**, I must be able to call a health check endpoint that returns system status so that I can verify the deployment is working before a demo.

**Acceptance criteria:**
- [ ] GET /health returns HTTP 200
- [ ] Response includes: status, database connection status, total claim count, total flag count, timestamp
- [ ] If database is unreachable, response returns HTTP 503 with a clear error message

---

### FR-031 — Error Handling

**As a developer**, all API endpoints must return structured error responses so that the frontend can display meaningful error states rather than crashing.

**Acceptance criteria:**
- [ ] Non-existent NPI returns HTTP 404 with message "NPI not found"
- [ ] Invalid action_type in POST /actions returns HTTP 422 with field-level error
- [ ] Database unavailable returns HTTP 503 with message "Service temporarily unavailable"
- [ ] No endpoint returns an unhandled 500 with a Python stack trace
- [ ] All error responses follow the shape: `{"error": "message", "code": "ERROR_CODE"}`

---

### FR-032 — CORS Configuration

**As a developer**, the backend must allow requests from the frontend origin so that the Next.js app can call the FastAPI backend without CORS errors.

**Acceptance criteria:**
- [ ] Requests from http://localhost:3000 are allowed in development
- [ ] Requests from the production frontend domain are allowed in production
- [ ] CORS headers are present on all API responses including SSE stream
- [ ] OPTIONS preflight requests return HTTP 200

---

## Section 7 — Demo Reset

---

### FR-033 — Demo Reset Script

**As a developer**, I must be able to reset the entire database to a clean known state in under 3 minutes so that I can start every pitch meeting with reliable demo data.

**Acceptance criteria:**
- [ ] Running `python data/demo_reset.py` completes without error
- [ ] All 5 tables are truncated and repopulated
- [ ] All 4 verification queries pass after reset completes
- [ ] 5 pre-seeded physician actions exist in the actions table (from seed_demo_actions.py)
- [ ] Script completes in under 3 minutes
- [ ] Script logs progress at each step so the developer knows it is running

---

## Out of Scope for MVP

The following are explicitly NOT requirements for the 10-day MVP:

- User authentication or login (FR-AUTH) `[PHASE 1]`
- HIPAA compliance or encrypted storage `[PHASE 1]`
- Real claims data from any plan `[PHASE 1]`
- ML-based anomaly detection (Isolation Forest, Autoencoder) `[PHASE 2]`
- Graph ML or fraud ring visualization `[PHASE 2]`
- XGBoost risk scoring model `[PHASE 2]`
- LLM-generated case summaries `[PHASE 2]`
- NLP copy-paste detection `[PHASE 2]`
- Case management workflow `[PHASE 2]`
- Cross-plan signal sharing `[PHASE 3]`
- EHR integration `[PHASE 3]`
- Mobile layout `[PHASE 3]`
- Email notifications `[PHASE 3]`
- Multi-language support `[PHASE 3]`

---

## Requirements Traceability

| Requirement | Day Built | Component | Test |
|---|---|---|---|
| FR-001 | Day 2 | data/generate_synthetic.py | Verification queries |
| FR-002 | Day 2 | data/load_oig_leie.py | Query oig_flagged count |
| FR-003 | Day 2 | data/generate_synthetic.py | Query distinct supplier_id |
| FR-004 | Day 2 | data/generate_synthetic.py | Check lat/lng columns |
| FR-005 | Day 2 | SQL queries | Run 4 queries |
| FR-006 | Day 3 | rules/engine.py | Query rules_flags |
| FR-007 | Day 3 | rules/engine.py | Query geographic_anomaly flags |
| FR-008 | Day 3 | rules/engine.py | Query cross_npi_supplier flags |
| FR-009 | Day 3 | rules/engine.py | Query new_high_value_supplier flags |
| FR-010 | Day 3 | rules/engine.py | Query oig_leie_hit flags |
| FR-011 | Day 3 | rules/engine.py | Run engine twice, compare counts |
| FR-012 | Day 4 | scoring/risk_score.py | Check Dr. Wilson score |
| FR-013 | Day 4 | scoring/risk_score.py | Check MedSupply Pro score |
| FR-014 | Day 4 | scoring/risk_score.py | Flag then check score update |
| FR-015 | Day 5 | routers/claims.py | API response check |
| FR-016 | Day 5 | routers/claims.py | API response check |
| FR-017 | Day 5 | routers/claims.py | API response check |
| FR-018 | Day 5 | routers/claims.py | Test each filter param |
| FR-019 | Day 5 | routers/actions.py | POST and verify DB |
| FR-020 | Day 5 | routers/actions.py | POST and verify DB |
| FR-021 | Day 6 | routers/actions.py + alerts.py | POST and verify SSE event |
| FR-022 | Day 6 | routers/actions.py + alerts.py | POST and verify SSE event |
| FR-023 | Day 5 | routers/claims.py | API response check |
| FR-024 | Day 6 | routers/dashboard.py | API response check |
| FR-025 | Day 6 | routers/dashboard.py | Verify Dr. Wilson in top 3 |
| FR-026 | Day 6 | routers/dashboard.py | API response check |
| FR-027 | Day 6 | routers/dashboard.py | Verify MedSupply Pro row 1 |
| FR-028 | Day 6 | routers/alerts.py | SSE stream test |
| FR-029 | Day 8 | frontend/layout.tsx | Manual UI test |
| FR-030 | Day 8 | main.py | curl /health |
| FR-031 | Day 8 | all routers | Test error cases |
| FR-032 | Day 8 | main.py | Test from frontend origin |
| FR-033 | Day 7 | data/demo_reset.py | Run and time it |
