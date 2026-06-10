# RULES_ENGINE_SPEC — Rules Engine Specification
## ClaimLens — NPI Intelligence Platform

---

## Document Purpose

This document is the authoritative specification for all 5 guardrail rules in the ClaimLens rules engine. It defines the exact input, condition, output, severity, threshold, and test cases for each rule. The developer writes `rules/engine.py` directly from this document. The tester verifies `rules/engine.py` directly against this document.

---

## Overview

The rules engine is a deterministic, rule-based fraud detection layer. It runs on the full claims dataset after ETL ingestion and writes one row to the `rules_flags` table for each rule that fires on each claim.

**Key properties:**

- **Deterministic** — same input always produces same output
- **Idempotent** — running twice produces the same result, not double the flags
- **No ML required** — pure Python logic, no model training, no external API calls
- **Runs at startup** — executes after ETL completes, before dashboards are accessible
- **Re-runnable** — can be re-run in production after new claims arrive

**What it does not do:**

- It does not approve or deny claims
- It does not contact any external system
- It does not send alerts directly — alerts come from physician actions, not rule fires
- It does not replace physician judgment — it surfaces claims worth reviewing

---

## Rules Summary

| # | Rule Name | Constant | Severity | What It Catches |
|---|---|---|---|---|
| 1 | Volume Spike | `volume_spike` | high | NPI with sudden billing surge |
| 2 | Geographic Anomaly | `geographic_anomaly` | medium | Patient impossibly far from physician |
| 3 | Cross-NPI Supplier | `cross_npi_supplier` | critical | Supplier billing under many doctors |
| 4 | New High-Value Supplier | `new_high_value_supplier` | medium | Unknown supplier, large claim |
| 5 | OIG LEIE Hit | `oig_leie_hit` | critical | Supplier on federal exclusion list |

---

## Severity Definitions

| Severity | Meaning | Dashboard Color | Risk Score Weight |
|---|---|---|---|
| `critical` | Immediate attention required. Strong fraud indicator. | Red | Highest |
| `high` | Significant anomaly. Likely warrants investigation. | Orange | High |
| `medium` | Notable pattern. Worth reviewing in context. | Yellow | Medium |
| `low` | Minor deviation. Low standalone value. | Gray | Low |

---

## Rule 1 — Volume Spike

### Definition
Flag an NPI whose claim submission rate in the most recent 30-day window is more than 2x its average daily rate in the prior 60-day baseline window.

### Rationale
Fraudulent suppliers often begin billing heavily under a doctor's NPI before the doctor notices. A sudden spike in claim volume — with no clinical explanation — is one of the strongest fraud signals available before any physician flags are received.

### Input
- All claims for a given NPI sorted by `date_of_service`
- Two time windows calculated relative to the current date:
  - **Recent window:** last 30 days (current date minus 30 days to current date)
  - **Baseline window:** the 60 days before the recent window (current date minus 90 days to current date minus 30 days)

### Algorithm

```
For each unique NPI:

    recent_count   = COUNT of claims WHERE date_of_service >= (today - 30 days)
    baseline_count = COUNT of claims WHERE date_of_service >= (today - 90 days)
                                      AND date_of_service <  (today - 30 days)

    IF baseline_count == 0:
        SKIP — cannot calculate spike without prior history

    recent_rate   = recent_count  / 30   ← claims per day
    baseline_rate = baseline_count / 60  ← claims per day

    IF recent_rate > baseline_rate * VOLUME_SPIKE_MULTIPLIER:
        FLAG every claim in the recent window for this NPI
```

### Threshold
- `VOLUME_SPIKE_MULTIPLIER = 2.0` (configurable via environment variable)
- Minimum baseline: at least 1 claim in the baseline window required to fire

### Output — one RuleFlagResult per flagged claim

| Field | Value |
|---|---|
| `rule_name` | `volume_spike` |
| `severity` | `high` |
| `rule_description` | `"NPI {npi} claim rate in last 30 days ({recent_count} claims, {recent_rate:.1f}/day) is {ratio:.1f}x the prior 60-day baseline ({baseline_count} claims, {baseline_rate:.1f}/day)"` |

### What fires

- Dr. Wilson (NPI 1234567890): 8 claims in months 1-2 (baseline), 47 claims in month 3 (recent) → fires
- Any NPI with consistent volume across both windows → does not fire
- Any NPI with zero claims in the baseline window → does not fire (no prior history)

### What does not fire

- NPIs with their first claims ever appearing in the recent window (no baseline)
- NPIs where recent rate is less than 2x baseline even if volume is high
- NPIs where all claims fall entirely within one window

### Test cases

| NPI | Baseline (60d) | Recent (30d) | Multiplier | Expected |
|---|---|---|---|---|
| 1234567890 (Dr. Wilson) | 8 claims | 47 claims | 5.9x | FIRES |
| 9876543210 | 20 claims | 22 claims | 1.1x | NO FIRE |
| 1111111111 | 0 claims | 15 claims | N/A | NO FIRE (no baseline) |
| 2222222222 | 10 claims | 21 claims | 2.1x | FIRES |

---

## Rule 2 — Geographic Anomaly

### Definition
Flag any claim where the straight-line distance between the patient's zip code centroid and the ordering physician's practice zip code centroid exceeds 150 miles.

### Rationale
Physicians order services for their own patients. A home health agency claiming to provide care to a patient 350 miles from the ordering physician's office is almost certainly fraudulent. The doctor either does not know the patient or the claim was submitted without their knowledge.

### Input
- `claims.patient_lat`, `claims.patient_lng` — geocoded from patient_zip at ETL
- `npi_profiles.practice_lat`, `npi_profiles.practice_lng` — geocoded from practice_zip at ETL
- Claims and profiles joined on `claims.npi = npi_profiles.npi`

### Algorithm

```
For each claim with non-null patient_lat/lng AND non-null practice_lat/lng:

    distance = haversine_miles(
        patient_lat, patient_lng,
        practice_lat, practice_lng
    )

    IF distance > GEOGRAPHIC_ANOMALY_MILES:
        FLAG this claim
```

### Haversine Formula

```
R = 3958.8  ← Earth radius in miles

phi1 = radians(lat1)
phi2 = radians(lat2)
dphi = radians(lat2 - lat1)
dlng = radians(lng2 - lng1)

a = sin(dphi/2)² + cos(phi1) * cos(phi2) * sin(dlng/2)²
distance = 2 * R * arcsin(sqrt(a))
```

### Threshold
- `GEOGRAPHIC_ANOMALY_MILES = 150.0` (configurable via environment variable)
- Claims with null lat/lng on either end are skipped — not flagged

### Output — one RuleFlagResult per flagged claim

| Field | Value |
|---|---|
| `rule_name` | `geographic_anomaly` |
| `severity` | `medium` |
| `rule_description` | `"Patient zip {patient_zip} is {distance:.0f} miles from physician practice zip {practice_zip} (threshold: {threshold:.0f} miles)"` |

### What fires

- Patient zip 90210 (Beverly Hills, CA) vs physician practice zip 02101 (Boston, MA) — ~2,600 miles → fires
- Patient zip 90210 vs physician practice zip 94102 (San Francisco, CA) — ~340 miles → fires
- 20 synthetic claims where patient state is different from physician state at high distance → fires

### What does not fire

- Patient zip 94105 (SF) vs physician practice zip 94102 (SF) — ~0.5 miles → no fire
- Patient zip 10001 (Manhattan) vs physician practice zip 11201 (Brooklyn) — ~4 miles → no fire
- Claims where patient_lat or practice_lat is null → skipped, not flagged

### Test cases

| Patient Zip | Practice Zip | Distance (approx) | Expected |
|---|---|---|---|
| 90210 | 94102 | 340 miles | FIRES |
| 33101 (Miami) | 94102 (SF) | 2,580 miles | FIRES |
| 94105 | 94102 | 0.5 miles | NO FIRE |
| 10001 | 10005 | 1 mile | NO FIRE |
| NULL | 94102 | N/A | SKIP |

---

## Rule 3 — Cross-NPI Supplier

### Definition
Flag all claims from any supplier that bills under more than 3 distinct physician NPIs within the dataset.

### Rationale
A legitimate DME supplier or home health agency serves many patients but does so through referrals from many physicians. However, a fraudulent supplier steals NPIs from multiple doctors and submits claims under all of them simultaneously. When the same supplier appears under 5, 10, or 40 different physician NPIs, that is not coincidence — it is the signature of a fraud ring. This is the highest-value rule in the MVP.

### Input
- All claims grouped by `supplier_id`
- Count of distinct `npi` values per `supplier_id`

### Algorithm

```
For each unique supplier_id:

    distinct_npi_count = COUNT(DISTINCT npi) WHERE supplier_id = this_supplier

    IF distinct_npi_count > CROSS_NPI_THRESHOLD:
        FLAG every claim from this supplier across all NPIs
```

### Threshold
- `CROSS_NPI_THRESHOLD = 3` (configurable via environment variable)
- A supplier billing under 4 or more distinct NPIs fires this rule
- A supplier billing under exactly 3 NPIs does NOT fire (strictly greater than)

### Output — one RuleFlagResult per flagged claim

| Field | Value |
|---|---|
| `rule_name` | `cross_npi_supplier` |
| `severity` | `critical` |
| `rule_description` | `"Supplier '{supplier_name}' is billing under {distinct_npi_count} distinct physician NPIs (threshold: {threshold})"` |

### What fires

- MedSupply Pro LLC: bills under 9 distinct NPIs → fires on all 120 of its claims
- Any supplier billing under 4+ NPIs → fires on all of that supplier's claims
- This includes claims from "innocent" NPIs — the rule flags the supplier's behavior across all NPIs, not just suspicious ones

### What does not fire

- A supplier billing under exactly 3 NPIs → does not fire
- A supplier billing under 2 NPIs → does not fire
- A legitimate supplier with 5 NPIs but all are in the same hospital network — this rule still fires. The dashboard and physician flag loop provides context. The rule is intentionally broad; human review narrows it.

### Test cases

| Supplier | Distinct NPIs | Expected |
|---|---|---|
| MedSupply Pro LLC | 9 | FIRES — all 120 claims flagged |
| QuickCare Equipment Inc | 3 | NO FIRE (exactly at threshold, not over) |
| Premier Home Solutions | 2 | NO FIRE |
| Legit Home Health Co | 1 | NO FIRE |

### Important design note

The threshold is `> CROSS_NPI_THRESHOLD`, not `>= CROSS_NPI_THRESHOLD`. A supplier billing under exactly 3 NPIs is at the boundary and is not flagged. This is intentional — a physician + their partner + a covering colleague is 3 NPIs and plausibly legitimate. 4 or more becomes increasingly difficult to explain legitimately for a single supplier.

---

## Rule 4 — New High-Value Supplier

### Definition
Flag any claim from a supplier that has never previously billed under a given NPI (no claims older than 30 days) and whose claim amount exceeds $500.

### Rationale
Established supplier-physician relationships accumulate claim history over time. A brand-new supplier appearing for the first time under a physician's NPI with immediately high-value claims is suspicious. Fraudulent operations often set up new shell suppliers and immediately begin billing at high volumes before detection.

### Input
- All claims grouped by `(npi, supplier_id)` pairs
- The earliest `date_of_service` for each pair
- The `claim_amount` for each claim in new pairs

### Algorithm

```
cutoff_date = today - NEW_SUPPLIER_DAYS_LOOKBACK  ← 30 days ago

For each unique (npi, supplier_id) pair:

    first_seen = MIN(date_of_service) WHERE npi = this_npi
                                       AND supplier_id = this_supplier

    IF first_seen >= cutoff_date:
        ← This is a "new" supplier for this NPI

        For each claim in this (npi, supplier_id) pair:
            IF claim_amount > NEW_SUPPLIER_AMOUNT_THRESHOLD:
                FLAG this claim
```

### Thresholds
- `NEW_SUPPLIER_DAYS_LOOKBACK = 30` (configurable)
- `NEW_SUPPLIER_AMOUNT_THRESHOLD = 500.00` (configurable, in dollars)

### Output — one RuleFlagResult per qualifying claim

| Field | Value |
|---|---|
| `rule_name` | `new_high_value_supplier` |
| `severity` | `medium` |
| `rule_description` | `"Supplier '{supplier_name}' appeared for the first time under NPI {npi} within the last {lookback} days with claim amount ${amount:.2f} (threshold: ${threshold:.2f})"` |

### What fires

- Premier Home Solutions: first appears in last 15 days of dataset under 2 NPIs with claims of $1,800-$2,400 → fires on all those claims
- Any supplier with first claim within last 30 days and amount > $500 → fires

### What does not fire

- A supplier with claims dating back more than 30 days → established relationship, does not fire
- A new supplier with claims under $500 → below amount threshold, does not fire
- A new supplier with a first claim exactly 30 days ago → boundary case, does not fire (strictly less than cutoff)

### Test cases

| Supplier | First Seen | Amount | Expected |
|---|---|---|---|
| Premier Home Solutions | 15 days ago | $2,200 | FIRES |
| Premier Home Solutions | 15 days ago | $300 | NO FIRE (below amount threshold) |
| MedSupply Pro LLC | 85 days ago | $1,850 | NO FIRE (established) |
| New Supplier X | 5 days ago | $750 | FIRES |
| New Supplier Y | 31 days ago | $900 | NO FIRE (outside lookback) |

---

## Rule 5 — OIG LEIE Hit

### Definition
Flag every claim where the submitting supplier appears on the OIG (Office of Inspector General) List of Excluded Individuals/Entities (LEIE).

### Rationale
The OIG LEIE is a federal exclusion list maintained by the US Department of Health & Human Services. Medicare and Medicaid are legally prohibited from reimbursing claims from excluded providers. Any claim from an excluded supplier is not just suspicious — it is per se impermissible under federal law. This is the most straightforward rule: if the supplier is excluded, every single one of their claims is flagged.

### Input
- `claims.oig_flagged` — boolean set at ETL ingestion time
- The OIG LEIE check at ETL compares supplier names against the exclusion list using fuzzy matching

### Algorithm

```
For each claim:
    IF oig_flagged == true:
        FLAG this claim
```

No calculation required. The boolean was set at ingestion. This rule reads it.

### Why set at ETL vs check at rule time

The OIG check is done at ETL for two reasons:
1. The LEIE list is downloaded once and checked in bulk — faster than checking per claim at rule time
2. The `oig_flagged` boolean makes the rules engine idempotent regardless of when the LEIE list is refreshed

In production, a LEIE refresh job runs weekly and re-checks all supplier names. If a supplier is added to the exclusion list, the ETL re-ingestion or a standalone refresh script updates `oig_flagged` for all their claims.

### Output — one RuleFlagResult per flagged claim

| Field | Value |
|---|---|
| `rule_name` | `oig_leie_hit` |
| `severity` | `critical` |
| `rule_description` | `"Supplier '{supplier_name}' appears on the OIG LEIE exclusion list. Medicare/Medicaid cannot reimburse claims from excluded providers."` |

### What fires

- All claims from MedSupply Pro LLC (oig_flagged = true) → fires
- All claims from QuickCare Equipment Inc (oig_flagged = true) → fires
- Any claim where oig_flagged = true → fires

### What does not fire

- Any claim where oig_flagged = false → never fires
- Claims from non-excluded suppliers with suspicious behavior → caught by other rules

### Test cases

| Supplier | oig_flagged | Expected |
|---|---|---|
| MedSupply Pro LLC | true | FIRES on all 120 claims |
| QuickCare Equipment Inc | true | FIRES on all 15 claims |
| Premier Home Solutions | false | NO FIRE |
| Any legitimate supplier | false | NO FIRE |

---

## Rules Engine Orchestration

### Execution Order

Rules run in this order every time:

```
1. oig_leie_hit          ← fastest, boolean lookup, run first
2. cross_npi_supplier    ← aggregate query, run early
3. volume_spike          ← time-window queries
4. geographic_anomaly    ← per-claim distance calculations, most compute-intensive
5. new_high_value_supplier ← pair-based lookups
```

Order does not affect correctness. Order affects performance — faster rules run first.

### Idempotency

Before inserting new flags, the engine deletes all existing rows in `rules_flags`. This ensures re-running produces identical results without accumulating duplicates.

```
DELETE FROM rules_flags;   ← wipes all existing flags
[run all 5 rules]
INSERT all new flags in bulk
COMMIT
```

### Bulk Insert

All flags from all 5 rules are collected in memory first, then inserted in a single bulk operation. This is more efficient than committing after each rule and prevents partial states in the database.

### Logging

Each rule logs:
```
INFO: Rule 'volume_spike': 47 flags fired in 0.12s
INFO: Rule 'geographic_anomaly': 20 flags fired in 0.34s
INFO: Rule 'cross_npi_supplier': 120 flags fired in 0.08s
INFO: Rule 'new_high_value_supplier': 22 flags fired in 0.09s
INFO: Rule 'oig_leie_hit': 135 flags fired in 0.04s
INFO: Rules engine complete: 344 total flags written
```

### A claim can have multiple flags

A single claim may match multiple rules. Each match produces a separate row in `rules_flags`. A MedSupply Pro claim in Dr. Wilson's recent window for a patient 300 miles away will produce 3 rows: `cross_npi_supplier`, `oig_leie_hit`, and `geographic_anomaly`. All three display as badges on that claim row in both dashboards.

---

## Configuration Reference

All thresholds are environment variables. Set them in `.env`. No code change required to adjust them.

| Environment Variable | Default | Rule | Description |
|---|---|---|---|
| `VOLUME_SPIKE_MULTIPLIER` | `2.0` | Rule 1 | How many times the baseline before spike fires |
| `GEOGRAPHIC_ANOMALY_MILES` | `150.0` | Rule 2 | Distance threshold in miles |
| `CROSS_NPI_THRESHOLD` | `3` | Rule 3 | Distinct NPIs before cross-NPI rule fires (strictly greater than) |
| `NEW_SUPPLIER_DAYS_LOOKBACK` | `30` | Rule 4 | Days back to consider a supplier "new" |
| `NEW_SUPPLIER_AMOUNT_THRESHOLD` | `500.00` | Rule 4 | Minimum amount for new supplier flag |

---

## Expected Flag Counts for MVP Synthetic Dataset

After running the rules engine against the 800-record synthetic dataset, these counts must be verified:

| Rule | Expected minimum flags |
|---|---|
| `volume_spike` | 40+ (Dr. Wilson's recent claims) |
| `geographic_anomaly` | 20+ |
| `cross_npi_supplier` | 120+ (all MedSupply Pro claims) |
| `new_high_value_supplier` | 15+ (Premier Home Solutions claims) |
| `oig_leie_hit` | 35+ (MedSupply Pro + QuickCare Equipment) |
| **Total** | **230+** |

If any count is below the minimum after running, the synthetic data generation or rules engine has a defect. Fix before proceeding to risk scoring.

---

## Verification Queries

Run these after `run_all_rules()` completes:

```sql
-- 1. Rule counts
SELECT rule_name, severity, COUNT(*) as flag_count
FROM rules_flags
GROUP BY rule_name, severity
ORDER BY rule_name;

-- 2. Dr. Wilson is flagged
SELECT COUNT(*) FROM rules_flags
WHERE npi = '1234567890';
-- Expected: > 40

-- 3. MedSupply Pro flagged across all NPIs
SELECT COUNT(*) FROM rules_flags rf
JOIN claims c ON c.id = rf.claim_id
WHERE c.supplier_name = 'MedSupply Pro LLC';
-- Expected: >= 120 (may be higher if also geo-flagged)

-- 4. Geographic anomaly minimum
SELECT COUNT(*) FROM rules_flags
WHERE rule_name = 'geographic_anomaly';
-- Expected: >= 20

-- 5. OIG hits minimum
SELECT COUNT(*) FROM rules_flags
WHERE rule_name = 'oig_leie_hit';
-- Expected: >= 35

-- 6. No claim flagged by same rule twice (idempotency check)
SELECT claim_id, rule_name, COUNT(*) as cnt
FROM rules_flags
GROUP BY claim_id, rule_name
HAVING COUNT(*) > 1;
-- Expected: 0 rows
```
