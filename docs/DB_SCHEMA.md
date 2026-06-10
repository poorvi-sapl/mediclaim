# DB_SCHEMA — Database Schema
## ClaimLens — NPI Intelligence Platform

---

## Overview

ClaimLens uses a single PostgreSQL 15 database with five tables. Every component of the platform — ETL pipeline, rules engine, risk scoring, both dashboards, SSE alerts — reads from or writes to this one database.

**Database name:** `claimlens_db`
**Schema:** `public` (default)

```
claimlens_db
│
├── claims              — every normalized claim record
├── npi_profiles        — one row per physician NPI
├── actions             — every physician flag / confirm / dispute
├── rules_flags         — output of rules engine, one row per fired rule per claim
└── npi_risk_scores     — composite risk score per NPI and per supplier
```

---

## Table 1 — `claims`

The core table. Every claim ingested from any source lands here after ETL normalization. This table is the single source of truth for all claim data. Both dashboards read primarily from this table.

### Columns

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | UUID | NOT NULL | gen_random_uuid() | Primary key |
| `npi` | VARCHAR(10) | NOT NULL | — | Ordering physician NPI — 10 digits |
| `patient_id` | VARCHAR(64) | NOT NULL | — | De-identified patient identifier |
| `patient_name` | VARCHAR(255) | NOT NULL | — | Patient full name (synthetic in MVP, de-identified in pilot) |
| `patient_zip` | VARCHAR(10) | NOT NULL | — | Patient zip code — used for geographic distance rule |
| `patient_state` | VARCHAR(2) | NOT NULL | — | Patient state — 2-letter code |
| `patient_lat` | DECIMAL(9,6) | NULL | NULL | Patient zip centroid latitude — populated at ETL |
| `patient_lng` | DECIMAL(9,6) | NULL | NULL | Patient zip centroid longitude — populated at ETL |
| `date_of_service` | DATE | NOT NULL | — | Date the service was rendered |
| `cpt_code` | VARCHAR(10) | NULL | NULL | CPT procedure code — NULL if HCPCS applies |
| `hcpcs_code` | VARCHAR(10) | NULL | NULL | HCPCS code — NULL if CPT applies |
| `service_description` | VARCHAR(512) | NOT NULL | — | Plain English description of the service or item |
| `service_category` | VARCHAR(32) | NOT NULL | — | Enum: home_health, hospice, dme, drugs, hospital |
| `supplier_name` | VARCHAR(255) | NOT NULL | — | Name of supplier or provider who submitted claim |
| `supplier_id` | VARCHAR(64) | NOT NULL | — | Internal unique supplier entity ID — set by entity resolution |
| `supplier_zip` | VARCHAR(10) | NULL | NULL | Supplier zip code |
| `supplier_state` | VARCHAR(2) | NULL | NULL | Supplier state |
| `claim_amount` | DECIMAL(10,2) | NOT NULL | — | Dollar amount of the claim |
| `plan_name` | VARCHAR(255) | NOT NULL | — | Name of the health plan that received the claim |
| `oig_flagged` | BOOLEAN | NOT NULL | false | True if supplier name matches OIG LEIE exclusion list |
| `reviewed` | BOOLEAN | NOT NULL | false | True if physician has taken any action on this claim |
| `ingested_at` | TIMESTAMP | NOT NULL | NOW() | When ETL wrote this record |
| `created_at` | TIMESTAMP | NOT NULL | NOW() | Claim creation timestamp (matches ingested_at in MVP) |

### Constraints

```sql
PRIMARY KEY (id)
CHECK (service_category IN ('home_health', 'hospice', 'dme', 'drugs', 'hospital'))
CHECK (claim_amount >= 0)
CHECK (LENGTH(npi) = 10)
CHECK (date_of_service <= CURRENT_DATE)
```

### Indexes

```sql
-- Primary lookup: all claims for a given NPI (physician dashboard)
CREATE INDEX idx_claims_npi ON claims(npi);

-- Plan dashboard: filter by service category
CREATE INDEX idx_claims_service_category ON claims(service_category);

-- Rules engine: time window queries
CREATE INDEX idx_claims_date_of_service ON claims(date_of_service);

-- Supplier-based queries (watchlist, cross-NPI rule)
CREATE INDEX idx_claims_supplier_id ON claims(supplier_id);

-- OIG flag filter
CREATE INDEX idx_claims_oig_flagged ON claims(oig_flagged) WHERE oig_flagged = true;

-- Composite: NPI + date range (most common physician query)
CREATE INDEX idx_claims_npi_date ON claims(npi, date_of_service);

-- Composite: supplier + NPI (cross-NPI rule)
CREATE INDEX idx_claims_supplier_npi ON claims(supplier_id, npi);
```

### Notes

- `supplier_id` is not the supplier's NPI or any external ID. It is an internal identifier assigned by the entity resolution step in ETL. "ABC Home Health LLC" and "ABC Home Health" both get the same `supplier_id`.
- `reviewed` is set to `true` when any action is recorded in the `actions` table for this claim. Updated via trigger or application logic on action insert.
- `patient_lat` and `patient_lng` are populated by geocoding `patient_zip` during ETL. Required by the geographic anomaly rule.
- In the MVP, `patient_name` is a realistic fake name from GPT-4 generation. In the pilot, it is a de-identified ID string.

---

## Table 2 — `npi_profiles`

One row per physician NPI. Contains enriched physician profile data fetched from the NPI Registry API during ETL. Used to display physician information on dashboards and by the geographic anomaly rule to calculate patient-to-physician distance.

### Columns

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `npi` | VARCHAR(10) | NOT NULL | — | Primary key — NPI number |
| `physician_name` | VARCHAR(255) | NOT NULL | — | Full name of the physician |
| `specialty` | VARCHAR(255) | NULL | NULL | Medical specialty |
| `practice_city` | VARCHAR(128) | NULL | NULL | City of primary practice location |
| `practice_state` | VARCHAR(2) | NULL | NULL | State of primary practice location |
| `practice_zip` | VARCHAR(10) | NOT NULL | — | Zip code of primary practice — required for geo rule |
| `practice_lat` | DECIMAL(9,6) | NULL | NULL | Practice zip centroid latitude |
| `practice_lng` | DECIMAL(9,6) | NULL | NULL | Practice zip centroid longitude |
| `enrollment_status` | VARCHAR(32) | NULL | NULL | NPI Registry enrollment status |
| `enrolled_since` | DATE | NULL | NULL | Date NPI was enrolled |
| `created_at` | TIMESTAMP | NOT NULL | NOW() | When this profile was created |
| `updated_at` | TIMESTAMP | NOT NULL | NOW() | Last time this profile was updated |

### Constraints

```sql
PRIMARY KEY (npi)
CHECK (LENGTH(npi) = 10)
```

### Indexes

```sql
-- Lookup by NPI (joins with claims table)
CREATE INDEX idx_npi_profiles_npi ON npi_profiles(npi);

-- State-based filtering on plan dashboard
CREATE INDEX idx_npi_profiles_state ON npi_profiles(practice_state);
```

### Notes

- In the MVP, these 15 rows are generated by GPT-4 with realistic fake data. Dr. James Wilson is NPI `1234567890`, practice zip `94102` (San Francisco).
- `practice_lat` and `practice_lng` are populated at ETL time by geocoding `practice_zip`. These are used by the geographic anomaly rule alongside `patient_lat` and `patient_lng` from the claims table.
- In production, this table is refreshed periodically from the NPI Registry API to catch physician address changes.

---

## Table 3 — `actions`

Every action a physician takes on a claim is recorded here. This table is the feedback loop. It powers the live alert feed on the plan dashboard, it is the input to physician flag counts in risk scoring, and in the real product it becomes the training label dataset for the XGBoost model.

### Columns

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | UUID | NOT NULL | gen_random_uuid() | Primary key |
| `claim_id` | UUID | NOT NULL | — | Foreign key → claims.id |
| `npi` | VARCHAR(10) | NOT NULL | — | NPI of the physician who took the action |
| `action_type` | VARCHAR(32) | NOT NULL | — | Enum: confirm, dispute, flag_supplier, unknown_patient |
| `note` | TEXT | NULL | NULL | Optional free-text note from physician |
| `supplier_id` | VARCHAR(64) | NOT NULL | — | Supplier from the flagged claim — denormalized for alert speed |
| `supplier_name` | VARCHAR(255) | NOT NULL | — | Supplier name — denormalized for alert display |
| `patient_name` | VARCHAR(255) | NOT NULL | — | Patient name — denormalized for alert display |
| `claim_amount` | DECIMAL(10,2) | NOT NULL | — | Claim amount — denormalized for alert display |
| `broadcast` | BOOLEAN | NOT NULL | false | False until SSE stream has broadcast this action to plan dashboard |
| `created_at` | TIMESTAMP | NOT NULL | NOW() | When the action was recorded |

### Constraints

```sql
PRIMARY KEY (id)
FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE CASCADE
CHECK (action_type IN ('confirm', 'dispute', 'flag_supplier', 'unknown_patient'))
CHECK (LENGTH(npi) = 10)
```

### Indexes

```sql
-- SSE stream polling: unbroadcast actions
CREATE INDEX idx_actions_broadcast ON actions(broadcast) WHERE broadcast = false;

-- Alert history for plan dashboard
CREATE INDEX idx_actions_created_at ON actions(created_at DESC);

-- Physician action history
CREATE INDEX idx_actions_npi ON actions(npi);

-- Risk scoring: flag count per supplier
CREATE INDEX idx_actions_supplier_id ON actions(supplier_id);

-- Risk scoring: flag count per claim
CREATE INDEX idx_actions_claim_id ON actions(claim_id);
```

### Notes

- `supplier_id`, `supplier_name`, `patient_name`, and `claim_amount` are denormalized from the claims table at insert time. This avoids a join on every SSE broadcast and every alert card render. The slight data redundancy is intentional and worth it for query performance.
- `broadcast` is the SSE mechanism flag. The SSE stream endpoint queries `WHERE broadcast = false ORDER BY created_at ASC`, sends those events to connected clients, then sets `broadcast = true`. This ensures no alert is ever missed even if the plan dashboard reconnects.
- Only `flag_supplier` and `unknown_patient` action types generate SSE alerts to the plan dashboard. `confirm` and `dispute` are recorded but not broadcast as alerts.
- The `actions` table is append-only. No updates. No deletes. It is an immutable audit record.

---

## Table 4 — `rules_flags`

One row per guardrail rule that fires on a given claim. Written by the rules engine at startup and on each new batch of claims. Read by the risk scoring component and displayed as colored badges on both dashboards.

### Columns

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | UUID | NOT NULL | gen_random_uuid() | Primary key |
| `claim_id` | UUID | NOT NULL | — | Foreign key → claims.id |
| `npi` | VARCHAR(10) | NOT NULL | — | NPI associated with this flag — denormalized for aggregation |
| `supplier_id` | VARCHAR(64) | NOT NULL | — | Supplier associated with this flag — denormalized |
| `rule_name` | VARCHAR(64) | NOT NULL | — | Identifier: volume_spike, geographic_anomaly, cross_npi_supplier, new_high_value_supplier, oig_leie_hit |
| `rule_description` | TEXT | NOT NULL | — | Human-readable explanation of why this rule fired |
| `severity` | VARCHAR(16) | NOT NULL | — | Enum: low, medium, high, critical |
| `fired_at` | TIMESTAMP | NOT NULL | NOW() | When the rule engine wrote this flag |

### Constraints

```sql
PRIMARY KEY (id)
FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE CASCADE
CHECK (rule_name IN ('volume_spike', 'geographic_anomaly', 'cross_npi_supplier', 'new_high_value_supplier', 'oig_leie_hit'))
CHECK (severity IN ('low', 'medium', 'high', 'critical'))
```

### Indexes

```sql
-- Risk scoring: all flags for a given NPI
CREATE INDEX idx_rules_flags_npi ON rules_flags(npi);

-- Dashboard: flags for a given claim
CREATE INDEX idx_rules_flags_claim_id ON rules_flags(claim_id);

-- Analytics: filter by rule type
CREATE INDEX idx_rules_flags_rule_name ON rules_flags(rule_name);

-- Analytics: filter by severity
CREATE INDEX idx_rules_flags_severity ON rules_flags(severity);

-- Supplier risk: all flags for a supplier
CREATE INDEX idx_rules_flags_supplier_id ON rules_flags(supplier_id);
```

### Notes

- A single claim can have multiple rows in `rules_flags` — one per rule that fired. A claim with an OIG-listed supplier that is also geographically anomalous will have two rows here.
- `rule_description` is a templated human-readable string generated at rule fire time. Example: `"Patient zip 90210 is 387 miles from physician practice zip 94102"`. This string is displayed directly in the UI as the flag explanation.
- The rules engine is idempotent — running it twice does not create duplicate flags. It clears existing flags for a claim before re-running.

---

## Table 5 — `npi_risk_scores`

One row per NPI and one row per supplier. Contains the composite risk score and the individual flag components that drove it. Written by the scoring component after the rules engine runs. Read by the plan dashboard leaderboard and supplier watchlist.

### Columns

#### NPI Scores

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | UUID | NOT NULL | gen_random_uuid() | Primary key |
| `entity_type` | VARCHAR(16) | NOT NULL | — | Enum: npi, supplier |
| `entity_id` | VARCHAR(64) | NOT NULL | — | NPI number if entity_type = npi, supplier_id if entity_type = supplier |
| `entity_name` | VARCHAR(255) | NOT NULL | — | Physician name or supplier name — for display |
| `risk_score` | INTEGER | NOT NULL | 0 | Composite score 0-100 |
| `volume_flag` | BOOLEAN | NOT NULL | false | Volume spike rule fired |
| `geo_flag` | BOOLEAN | NOT NULL | false | Geographic anomaly rule fired on any claim |
| `cross_npi_flag` | BOOLEAN | NOT NULL | false | Cross-NPI supplier rule fired |
| `oig_flag` | BOOLEAN | NOT NULL | false | OIG LEIE hit on any associated supplier |
| `new_supplier_flag` | BOOLEAN | NOT NULL | false | New high-value supplier rule fired |
| `physician_flag_count` | INTEGER | NOT NULL | 0 | Number of flag_supplier or unknown_patient actions from physicians |
| `total_claim_count` | INTEGER | NOT NULL | 0 | Total claims under this NPI or from this supplier |
| `total_claim_amount` | DECIMAL(12,2) | NOT NULL | 0 | Total dollar value of all claims |
| `top_supplier_id` | VARCHAR(64) | NULL | NULL | Supplier with most claims under this NPI (for NPI rows only) |
| `top_supplier_name` | VARCHAR(255) | NULL | NULL | Display name of top supplier |
| `distinct_npi_count` | INTEGER | NULL | NULL | Number of distinct NPIs this supplier bills under (for supplier rows only) |
| `last_calculated` | TIMESTAMP | NOT NULL | NOW() | When this score was last recalculated |

### Constraints

```sql
PRIMARY KEY (id)
CHECK (entity_type IN ('npi', 'supplier'))
CHECK (risk_score BETWEEN 0 AND 100)
UNIQUE (entity_type, entity_id)
```

### Indexes

```sql
-- Plan leaderboard: sorted by risk score
CREATE INDEX idx_risk_scores_score ON npi_risk_scores(risk_score DESC);

-- Filter by entity type
CREATE INDEX idx_risk_scores_entity_type ON npi_risk_scores(entity_type);

-- Lookup by entity ID
CREATE INDEX idx_risk_scores_entity_id ON npi_risk_scores(entity_id);

-- Supplier watchlist: sort by physician flag count
CREATE INDEX idx_risk_scores_flag_count ON npi_risk_scores(physician_flag_count DESC)
  WHERE entity_type = 'supplier';
```

### Notes

- This table has both NPI rows and supplier rows. The `entity_type` column distinguishes them. The plan NPI leaderboard queries `WHERE entity_type = 'npi'`. The supplier watchlist queries `WHERE entity_type = 'supplier'`.
- The UNIQUE constraint on `(entity_type, entity_id)` means the scoring job does an upsert — insert or update — not a duplicate insert.
- `physician_flag_count` is the most important column in the real product. As doctors flag suppliers, this count drives the risk score up and the supplier climbs the watchlist.
- `distinct_npi_count` is populated only for supplier rows. It is the key signal for the cross-NPI fraud pattern — a supplier billing under 9 NPIs has a very high score even before any physician flags them.

---

## Entity Relationships

```
npi_profiles ──────────────────────────────────────────┐
     │ npi (PK)                                         │
     │                                                  │
     └──────────────────────────────────────────────────▼
                                                    claims
                                                  npi (FK → npi_profiles.npi)
                                                        │
                              ┌─────────────────────────┼────────────────────┐
                              │                         │                    │
                              ▼                         ▼                    ▼
                          actions                  rules_flags        npi_risk_scores
                    claim_id (FK → claims.id)  claim_id (FK)      entity_id = npi or supplier_id
```

---

## Migration Script

Run this to create all tables from scratch:

```sql
-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Table 1: claims
CREATE TABLE claims (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    npi                 VARCHAR(10) NOT NULL,
    patient_id          VARCHAR(64) NOT NULL,
    patient_name        VARCHAR(255) NOT NULL,
    patient_zip         VARCHAR(10) NOT NULL,
    patient_state       VARCHAR(2) NOT NULL,
    patient_lat         DECIMAL(9,6),
    patient_lng         DECIMAL(9,6),
    date_of_service     DATE NOT NULL,
    cpt_code            VARCHAR(10),
    hcpcs_code          VARCHAR(10),
    service_description VARCHAR(512) NOT NULL,
    service_category    VARCHAR(32) NOT NULL,
    supplier_name       VARCHAR(255) NOT NULL,
    supplier_id         VARCHAR(64) NOT NULL,
    supplier_zip        VARCHAR(10),
    supplier_state      VARCHAR(2),
    claim_amount        DECIMAL(10,2) NOT NULL,
    plan_name           VARCHAR(255) NOT NULL,
    oig_flagged         BOOLEAN NOT NULL DEFAULT false,
    reviewed            BOOLEAN NOT NULL DEFAULT false,
    ingested_at         TIMESTAMP NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_service_category CHECK (service_category IN ('home_health','hospice','dme','drugs','hospital')),
    CONSTRAINT chk_claim_amount CHECK (claim_amount >= 0),
    CONSTRAINT chk_npi_length CHECK (LENGTH(npi) = 10),
    CONSTRAINT chk_date CHECK (date_of_service <= CURRENT_DATE)
);

CREATE INDEX idx_claims_npi ON claims(npi);
CREATE INDEX idx_claims_service_category ON claims(service_category);
CREATE INDEX idx_claims_date_of_service ON claims(date_of_service);
CREATE INDEX idx_claims_supplier_id ON claims(supplier_id);
CREATE INDEX idx_claims_oig_flagged ON claims(oig_flagged) WHERE oig_flagged = true;
CREATE INDEX idx_claims_npi_date ON claims(npi, date_of_service);
CREATE INDEX idx_claims_supplier_npi ON claims(supplier_id, npi);

-- Table 2: npi_profiles
CREATE TABLE npi_profiles (
    npi                 VARCHAR(10) PRIMARY KEY,
    physician_name      VARCHAR(255) NOT NULL,
    specialty           VARCHAR(255),
    practice_city       VARCHAR(128),
    practice_state      VARCHAR(2),
    practice_zip        VARCHAR(10) NOT NULL,
    practice_lat        DECIMAL(9,6),
    practice_lng        DECIMAL(9,6),
    enrollment_status   VARCHAR(32),
    enrolled_since      DATE,
    created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_npi_profile_length CHECK (LENGTH(npi) = 10)
);

CREATE INDEX idx_npi_profiles_state ON npi_profiles(practice_state);

-- Table 3: actions
CREATE TABLE actions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id            UUID NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    npi                 VARCHAR(10) NOT NULL,
    action_type         VARCHAR(32) NOT NULL,
    note                TEXT,
    supplier_id         VARCHAR(64) NOT NULL,
    supplier_name       VARCHAR(255) NOT NULL,
    patient_name        VARCHAR(255) NOT NULL,
    claim_amount        DECIMAL(10,2) NOT NULL,
    broadcast           BOOLEAN NOT NULL DEFAULT false,
    created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_action_type CHECK (action_type IN ('confirm','dispute','flag_supplier','unknown_patient')),
    CONSTRAINT chk_action_npi CHECK (LENGTH(npi) = 10)
);

CREATE INDEX idx_actions_broadcast ON actions(broadcast) WHERE broadcast = false;
CREATE INDEX idx_actions_created_at ON actions(created_at DESC);
CREATE INDEX idx_actions_npi ON actions(npi);
CREATE INDEX idx_actions_supplier_id ON actions(supplier_id);
CREATE INDEX idx_actions_claim_id ON actions(claim_id);

-- Table 4: rules_flags
CREATE TABLE rules_flags (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id            UUID NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    npi                 VARCHAR(10) NOT NULL,
    supplier_id         VARCHAR(64) NOT NULL,
    rule_name           VARCHAR(64) NOT NULL,
    rule_description    TEXT NOT NULL,
    severity            VARCHAR(16) NOT NULL,
    fired_at            TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_rule_name CHECK (rule_name IN ('volume_spike','geographic_anomaly','cross_npi_supplier','new_high_value_supplier','oig_leie_hit')),
    CONSTRAINT chk_severity CHECK (severity IN ('low','medium','high','critical'))
);

CREATE INDEX idx_rules_flags_npi ON rules_flags(npi);
CREATE INDEX idx_rules_flags_claim_id ON rules_flags(claim_id);
CREATE INDEX idx_rules_flags_rule_name ON rules_flags(rule_name);
CREATE INDEX idx_rules_flags_severity ON rules_flags(severity);
CREATE INDEX idx_rules_flags_supplier_id ON rules_flags(supplier_id);

-- Table 5: npi_risk_scores
CREATE TABLE npi_risk_scores (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type         VARCHAR(16) NOT NULL,
    entity_id           VARCHAR(64) NOT NULL,
    entity_name         VARCHAR(255) NOT NULL,
    risk_score          INTEGER NOT NULL DEFAULT 0,
    volume_flag         BOOLEAN NOT NULL DEFAULT false,
    geo_flag            BOOLEAN NOT NULL DEFAULT false,
    cross_npi_flag      BOOLEAN NOT NULL DEFAULT false,
    oig_flag            BOOLEAN NOT NULL DEFAULT false,
    new_supplier_flag   BOOLEAN NOT NULL DEFAULT false,
    physician_flag_count INTEGER NOT NULL DEFAULT 0,
    total_claim_count   INTEGER NOT NULL DEFAULT 0,
    total_claim_amount  DECIMAL(12,2) NOT NULL DEFAULT 0,
    top_supplier_id     VARCHAR(64),
    top_supplier_name   VARCHAR(255),
    distinct_npi_count  INTEGER,
    last_calculated     TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_entity_type CHECK (entity_type IN ('npi','supplier')),
    CONSTRAINT chk_risk_score CHECK (risk_score BETWEEN 0 AND 100),
    CONSTRAINT uq_entity UNIQUE (entity_type, entity_id)
);

CREATE INDEX idx_risk_scores_score ON npi_risk_scores(risk_score DESC);
CREATE INDEX idx_risk_scores_entity_type ON npi_risk_scores(entity_type);
CREATE INDEX idx_risk_scores_entity_id ON npi_risk_scores(entity_id);
CREATE INDEX idx_risk_scores_flag_count ON npi_risk_scores(physician_flag_count DESC)
    WHERE entity_type = 'supplier';
```

---

## Design Decisions

**Why UUIDs instead of auto-increment integers for primary keys**
Claims data from different plans could theoretically be merged in the future. UUIDs eliminate collision risk across datasets. They are also safer to expose in API responses — sequential integers reveal record counts.

**Why denormalize supplier_name and patient_name into actions**
The SSE alert stream sends an event every time a physician flags something. That event needs to display supplier name and patient name instantly. A join against the claims table on every broadcast adds latency to a real-time feature. Denormalization is the right trade-off here.

**Why store both npi in rules_flags and supplier_id**
The rules engine produces flags at the claim level but risk scoring aggregates at both the NPI level and the supplier level. Having both columns denormalized in rules_flags means risk scoring reads one table with no joins.

**Why a single npi_risk_scores table for both NPIs and suppliers**
Both entities need a risk score, a flag count, a total claim amount, and a last calculated timestamp. The column overlap is high enough that one table with an entity_type discriminator is cleaner than two separate tables with near-identical schemas.

**Why reviewed is on the claims table not derived from actions**
Deriving reviewed status from the actions table requires a subquery or join on every claims table read. The physician dashboard loads the full claims list on every page view. A simple boolean column on claims makes that query trivially fast.

---

## Data Volume Estimates

### MVP (Synthetic)

| Table | Expected rows |
|---|---|
| claims | 800 |
| npi_profiles | 15 |
| actions | 5-10 (pre-seeded) |
| rules_flags | ~150-200 |
| npi_risk_scores | ~25 (15 NPIs + ~10 suppliers) |

### Pilot (Real plan data, 90 days, DME only)

| Table | Expected rows |
|---|---|
| claims | 50,000 - 500,000 |
| npi_profiles | 1,000 - 10,000 |
| actions | grows with physician usage |
| rules_flags | 5,000 - 100,000 |
| npi_risk_scores | 2,000 - 20,000 |

### Production (Full plan, all categories, ongoing)

PostgreSQL handles tens of millions of rows comfortably with proper indexing. Partitioning the claims table by `date_of_service` month is recommended when claims exceed 10 million rows.
