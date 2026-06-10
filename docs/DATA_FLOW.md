# DATA_FLOW — Data Flow Documentation
## ClaimLens — NPI Intelligence Platform

---

## Overview

This document traces every path data takes through ClaimLens — from the moment it is generated or ingested, through every transformation, to every output on both dashboards. It also covers the reverse path: the physician flag flowing back from the dashboard into the database and out to the plan in real time.

There are five distinct data flows in ClaimLens:

```
Flow 1 — Ingestion Flow      : Source data → PostgreSQL
Flow 2 — Processing Flow     : PostgreSQL → Rules Engine → Risk Scores
Flow 3 — Physician Read Flow : PostgreSQL → FastAPI → Physician Dashboard
Flow 4 — Plan Read Flow      : PostgreSQL → FastAPI → Plan Dashboard
Flow 5 — Alert Flow          : Physician action → SSE → Plan Dashboard (real time)
```

All five flows share a single PostgreSQL database. Flows 1 and 2 happen at startup (and on a schedule in production). Flows 3, 4, and 5 happen continuously as users interact with the dashboards.

---

## Flow 1 — Ingestion Flow

### Purpose
Take raw claims data from any source and produce a clean, normalized, enriched dataset in PostgreSQL.

### Trigger
- **MVP:** Manual — developer runs `python data/generate_synthetic.py`
- **Pilot:** Manual — developer runs ETL script against the plan's exported file
- **Production:** Scheduled — cron job or event trigger when plan delivers new data

---

### Step 1.1 — Data Generation or Receipt

**MVP path:**
```
Developer runs generate_synthetic.py
    ↓
Script calls GPT-4 API with detailed prompt
    ↓
GPT-4 returns JSON array of 800 claim records
    ↓
Script parses JSON response
    ↓
Raw records held in memory as Python list of dicts
```

**Pilot / Production path:**
```
Plan delivers file (CSV / JSON / EDI 837 / flat file)
    ↓
ETL script opens and parses file
    ↓
Raw records held in memory as Python list of dicts
```

At this point records are in their raw format — field names, date formats, and code formats vary by source. Nothing has been written to the database yet.

---

### Step 1.2 — Field Mapping to Canonical Schema

Every raw record is mapped to the ClaimLens canonical schema regardless of source format.

```
Raw record (any format)
    ↓
Field mapper runs per source type
    ↓
Canonical dict produced for every record:
{
    npi:                  "1234567890",
    patient_id:           "uuid-or-plan-id",
    patient_name:         "Margaret Johnson",
    patient_zip:          "90210",
    patient_state:        "CA",
    date_of_service:      "2024-11-15",
    cpt_code:             "99213",
    hcpcs_code:           null,
    service_description:  "Office visit, established patient",
    service_category:     "home_health",
    supplier_name:        "ABC Home Health LLC",
    supplier_zip:         "94102",
    supplier_state:       "CA",
    claim_amount:         285.00,
    plan_name:            "TBD Pilot Plan"
}
```

**What this step handles:**
- Different column names across plan exports mapped to canonical names
- Date formats normalized to ISO 8601 (YYYY-MM-DD)
- State codes standardized to 2-letter uppercase
- Claim amounts converted to DECIMAL — strip currency symbols if present
- Service categories inferred from CPT/HCPCS code ranges if not explicitly provided

---

### Step 1.3 — Entity Resolution (Supplier Name Deduplication)

A fraudulent supplier may appear under slightly different names across claims. "MedSupply Pro LLC", "Med Supply Pro", "MEDSUPPLY PRO LLC" are the same entity. Without entity resolution, the cross-NPI rule misses this.

```
All supplier_name values extracted from canonical records
    ↓
Fuzzy string matching groups name variants:
    "MedSupply Pro LLC"     ─┐
    "Med Supply Pro"         ├─ supplier_id: "SUP-001"
    "MEDSUPPLY PRO LLC"     ─┘
    ↓
Each canonical record updated with resolved supplier_id
    ↓
supplier_id is a stable internal identifier — UUID or deterministic hash
```

**Algorithm:** Token sort ratio fuzzy matching (rapidfuzz library). Threshold: 85% similarity. Names above threshold are grouped under the same supplier_id.

---

### Step 1.4 — NPI Profile Enrichment

For each unique NPI in the dataset, fetch physician profile data from the NPI Registry API.

```
Unique NPI list extracted from canonical records
    ↓
For each NPI:
    GET https://npiregistry.cms.hhs.gov/api/?number={npi}&version=2.1
    ↓
    Response parsed for:
        - provider_first_name + provider_last_name → physician_name
        - provider_primary_taxonomy_desc → specialty
        - addresses[0].address_purpose = LOCATION → practice address
        - addresses[0].postal_code → practice_zip
        - addresses[0].state → practice_state
        - addresses[0].city → practice_city
    ↓
    npi_profiles record constructed
    ↓
    Upsert into npi_profiles table
```

**MVP note:** NPI Registry returns real data for real NPIs. In the MVP, NPIs are fake so this step uses GPT-4 generated profile data directly instead of calling the registry.

---

### Step 1.5 — Geocoding

Convert practice zip and patient zip to latitude/longitude for the geographic anomaly rule.

```
All unique zip codes collected (practice zips + patient zips)
    ↓
pgeocode library looks up centroid lat/lng per zip
    ↓
    practice_lat, practice_lng → written to npi_profiles
    patient_lat,  patient_lng  → written to each claims record
```

**Library:** pgeocode (uses US ZIP code dataset, no API call required, offline lookup)

---

### Step 1.6 — OIG LEIE Exclusion Check

Check every supplier against the OIG exclusion list before writing to the database.

```
OIG LEIE CSV downloaded from oig.hhs.gov (one-time, stored locally)
    ↓
Loaded into memory as pandas DataFrame
    ↓
For each canonical record's supplier_name:
    Exact match against LEIE exclusion list
    + Fuzzy match at 90% threshold for name variants
    ↓
    oig_flagged = True if match found
    oig_flagged = False otherwise
```

---

### Step 1.7 — Deduplication

Remove exact duplicate claim submissions before writing to database.

```
Full canonical dataset in memory
    ↓
Deduplicate on composite key:
    (npi, patient_id, date_of_service, cpt_code, hcpcs_code, supplier_id)
    ↓
Keep first occurrence, discard duplicates
    ↓
Log count of duplicates removed
```

---

### Step 1.8 — Database Write

Write all clean records to PostgreSQL in a single bulk insert.

```
Clean canonical records (list of dicts)
    ↓
SQLAlchemy bulk insert → claims table
    ↓
GPT-4 generated npi_profiles → npi_profiles table
    ↓
Commit transaction
    ↓
Log: "Inserted {n} claims, {m} NPI profiles"
```

**Transaction behavior:** All-or-nothing. If any insert fails, the entire batch rolls back. Re-run the script to retry.

---

### Flow 1 — Complete Diagram

```
[GPT-4 / Plan File]
        ↓
  Parse raw data
        ↓
  Map to canonical schema
        ↓
  Entity resolution (supplier dedup)
        ↓
  NPI Registry enrichment
        ↓
  Geocoding (zip → lat/lng)
        ↓
  OIG LEIE check
        ↓
  Deduplication
        ↓
  Bulk insert
        ↓
[PostgreSQL: claims + npi_profiles]
```

---

## Flow 2 — Processing Flow

### Purpose
Transform raw claims data into actionable intelligence — flags and risk scores — that both dashboards consume.

### Trigger
- Runs immediately after Flow 1 completes
- Re-runs in production on a schedule after each new batch of claims

---

### Step 2.1 — Rules Engine Execution

The rules engine reads from the claims and npi_profiles tables and writes to rules_flags.

```
[PostgreSQL: claims + npi_profiles]
        ↓
rules/engine.py: run_all_rules()
        ↓
    Rule 1: volume_spike()
        Read claims grouped by NPI and month
        Compare last-30-day rate to prior-60-day baseline
        Flag NPIs where rate > 2x baseline
        Severity: HIGH
        ↓
    Rule 2: geographic_anomaly()
        For each claim: calculate haversine distance
            patient_lat/lng vs practice_lat/lng
        Flag claims where distance > 150 miles
        Severity: MEDIUM
        ↓
    Rule 3: cross_npi_supplier()
        Count distinct NPIs per supplier_id
        Flag all claims from suppliers with > 3 distinct NPIs
        Severity: CRITICAL
        ↓
    Rule 4: new_high_value_supplier()
        For each (npi, supplier_id) pair:
            Check if any claims exist older than 30 days
            If no prior history AND claim_amount > $500: flag
        Severity: MEDIUM
        ↓
    Rule 5: oig_leie_hit()
        Flag all claims WHERE oig_flagged = true
        Severity: CRITICAL
        ↓
All fired flags collected into list of RuleFlag objects
        ↓
Bulk insert → rules_flags table
```

**Idempotency:** Before inserting, delete all existing rules_flags records for claims being processed. Re-running produces identical results.

---

### Step 2.2 — Risk Score Calculation

Reads rules_flags and actions tables. Writes to npi_risk_scores.

```
[PostgreSQL: rules_flags + actions + claims]
        ↓
scoring/risk_score.py: calculate_all_scores()
        ↓
    For each unique NPI:

        Pull all rules_flags WHERE npi = this_npi
        Pull physician_flag_count from actions
            WHERE npi = this_npi
            AND action_type IN ('flag_supplier','unknown_patient')

        Calculate score:
            volume_flag present         → +25
            geo_flag on any claim       → +15
            cross_npi_flag present      → +30
            oig_flag on any claim       → +35
            new_supplier_flag present   → +10
            physician_flag_count * 5    → up to +20
            ─────────────────────────────────────
            Total → cap at 100

        Find top_supplier:
            Most frequent supplier_id in claims WHERE npi = this_npi

        Upsert into npi_risk_scores:
            entity_type = 'npi'
            entity_id   = npi
            entity_name = physician_name from npi_profiles
            risk_score  = calculated score
            [all flag booleans]
            total_claim_count   = COUNT(claims WHERE npi = this_npi)
            total_claim_amount  = SUM(claim_amount WHERE npi = this_npi)
            top_supplier_id     = most frequent supplier
            top_supplier_name   = supplier name
            last_calculated     = NOW()

    For each unique supplier_id:

        Pull all rules_flags WHERE supplier_id = this_supplier
        Pull physician_flag_count from actions
            WHERE supplier_id = this_supplier

        Calculate score:
            cross_npi_flag (distinct NPI count > 3)  → +30
            oig_flag                                  → +35
            physician_flag_count * 5                  → up to +20
            new_supplier_flag                         → +10
            ─────────────────────────────────────────────────
            Total → cap at 100

        Upsert into npi_risk_scores:
            entity_type         = 'supplier'
            entity_id           = supplier_id
            entity_name         = supplier_name
            distinct_npi_count  = COUNT(DISTINCT npi WHERE supplier_id = this_supplier)
            [all other fields]
```

---

### Flow 2 — Complete Diagram

```
[PostgreSQL: claims + npi_profiles]
        ↓
  Rules Engine (5 rules)
        ↓
[PostgreSQL: rules_flags]
        ↓
  Risk Score Calculator
        ↓
[PostgreSQL: npi_risk_scores]
        ↓
  Both dashboards now have
  intelligence to display
```

---

## Flow 3 — Physician Read Flow

### Purpose
Serve a physician's NPI-scoped claim data to the physician dashboard on demand.

### Trigger
Every time the physician dashboard loads or applies a filter.

---

### Step 3.1 — Summary Card Request

```
Browser: GET /physician/1234567890/summary
        ↓
FastAPI: routers/claims.py → get_physician_summary(npi)
        ↓
    Query 1: total claims this month
        SELECT COUNT(*) FROM claims
        WHERE npi = '1234567890'
        AND date_of_service >= DATE_TRUNC('month', NOW())

    Query 2: unreviewed count
        SELECT COUNT(*) FROM claims
        WHERE npi = '1234567890'
        AND reviewed = false

    Query 3: unknown supplier count
        SELECT COUNT(DISTINCT supplier_id) FROM actions
        WHERE npi = '1234567890'
        AND action_type IN ('flag_supplier','unknown_patient')

    Query 4: total claim amount this month
        SELECT SUM(claim_amount) FROM claims
        WHERE npi = '1234567890'
        AND date_of_service >= DATE_TRUNC('month', NOW())
        ↓
Response:
{
    "physician_name": "Dr. James Wilson",
    "npi": "1234567890",
    "specialty": "Internal Medicine",
    "total_claims_month": 47,
    "unreviewed_count": 43,
    "unknown_supplier_count": 1,
    "total_amount_month": 94230.00
}
```

---

### Step 3.2 — Claims Table Request

```
Browser: GET /physician/1234567890/claims
         ?category=dme&reviewed=false&date_from=2024-10-01
        ↓
FastAPI: routers/claims.py → get_physician_claims(npi, filters)
        ↓
    Base query:
        SELECT c.*, array_agg(rf.rule_name) as flags, array_agg(rf.severity) as severities
        FROM claims c
        LEFT JOIN rules_flags rf ON rf.claim_id = c.id
        WHERE c.npi = '1234567890'
        [+ optional filters applied]
        GROUP BY c.id
        ORDER BY c.reviewed ASC, c.date_of_service DESC
        LIMIT 50 OFFSET {page * 50}
        ↓
Response: paginated list of claim objects, each with:
{
    "id": "uuid",
    "patient_name": "Margaret Johnson",
    "date_of_service": "2024-11-15",
    "service_description": "Wheelchair rental",
    "cpt_code": null,
    "hcpcs_code": "E1050",
    "service_category": "dme",
    "supplier_name": "MedSupply Pro LLC",
    "claim_amount": 1850.00,
    "oig_flagged": true,
    "reviewed": false,
    "flags": ["cross_npi_supplier", "oig_leie_hit"],
    "severities": ["critical", "critical"]
}
```

---

## Flow 4 — Plan Read Flow

### Purpose
Serve cross-NPI aggregated analytics to the plan dashboard on demand.

---

### Step 4.1 — NPI Risk Leaderboard

```
Browser: GET /plan/npi-risk-list
         ?min_score=0&state=CA
        ↓
FastAPI: routers/dashboard.py → get_npi_risk_list(filters)
        ↓
    SELECT
        nrs.*,
        np.practice_state,
        np.specialty
    FROM npi_risk_scores nrs
    JOIN npi_profiles np ON np.npi = nrs.entity_id
    WHERE nrs.entity_type = 'npi'
    [+ optional filters]
    ORDER BY nrs.risk_score DESC
    LIMIT 100
        ↓
Response: sorted list of NPI risk rows with score, flags, counts
```

---

### Step 4.2 — NPI Detail Drill-Down

```
Browser: GET /plan/npi/1234567890/detail
        ↓
FastAPI: 3 parallel queries:
    Query 1: full claim history for this NPI
        SELECT c.*, array_agg(rf.rule_name) as flags
        FROM claims c
        LEFT JOIN rules_flags rf ON rf.claim_id = c.id
        WHERE c.npi = '1234567890'
        GROUP BY c.id
        ORDER BY c.date_of_service DESC

    Query 2: all rules flags for this NPI
        SELECT * FROM rules_flags
        WHERE npi = '1234567890'
        ORDER BY fired_at DESC

    Query 3: all physician actions for this NPI
        SELECT * FROM actions
        WHERE npi = '1234567890'
        ORDER BY created_at DESC
        ↓
Response: combined object with claims array, flags array, actions array
```

---

### Step 4.3 — Supplier Watchlist

```
Browser: GET /plan/suppliers
        ↓
FastAPI: routers/dashboard.py → get_supplier_watchlist()
        ↓
    SELECT *
    FROM npi_risk_scores
    WHERE entity_type = 'supplier'
    ORDER BY physician_flag_count DESC, risk_score DESC
    LIMIT 100
        ↓
Response: sorted supplier list — MedSupply Pro LLC at row 1
```

---

## Flow 5 — Alert Flow (Real-Time)

### Purpose
Deliver physician flag actions to the plan dashboard in real time the moment they happen. This is the most important flow in the MVP demo.

### Technology
Server-Sent Events (SSE) over HTTP. The plan dashboard holds an open HTTP connection to the backend. The backend pushes events down this connection when a physician flags something.

---

### Step 5.1 — Plan Dashboard Opens SSE Connection

```
Plan dashboard loads alerts page
        ↓
Browser: GET /plan/alerts/stream
         Accept: text/event-stream
        ↓
FastAPI: StreamingResponse with content_type="text/event-stream"
        ↓
Connection held open — server does not close it
        ↓
An asyncio Queue is created for this connection
Connection registered in global connections set
        ↓
Server sends keep-alive comment every 15 seconds:
    ": keep-alive\n\n"
```

---

### Step 5.2 — Physician Takes Action

```
Physician clicks "Flag Supplier" on a claim
        ↓
Browser: POST /actions
Body: {
    "claim_id": "uuid",
    "npi": "1234567890",
    "action_type": "flag_supplier",
    "note": null
}
        ↓
FastAPI: routers/actions.py → create_action()
        ↓
    Step A: Fetch claim details for denormalization
        SELECT supplier_id, supplier_name, patient_name, claim_amount
        FROM claims WHERE id = claim_id

    Step B: Insert into actions table
        INSERT INTO actions (
            claim_id, npi, action_type,
            supplier_id, supplier_name, patient_name, claim_amount,
            broadcast
        ) VALUES (..., broadcast=false)

    Step C: Update claims.reviewed = true
        UPDATE claims SET reviewed = true WHERE id = claim_id

    Step D: Build alert event payload
        event = {
            "id": new_action_id,
            "action_type": "flag_supplier",
            "physician_name": "Dr. James Wilson",
            "supplier_name": "MedSupply Pro LLC",
            "patient_name": "Margaret Johnson",
            "claim_amount": 1850.00,
            "npi": "1234567890",
            "timestamp": "2024-11-15T14:32:01Z"
        }

    Step E: Put event into broadcast queue
        await broadcast_queue.put(event)

    Step F: Return 201 Created to physician dashboard
```

---

### Step 5.3 — SSE Stream Broadcasts Event

```
broadcast_queue receives new event
        ↓
SSE stream background task picks it up
        ↓
Formats as SSE message:
    "data: {json_payload}\n\n"
        ↓
Sends to all open SSE connections
        ↓
Updates actions.broadcast = true for this action_id
        ↓
Plan dashboard receives event < 1 second after physician clicked
        ↓
New alert card slides into top of alerts feed
```

---

### Step 5.4 — SSE Reconnection Recovery

If the plan dashboard disconnects and reconnects (page refresh, network blip), it must not miss any alerts.

```
Plan dashboard reconnects:
    GET /plan/alerts/stream
    Last-Event-ID: {last_received_action_id}
        ↓
FastAPI checks for missed events:
    SELECT * FROM actions
    WHERE broadcast = true
    AND created_at > {timestamp of last_received_action_id}
    AND action_type IN ('flag_supplier','unknown_patient')
    ORDER BY created_at ASC
        ↓
Replays missed events to reconnecting client
        ↓
Continues normal stream
```

---

### Flow 5 — Complete Diagram

```
[Physician Dashboard]
    Physician clicks Flag Supplier
        ↓
    POST /actions
        ↓
[FastAPI]
    Write to actions table
    Update claims.reviewed = true
    Put event in broadcast_queue
    Return 201 to physician
        ↓
[broadcast_queue]
    Background task picks up event
        ↓
[SSE Stream]
    Push "data: {...}\n\n" to all open connections
        ↓
[Plan Dashboard — Alerts Page]
    Event received
    New alert card rendered at top of feed
    Supplier flag count increments on watchlist
```

---

## Complete End-to-End Flow Diagram

```
╔═══════════════════════════════════════════════════════════════════╗
║                    COMPLETE DATA FLOW                             ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  [GPT-4 / Plan File]                                              ║
║         │                                                         ║
║         ▼  FLOW 1 — INGESTION                                     ║
║  Parse → Map → Resolve → Enrich → Geocode → OIG → Dedup → Insert  ║
║         │                                                         ║
║         ▼                                                         ║
║  [PostgreSQL: claims + npi_profiles]                              ║
║         │                                                         ║
║         ▼  FLOW 2 — PROCESSING                                    ║
║  Rules Engine → rules_flags → Risk Scoring → npi_risk_scores      ║
║         │                                                         ║
║         ├─────────────────────────┐                               ║
║         ▼  FLOW 3                 ▼  FLOW 4                       ║
║  FastAPI /physician/*      FastAPI /plan/*                        ║
║         │                         │                               ║
║         ▼                         ▼                               ║
║  [Physician Dashboard]    [Plan Dashboard]                        ║
║  Claims table              NPI Leaderboard                        ║
║  Action buttons            Supplier Watchlist                     ║
║         │                  Alerts Feed ◄──────────────────────┐  ║
║         │                                                      │  ║
║         ▼  FLOW 5 — REAL-TIME ALERT                           │  ║
║  POST /actions                                                 │  ║
║  → actions table                                               │  ║
║  → broadcast_queue                                             │  ║
║  → SSE stream ─────────────────────────────────────────────────┘  ║
║                                                                   ║
║  [Physician flag → actions table → ML training labels (Phase 2)]  ║
╚═══════════════════════════════════════════════════════════════════╝
```

---

## Data Transformation Summary

| Stage | Input | Output | Key transformation |
|---|---|---|---|
| Generate / Receive | GPT-4 JSON or plan file | Raw records in memory | None — raw |
| Field mapping | Raw records | Canonical dicts | Field name normalization, date formatting |
| Entity resolution | Supplier names | supplier_id per canonical dict | Fuzzy dedup of supplier variants |
| NPI enrichment | NPI list | npi_profiles rows | API call or GPT-4 generated profiles |
| Geocoding | Zip codes | lat/lng pairs | pgeocode offline lookup |
| OIG check | Supplier names | oig_flagged boolean per record | Fuzzy match against LEIE list |
| Rules engine | claims + npi_profiles | rules_flags rows | Business logic applied per claim |
| Risk scoring | rules_flags + actions | npi_risk_scores rows | Weighted arithmetic aggregation |
| Physician API | npi_risk_scores + claims + rules_flags | JSON response | Filtered, joined, paginated |
| Plan API | npi_risk_scores + claims + rules_flags + actions | JSON response | Aggregated, sorted, joined |
| SSE broadcast | actions row | Server-sent event | JSON serialization, text/event-stream format |

---

## Timing

| Flow | MVP | Production |
|---|---|---|
| Flow 1 — Ingestion | ~2 min (800 records) | Hours for large datasets, streaming for real-time |
| Flow 2 — Processing | ~30 sec (800 records) | Minutes for large datasets |
| Flow 3 — Physician read | < 200ms per request | < 500ms with indexing |
| Flow 4 — Plan read | < 300ms per request | < 1s with indexing and caching |
| Flow 5 — Alert delivery | < 1 second end-to-end | < 1 second (SSE has no meaningful latency) |
