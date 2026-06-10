# RISK_SCORING_SPEC — Risk Scoring Specification
## ClaimLens — NPI Intelligence Platform

---

## Document Purpose

This document defines the exact formula for calculating risk scores for every NPI and every supplier in ClaimLens. It specifies every weight, every cap, every edge case, and the action each score band triggers. The developer writes `scoring/risk_score.py` directly from this document. The tester verifies scores against the expected values at the end of this document.

---

## Overview

The risk scoring component runs after the rules engine completes. It reads the `rules_flags` and `actions` tables and writes a composite score 0-100 to the `npi_risk_scores` table — one row per NPI and one row per supplier.

**Two entity types are scored separately:**

- **NPI scores** — used by the Plan NPI Risk Leaderboard
- **Supplier scores** — used by the Plan Supplier Watchlist

Both use the same table (`npi_risk_scores`) with an `entity_type` discriminator column.

**MVP approach:** Weighted arithmetic sum of rules flags and physician flags. No ML model.

**Phase 2 approach:** XGBoost model trained on physician flag history as labels. The score formula below becomes the feature engineering input to that model.

---

## Score Bands

Every score maps to a risk band used for color coding and action routing:

| Score Range | Band | Dashboard Color | Action |
|---|---|---|---|
| 0 – 30 | `low` | Green | Monitored passively |
| 31 – 60 | `medium` | Amber | Weekly investigator review |
| 61 – 80 | `high` | Red | Immediate case opened |
| 81 – 100 | `critical` | Dark red | Auto-alert + claim hold request |

**Band assignment logic:**
```
score > 80  → critical
score > 60  → high
score > 30  → medium
else        → low
```

Note: the boundary values (30, 60, 80) belong to the higher band — score of 31 is `medium`, score of 61 is `high`, score of 81 is `critical`.

---

## Part 1 — NPI Risk Score

### Formula

```
score = 0

IF volume_spike rule fired for this NPI:
    score += WEIGHT_VOLUME_SPIKE          (default: 25)

IF geographic_anomaly rule fired on ANY claim for this NPI:
    score += WEIGHT_GEO_ANOMALY           (default: 15)

IF cross_npi_supplier rule fired on ANY claim for this NPI:
    score += WEIGHT_CROSS_NPI             (default: 30)

IF oig_leie_hit rule fired on ANY claim for this NPI:
    score += WEIGHT_OIG_HIT               (default: 35)

IF new_high_value_supplier rule fired on ANY claim for this NPI:
    score += WEIGHT_NEW_SUPPLIER          (default: 10)

physician_flag_contribution = MIN(
    physician_flag_count * WEIGHT_PER_PHYSICIAN_FLAG,   (default: 5 per flag)
    MAX_PHYSICIAN_FLAG_CONTRIBUTION                      (default: 20)
)
score += physician_flag_contribution

score = MIN(score, 100)    ← cap at 100
```

### Weights Reference

| Factor | Environment Variable | Default Weight | Notes |
|---|---|---|---|
| Volume spike | `WEIGHT_VOLUME_SPIKE` | 25 | One-time addition if rule fired for NPI |
| Geographic anomaly | `WEIGHT_GEO_ANOMALY` | 15 | One-time addition if ANY claim flagged |
| Cross-NPI supplier | `WEIGHT_CROSS_NPI` | 30 | One-time addition if ANY claim flagged |
| OIG LEIE hit | `WEIGHT_OIG_HIT` | 35 | One-time addition if ANY claim flagged |
| New high-value supplier | `WEIGHT_NEW_SUPPLIER` | 10 | One-time addition if ANY claim flagged |
| Per physician flag | `WEIGHT_PER_PHYSICIAN_FLAG` | 5 | Multiplied by physician_flag_count |
| Max physician contribution | `MAX_PHYSICIAN_FLAG_CONTRIBUTION` | 20 | Cap on physician flag total |

### Important: One-Time Additions

Each rule flag contributes to the score **at most once** per NPI, regardless of how many individual claims were flagged by that rule.

Example: If MedSupply Pro is cross-NPI and 47 of Dr. Wilson's claims are flagged with `cross_npi_supplier`, the cross-NPI weight of 30 is added **once** — not 47 times.

This is correct. The score measures the presence or absence of a risk pattern, not its intensity. Intensity is represented by the claim counts and totals visible in the dashboard.

### Physician Flag Contribution Detail

```
physician_flag_count = COUNT of actions WHERE:
    npi = this_npi
    AND action_type IN ('flag_supplier', 'unknown_patient')

physician_flag_contribution = MIN(
    physician_flag_count * 5,
    20
)
```

| Flag Count | Contribution | Explanation |
|---|---|---|
| 0 | 0 | No flags yet |
| 1 | 5 | One flag — signal present |
| 2 | 10 | Two flags — stronger signal |
| 3 | 15 | Three flags — significant |
| 4 | 20 | Four flags — maximum contribution |
| 5+ | 20 | Capped — additional flags do not increase score beyond 20 |

Note: Only `flag_supplier` and `unknown_patient` actions count. `confirm` and `dispute` do NOT affect the physician flag count.

### Maximum Possible Score by Pattern

| Pattern | Rules Fired | Max Score (no physician flags) |
|---|---|---|
| OIG hit only | oig_leie_hit | 35 |
| OIG + cross-NPI | oig_leie_hit + cross_npi_supplier | 65 → high band |
| Volume + cross-NPI + OIG | volume_spike + cross_npi_supplier + oig_leie_hit | 90 → critical |
| All 5 rules | all | 115 → capped at 100 |
| All 5 rules + 4 physician flags | all + 4 flags | 135 → capped at 100 |

### NPI Score Calculation — Step by Step

```python
def calculate_npi_score(npi: str, db: Session, settings: Settings) -> int:
    """
    Returns integer score 0-100 for this NPI.
    """
    # 1. Get all rules that fired for this NPI
    fired_rules = set(
        row.rule_name for row in
        db.query(RulesFlag.rule_name)
          .filter(RulesFlag.npi == npi)
          .distinct()
          .all()
    )

    # 2. Calculate base score from rules
    score = 0
    if "volume_spike"             in fired_rules: score += settings.weight_volume_spike
    if "geographic_anomaly"       in fired_rules: score += settings.weight_geo_anomaly
    if "cross_npi_supplier"       in fired_rules: score += settings.weight_cross_npi
    if "oig_leie_hit"             in fired_rules: score += settings.weight_oig_hit
    if "new_high_value_supplier"  in fired_rules: score += settings.weight_new_supplier

    # 3. Add physician flag contribution
    physician_flag_count = (
        db.query(func.count(Action.id))
          .filter(Action.npi == npi)
          .filter(Action.action_type.in_(["flag_supplier", "unknown_patient"]))
          .scalar() or 0
    )
    flag_contribution = min(
        physician_flag_count * settings.weight_per_physician_flag,
        settings.max_physician_flag_contribution
    )
    score += flag_contribution

    # 4. Cap at 100
    return min(score, 100)
```

---

## Part 2 — Supplier Risk Score

Suppliers are scored separately from NPIs. A supplier's risk score drives its position in the Supplier Watchlist on the plan dashboard.

### Formula

```
score = 0

IF cross_npi_supplier rule fired for this supplier:
    score += WEIGHT_CROSS_NPI             (default: 30)

IF oig_leie_hit rule fired for this supplier:
    score += WEIGHT_OIG_HIT               (default: 35)

IF new_high_value_supplier rule fired for this supplier:
    score += WEIGHT_NEW_SUPPLIER          (default: 10)

physician_flag_contribution = MIN(
    total_physician_flags_against_supplier * WEIGHT_PER_PHYSICIAN_FLAG,
    MAX_PHYSICIAN_FLAG_CONTRIBUTION
)
score += physician_flag_contribution

score = MIN(score, 100)
```

### Key difference from NPI scoring

Supplier scoring does NOT include `volume_spike` or `geographic_anomaly`. Those rules fire on NPIs, not on suppliers. The supplier score focuses on:

- How many distinct NPIs they bill under (cross-NPI)
- Whether they are federally excluded (OIG)
- Whether they are newly emerging with high-value claims (new supplier)
- How many physicians across all NPIs have flagged them (physician flags)

### Physician Flags — Supplier Level

Unlike the NPI score where physician_flag_count is per-physician, the supplier physician flag count is **across all NPIs**:

```
total_physician_flags_against_supplier = COUNT of actions WHERE:
    supplier_id = this_supplier
    AND action_type IN ('flag_supplier', 'unknown_patient')
    -- from ANY physician, not just one NPI
```

This is the critical difference. If 9 different physicians each flag MedSupply Pro once, the supplier score gets +5 × 9 = 45, capped at 20. Each physician saw only their own claim but the supplier score aggregates all of them. This is the cross-physician signal that makes the supplier watchlist powerful.

### Supplier Score Calculation — Step by Step

```python
def calculate_supplier_score(supplier_id: str, db: Session, settings: Settings) -> int:
    """
    Returns integer score 0-100 for this supplier.
    """
    # 1. Get all rules that fired for this supplier
    fired_rules = set(
        row.rule_name for row in
        db.query(RulesFlag.rule_name)
          .filter(RulesFlag.supplier_id == supplier_id)
          .distinct()
          .all()
    )

    # 2. Calculate base score (no volume_spike or geo_anomaly for suppliers)
    score = 0
    if "cross_npi_supplier"        in fired_rules: score += settings.weight_cross_npi
    if "oig_leie_hit"              in fired_rules: score += settings.weight_oig_hit
    if "new_high_value_supplier"   in fired_rules: score += settings.weight_new_supplier

    # 3. Add cross-NPI physician flag contribution
    total_physician_flags = (
        db.query(func.count(Action.id))
          .filter(Action.supplier_id == supplier_id)
          .filter(Action.action_type.in_(["flag_supplier", "unknown_patient"]))
          .scalar() or 0
    )
    flag_contribution = min(
        total_physician_flags * settings.weight_per_physician_flag,
        settings.max_physician_flag_contribution
    )
    score += flag_contribution

    # 4. Cap at 100
    return min(score, 100)
```

---

## Part 3 — Score Storage and Retrieval

### Upsert Pattern

The scoring job runs after every rules engine execution. It does not delete and reinsert — it upserts.

```python
existing = db.query(NpiRiskScore).filter_by(
    entity_type="npi",
    entity_id=npi
).first()

if existing:
    # Update all fields
    existing.risk_score = score
    existing.volume_flag = "volume_spike" in fired_rules
    # ... update all flag booleans and stats
    existing.last_calculated = datetime.utcnow()
else:
    # Insert new row
    db.add(NpiRiskScore(entity_type="npi", entity_id=npi, ...))
```

The UNIQUE constraint on `(entity_type, entity_id)` enforces that there is exactly one row per entity. The upsert pattern keeps that row current.

### Real-Time Score Update After Physician Flag

When a physician clicks Flag Supplier or Unknown Patient, the relevant supplier's score must update immediately — not wait for the next scheduled scoring run. The `create_action` endpoint calls `_increment_supplier_flag_count()` synchronously before returning the response.

```python
def _increment_supplier_flag_count(
    db: Session,
    supplier_id: str,
    settings: Settings
) -> None:
    """
    Increments physician_flag_count for this supplier and recalculates score.
    Called immediately after a flag action is recorded.
    """
    score_row = db.query(NpiRiskScore).filter_by(
        entity_type="supplier",
        entity_id=supplier_id
    ).first()

    if not score_row:
        return  # Supplier not yet scored — next full scoring run will handle it

    score_row.physician_flag_count += 1

    # Recalculate score with new flag count
    flag_contribution = min(
        score_row.physician_flag_count * settings.weight_per_physician_flag,
        settings.max_physician_flag_contribution
    )

    # Base score from existing flags (unchanged)
    base_score = 0
    if score_row.cross_npi_flag:    base_score += settings.weight_cross_npi
    if score_row.oig_flag:          base_score += settings.weight_oig_hit
    if score_row.new_supplier_flag: base_score += settings.weight_new_supplier

    score_row.risk_score = min(base_score + flag_contribution, 100)
    score_row.last_calculated = datetime.utcnow()
    db.commit()
```

---

## Part 4 — Additional Stored Fields

Beyond the risk score, the scoring job populates supporting fields used by both dashboards. These are derived at scoring time and stored — not calculated at query time — to keep dashboard queries fast.

### NPI rows

| Field | How calculated |
|---|---|
| `total_claim_count` | `COUNT(*) FROM claims WHERE npi = this_npi` |
| `total_claim_amount` | `SUM(claim_amount) FROM claims WHERE npi = this_npi` |
| `top_supplier_id` | `supplier_id` with highest claim count under this NPI |
| `top_supplier_name` | Name corresponding to `top_supplier_id` |

### Supplier rows

| Field | How calculated |
|---|---|
| `total_claim_count` | `COUNT(*) FROM claims WHERE supplier_id = this_supplier` |
| `total_claim_amount` | `SUM(claim_amount) FROM claims WHERE supplier_id = this_supplier` |
| `distinct_npi_count` | `COUNT(DISTINCT npi) FROM claims WHERE supplier_id = this_supplier` |

---

## Part 5 — Expected Scores for MVP Synthetic Dataset

After running `calculate_all_scores()` against the 800-record synthetic dataset, verify these expected scores. All values assume no physician flags have been recorded yet (pre-demo state).

### NPI Expected Scores

| NPI | Physician | Rules Expected to Fire | Expected Score |
|---|---|---|---|
| 1234567890 | Dr. James Wilson | volume_spike (25) + cross_npi_supplier (30) + oig_leie_hit (35) | **90** |
| NPIs billing MedSupply Pro | various | cross_npi_supplier (30) + oig_leie_hit (35) | **65** |
| NPIs with geo anomaly only | various | geographic_anomaly (15) | **15** |
| NPIs with new supplier | various | new_high_value_supplier (10) | **10** |
| NPIs with no flags | various | none | **0** |

### Supplier Expected Scores

| Supplier | Rules Expected to Fire | Expected Score |
|---|---|---|
| MedSupply Pro LLC | cross_npi_supplier (30) + oig_leie_hit (35) | **65** |
| QuickCare Equipment Inc | oig_leie_hit (35) | **35** |
| Premier Home Solutions | new_high_value_supplier (10) + cross_npi_supplier if >3 NPIs (30) | **10 or 40** |
| All other suppliers | none | **0** |

### Score After Physician Flags (Demo State)

After `seed_demo_actions.py` runs (5 pre-seeded flags against MedSupply Pro):

| Entity | Seeded Flags | Flag Contribution | New Score |
|---|---|---|---|
| MedSupply Pro LLC (supplier) | 5 flags | MIN(5×5, 20) = 20 | **65 + 20 = 85** → critical |
| Dr. Wilson (NPI) | 3 flags against MedSupply | MIN(3×5, 20) = 15 | **90 + 15 = 100** → capped |

---

## Part 6 — Verification Queries

Run after `calculate_all_scores()` completes:

```sql
-- 1. Dr. Wilson NPI score (expect >= 85)
SELECT entity_id, entity_name, risk_score, volume_flag, cross_npi_flag, oig_flag
FROM npi_risk_scores
WHERE entity_type = 'npi' AND entity_id = '1234567890';

-- 2. MedSupply Pro supplier score (expect >= 65)
SELECT entity_name, risk_score, cross_npi_flag, oig_flag,
       distinct_npi_count, physician_flag_count
FROM npi_risk_scores
WHERE entity_type = 'supplier'
AND entity_name ILIKE '%MedSupply Pro%';

-- 3. NPI leaderboard top 5 (Dr. Wilson should appear)
SELECT entity_id, entity_name, risk_score
FROM npi_risk_scores
WHERE entity_type = 'npi'
ORDER BY risk_score DESC
LIMIT 5;

-- 4. Supplier watchlist top 3 (MedSupply Pro should be row 1)
SELECT entity_name, risk_score, distinct_npi_count, physician_flag_count, oig_flag
FROM npi_risk_scores
WHERE entity_type = 'supplier'
ORDER BY physician_flag_count DESC, risk_score DESC
LIMIT 3;

-- 5. Score capped at 100 (no score should exceed 100)
SELECT COUNT(*) FROM npi_risk_scores WHERE risk_score > 100;
-- Expected: 0

-- 6. No NULL scores
SELECT COUNT(*) FROM npi_risk_scores WHERE risk_score IS NULL;
-- Expected: 0

-- 7. All NPIs in npi_profiles have a score row
SELECT COUNT(*) FROM npi_profiles np
LEFT JOIN npi_risk_scores nrs ON nrs.entity_id = np.npi AND nrs.entity_type = 'npi'
WHERE nrs.id IS NULL;
-- Expected: 0

-- 8. risk_band derived correctly for display verification
SELECT
    entity_name,
    risk_score,
    CASE
        WHEN risk_score > 80 THEN 'critical'
        WHEN risk_score > 60 THEN 'high'
        WHEN risk_score > 30 THEN 'medium'
        ELSE 'low'
    END as risk_band
FROM npi_risk_scores
WHERE entity_type = 'npi'
ORDER BY risk_score DESC;
```

---

## Part 7 — Phase 2 Migration Path

When real physician flag data has accumulated during the pilot, the rules-based score is replaced with an XGBoost model. The transition is designed to be non-breaking.

### What stays the same
- The `npi_risk_scores` table schema is unchanged
- The `risk_score` column continues to hold a 0-100 integer
- The score bands and dashboard color coding are unchanged
- The `last_calculated` column records when each score was last updated

### What changes
- `scoring/risk_score.py` is updated to call the XGBoost model instead of the weighted sum
- The existing weighted sum becomes the feature engineering baseline for the model
- The 5 flag boolean columns become model features
- `physician_flag_count` becomes the primary training label
- The model is retrained weekly on accumulated flag history

### Feature vector for XGBoost (Phase 2)

```python
features = {
    "volume_flag":           1 if score_row.volume_flag else 0,
    "geo_flag":              1 if score_row.geo_flag else 0,
    "cross_npi_flag":        1 if score_row.cross_npi_flag else 0,
    "oig_flag":              1 if score_row.oig_flag else 0,
    "new_supplier_flag":     1 if score_row.new_supplier_flag else 0,
    "physician_flag_count":  score_row.physician_flag_count,
    "total_claim_count":     score_row.total_claim_count,
    "total_claim_amount":    float(score_row.total_claim_amount),
    "distinct_npi_count":    score_row.distinct_npi_count or 0,
}
```

The MVP scoring spec is designed so the Phase 2 migration requires only updating `scoring/risk_score.py` — no schema changes, no API changes, no frontend changes.
