# SYNTHETIC_DATA_SPEC — Synthetic Data Specification
## ClaimLens — NPI Intelligence Platform

---

## Document Purpose

This document is the complete specification for the synthetic claims dataset that powers the ClaimLens MVP demo. It defines every field, every value range, every fraud pattern with precise numbers, and the exact GPT-4 prompt structure. The developer writes `data/generate_synthetic.py` directly from this document.

---

## Overview

The MVP runs on 800 GPT-4 generated claims across 15 fake physician NPIs. The dataset must look realistic enough that a health plan executive reviewing it thinks "this is what my data would look like in this system." It must also contain 6 precisely engineered fraud patterns that make the demo story coherent and visually compelling.

**Total records:** 800 claims + 15 NPI profiles
**Time span:** 90 days ending on the date the script is run
**Plan name:** Consistent across all records — used as a placeholder until a pilot plan is confirmed
**Data sensitivity:** Zero — entirely synthetic, no real patients, no real physicians

---

## Part 1 — NPI Profiles (15 Physicians)

### The Demo Physician — Fixed

This physician is hardcoded. Do not let GPT-4 generate this record — create it manually in the script.

```python
DEMO_PHYSICIAN = {
    "npi":              "1234567890",
    "physician_name":   "Dr. James Wilson",
    "specialty":        "Internal Medicine",
    "practice_city":    "San Francisco",
    "practice_state":   "CA",
    "practice_zip":     "94102",
    "practice_lat":     37.779026,
    "practice_lng":     -122.419906,
    "enrollment_status": "active",
    "enrolled_since":   "2010-03-15",
}
```

### The Remaining 14 Physicians — GPT-4 Generated

Generate 14 additional realistic physician profiles. Each must have:

| Field | Requirement |
|---|---|
| `npi` | 10-digit string, starts with 1 or 2, no repeating digits, unique across all 15 |
| `physician_name` | Realistic US name with "Dr." prefix |
| `specialty` | One of: Family Medicine, Internal Medicine, Oncology, Cardiology, Neurology, Orthopedics, Geriatrics |
| `practice_city` | Real US city |
| `practice_state` | 2-letter US state code |
| `practice_zip` | Real 5-digit US zip code matching the city and state |
| `practice_lat` | Correct centroid latitude for the zip (pgeocode will fill this) |
| `practice_lng` | Correct centroid longitude for the zip (pgeocode will fill this) |
| `enrollment_status` | `"active"` for all |
| `enrolled_since` | A realistic date between 2005 and 2018 |

### Geographic Distribution

Distribute the 14 generated physicians across these states to enable geographic anomaly patterns:

| State | Count |
|---|---|
| CA | 4 (including Dr. Wilson) |
| TX | 3 |
| FL | 2 |
| NY | 2 |
| IL | 1 |
| OH | 1 |
| WA | 1 |

---

## Part 2 — Claim Field Specifications

Every claim record must contain these fields with the specified constraints:

### Patient Fields

| Field | Type | Constraints |
|---|---|---|
| `patient_id` | string | UUID format — `str(uuid.uuid4())` |
| `patient_name` | string | Realistic first + last name. Use diverse names (mix of Anglo, Hispanic, Asian, African-American). No "John Doe" or "Test Patient". |
| `patient_zip` | string | Real 5-digit US zip code. Must match patient_state. |
| `patient_state` | string | 2-letter US state code matching patient_zip |

### Claim Fields

| Field | Type | Constraints |
|---|---|---|
| `date_of_service` | string | ISO date YYYY-MM-DD. Spread across 90 days ending today. See distribution spec below. |
| `cpt_code` | string or null | Real CPT code matching service_category. Null if hcpcs_code is present. |
| `hcpcs_code` | string or null | Real HCPCS code matching service_category. Null if cpt_code is present. Primarily used for DME. |
| `service_description` | string | Plain English description matching the code. 5-15 words. |
| `service_category` | string | One of: `home_health`, `hospice`, `dme`, `drugs`, `hospital`. See distribution below. |
| `claim_amount` | float | Realistic for the service type. See amount ranges below. Always > 0. |
| `plan_name` | string | `"ClaimLens Pilot Plan"` for all records |

### Supplier Fields

| Field | Type | Constraints |
|---|---|---|
| `supplier_name` | string | Realistic healthcare company name. See named suppliers below. |
| `supplier_zip` | string | Real 5-digit US zip code |
| `supplier_state` | string | 2-letter state code matching supplier_zip |

### System Fields (set by script, not GPT-4)

| Field | Type | Set by |
|---|---|---|
| `supplier_id` | string | Entity resolution step in the script |
| `patient_lat` | float | pgeocode geocoding of patient_zip |
| `patient_lng` | float | pgeocode geocoding of patient_zip |
| `oig_flagged` | boolean | OIG LEIE check step |
| `reviewed` | boolean | Always `False` at generation time |

---

## Part 3 — Service Category Distribution

| Category | Count | % |
|---|---|---|
| `dme` | 280 | 35% |
| `home_health` | 240 | 30% |
| `hospice` | 160 | 20% |
| `drugs` | 80 | 10% |
| `hospital` | 40 | 5% |
| **Total** | **800** | **100%** |

---

## Part 4 — Claim Amount Ranges by Category

GPT-4 must generate amounts within these ranges. Use realistic variation — not every DME claim is exactly $1,200.

| Category | Min | Max | Typical Range | Notes |
|---|---|---|---|---|
| `dme` | $150 | $3,500 | $400 – $2,000 | Wheelchairs at high end, simple supplies at low end |
| `home_health` | $120 | $600 | $150 – $400 | Per-visit billing |
| `hospice` | $150 | $220 | $180 – $200 | Daily rate — narrow range |
| `drugs` | $50 | $1,200 | $100 – $500 | Generic vs branded |
| `hospital` | $500 | $5,000 | $800 – $2,500 | Outpatient procedures |

---

## Part 5 — CPT and HCPCS Codes by Category

Use only real codes. GPT-4 must not invent codes.

### DME — HCPCS Codes

| Code | Description |
|---|---|
| E0100 | Cane, includes canes of all materials |
| E0105 | Cane, quad or three-pronged |
| E0141 | Walker, folding, wheeled |
| E0159 | Rollator walker, any type |
| E0250 | Hospital bed, fixed height, with mattress |
| E0601 | Continuous positive airway pressure device |
| E1050 | Fully reclining wheelchair |
| E1070 | Motorized wheelchair |
| K0001 | Standard wheelchair |
| K0005 | Ultralightweight wheelchair |
| A4253 | Blood glucose test strips |
| A4570 | Splint |

### Home Health — CPT Codes

| Code | Description |
|---|---|
| 99509 | Home visit for assistance with activities of daily living |
| 99511 | Home visit for fecal impaction management |
| 97110 | Therapeutic exercises |
| 97530 | Therapeutic activities |
| G0162 | Skilled services of RN for management of skilled care |
| G0163 | Skilled services of LPN for management of skilled care |
| G0299 | Direct skilled nursing services of RN in home health |
| G0300 | Direct skilled nursing services of LPN in home health |

### Hospice — Revenue Codes (use in service_description)

| Code | Description |
|---|---|
| 0651 | Routine home care |
| 0652 | Continuous home care |
| 0655 | Inpatient respite care |
| 0656 | General inpatient care |

### Drugs — NDC/HCPCS

| Code | Description |
|---|---|
| J0131 | Acetaminophen injection |
| J0133 | Acyclovir injection |
| J0895 | Deferoxamine mesylate injection |
| J1940 | Furosemide injection |
| J2270 | Morphine sulfate injection |
| J3010 | Fentanyl citrate injection |

### Hospital — CPT Codes

| Code | Description |
|---|---|
| 99213 | Office visit, established patient, low complexity |
| 99214 | Office visit, established patient, moderate complexity |
| 99232 | Subsequent hospital care |
| 99233 | Subsequent hospital care, high complexity |

---

## Part 6 — Named Suppliers

Use these exact supplier names. Casing and spelling must be consistent. GPT-4 should assign claims to these suppliers as specified in Part 7.

### Fraud Suppliers (specific to fraud patterns)

| Supplier Name | Pattern | OIG Status |
|---|---|---|
| `MedSupply Pro LLC` | Hub supplier, cross-NPI | OIG flagged |
| `QuickCare Equipment Inc` | OIG excluded | OIG flagged |
| `Premier Home Solutions` | New high-value supplier | Clean |

### Legitimate Suppliers (background noise)

Use these for the 568 legitimate claims. Assign them consistently — a physician should have 2-3 regular suppliers they use repeatedly.

| Supplier Name | Category | State |
|---|---|---|
| `Sunrise Home Health Agency` | home_health | CA |
| `Pacific Care Services` | home_health | CA |
| `Lone Star Home Health` | home_health | TX |
| `Coastal Hospice Partners` | hospice | FL |
| `Heartland Hospice Care` | hospice | IL |
| `All American Medical Supply` | dme | OH |
| `Guardian Medical Equipment` | dme | TX |
| `National Pharmacy Solutions` | drugs | NY |
| `Regional Medical Center` | hospital | WA |
| `Midwest Health Services` | hospital | OH |

---

## Part 7 — The 6 Fraud Patterns

This is the most critical section. Every number here is exact. The demo story depends on these patterns being precisely implemented.

---

### Pattern 1 — Hub Supplier (MedSupply Pro LLC)

**What it demonstrates:** A single fraudulent supplier billing under 9 different physician NPIs — the signature of a fraud ring.

**Exact specification:**

| Property | Value |
|---|---|
| Supplier name | `MedSupply Pro LLC` |
| Supplier zip | `10001` (New York, NY) |
| OIG flagged | `True` |
| Total claims | 120 |
| Distinct NPIs billing under | 9 (includes Dr. Wilson + 8 others) |
| Service category | `dme` exclusively |
| Claim amounts | $800 – $2,200 |
| Date distribution | Spread across all 90 days |

**Assignment:** Distribute 120 claims across exactly 9 NPIs. Suggested distribution:

| NPI | Claims from MedSupply Pro |
|---|---|
| 1234567890 (Dr. Wilson) | 20 |
| NPI #2 | 15 |
| NPI #3 | 15 |
| NPI #4 | 14 |
| NPI #5 | 14 |
| NPI #6 | 12 |
| NPI #7 | 12 |
| NPI #8 | 10 |
| NPI #9 | 8 |

**HCPCS codes to use:** E1050, E1070, K0001, K0005 (wheelchairs and mobility equipment)

---

### Pattern 2 — Volume Spike (Dr. James Wilson, NPI 1234567890)

**What it demonstrates:** A sudden surge in claims under a physician's NPI — fraudulent supplier ramping up activity.

**Exact specification:**

| Property | Value |
|---|---|
| NPI | `1234567890` (Dr. James Wilson) |
| Days 1–60 (older period) | 8–10 total claims from all suppliers |
| Days 61–90 (recent 30 days) | 47 total claims |
| Total for Dr. Wilson | 55–57 claims |
| Spike ratio | ~5.9x (47 claims in 30 days vs ~4.5 claims in prior 30-day equivalent) |

**Distribution within the recent 30 days:**

- 20 claims from MedSupply Pro LLC (already counted in Pattern 1)
- 27 additional claims from other suppliers (mix of legitimate and suspicious)
- The 27 additional claims should use realistic suppliers from the legitimate list

**Why this works:** Dr. Wilson's baseline is 4-5 claims per month. In month 3 he has 47 claims. The volume spike rule fires. His risk score reaches 90 (volume 25 + cross-NPI 30 + OIG 35 = 90).

---

### Pattern 3 — Geographic Anomaly

**What it demonstrates:** Claims where the patient lives impossibly far from the ordering physician — a classic sign that the physician never actually saw the patient.

**Exact specification:**

| Property | Value |
|---|---|
| Total anomalous claims | 20 |
| Minimum distance | 200 miles |
| Spread across NPIs | At least 5 different NPIs |

**Specific pairs to generate (patient zip vs physician practice zip):**

| # | Physician Practice Zip | Patient Zip | Approx Distance |
|---|---|---|---|
| 1–4 | 94102 (San Francisco, CA) | 33101 (Miami, FL) | 2,580 miles |
| 5–8 | 94102 (San Francisco, CA) | 77001 (Houston, TX) | 1,640 miles |
| 9–11 | 78201 (San Antonio, TX) | 10001 (New York, NY) | 1,700 miles |
| 12–14 | 77001 (Houston, TX) | 60601 (Chicago, IL) | 940 miles |
| 15–17 | 33101 (Miami, FL) | 98101 (Seattle, WA) | 2,730 miles |
| 18–20 | 60601 (Chicago, IL) | 90210 (Beverly Hills, CA) | 1,740 miles |

**Service categories:** Mix of `dme` and `home_health` — these are the categories where geographic fraud is most common.

**Important:** Patient zips must be real US zip codes. The geocoding step will convert them to lat/lng and the haversine calculation must produce distances above 150 miles.

---

### Pattern 4 — OIG Listed Supplier (QuickCare Equipment Inc)

**What it demonstrates:** A supplier on the federal OIG exclusion list — Medicare/Medicaid cannot legally reimburse their claims.

**Exact specification:**

| Property | Value |
|---|---|
| Supplier name | `QuickCare Equipment Inc` |
| Supplier zip | `30301` (Atlanta, GA) |
| OIG flagged | `True` |
| Total claims | 15 |
| Distinct NPIs | 3 (different from the MedSupply Pro NPIs if possible) |
| Service category | `dme` |
| Claim amounts | $250 – $800 (deliberately lower — staying under radar) |
| Date distribution | Spread across all 90 days |

**NPI assignment:** 5 claims each under 3 NPIs that are not Dr. Wilson and are not already carrying the full MedSupply Pro load.

**HCPCS codes:** A4253, A4570, E0100 (lower-value items)

---

### Pattern 5 — New High-Value Supplier (Premier Home Solutions)

**What it demonstrates:** A supplier appearing for the first time under a physician's NPI within the last 30 days with immediately large claim amounts — a shell supplier starting operations.

**Exact specification:**

| Property | Value |
|---|---|
| Supplier name | `Premier Home Solutions` |
| Supplier zip | `85001` (Phoenix, AZ) |
| OIG flagged | `False` |
| Total claims | 22 |
| Distinct NPIs | 2 |
| Service category | `home_health` |
| Claim amounts | $1,800 – $2,400 (deliberately high) |
| Date range | All claims must fall within the last 15 days of the 90-day window |
| Prior history | Zero claims before the last 15 days — this supplier has never appeared before |

**NPI assignment:** 11 claims each under 2 NPIs.

**Note:** The `new_high_value_supplier` rule checks for first appearance within 30 days AND amount > $500. All 22 Premier Home Solutions claims qualify on both counts.

---

### Pattern 6 — Patient ID Reuse

**What it demonstrates:** The same patient identity appearing under multiple physician NPIs with different names and different zip codes — identity fraud or a fabricated patient used by a billing fraud operation.

**Exact specification:**

| Property | Value |
|---|---|
| Shared patient_id | One specific UUID — hardcode it: `"pat-FRAUD-001-REUSE"` |
| Number of claims with this patient_id | 8 |
| Distinct NPIs | 3 different NPIs |
| Patient names used | 3 different names for the same patient_id |
| Patient zips used | 3 different zip codes for the same patient_id |
| Service categories | Mix of dme and drugs |
| Date range | Spread across all 90 days |

**Specific records to generate:**

| Claim # | patient_id | patient_name | patient_zip | NPI | Category |
|---|---|---|---|---|---|
| 1–3 | `pat-FRAUD-001-REUSE` | "Robert Chen" | 94105 | NPI #10 | dme |
| 4–5 | `pat-FRAUD-001-REUSE` | "Roberto Chen" | 90210 | NPI #11 | drugs |
| 6–8 | `pat-FRAUD-001-REUSE` | "R. Chen" | 10001 | NPI #12 | dme |

**Why this matters:** The same patient_id appears with 3 different names and 3 different addresses across 3 different physicians. This suggests a real patient's identity has been stolen and is being used by multiple fraudulent billers.

---

## Part 8 — Legitimate Claims (568 Records)

The remaining 568 claims must look genuinely normal. Rules should NOT fire on these claims.

**Requirements for legitimate claims:**

- Patient zip within 100 miles of physician practice zip (typically same state)
- Supplier has been billing under this NPI for more than 30 days (no new supplier flag)
- Supplier bills under no more than 2 other NPIs in the dataset (no cross-NPI flag)
- Claim amounts within the typical range for the service category
- Volume consistent month over month — no spike
- No OIG-flagged suppliers
- Use the 10 legitimate suppliers from Part 6

**Distribution across NPIs:**

Distribute the 568 legitimate claims across all 15 NPIs to give each physician a realistic claim history. Each NPI should have at minimum 5 legitimate claims outside any fraud pattern.

---

## Part 9 — Date Distribution

The 90-day window ends on the date the script is run (`today`). Dates are distributed as follows:

| Period | Days | Legitimate Claims | Fraud Claims |
|---|---|---|---|
| Oldest 60 days | Day 1–60 | ~380 | ~60 |
| Recent 30 days | Day 61–90 | ~188 | ~172 |

The skew toward recent dates for fraud patterns is intentional — it creates the volume spike effect and makes "new supplier" claims appear in the lookback window.

**Important for Pattern 2 (Volume Spike):**
- Dr. Wilson must have 8-10 total claims in days 1-60
- Dr. Wilson must have 47 total claims in days 61-90
- This ratio drives the volume_spike rule

---

## Part 10 — GPT-4 Generation Strategy

### Why not generate all 800 in one call

GPT-4 has context limits and JSON generation quality degrades for very large arrays. Generate in batches:

| Batch | Contents | Records |
|---|---|---|
| Batch 1 | MedSupply Pro fraud claims | 120 |
| Batch 2 | QuickCare Equipment claims | 15 |
| Batch 3 | Premier Home Solutions claims | 22 |
| Batch 4 | Geographic anomaly claims | 20 |
| Batch 5 | Patient ID reuse claims | 8 |
| Batch 6 | Dr. Wilson legitimate baseline claims | 9 |
| Batch 7 | Dr. Wilson recent volume claims (non-MedSupply) | 27 |
| Batch 8 | Legitimate claims for remaining 14 NPIs | 579 |

Generate the fraud pattern batches with specific prompts that enforce exact requirements. Generate the legitimate batch with a general prompt.

### Prompt Template for Fraud Batches

```python
FRAUD_BATCH_PROMPT = """
Generate exactly {count} realistic Medicare/Medicaid claims as a JSON array.

REQUIREMENTS:
- Return ONLY a valid JSON array. No markdown. No explanation. No preamble.
- Every object must have exactly these fields:
  npi, patient_id, patient_name, patient_zip, patient_state,
  date_of_service, cpt_code, hcpcs_code, service_description,
  service_category, supplier_name, supplier_zip, supplier_state,
  claim_amount, plan_name

SPECIFIC INSTRUCTIONS FOR THIS BATCH:
{batch_specific_instructions}

FIELD CONSTRAINTS:
- date_of_service: ISO format YYYY-MM-DD, between {start_date} and {end_date}
- service_category: must be one of: home_health, hospice, dme, drugs, hospital
- cpt_code: use null if hcpcs_code is present
- hcpcs_code: use null if cpt_code is present
- claim_amount: number with 2 decimal places, no currency symbols
- plan_name: always "ClaimLens Pilot Plan"
- patient_zip: must be a real US 5-digit zip code
- supplier_zip: must be a real US 5-digit zip code

Return ONLY the JSON array. Nothing else.
"""
```

### Batch-Specific Instructions Examples

**For MedSupply Pro batch:**
```
- supplier_name: "MedSupply Pro LLC" for ALL records
- supplier_zip: "10001"
- supplier_state: "NY"
- service_category: "dme" for ALL records
- hcpcs_code: use only these codes: E1050, E1070, K0001, K0005
- claim_amount: between 800.00 and 2200.00
- Distribute across these NPIs with these counts: {npi_distribution}
- patient_zip: use various US zip codes (patients can be anywhere)
```

**For geographic anomaly batch:**
```
Generate {count} claims with these specific patient_zip / NPI pairs:
{pairs_list}
- The patient_zip must be EXACTLY as specified for each pair
- service_category: mix of "dme" and "home_health"
```

### Response Parsing

```python
def parse_gpt4_response(response_text: str) -> list[dict]:
    """
    Parse GPT-4 response. Strip any markdown fences if present.
    Validate each record has all required fields.
    """
    # Strip markdown fences if GPT-4 added them despite instructions
    text = response_text.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    text = text.strip().rstrip("`").strip()

    records = json.loads(text)

    required_fields = {
        "npi", "patient_id", "patient_name", "patient_zip", "patient_state",
        "date_of_service", "cpt_code", "hcpcs_code", "service_description",
        "service_category", "supplier_name", "supplier_zip", "supplier_state",
        "claim_amount", "plan_name"
    }

    validated = []
    for i, record in enumerate(records):
        missing = required_fields - set(record.keys())
        if missing:
            raise ValueError(f"Record {i} missing fields: {missing}")
        validated.append(record)

    return validated
```

---

## Part 11 — Post-Generation Processing

After GPT-4 returns all records, run these steps in sequence before database insert:

### Step 1 — Patient ID Assignment for Pattern 6
```python
# Override patient_id for the 8 reuse claims
for claim in patient_reuse_claims:
    claim["patient_id"] = "pat-FRAUD-001-REUSE"
```

### Step 2 — Supplier Entity Resolution
```python
all_supplier_names = [c["supplier_name"] for c in all_claims]
supplier_id_map = resolve_supplier_entities(all_supplier_names)
for claim in all_claims:
    claim["supplier_id"] = supplier_id_map[claim["supplier_name"]]
```

### Step 3 — Geocoding
```python
import pgeocode
nomi = pgeocode.Nominatim("US")

for claim in all_claims:
    result = nomi.query_postal_code(claim["patient_zip"])
    claim["patient_lat"] = float(result.latitude) if not pd.isna(result.latitude) else None
    claim["patient_lng"] = float(result.longitude) if not pd.isna(result.longitude) else None
```

### Step 4 — OIG LEIE Check
```python
OIG_FLAGGED_SUPPLIERS = {"MedSupply Pro LLC", "QuickCare Equipment Inc"}

for claim in all_claims:
    claim["oig_flagged"] = claim["supplier_name"] in OIG_FLAGGED_SUPPLIERS
```

For the MVP, use the hardcoded set above. In production, use the full fuzzy match against the downloaded LEIE CSV.

### Step 5 — Set Default Fields
```python
from datetime import datetime
import uuid

for claim in all_claims:
    claim["reviewed"]    = False
    claim["id"]          = str(uuid.uuid4())
    claim["ingested_at"] = datetime.utcnow().isoformat()
    claim["created_at"]  = datetime.utcnow().isoformat()
    # Ensure patient_id is set (GPT-4 should have set this, but verify)
    if not claim.get("patient_id"):
        claim["patient_id"] = str(uuid.uuid4())
```

---

## Part 12 — Verification Queries

Run these after loading all data to confirm the fraud patterns are present and correct:

```sql
-- 1. Total record count
SELECT COUNT(*) FROM claims;
-- Expected: 800

-- 2. MedSupply Pro distinct NPIs (Pattern 1)
SELECT COUNT(DISTINCT npi) FROM claims
WHERE supplier_name = 'MedSupply Pro LLC';
-- Expected: 9

-- 3. MedSupply Pro total claims (Pattern 1)
SELECT COUNT(*) FROM claims
WHERE supplier_name = 'MedSupply Pro LLC';
-- Expected: 120

-- 4. Dr. Wilson recent volume (Pattern 2)
SELECT COUNT(*) FROM claims
WHERE npi = '1234567890'
AND date_of_service >= CURRENT_DATE - INTERVAL '30 days';
-- Expected: >= 40

-- 5. Dr. Wilson baseline volume (Pattern 2)
SELECT COUNT(*) FROM claims
WHERE npi = '1234567890'
AND date_of_service < CURRENT_DATE - INTERVAL '30 days';
-- Expected: 8-15

-- 6. Geographic anomaly candidates (Pattern 3)
-- These will be verified after geocoding and rules engine runs
SELECT COUNT(*) FROM claims
WHERE patient_state != (
    SELECT practice_state FROM npi_profiles
    WHERE npi_profiles.npi = claims.npi
);
-- Expected: >= 20

-- 7. OIG flagged claims (Patterns 1 + 4)
SELECT supplier_name, COUNT(*) FROM claims
WHERE oig_flagged = true
GROUP BY supplier_name;
-- Expected: MedSupply Pro LLC: 120, QuickCare Equipment Inc: 15

-- 8. Premier Home Solutions in last 15 days (Pattern 5)
SELECT COUNT(*) FROM claims
WHERE supplier_name = 'Premier Home Solutions'
AND date_of_service >= CURRENT_DATE - INTERVAL '15 days';
-- Expected: 22

-- 9. Patient ID reuse (Pattern 6)
SELECT patient_id, COUNT(DISTINCT patient_name), COUNT(DISTINCT patient_zip)
FROM claims
WHERE patient_id = 'pat-FRAUD-001-REUSE'
GROUP BY patient_id;
-- Expected: 1 row, 3 distinct names, 3 distinct zips

-- 10. NPI profile count
SELECT COUNT(*) FROM npi_profiles;
-- Expected: 15

-- 11. Dr. Wilson in npi_profiles
SELECT * FROM npi_profiles WHERE npi = '1234567890';
-- Expected: 1 row, practice_zip = '94102', practice_lat ~37.78
```

If any query fails its expected result, the synthetic data generation has a defect. Fix the generation script and re-run before proceeding to the rules engine.
