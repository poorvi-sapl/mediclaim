# Physician Dashboard — UI Element Inventory

> **Purpose.** A complete, hand-off catalogue of every UI element on the Physician Dashboard screen, with exact design tokens (colours, type, spacing, radii, shadows), states and interactions. A UI/UX designer can build client-ready designs directly from this file without opening the code.
>
> **Screen shown:** "My Dashboard" — the physician's landing screen (`frontend/src/components/PhysicianDashboard.jsx`), rendered inside the top-navbar shell (`frontend/src/components/Shell.jsx`).
> **Product:** ClaimLens / MedClaim Analytics — NPI-based medical-claims fraud intelligence.
> **Viewport in reference image:** 1440px-wide desktop.

---

## 1. Global Design Tokens

These are the shared values used across every element below. Do not introduce arbitrary colours or sizes.

### 1.1 Colour palette

**Brand / neutral**
| Token | Hex | Use |
|---|---|---|
| Navy 900 | `#0A1F3D` | Primary text, big numbers, active nav pill, banner end, tooltips |
| Slate blue | `#5B84C4` | Secondary accent, KPI default icon, chart bars, "Review →" text |
| Slate blue light | `#AFC3E8` | Low-value chart bars, banner glow |
| Neutral 500 | `#647089` | Secondary / label text |
| Neutral 400 | `#93A0B3` | Tertiary text, axis labels, muted values |
| Neutral 100 | `#F1F4F9` | Progress-track background, dividers, empty chart bar |
| Border | `#E1E6EE` | Card borders, header divider |
| Page background | `#F1F5F9` (slate-100) | App canvas behind cards |
| White | `#FFFFFF` | Card surfaces |

**Status / semantic**
| Token | Hex | Meaning |
|---|---|---|
| Success | `#3A7D5C` | Positive / "all clear" |
| Warning | `#D1A85C` | Attention / pending |
| Error | `#A6453F` | Critical / flagged |
| Success text | `#2E6B4F` | Text on green pills |
| Warning text | `#8A6A34` | Text on amber pills |
| Error text | `#8A423D` | Text on red pills |

**KPI card icon tones** (each = a soft glow tint + a solid icon/bar colour)
| Tone | Glow | Icon + bar | Used by |
|---|---|---|---|
| default | `#F1F4F9` | `#5B84C4` | — |
| primary (info) | `#E9F0F6` | `#5A9BC9` | Submitted This Month |
| success | `#E9F3ED` | `#3A7D5C` | Confirmation Rate |
| warning | `#FBF3E4` | `#D1A85C` | Pending Review |
| danger | `#F7EBEA` | `#A6453F` | Flagged Suppliers |
| ai | `#EAF1F5` | `#2E6B8F` | — |

**Chart / donut palette** (Review Outcomes — softer teal→coral family)
| Segment | Hex |
|---|---|
| Confirmed | `#3E8E82` |
| Disputed | `#E1B866` |
| Fraud reported | `#C56B60` |
| Flagged vendor | `#6E8FC7` |
| Unknown patient | `#AEB8C7` |

**Pills / badges**
| Variant | Background | Text | 1px inset ring |
|---|---|---|---|
| Low / success | `#E9F3ED` | `#2E6B4F` | `#D5E9DD` |
| Medium / warning | `#FBF3E4` | `#8A6A34` | `#F0E0BE` |
| Critical / error | `#F7EBEA` | `#8A423D` | `#EBD3D1` |

### 1.2 Typography
| Role | Family | Notes |
|---|---|---|
| Body / UI text | **Inter** | Base font; feature settings `cv11, ss01, cv01, ss03` |
| Headings | **Inter Tight** (falls back to Inter) | Letter-spacing ≈ −0.018em to −0.022em |
| Display numbers (KPI values, big stats, donut centre) | **Manrope**, weight 800, letter-spacing −0.02em | The large numerals |
| Monospace (claim IDs / CCN) | **JetBrains Mono**, weight 600 | Fixed-width for IDs |

Key sizes seen on this screen: 28px (KPI value), 30px (spectrum stat), 22px (banner greeting, donut centre), 15px (card titles), 13.5px (banner subtext), 12–12.5px (labels/rows), 10.5–11px (axis labels, percentages).

### 1.3 Spacing, radius, elevation
- **Card radius:** 16–20px (KPI cards 18px, banner 20px, generic cards `rounded-2xl` = 16px).
- **Card padding:** 16–22px.
- **Grid gap between cards:** 10–12px (`gap-2.5` / `gap-3`).
- **Page padding:** 16px mobile → 32px desktop horizontal; 12px vertical.
- **Shadow — sm:** `0 1px 2px rgba(10,31,61,.05), 0 1px 1px rgba(10,31,61,.03)` (resting cards).
- **Shadow — md:** `0 8px 20px rgba(10,31,61,.07)` (hover on clickable cards).
- **Shadow — lg:** `0 16px 40px rgba(10,31,61,.12)` (floating previews/tooltips).

---

## 2. Page Layout

Vertical stack, all inside a scrollable content area. Top-to-bottom order:

```
┌──────────────────────────────────────────────────────────────┐
│  TOP NAV BAR (sticky)                                         │  ← Section 3
├──────────────────────────────────────────────────────────────┤
│  WELCOME BANNER (full width)                                  │  ← Section 4
├──────────────────────────────────────────────────────────────┤
│  KPI ROW — 4 cards                                            │  ← Section 5
│  [Pending Review] [Submitted] [Flagged Suppliers] [Conf.Rate] │
├───────────────────────────────┬──────────────────────────────┤
│  REVIEW SPECTRUM (≈1.4fr)     │  OLDEST UNREVIEWED (≈1fr)    │  ← Section 6 & 7
├───────────────────────────────┼──────────────────────────────┤
│  REVIEW VELOCITY (≈1.55fr)    │  REVIEW OUTCOMES (≈1fr)      │  ← Section 8 & 9
└───────────────────────────────┴──────────────────────────────┘
```

**Responsive columns**
- KPI row: 1 col (mobile) → 2 cols (sm) → 4 cols (lg).
- Spectrum / Oldest row: 1 col (mobile) → `1.4fr / 1fr` (lg).
- Velocity / Outcomes row: 1 col (mobile) → `1.55fr / 1fr` (lg).

---

## 3. Top Navigation Bar (Header)

Sticky, transparent header sitting on the light page background (no white bar). Left = breadcrumb; right = nav pills + utility icons + search + bell + avatar.

### 3.1 Left — Breadcrumb trail
- **Home icon** (house outline, 13px) + label **"Dashboard"** in bold navy `#0A1F3D`, 12.5px.
- When deeper than one level, additional crumbs separate with a chevron `›` in slate-300; non-active crumbs are clickable, muted (`#647089`), last crumb bold.

### 3.2 Right cluster (left→right)
1. **"My Dashboard" nav pill (active)** — filled navy `#0A1F3D` pill, white text 13.5px semibold, grid icon on the left. Radius = full (pill). Inactive nav items collapse to an icon-only 36×36 circle in slate blue `#5B84C4`, hover shows a navy rounded tooltip.
2. **Document / Claims icon** — icon-only 36×36 circle button (inactive nav item).
3. **Alerts icon** — icon-only 36×36 circle button (inactive nav item, warning triangle).
4. **Search field** — pill input, 288px wide (desktop lg+ only). Left search icon (14px, `#93A0B3`), placeholder "Search claims…". Background slate-50, 1px border `#E1E6EE`, radius full. On focus: white background, navy-tinted border + 2px focus ring. A clear "×" appears when text is entered. Live dropdown lists matching Physicians and Vendors (grouped, with score/OIG badge).
5. **Notification bell** — 36×36 rounded button, slate-500 icon. Unread count shown as a rose `#F43F5E` circular badge (top-right, min 16px, "9+" cap).
6. **User avatar chip** — 32×32 circle, navy gradient `linear-gradient(135deg,#1a3d7c,#0d1f35)`, white initials ("DJ") 11px bold, with a subtle ring. Click opens a centered profile panel (identity header, info rows, Sign out). On the physician variant a small green "online" dot sits bottom-right of the avatar.

**Header height:** ~60px. **Divider:** 1px `#E1E6EE` (only when not transparent).

---

## 4. Welcome Banner

Full-width hero card greeting the physician.

- **Container:** radius 20px, padding 22px 28px, white text.
- **Background:** diagonal gradient `linear-gradient(100deg, #2F4A76 0%, #1C3157 45%, #0A1F3D 100%)` — lighter slate-blue on the left settling into brand navy on the right.
- **Decorative glow:** soft radial highlight `rgba(175,195,232,.22)` bleeding off the bottom-right corner (220×220 circle, clipped by the card).
- **Greeting (line 1):** Manrope 800, 22px, white — `"{Good morning|afternoon|evening}, Dr. James Wilson"`. Time-of-day chosen by local hour (< 12 morning, < 17 afternoon, else evening).
- **Sub-line (line 2):** 13.5px, colour `#C9D6EA`, line-height 1.5 — dynamic sentence:
  `"709 claims are waiting on your review — 4 suppliers on your account have been flagged for unusual billing."`
  (Pluralisation adapts; the "suppliers flagged" clause is omitted when zero.)
- **Avatar badge (right):** 52×52 circle, `rgba(255,255,255,0.14)` fill, single-person (User) icon 24px in `rgba(255,255,255,0.85)`.

---

## 5. KPI Card Row (4 cards)

Four uniform, clickable stat cards. Each card navigates to a pre-filtered Claims screen on click, and on hover (after ~320ms) shows a scaled live iframe thumbnail of the destination (browser-chrome mock with red/amber/green dots + URL bar).

### 5.1 Card anatomy (shared recipe — `KpiCard`)
```
┌───────────────────────────────┐
│ Label                    ◔ ◉  │  ← label (top-left) + tinted icon circle (top-right) on a corner glow
│                               │
│ 709                           │  ← value (Manrope 800, 28px, navy)
│ Claims awaiting your decision │  ← sub-label (12px, #647089)
│ ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░           │  ← progress bar (4px, tone-coloured fill on #F1F4F9 track)
└───────────────────────────────┘
```
- **Surface:** white, radius 18px, 1px border `#E1E6EE`, padding `20px 22px 22px`, inset top highlight + sm shadow.
- **Label:** 12.5px, weight 600, `#647089`.
- **Icon circle:** 32×32, filled with the tone's glow tint; stroked lucide icon (16px) in the tone's icon colour. Behind it, a blurred quarter-circle corner glow (radial gradient in the icon colour, ~50% opacity) plus a thin 1.5px arc ring — reads as one deliberate corner wash.
- **Value:** Manrope 800, 28px, `#0A1F3D`, letter-spacing −0.02em. Numbers are locale-formatted with thousands separators.
- **Sub:** 12px, `#647089`.
- **Progress bar:** height 4px, radius 4px, track `#F1F4F9`, fill in the tone colour, width driven by a `pct` value (0–100).
- **Hover (clickable):** cursor pointer + md shadow lift; hover preview thumbnail (desktop only).

### 5.2 The four cards
| # | Label | Value (sample) | Sub-label | Icon | Tone | pct driver | Click → |
|---|---|---|---|---|---|---|---|
| 1 | **Pending Review** | `709` | Claims awaiting your decision | Clock | Warning (amber) | pending ÷ total | Claims filtered to *unreviewed* |
| 2 | **Submitted This Month** | `2` | New claims under your NPI | FileText | Primary (blue) | monthly count ×10 (cap 100) | Claims (all) |
| 3 | **Flagged Suppliers** | `4` | Suppliers you've flagged | Flag | Danger (red) | flagged ×25 (cap 100) | Claims filtered to *unknown/flagged suppliers* |
| 4 | **Confirmation Rate** | `1%` | `767 claims reviewed` | CheckCircle2 | Success (green) | = the % value | Claims (all) |

Empty/zero → value shows `—` (Confirmation Rate) or `0`.

---

## 6. "Review Spectrum" Card

Wide card (left of its row). Four horizontal stat blocks with vertical dividers, each showing a metric + tone pill.

- **Card:** white, `rounded-2xl`, 1px border, sm shadow, padding `18px 22px 20px`.
- **Title:** "Review Spectrum", 15px, weight 700, navy.
- **Subtitle:** "Your dispute effectiveness and claim risk signals, NPI-wide" — 12px, `#647089`.
- **Stat block (×4, dividers `1px #F1F4F9` between):**
  - **Value:** Manrope 800, 30px, navy (e.g. `18%`, `36`, `0`, `0%`).
  - **Label:** 12.5px, `#647089`.
  - **Pill:** rounded-full, 11px semibold, tone-coloured (see pill palette).

| Block | Value (sample) | Label | Pill (sample) | Tone logic |
|---|---|---|---|---|
| 1 | `18%` | Dispute Resolution Rate | "Needs focus" | ≥70 Strong·green / ≥40 Fair·amber / else Needs focus·red |
| 2 | `36` | Fraud Reports Filed | "Reported" | >0 Reported·amber / else None filed·green |
| 3 | `0` | Needs Your Confirmation | "All clear" | >0 Action needed·amber / else All clear·green |
| 4 | `0%` | Unknown Patient Rate | "Low" | ≤5 Low·green / ≤15 Watch·amber / else High·red |

---

## 7. "Oldest Unreviewed Claims" Card

Narrow card (right of its row). A scrollable queue of the oldest pending claims, "work through these first."

- **Card:** white card, padding `14px 22px 12px`, internal vertical scroll (shows up to 15 items).
- **Title:** "Oldest Unreviewed Claims", 15px/700/navy.
- **Subtitle:** "Work through these first — sorted by how long they've been waiting", 12px `#647089`.
- **Row (`QueueItem`), repeated:** bottom border `1px #F1F4F9`, padding 11px vertical.
  - **Status dot** — 8px circle: red `#A6453F` if urgent (>14 days waiting), else amber `#D1A85C`.
  - **Claim ID (CCN)** — JetBrains Mono, 12.5px, weight 600, fixed 110px (hidden on mobile, prefixed inline instead).
  - **Description** — 12.5px `#647089`, single line, truncates with ellipsis (e.g. "Daily infusion service for infliximab in hospital setti…").
  - **Amount** — 13px, weight 700, right-aligned, 70px column (e.g. `$1,231`).
  - **"Review →" button** — 11.5px/700, slate-blue text `#5B84C4` on a 12%-opacity slate-blue fill, radius 7px, padding `5px 11px`. Hover: slight darken; active: scale 0.97.
- **Empty state:** "Nothing waiting — you're all caught up." (12.5px `#93A0B3`).

---

## 8. "Review Velocity" Card

Bar chart of claims reviewed per week (left of the bottom row, wider).

- **Card:** white card, padding `16px 22px 18px`.
- **Title:** "Review Velocity", 15px/700/navy.
- **Subtitle:** "Claims reviewed per week", 12px `#647089`.
- **Chart:** 200px tall, flex row of bars, 14px gap, bars aligned to the bottom.
  - **Bar:** full column width, top corners radius 6px, min height 4px, height scaled to the weekly max.
  - **Bar colour logic:** `0` → track grey `#F1F4F9`; the peak week → navy `#0A1F3D`; < 40% of max → slate-blue-light `#AFC3E8`; otherwise slate-blue `#5B84C4`.
  - **Hover:** bar brightens (×1.12); a navy tooltip appears above with the week range + count, e.g. *"Jul 06 – Jul 12: 8 claims reviewed"* (rounded 8px, white text 11px, downward arrow).
- **X-axis labels:** week start labels (e.g. Jun 01 … Jul 20), 10.5px `#93A0B3`, centered under each bar.
- **Loading state:** "Loading…" centered, 12.5px `#93A0B3`.

---

## 9. "Review Outcomes" Card

Donut chart + legend showing how reviewed claims were decided (right of the bottom row).

- **Card:** white card, padding `16px 22px 18px`.
- **Title:** "Review Outcomes", 15px/700/navy.
- **Subtitle:** "How you've decided reviewed claims", 12px `#647089`.
- **Donut (left):** 132×132 SVG ring, 5px stroke, rotated −90° so it starts at 12 o'clock. Track ring in `#F1F4F9`; coloured arcs sized to each segment's share.
  - **Centre label:** total decided count in Manrope 800, 22px navy (e.g. `59`), with "reviewed" beneath in 10.5px `#647089`.
- **Legend (right):** one row per segment, 9px gap:
  - **Swatch** — 9×9 rounded square in the segment colour.
  - **Label** — 12.5px `#647089`, truncates.
  - **Count** — 13px, weight 700, navy, right-aligned.
  - **Percent** — 11px `#93A0B3`, 34px right column.

| Segment | Colour | Count (sample) | % (sample) |
|---|---|---|---|
| Confirmed | `#3E8E82` | 4 | 7% |
| Disputed | `#E1B866` | 14 | 24% |
| Fraud reported | `#C56B60` | 36 | 61% |
| Flagged vendor | `#6E8FC7` | 3 | 5% |
| Unknown patient | `#AEB8C7` | 2 | 3% |

- **Loading state:** "Loading…" (12.5px `#93A0B3`).
- **Empty state:** "No decisions recorded yet — review a claim to get started."

---

## 10. Shared States & Interactions (for the design system)

| State | Treatment |
|---|---|
| **Loading** | Inline "Loading…" text or skeleton — never a full-page spinner or blank screen. |
| **Empty** | Contextual one-line message in `#93A0B3` (see each card). |
| **Hover — clickable card** | md shadow lift, cursor pointer; KPI cards additionally show a live iframe preview after ~320ms. |
| **Hover — chart bar** | Brightens + navy tooltip with exact figures. |
| **Button press** | `active:scale(0.97)` micro-press. |
| **Tooltips** | Navy `#0A1F3D` background, white text, rounded 8px, small directional arrow, lg shadow. |

---

## 11. Iconography

Line icons from **lucide-react**, typically 16–18px, stroke width 1.9–2.2.
Seen on this screen: `Clock` (Pending), `FileText` (Submitted / document nav), `Flag` (Flagged Suppliers), `CheckCircle2` (Confirmation), `User` (banner avatar), `Search`, `Bell`/alerts triangle, `Shield`+`Check` (brand mark), grid icon (My Dashboard), home icon (breadcrumb), chevrons.

---

## 12. Notes for the Designer

- **Three portals share this visual system.** Physician (this screen), Payer, and Vendor dashboards reuse the same KPI card, pills, shadows and navy/slate-blue palette. Design components once and reuse; only accent usage and nav items differ per portal.
- **This screen is data-driven.** Every number/pill is computed from live API data — design must accommodate variable string lengths, `—` placeholders, zero states and pluralisation.
- **Naming for the client:** the product surface uses two names — "ClaimLens" (spec) and "MedClaim Analytics" (brand mark). Confirm the canonical brand name before finalizing.
- The older, teal-themed spec in `docs/UI_SPEC.md` predates this navy/slate-blue implementation — **use this file** for the current look, not that one.
```
