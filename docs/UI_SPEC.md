# UI_SPEC — User Interface Specification
## ClaimLens — NPI Intelligence Platform

---

## Document Purpose

This document is the complete specification for the ClaimLens frontend. It defines every screen, every component, every piece of data displayed, every user action, and every state (loading, empty, error, success). The frontend developer builds directly from this document. No screen may be built that is not defined here. No API call may be made that is not in API_SPEC.md.

---

## Tech Stack

| Technology | Purpose |
|---|---|
| Next.js 14 (App Router) | Framework — file-based routing |
| Tailwind CSS | Styling — utility classes only |
| TypeScript | Type safety |
| EventSource API | SSE connection for live alerts |

**No additional component libraries.** Build all components from scratch with Tailwind. This keeps the bundle small and the design fully controlled.

---

## Design Tokens

Use these values consistently across all components. Do not use arbitrary colors or sizes.

### Colors

```css
/* Primary */
--navy:       #1B3A5C   /* headings, primary text */
--teal:       #0E7490   /* primary accent, active states, links */
--teal-light: #E0F2FE   /* light background for teal sections */

/* Status */
--red:        #991B1B   /* critical risk, errors, OIG badge */
--red-light:  #FEE2E2   /* critical row background */
--amber:      #92400E   /* medium risk */
--amber-light:#FEF3C7   /* medium row background */
--green:      #065F46   /* low risk, success, confirm action */
--green-light:#D1FAE5   /* success states */

/* Neutral */
--white:      #FFFFFF
--off-white:  #F8FAFC   /* page background */
--lt-gray:    #F1F5F9   /* alternate table rows */
--border:     #E2E8F0   /* all borders */
--muted:      #64748B   /* secondary text */
--dark:       #1E293B   /* primary text on white */

/* Action buttons */
--confirm:    #065F46   /* green — confirm button */
--dispute:    #991B1B   /* red — dispute button */
--flag:       #EA6C00   /* orange — flag supplier button */
--unknown:    #92400E   /* amber — unknown patient button */
```

### Typography

```css
font-family: 'Inter', system-ui, sans-serif;

/* Sizes */
--text-xs:   0.75rem   /* 12px — labels, badges */
--text-sm:   0.875rem  /* 14px — table cells, secondary */
--text-base: 1rem      /* 16px — body */
--text-lg:   1.125rem  /* 18px — section headers */
--text-xl:   1.25rem   /* 20px — page titles */
--text-2xl:  1.5rem    /* 24px — main headings */
```

### Spacing

Use Tailwind spacing scale. Key values:
- Page horizontal padding: `px-6` (24px)
- Section gaps: `gap-4` (16px) or `gap-6` (24px)
- Card padding: `p-4` (16px) or `p-6` (24px)

---

## Layout — Root Structure

### File: `app/layout.tsx`

The root layout renders on every page. Contains:

1. **Top navigation bar** — always visible
2. **Demo user switcher** — always visible in top-right
3. **Page content slot** — changes per route

### Top Navigation Bar

```
┌────────────────────────────────────────────────────────────────┐
│  🔷 ClaimLens          [Nav links]           [User switcher]   │
└────────────────────────────────────────────────────────────────┘
```

**Height:** 56px
**Background:** white, with 1px bottom border in `--border`
**Logo:** "ClaimLens" in `--navy`, bold, 18px, with a small teal square icon

**Nav links — Physician view:**
- My Claims (links to `/physician`)
- Flagged Suppliers (links to `/physician/flagged-suppliers`)

**Nav links — Plan view:**
- Risk Leaderboard (links to `/plan`)
- Supplier Watchlist (links to `/plan/suppliers`)
- Live Alerts (links to `/plan/alerts`)

Nav links switch based on the active demo user. Show only the relevant links for the current user.

**Active link:** `--teal` color, 2px bottom border in `--teal`

### Demo User Switcher

Position: top-right of navigation bar.

```
┌────────────────────────────────────┐
│  👤  Dr. James Wilson (Physician)  ▼│
└────────────────────────────────────┘
```

**Behavior:**
- Clicking opens a dropdown with two options
- Option 1: "Dr. James Wilson (Physician)" — navigates to `/physician`
- Option 2: "Plan Investigator" — navigates to `/plan`
- Currently selected option shown with a teal check mark
- Dropdown closes on selection or click-outside

**States:**
- Physician selected: shows physician avatar icon + name
- Plan selected: shows shield icon + "Plan Investigator"

---

## Page 1 — Physician Dashboard

### Route: `/physician`
### API calls: `GET /physician/1234567890/summary`, `GET /physician/1234567890/claims`

---

### Section 1.1 — Summary Card

Position: top of page, full width.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Dr. James Wilson                                                     │
│  NPI: 1234567890  ·  Internal Medicine  ·  San Francisco, CA         │
│                                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐  │
│  │ 47          │  │ 43          │  │ 1  ⚠️        │  │ $94,230    │  │
│  │ Claims      │  │ Unreviewed  │  │ Unknown      │  │ This Month │  │
│  │ This Month  │  │             │  │ Suppliers    │  │            │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

**Physician name:** 24px, bold, `--navy`
**Sub-line:** NPI · Specialty · City, State — 14px, `--muted`

**Stat cards:**
- White background, 1px `--border`, subtle shadow
- Number: 28px, bold, `--navy`
- Label: 12px, `--muted`
- Unknown Suppliers card: number in `--red` when > 0, with a ⚠️ icon

**Loading state:** Show skeleton placeholders — gray pulsing rectangles in place of numbers.

**Error state:** Show "Unable to load summary. Please refresh." in `--muted`.

---

### Section 1.2 — Filter Bar

Position: below summary card, above claims table.

```
┌─────────────────────────────────────────────────────────────────────┐
│  [Category ▼]  [Date From]  [Date To]  [🔍 Search supplier...]      │
│                                            [All ●] [Unreviewed ○]   │
└─────────────────────────────────────────────────────────────────────┘
```

**Category dropdown:**
- Options: All Categories, Home Health, Hospice, DME, Drugs, Hospital
- Default: All Categories
- Maps to `category` query param

**Date range:**
- Two date inputs: "From" and "To"
- Format display: MM/DD/YYYY
- Maps to `date_from` and `date_to` query params (sent as YYYY-MM-DD)

**Supplier search:**
- Text input with search icon
- Placeholder: "Search supplier name..."
- Debounced 300ms before triggering API call
- Maps to `supplier_search` query param

**Reviewed toggle:**
- Two-option radio: "All" | "Unreviewed"
- Default: "Unreviewed" (shows reviewed=false claims first by default)
- Maps to `reviewed` query param

**Behavior:**
- Changing any filter re-fetches claims from page 0
- Active filters shown with a teal highlight on the filter control
- "Clear all filters" link appears when any filter is active

---

### Section 1.3 — Claims Table

Position: main content area. Takes remaining page height.

**Table columns:**

| Column | Width | Content |
|---|---|---|
| Date | 100px | date_of_service formatted as MM/DD/YYYY |
| Patient | 160px | patient_name |
| Service | auto | service_description (truncate at 40 chars with tooltip) |
| Code | 90px | cpt_code or hcpcs_code |
| Category | 110px | Colored chip (see below) |
| Supplier | 180px | supplier_name |
| Amount | 90px | claim_amount formatted as $X,XXX.XX |
| Flags | 90px | Flag badges (see below) |
| Actions | 200px | Four action buttons |

**Category chips:**

| Category | Background | Text |
|---|---|---|
| home_health | `#E0F2FE` | `#0E7490` — "Home Health" |
| hospice | `#EDE9FE` | `#5B21B6` — "Hospice" |
| dme | `#DBEAFE` | `#1E40AF` — "DME" |
| drugs | `#FEF3C7` | `#92400E` — "Drugs" |
| hospital | `#F1F5F9` | `#475569` — "Hospital" |

Chip styling: `rounded-full px-2 py-0.5 text-xs font-medium`

**Flag badges:**

Show up to 2 badges per claim. If more than 2 flags, show "+N more" badge.

| Severity | Background | Text |
|---|---|---|
| critical | `#FEE2E2` | `#991B1B` — rule_name shortened |
| high | `#FFEDD5` | `#C2410C` |
| medium | `#FEF3C7` | `#92400E` |
| low | `#F1F5F9` | `#475569` |

Badge text: use shortened rule names:
- `volume_spike` → "Vol. Spike"
- `geographic_anomaly` → "Geo. Flag"
- `cross_npi_supplier` → "Cross-NPI"
- `new_high_value_supplier` → "New Supplier"
- `oig_leie_hit` → "OIG Hit"

Hovering over a badge shows the full `rule_description` as a tooltip.

**Action buttons:**

Four buttons per row, compact:

```
[✓ Confirm]  [✗ Dispute]  [⚑ Flag]  [? Unknown]
```

| Button | Color | Action type |
|---|---|---|
| ✓ Confirm | `--confirm` (green) | confirm |
| ✗ Dispute | `--dispute` (red) | dispute |
| ⚑ Flag Supplier | `--flag` (orange) | flag_supplier |
| ? Unknown Patient | `--unknown` (amber) | unknown_patient |

Button styling: `text-xs px-2 py-1 rounded font-medium` with matching background at 10% opacity, text in full color.

**Button states:**
- Default: outlined style (border + text, no fill)
- Hover: filled background at 10% opacity
- Loading: show spinner, disable all 4 buttons on this row
- Success: brief green flash, then row grays out
- After any action: all 4 buttons replaced with a gray "Reviewed" badge

**Row states:**
- Unreviewed: white background
- Reviewed: `#F8FAFC` background, slightly muted text
- OIG flagged: subtle left border in `--red` (3px)

**Row sort:**
- Default: unreviewed first, then by date_of_service DESC
- Reviewed rows appear below all unreviewed rows regardless of date

**Empty state:**
```
[Inbox icon]
No claims match your filters.
Try adjusting the date range or category.
[Clear filters]
```

**Loading state:** Show 10 skeleton rows — gray pulsing rectangles.

---

### Section 1.4 — Pagination

Position: below claims table.

```
                    ← Prev   Page 1 of 2   Next →
                  Showing 1–50 of 57 claims
```

- Previous/Next buttons — disabled when at first/last page
- Current page indicator
- Total count display
- Jump to page: not needed for MVP

---

## Page 2 — Flagged Suppliers

### Route: `/physician/flagged-suppliers`
### API calls: `GET /physician/1234567890/flagged-suppliers`

---

```
┌────────────────────────────────────────────────────────────────┐
│  Flagged Suppliers                                              │
│  Suppliers you have reported as unknown or suspicious           │
├────────────────────────────────────────────────────────────────┤
│  Supplier Name      Claims  Amount      First Flagged  OIG     │
├────────────────────────────────────────────────────────────────┤
│  MedSupply Pro LLC    8    $14,800    Nov 15, 2024    🔴 OIG   │
└────────────────────────────────────────────────────────────────┘
```

**Table columns:**

| Column | Content |
|---|---|
| Supplier Name | supplier_name |
| Claims | claim_count |
| Amount | total_amount formatted as $X,XXX.XX |
| First Flagged | first_flagged_at formatted as MMM DD, YYYY |
| Flag Count | flag_count |
| OIG | Red "OIG EXCLUDED" badge if oig_flagged = true |

**OIG badge:** `bg-red-100 text-red-800 text-xs font-medium px-2 py-0.5 rounded`

**Empty state:**
```
[Flag icon]
No suppliers flagged yet.
Use the Flag Supplier button on any claim to report
an unfamiliar supplier.
```

---

## Page 3 — Plan Dashboard — NPI Risk Leaderboard

### Route: `/plan`
### API calls: `GET /plan/summary`, `GET /plan/npi-risk-list`

---

### Section 3.1 — Summary Cards

Four cards in a horizontal row:

```
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│      15      │ │      3       │ │      4       │ │      7       │
│  NPIs        │ │  High Risk   │ │  Alerts      │ │  Total       │
│  Monitored   │ │  (Score >70) │ │  Today       │ │  Physician   │
│              │ │              │ │              │ │  Flags       │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

**Card styling:** White background, 1px border, shadow-sm, p-6
**Number:** 36px, bold, `--navy`
**Label:** 14px, `--muted`
**High Risk card:** number in `--red` when > 0
**Alerts Today card:** number in `--orange` when > 0

---

### Section 3.2 — Filters

```
┌──────────────────────────────────────────────────────────────────┐
│  [State ▼]  [Specialty ▼]  [Min Score: ___]  [🔍 Search NPI...] │
└──────────────────────────────────────────────────────────────────┘
```

Maps to `state`, `specialty`, `min_score` query params on the API.

---

### Section 3.3 — NPI Risk Leaderboard Table

**Table columns:**

| Column | Width | Content |
|---|---|---|
| Physician | 200px | physician_name |
| NPI | 110px | npi (monospace font) |
| Specialty | 150px | specialty |
| State | 60px | practice_state |
| Risk Score | 100px | Colored score display |
| Claims | 80px | total_claim_count |
| Amount | 110px | total_claim_amount |
| Flags | 80px | physician_flag_count |
| Top Supplier | 180px | top_supplier_name |
| Rules | 120px | Rule flag icons |

**Risk Score Display:**

```
[  85  ]
  HIGH
```

The score number is displayed in a colored circle/badge:
- `critical` (>80): dark red background `#991B1B`, white text
- `high` (>60): red background `#DC2626`, white text
- `medium` (>30): amber background `#D97706`, white text
- `low` (≤30): green background `#059669`, white text

Below the score badge, show the `risk_band` label in matching color.

**Rules column:** Show small icons for each flag that fired:
- 📈 volume_spike
- 📍 geographic_anomaly
- 🔗 cross_npi_supplier
- ⚠️ oig_leie_hit
- 🆕 new_high_value_supplier

Icons shown only for true flags. Grayed out / hidden for false.

**Row styling:**
- `critical` rows: `bg-red-50` background
- `high` rows: white background
- `medium` rows: white background
- `low` rows: white background
- Alternate rows: no striping — keep clean

**Row interaction:** Entire row is clickable. Cursor: pointer. Hover: `bg-slate-50`. Click navigates to `/plan/npi/{npi}`.

**Dr. Wilson row:** Must appear in top 3. If it does not due to data issues, the demo data needs to be reset.

---

## Page 4 — NPI Detail

### Route: `/plan/npi/[npi]`
### API calls: `GET /plan/npi/{npi}/detail`

---

### Section 4.1 — Header

```
← Back to Leaderboard

┌──────────────────────────────────────────────────────────────────┐
│  Dr. James Wilson                              Risk Score: 85    │
│  NPI: 1234567890 · Internal Medicine · San Francisco, CA         │
│                                                                  │
│  Score Breakdown:                                                │
│  Volume Spike +25  ·  Cross-NPI +30  ·  OIG Hit +35  =  90      │
│  Physician Flags (2) +10  →  Final: 90 → capped at 90           │
└──────────────────────────────────────────────────────────────────┘
```

**Back link:** `← Back to Leaderboard` in `--teal`, above the card
**Risk score:** large badge using the same color coding as leaderboard
**Score breakdown:** show only factors that contributed > 0 points, inline with `·` separators

---

### Section 4.2 — Tab Navigation

Three tabs below the header:

```
[Claims (57)]  [Rules Flags (163)]  [Physician Actions (2)]
```

Active tab: teal underline border, `--teal` text
Inactive tab: `--muted` text
Count in parentheses: from API response

---

### Section 4.3 — Claims Tab

Same claims table as physician dashboard but:
- No action buttons (plan investigators cannot confirm/dispute)
- All claims visible regardless of reviewed status
- Same flag badges and row styling
- Paginated — 50 per page

---

### Section 4.4 — Rules Flags Tab

Table of all rules_flags for this NPI:

| Column | Content |
|---|---|
| Rule | Colored badge with rule name |
| Severity | severity badge |
| Description | rule_description (full text) |
| Claim Date | date_of_service of the flagged claim |
| Supplier | supplier_name of the flagged claim |
| Amount | claim_amount of the flagged claim |

Sorted by: severity DESC (critical first), then date DESC

---

### Section 4.5 — Physician Actions Tab

Table of all physician actions for this NPI:

| Column | Content |
|---|---|
| Action | Colored action type badge |
| Supplier | supplier_name |
| Patient | patient_name |
| Amount | claim_amount |
| Date/Time | created_at formatted as MMM DD, YYYY HH:MM |

**Action type badges:**

| Action | Color |
|---|---|
| confirm | Green — "✓ Confirmed" |
| dispute | Red — "✗ Disputed" |
| flag_supplier | Orange — "⚑ Flagged Supplier" |
| unknown_patient | Amber — "? Unknown Patient" |

**Empty state:** "No physician actions recorded for this NPI yet."

---

## Page 5 — Supplier Watchlist

### Route: `/plan/suppliers`
### API calls: `GET /plan/suppliers`

---

```
┌──────────────────────────────────────────────────────────────────────┐
│  Supplier Watchlist                                                   │
│  Suppliers ranked by physician flags and risk score                   │
├─────────────┬───────┬─────────┬──────────┬───────────┬──────────────┤
│  Supplier   │  OIG  │  NPIs   │  Flags   │  Amount   │  Risk Score  │
├─────────────┼───────┼─────────┼──────────┼───────────┼──────────────┤
│  MedSupply  │  🔴   │   9     │   5      │ $180,000  │  [85 CRIT]  │
│  Pro LLC    │  OIG  │         │          │           │             │
└─────────────┴───────┴─────────┴──────────┴───────────┴──────────────┘
```

**Columns:**

| Column | Content |
|---|---|
| Supplier Name | supplier_name |
| OIG Status | "OIG EXCLUDED" badge in red if oig_flag = true. Blank if false. |
| Distinct NPIs | distinct_npi_count |
| Physician Flags | physician_flag_count — bold red if > 0 |
| Total Claims | total_claim_count |
| Total Amount | total_claim_amount |
| Risk Score | Same colored badge as NPI leaderboard |

**MedSupply Pro LLC must be row 1** — verify after demo reset.

**Filters:**
- "OIG Only" toggle — filters to `oig_only=true`
- "Has Flags" toggle — filters to `min_flags=1`

**Row click:** Opens a right-side panel showing all claims from this supplier across all NPIs. The panel slides in from the right without navigating away.

**Supplier detail panel:**

```
┌────────────────────────────────────────┐
│  MedSupply Pro LLC              [Close]│
├────────────────────────────────────────┤
│  OIG EXCLUDED · 9 NPIs · 5 Flags      │
│  120 claims · $180,000 total          │
├────────────────────────────────────────┤
│  Claims (showing 50 of 120)            │
│  ──────────────────────────────────── │
│  [same table as claims tab, no actions]│
└────────────────────────────────────────┘
```

---

## Page 6 — Live Alerts Feed

### Route: `/plan/alerts`
### API calls: `GET /plan/alerts/stream` (SSE)

---

### Section 6.1 — Connection Status Bar

```
┌────────────────────────────────────────────────────────────────┐
│  🟢 Connected — receiving live physician alerts                  │
└────────────────────────────────────────────────────────────────┘
```

**States:**
- Connected: green dot + "Connected — receiving live physician alerts"
- Disconnected: red dot + "Reconnecting..." with spinner
- On reconnect: brief yellow "Reconnected — replaying missed alerts" then back to green

---

### Section 6.2 — Alert Cards Feed

New alerts appear at the TOP of the feed with a slide-in animation.

**Alert card layout:**

```
┌────────────────────────────────────────────────────────────────┐
│  ⚑ Flag Supplier                          2 minutes ago       │
│                                                                │
│  Dr. James Wilson (NPI 1234567890)                             │
│  flagged  MedSupply Pro LLC                                    │
│  for patient  Margaret Johnson                                 │
│  Claim amount: $1,850.00                                       │
└────────────────────────────────────────────────────────────────┘
```

**Card styling:** White background, 1px `--border`, shadow-sm, `rounded-lg p-4`

**Action type icons and colors:**
- flag_supplier: ⚑ orange header bar (3px top border in `--flag`)
- unknown_patient: ? amber header bar (3px top border in `--unknown`)

**Time display:** Relative time — "just now", "2 minutes ago", "1 hour ago". Update every 30 seconds.

**New card animation:** Cards slide in from the top with a 300ms ease-in-out transition. New cards push existing cards down.

**"NEW" badge:** Show a pulsing green "NEW" badge on cards less than 60 seconds old. Remove after 60 seconds.

**Initial load:** Show last 50 alerts from the database on page load (replayed by SSE stream on connect). Do not show "no alerts" if there are pre-seeded alerts.

**Empty state (no alerts at all):**
```
[Bell icon]
Waiting for physician alerts...
When a physician flags a claim, it will appear here instantly.
```

---

## Component Library

Define these reusable components in `app/components/`:

---

### `RiskBadge.tsx`

Props: `score: number`

Renders the colored risk score badge with band label.

```tsx
// score > 80: critical — dark red
// score > 60: high — red
// score > 30: medium — amber
// else: low — green
```

---

### `CategoryChip.tsx`

Props: `category: string`

Renders the colored service category chip.

---

### `ActionButtons.tsx`

Props:
```tsx
{
  claimId: string
  npi: string
  reviewed: boolean
  onAction: (actionType: string) => void
}
```

Renders the four action buttons. Handles loading state per button. Replaces buttons with "Reviewed" badge after any action.

---

### `FlagBadge.tsx`

Props: `ruleName: string, severity: string, description: string`

Renders a single flag badge with tooltip on hover.

---

### `AlertCard.tsx`

Props: `alert: AlertEvent, isNew: boolean`

Renders a single alert card with correct color coding and time display.

---

### `AlertFeed.tsx`

No external props. Manages SSE connection, state, and renders list of AlertCards.

```tsx
// On mount: open EventSource to /plan/alerts/stream
// On message: prepend to alerts array
// On error: show reconnecting state
// On unmount: close EventSource
```

---

### `SupplierPanel.tsx`

Props: `supplierId: string | null, onClose: () => void`

Right-side sliding panel. Fetches supplier claims when `supplierId` is non-null. Closes on `onClose` or Escape key.

---

## State Management

Use React `useState` and `useEffect` only. No Redux, no Zustand, no Context for MVP.

**Per-page state:**
- Claims list: managed in the page component
- Filters: managed in the page component as query string state
- Loading: boolean per data fetch
- Error: error message string per data fetch

**SSE state (AlertFeed component):**
```tsx
const [alerts, setAlerts]         = useState<AlertEvent[]>([])
const [connected, setConnected]   = useState(false)
const [reconnecting, setReconnecting] = useState(false)
```

---

## API Integration — `lib/api.ts`

All API calls go through this file. No `fetch` calls outside of it.

```typescript
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

export async function getPhysicianSummary(npi: string): Promise<PhysicianSummary> { ... }
export async function getPhysicianClaims(npi: string, filters: ClaimFilters): Promise<ClaimsPage> { ... }
export async function getFlaggedSuppliers(npi: string): Promise<FlaggedSupplier[]> { ... }
export async function postAction(req: ActionRequest): Promise<ActionResponse> { ... }
export async function getPlanSummary(): Promise<PlanSummary> { ... }
export async function getNpiRiskList(filters: NpiFilters): Promise<NpiRiskPage> { ... }
export async function getNpiDetail(npi: string): Promise<NpiDetail> { ... }
export async function getSupplierWatchlist(filters: SupplierFilters): Promise<SupplierPage> { ... }
export function connectAlertStream(onAlert: (e: AlertEvent) => void): EventSource { ... }
```

**Environment variable:** `NEXT_PUBLIC_API_URL` — set in `.env.local` for development, in server environment for production.

---

## Loading and Error States — Universal Rules

Apply these rules on every page and every data fetch:

**Loading:** Show skeleton UI (gray pulsing rectangles matching the shape of the content). Never show a blank white page or a spinner in the center of the screen.

**Error:** Show an inline error message in the affected section. Never redirect to an error page. Message: "Unable to load [section name]. Please refresh."

**Empty:** Show an empty state with a contextual icon, a one-line explanation, and an action if applicable (e.g., "Clear filters" or "Return to claims").

**Never:** show a raw error object, a JavaScript stack trace, or an HTTP status code to the user.

---

## Environment Variables (Frontend)

```env
NEXT_PUBLIC_API_URL=http://localhost:8000    # Backend URL
```

Set in `.env.local` for development. Set in the server environment for production. Never commit `.env.local`.

---

## Routing Summary

| Route | Page | User |
|---|---|---|
| `/physician` | Physician Dashboard — Claims Table | Physician |
| `/physician/flagged-suppliers` | Flagged Suppliers List | Physician |
| `/plan` | Plan Dashboard — NPI Risk Leaderboard | Plan |
| `/plan/npi/[npi]` | NPI Detail Drill-Down | Plan |
| `/plan/suppliers` | Supplier Watchlist | Plan |
| `/plan/alerts` | Live Alerts Feed | Plan |

**Default route:** `/physician` — if user navigates to `/`, redirect to `/physician`.

**Auth guard:** Not needed for MVP. All routes are open. Demo user is determined by the switcher.
