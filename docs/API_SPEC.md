# API_SPEC — API Specification
## ClaimLens — NPI Intelligence Platform

---

## Document Purpose

This document is the contract between the FastAPI backend and the Next.js frontend. Every endpoint is fully specified — method, path, query parameters, request body, response shape, error responses, and notes. The frontend developer builds against this document. No endpoint may be called that is not defined here. No response field may be assumed that is not listed here.

**Base URL — Development:** `http://localhost:8000`
**Base URL — Production:** `https://your-domain.com/api`

**Content-Type:** All request bodies and responses are `application/json` unless noted.
**SSE endpoint:** `text/event-stream`

---

## Authentication

**MVP:** No authentication. All endpoints are open. Demo users are hardcoded in the frontend.

**Phase 1+:** Bearer token in Authorization header. `Authorization: Bearer <jwt_token>`

---

## Standard Error Response

All error responses follow this shape:

```json
{
  "error": "Human readable message",
  "code": "MACHINE_READABLE_CODE"
}
```

| Code | HTTP | Meaning |
|---|---|---|
| `NPI_NOT_FOUND` | 404 | NPI does not exist |
| `CLAIM_NOT_FOUND` | 404 | claim_id does not exist |
| `INVALID_ACTION_TYPE` | 422 | action_type not in allowed enum |
| `INVALID_NPI_FORMAT` | 422 | NPI is not exactly 10 digits |
| `INVALID_UUID` | 422 | claim_id is not valid UUID |
| `DB_ERROR` | 503 | Database write failed |
| `DB_UNAVAILABLE` | 503 | Cannot connect to database |
| `INTERNAL_ERROR` | 500 | Unhandled exception |

---

## Endpoints

---

### `GET /health`

Health check. Call before every demo to verify the server is running and the database is connected.

**Request:** No parameters.

**Response `200 OK`:**
```json
{
  "status": "ok",
  "database": "connected",
  "total_claims": 800,
  "total_flags": 187,
  "timestamp": "2024-11-15T14:32:01.000Z"
}
```

**Response `503 Service Unavailable`:**
```json
{
  "error": "Database unavailable",
  "code": "DB_UNAVAILABLE"
}
```

**Notes:**
- `total_claims` is a COUNT of the claims table
- `total_flags` is a COUNT of the rules_flags table
- If database is unreachable, returns 503 — do not proceed with demo

---

### `GET /physician/{npi}/summary`

Summary card data for the physician dashboard header. Returns counts and totals for the logged-in physician's NPI.

**Path parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `npi` | string | Yes | 10-digit physician NPI |

**Request:** No body. No query parameters.

**Response `200 OK`:**
```json
{
  "physician_name": "Dr. James Wilson",
  "npi": "1234567890",
  "specialty": "Internal Medicine",
  "practice_state": "CA",
  "practice_city": "San Francisco",
  "total_claims_month": 47,
  "unreviewed_count": 43,
  "unknown_supplier_count": 1,
  "total_amount_month": 94230.00
}
```

**Response fields:**

| Field | Type | Description |
|---|---|---|
| `physician_name` | string | Full name from npi_profiles |
| `npi` | string | NPI number |
| `specialty` | string \| null | Medical specialty |
| `practice_state` | string \| null | 2-letter state code |
| `practice_city` | string \| null | Practice city |
| `total_claims_month` | integer | Claims with date_of_service in current calendar month |
| `unreviewed_count` | integer | Claims with reviewed = false for this NPI |
| `unknown_supplier_count` | integer | Distinct suppliers flagged by this physician (flag_supplier or unknown_patient actions) |
| `total_amount_month` | decimal | Sum of claim_amount for current month |

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 404 | `NPI_NOT_FOUND` | NPI not in npi_profiles |
| 422 | `INVALID_NPI_FORMAT` | NPI is not 10 digits |

---

### `GET /physician/{npi}/claims`

Paginated claims list for the physician dashboard table. Includes rules flags per claim.

**Path parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `npi` | string | Yes | 10-digit physician NPI |

**Query parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `page` | integer | No | 0 | Zero-indexed page number |
| `page_size` | integer | No | 50 | Records per page. Max: 100 |
| `category` | string | No | null | Filter by service_category. One of: home_health, hospice, dme, drugs, hospital |
| `date_from` | string (ISO date) | No | null | Filter claims on or after this date. Format: YYYY-MM-DD |
| `date_to` | string (ISO date) | No | null | Filter claims on or before this date. Format: YYYY-MM-DD |
| `reviewed` | boolean | No | null | Filter by reviewed status. true = reviewed only, false = unreviewed only, null = all |
| `supplier_search` | string | No | null | Partial match on supplier_name. Case-insensitive |

**Response `200 OK`:**
```json
{
  "items": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "patient_name": "Margaret Johnson",
      "patient_zip": "90210",
      "date_of_service": "2024-11-15",
      "cpt_code": null,
      "hcpcs_code": "E1050",
      "service_description": "Standard manual wheelchair",
      "service_category": "dme",
      "supplier_name": "MedSupply Pro LLC",
      "supplier_id": "SUP-a1b2c3d4e5f6",
      "claim_amount": 1850.00,
      "oig_flagged": true,
      "reviewed": false,
      "flags": ["cross_npi_supplier", "oig_leie_hit"],
      "severities": ["critical", "critical"],
      "flag_descriptions": [
        "Supplier 'MedSupply Pro LLC' is billing under 9 distinct physician NPIs (threshold: 3)",
        "Supplier 'MedSupply Pro LLC' appears on the OIG LEIE exclusion list"
      ]
    }
  ],
  "total": 47,
  "page": 0,
  "page_size": 50,
  "total_pages": 1
}
```

**Response fields — items array:**

| Field | Type | Description |
|---|---|---|
| `id` | UUID string | Claim primary key |
| `patient_name` | string | Patient full name |
| `patient_zip` | string | Patient zip code |
| `date_of_service` | string (ISO date) | Date service was rendered |
| `cpt_code` | string \| null | CPT code if applicable |
| `hcpcs_code` | string \| null | HCPCS code if applicable |
| `service_description` | string | Plain English service description |
| `service_category` | string | One of: home_health, hospice, dme, drugs, hospital |
| `supplier_name` | string | Name of submitting supplier |
| `supplier_id` | string | Internal supplier entity ID |
| `claim_amount` | decimal | Dollar amount |
| `oig_flagged` | boolean | True if supplier is on OIG exclusion list |
| `reviewed` | boolean | True if physician has taken any action |
| `flags` | string[] | List of rule_name values for rules that fired on this claim |
| `severities` | string[] | Parallel array of severity values — same order as flags |
| `flag_descriptions` | string[] | Parallel array of human-readable flag descriptions |

**Response fields — pagination:**

| Field | Type | Description |
|---|---|---|
| `total` | integer | Total matching claims before pagination |
| `page` | integer | Current page (zero-indexed) |
| `page_size` | integer | Records per page |
| `total_pages` | integer | Total number of pages |

**Sort order:** Unreviewed claims first (reviewed = false), then by date_of_service descending.

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 404 | `NPI_NOT_FOUND` | NPI not in npi_profiles |
| 422 | `INVALID_NPI_FORMAT` | NPI is not 10 digits |
| 422 | Pydantic validation | Invalid category, date format, or page values |

---

### `GET /physician/{npi}/flagged-suppliers`

List of all suppliers this physician has flagged. Used for the Flagged Suppliers page.

**Path parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `npi` | string | Yes | 10-digit physician NPI |

**Response `200 OK`:**
```json
{
  "items": [
    {
      "supplier_id": "SUP-a1b2c3d4e5f6",
      "supplier_name": "MedSupply Pro LLC",
      "claim_count": 8,
      "total_amount": 14800.00,
      "first_flagged_at": "2024-11-15T14:32:01.000Z",
      "flag_count": 3,
      "oig_flagged": true
    }
  ]
}
```

**Response fields:**

| Field | Type | Description |
|---|---|---|
| `supplier_id` | string | Internal supplier entity ID |
| `supplier_name` | string | Supplier name |
| `claim_count` | integer | Number of claims from this supplier under this NPI |
| `total_amount` | decimal | Total dollar value of those claims |
| `first_flagged_at` | ISO datetime string | Timestamp of this physician's first flag on this supplier |
| `flag_count` | integer | Number of times this physician has flagged this supplier |
| `oig_flagged` | boolean | Whether this supplier is OIG excluded |

**Sort:** By first_flagged_at descending.

---

### `POST /actions`

Record a physician action on a claim. Triggers SSE broadcast for flag_supplier and unknown_patient action types.

**Request body:**
```json
{
  "claim_id": "550e8400-e29b-41d4-a716-446655440000",
  "npi": "1234567890",
  "action_type": "flag_supplier",
  "note": null
}
```

**Request fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `claim_id` | UUID string | Yes | ID of the claim being actioned |
| `npi` | string | Yes | NPI of the physician taking the action |
| `action_type` | string | Yes | One of: confirm, dispute, flag_supplier, unknown_patient |
| `note` | string \| null | No | Optional free-text note. Max 1000 characters |

**Response `201 Created`:**
```json
{
  "id": "660e8400-e29b-41d4-a716-446655441111",
  "action_type": "flag_supplier",
  "created_at": "2024-11-15T14:32:01.000Z"
}
```

**Side effects:**
- `claims.reviewed` is set to `true` for the actioned claim
- For `flag_supplier` and `unknown_patient`: SSE event broadcast to all connected plan dashboard clients
- For `flag_supplier` and `unknown_patient`: supplier's `physician_flag_count` in `npi_risk_scores` increments by 1 and risk_score is recalculated

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 404 | `CLAIM_NOT_FOUND` | claim_id not in claims table |
| 422 | `INVALID_ACTION_TYPE` | action_type not in allowed enum |
| 422 | `INVALID_NPI_FORMAT` | NPI is not 10 digits |
| 422 | `INVALID_UUID` | claim_id is not valid UUID format |
| 503 | `DB_ERROR` | Transaction failed — action not recorded |

**Notes:**
- A physician may action the same claim multiple times. Each action creates a new row in the actions table. The claim remains reviewed = true.
- Only the most recent action per claim is displayed in the physician dashboard, but all actions are stored.
- POST /actions is the only endpoint that triggers an SSE event.

---

### `GET /plan/summary`

Four summary counts for the plan dashboard home cards.

**Request:** No parameters.

**Response `200 OK`:**
```json
{
  "total_npis": 15,
  "high_risk_npis": 3,
  "band_counts": { "critical": 3, "high": 1, "medium": 5, "low": 6 },
  "alerts_today": 4,
  "total_physician_flags": 7
}
```

**Response fields:**

| Field | Type | Description |
|---|---|---|
| `total_npis` | integer | COUNT of npi_risk_scores WHERE entity_type = 'npi' |
| `high_risk_npis` | integer | COUNT WHERE entity_type = 'npi' AND risk_score >= 81 — i.e. the critical band, the same cut the NPI leaderboard's "High-risk NPIs" tile uses |
| `band_counts` | object | Count per risk band: `critical`, `high`, `medium`, `low`. Sums to `total_npis`. Prefer this over deriving unions from `high_risk_npis` |
| `alerts_today` | integer | COUNT of actions WHERE action_type IN ('flag_supplier','unknown_patient') AND created_at >= today 00:00:00 |
| `total_physician_flags` | integer | COUNT of all actions WHERE action_type IN ('flag_supplier','unknown_patient') |

---

### `GET /plan/npi-risk-list`

NPI risk leaderboard. All NPIs sorted by risk score descending.

**Query parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `page` | integer | No | 0 | Zero-indexed page number |
| `page_size` | integer | No | 50 | Max: 100 |
| `min_score` | integer | No | 0 | Filter NPIs with risk_score >= this value |
| `state` | string | No | null | Filter by practice_state (2-letter code) |
| `specialty` | string | No | null | Partial match on specialty |

**Response `200 OK`:**
```json
{
  "items": [
    {
      "npi": "1234567890",
      "physician_name": "Dr. James Wilson",
      "specialty": "Internal Medicine",
      "practice_state": "CA",
      "practice_city": "San Francisco",
      "risk_score": 85,
      "risk_band": "high",
      "total_claim_count": 57,
      "total_claim_amount": 114200.00,
      "physician_flag_count": 2,
      "top_supplier_name": "MedSupply Pro LLC",
      "volume_flag": true,
      "geo_flag": false,
      "cross_npi_flag": true,
      "oig_flag": true,
      "new_supplier_flag": false
    }
  ],
  "total": 15,
  "page": 0,
  "page_size": 50,
  "total_pages": 1
}
```

**Response fields — items:**

| Field | Type | Description |
|---|---|---|
| `npi` | string | Physician NPI |
| `physician_name` | string | Full name |
| `specialty` | string \| null | Medical specialty |
| `practice_state` | string \| null | 2-letter state |
| `practice_city` | string \| null | Practice city |
| `risk_score` | integer | 0-100 composite risk score |
| `risk_band` | string | One of `critical` (81-100), `high` (61-80), `medium` (31-60), `low` (0-30). Defined once in `backend/schemas.py` (`RISK_BAND_BOUNDS` / `get_risk_band`); the frontend mirror is `frontend/src/lib/risk.js` |
| `total_claim_count` | integer | Total claims under this NPI |
| `total_claim_amount` | decimal | Total dollar value |
| `physician_flag_count` | integer | Number of flag_supplier/unknown_patient actions by this physician |
| `top_supplier_name` | string \| null | Most frequent supplier billing under this NPI |
| `volume_flag` | boolean | Volume spike rule fired |
| `geo_flag` | boolean | Geographic anomaly rule fired |
| `cross_npi_flag` | boolean | Cross-NPI supplier rule fired |
| `oig_flag` | boolean | OIG LEIE hit rule fired |
| `new_supplier_flag` | boolean | New high-value supplier rule fired |

**Sort:** risk_score descending. Ties broken by physician_flag_count descending.

---

### `GET /plan/npi/{npi}/detail`

Full drill-down for one NPI. Returns claim history, rules flags, and physician actions.

**Path parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `npi` | string | Yes | 10-digit physician NPI |

**Query parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `claims_page` | integer | No | 0 | Page for claims list |
| `claims_page_size` | integer | No | 50 | Page size for claims list |

**Response `200 OK`:**
```json
{
  "profile": {
    "npi": "1234567890",
    "physician_name": "Dr. James Wilson",
    "specialty": "Internal Medicine",
    "practice_city": "San Francisco",
    "practice_state": "CA",
    "practice_zip": "94102"
  },
  "score": {
    "risk_score": 85,
    "risk_band": "high",
    "volume_flag": true,
    "geo_flag": false,
    "cross_npi_flag": true,
    "oig_flag": true,
    "new_supplier_flag": false,
    "physician_flag_count": 2,
    "score_breakdown": [
      { "factor": "Volume spike", "points": 25 },
      { "factor": "Cross-NPI supplier", "points": 30 },
      { "factor": "OIG LEIE hit", "points": 35 },
      { "factor": "Physician flags (2 × 5)", "points": 10 }
    ],
    "last_calculated": "2024-11-15T14:00:00.000Z"
  },
  "claims": {
    "items": [ /* same shape as GET /physician/{npi}/claims items */ ],
    "total": 57,
    "page": 0,
    "page_size": 50,
    "total_pages": 2
  },
  "physician_actions": [
    {
      "id": "uuid",
      "action_type": "flag_supplier",
      "supplier_name": "MedSupply Pro LLC",
      "patient_name": "Margaret Johnson",
      "claim_amount": 1850.00,
      "created_at": "2024-11-15T14:32:01.000Z"
    }
  ]
}
```

**Notes:**
- `score_breakdown` only includes factors that contributed > 0 points
- `physician_actions` returns all actions for this NPI, most recent first, no pagination (reasonable volume)
- Claims in the detail page have the same shape as the physician claims endpoint but visible to plan investigators without NPI restriction

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| 404 | `NPI_NOT_FOUND` | NPI not found |
| 422 | `INVALID_NPI_FORMAT` | NPI is not 10 digits |

---

### `GET /plan/suppliers`

Supplier watchlist. All suppliers sorted by physician flag count then risk score.

**Query parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `page` | integer | No | 0 | Zero-indexed page number |
| `page_size` | integer | No | 50 | Max: 100 |
| `oig_only` | boolean | No | false | If true, return only OIG-flagged suppliers |
| `min_flags` | integer | No | 0 | Filter suppliers with physician_flag_count >= this value |

**Response `200 OK`:**
```json
{
  "items": [
    {
      "supplier_id": "SUP-a1b2c3d4e5f6",
      "supplier_name": "MedSupply Pro LLC",
      "oig_flag": true,
      "distinct_npi_count": 9,
      "physician_flag_count": 5,
      "total_claim_count": 120,
      "total_claim_amount": 180000.00,
      "risk_score": 95,
      "risk_band": "high"
    }
  ],
  "total": 12,
  "page": 0,
  "page_size": 50,
  "total_pages": 1
}
```

**Response fields — items:**

| Field | Type | Description |
|---|---|---|
| `supplier_id` | string | Internal supplier entity ID |
| `supplier_name` | string | Supplier name |
| `oig_flag` | boolean | True if on OIG exclusion list |
| `distinct_npi_count` | integer | Number of distinct physician NPIs this supplier bills under |
| `physician_flag_count` | integer | Total physician flags against this supplier across all NPIs |
| `total_claim_count` | integer | Total claims submitted by this supplier |
| `total_claim_amount` | decimal | Total dollar value |
| `risk_score` | integer | 0-100 supplier risk score |
| `risk_band` | string | "high", "medium", or "low" |

**Sort:** physician_flag_count descending, then risk_score descending.

---

### `GET /plan/alerts/stream`

SSE endpoint. Streams real-time physician flag alerts to connected plan dashboard clients. This endpoint does not return JSON — it returns a continuous event stream.

**Request headers required:**
```
Accept: text/event-stream
Cache-Control: no-cache
```

**Response:** `200 OK` with `Content-Type: text/event-stream`

**Stream behavior:**
1. On connect: replays all unbroadcast actions (flag_supplier, unknown_patient) from the database in chronological order
2. After replay: holds connection open
3. When a physician flags a claim: pushes a new event within 1 second
4. Every 15 seconds: sends a keep-alive comment to prevent proxy timeout

**Event format:**
```
data: {"id":"uuid","action_type":"flag_supplier","physician_name":"Dr. James Wilson","npi":"1234567890","supplier_name":"MedSupply Pro LLC","patient_name":"Margaret Johnson","claim_amount":1850.00,"timestamp":"2024-11-15T14:32:01.000Z"}

```

**Note:** Two newlines (`\n\n`) terminate each event. This is the SSE protocol. The `data:` prefix is required.

**Keep-alive format:**
```
: keep-alive

```

**Event fields:**

| Field | Type | Description |
|---|---|---|
| `id` | UUID string | Action ID — used for reconnection recovery |
| `action_type` | string | flag_supplier or unknown_patient |
| `physician_name` | string | Full name of the flagging physician |
| `npi` | string | Physician NPI |
| `supplier_name` | string | Name of the flagged supplier |
| `patient_name` | string | Patient name on the flagged claim |
| `claim_amount` | decimal | Claim dollar amount |
| `timestamp` | ISO datetime string | When the action was recorded |

**Reconnection:** Browser automatically reconnects on drop. Include `Last-Event-ID` header with the last received action ID to trigger missed event replay.

**Nginx configuration required:**
```nginx
location /plan/alerts/stream {
    proxy_pass http://127.0.0.1:8000;
    proxy_buffering off;
    proxy_cache off;
    proxy_set_header Connection '';
    proxy_http_version 1.1;
    chunked_transfer_encoding on;
}
```

**Notes:**
- Only `flag_supplier` and `unknown_patient` action types generate SSE events
- `confirm` and `dispute` do NOT appear in the stream
- The stream sends ALL unbroadcast events on connect regardless of age
- This endpoint is never called by the physician dashboard — physician side only calls POST /actions

---

## Endpoint Summary Table

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | None | Health check |
| GET | `/physician/{npi}/summary` | None (MVP) | Physician summary card data |
| GET | `/physician/{npi}/claims` | None (MVP) | Physician claims table |
| GET | `/physician/{npi}/flagged-suppliers` | None (MVP) | Physician flagged suppliers list |
| POST | `/actions` | None (MVP) | Record physician action + trigger SSE |
| GET | `/plan/summary` | None (MVP) | Plan dashboard summary counts |
| GET | `/plan/npi-risk-list` | None (MVP) | NPI risk leaderboard |
| GET | `/plan/npi/{npi}/detail` | None (MVP) | NPI full drill-down |
| GET | `/plan/suppliers` | None (MVP) | Supplier watchlist |
| GET | `/plan/alerts/stream` | None (MVP) | SSE real-time alert stream |

**Total endpoints: 10**

---

## Frontend Integration Notes

### Calling the SSE endpoint from Next.js

```typescript
// frontend/lib/api.ts

export function connectAlertStream(
  onAlert: (event: AlertEvent) => void,
  onError?: (error: Event) => void
): EventSource {
  const source = new EventSource(`${API_BASE_URL}/plan/alerts/stream`);

  source.onmessage = (event) => {
    if (event.data === ': keep-alive') return;
    try {
      const alert = JSON.parse(event.data) as AlertEvent;
      onAlert(alert);
    } catch (e) {
      console.error('Failed to parse SSE event:', e);
    }
  };

  source.onerror = (error) => {
    onError?.(error);
    // Browser automatically reconnects — no manual retry needed
  };

  return source;
}

// Usage in React component:
useEffect(() => {
  const source = connectAlertStream((alert) => {
    setAlerts(prev => [alert, ...prev]);
  });
  return () => source.close(); // cleanup on unmount
}, []);
```

### Decimal handling

All `claim_amount` and `total_amount` fields are returned as JSON numbers (not strings). Use `toFixed(2)` for display. Do not do arithmetic on these values client-side — they are display-only.

### Date handling

All dates are returned as ISO strings (`YYYY-MM-DD` for dates, full ISO 8601 for datetimes). Parse with `new Date(dateString)` for display formatting.

### Pagination

The frontend must implement pagination controls for:
- `GET /physician/{npi}/claims` — physician claims table
- `GET /plan/npi-risk-list` — NPI leaderboard
- `GET /plan/npi/{npi}/detail` (claims section)
- `GET /plan/suppliers` — supplier watchlist

Use `page` (zero-indexed) and `page_size` query parameters. Display `total` and `total_pages` from response for pagination controls.

### Error handling pattern

```typescript
// frontend/lib/api.ts

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, options);

  if (!res.ok) {
    const error = await res.json();
    throw new ApiError(error.code, error.error, res.status);
  }

  return res.json() as T;
}

class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number
  ) {
    super(message);
  }
}
```
