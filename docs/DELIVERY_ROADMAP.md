# ClaimLens — Forward Build Plan & Phased Delivery Roadmap

_Version 1.0 · July 2026 · MediClaim Analytics (Confidential)_

---

## 1. Purpose

This document describes **how ClaimLens will be built from here** — the planned phases, the
sprint-level breakdown, and the timeline once real claims data is available.

The single most important point: **the timeline is data-gated.** Everything downstream of
ingestion (calibration, pilot, ML) can only be scoped precisely once we know *how* the data
arrives, in *what* format, with *which* fields, at *what* volume, and under *which* compliance
regime. Section 3 lists the intake questions whose answers set the clock. Section 5 maps each
answer to the phase it affects, so the client can see that their responses directly move the
delivery dates.

---

## 2. Where the product is today (baseline)

ClaimLens is a **working system** (React + FastAPI + PostgreSQL) running on a synthetic dataset:

- **16 fraud-detection rules**, explainable, each writing evidence per flag.
- **Risk scoring** 0–100 per physician (NPI) and per vendor, with risk bands.
- **Three role-based portals** — Payer/Investigator, Physician, Vendor.
- **Full dispute lifecycle** — raise → notify vendor (SLA) → respond with documents → physician
  confirm/reject → payer decision authority → escalate → audit trail.
- **MFA** (email OTP + optional TOTP + backup codes) and **provider verification** at registration
  (NPPES + OIG live against loaded snapshots; DEA/State/PTAN/SAM/UEI checks present, some mocked).
- **Real-time SSE alerts**, per-role notification centre, and **email notifications**.
- **One-click no-login response** (signed-token CONFIRM/DISPUTE/REPORT FRAUD from email).
- **LLM risk-explanation** prototype already in the codebase.

**Deliberately deferred (agreed future scope):** 835 ERA real-time parsing and the original
OCR/keyword document-reviewer were de-prioritised per the client (Shawn) on the 3 July 2026 call.
**Not yet started:** live deployment/hardening, real-data ingestion, ML models, native mobile app,
pre-authorization flow.

> **Data today is synthetic.** The plan below begins the moment we receive real (or a real
> representative sample of) claims data.

---

## 3. The timeline depends on this — data intake questionnaire

We have already told the client the timeline depends on these answers. They fall into seven areas:

### 3.1 Delivery
- **Push or pull?** Do they send to our API, or do we fetch from their SFTP / API?
- **Cadence?** Real-time, hourly, or daily batch?
- **Backfill, ongoing, or both?** One-time historical load, a continuous feed, or both?

### 3.2 Format
- CSV / Excel, **X12 837** EDI, **FHIR EOB**, or **CMS CCLF / LDS** extract?
- Is a **data dictionary** available?
- Granularity: **one row = one claim**, or one claim **line**?

### 3.3 Fields (which of these exist in their feed?)
- Physician / ordering **NPI**
- Patient identifier — **real MBI or tokenized**?
- Patient **name**, patient **ZIP + state**
- **Date of service**
- **Service description** or just the **HCPCS/CPT code**?
- **Service category**
- **Billed / paid / allowed** amount
- **Vendor NPI + name**

### 3.4 Volume
- How many claims in the **backfill**?
- How many **per day** ongoing?

### 3.5 Reference data
- Is **physician billing history** available (needed for baselines & the Established-Relationship check)?
- Are **patient death dates** available (needed for the deceased-patient rule)?
- Do they already run **OIG / exclusion checks**, or should we rely on the **public monthly LEIE list**?

### 3.6 Compliance
- Is the data **identifiable PHI**, a **Limited Data Set**, or **de-identified**?
- Is a **DUA / BAA** signed?
- Any **hosting requirements** (region, cloud, on-prem, isolation)?

### 3.7 Data quality
- Do **duplicate / adjustment / void** claims come through?
- Typical **delay** between service date and when the claim arrives?

---

## 4. How the plan is structured

- **Sprint length:** 2 weeks. "Week N" below is counted from **data availability + signed DUA/BAA**
  (call that **Day 0**), except Sprint 0 work that can start earlier.
- **Two tracks run in parallel:**
  - **Track A — data-independent:** production hardening & deployment. Can start *now*, before any data.
  - **Track B — data-gated:** ingestion, calibration, pilot, ML. Starts at Day 0.
- Each phase lists **goal · scope · deliverables · exit criteria · what it depends on.**

---

## 5. Phased roadmap (sprints)

### PHASE 0 — Data Intake & Production Readiness
**Sprint 0 · Weeks 0–2 (Track A can begin before Day 0)**

- **Goal:** Lock the data contract and make the platform deployable for real data.
- **Scope:**
  - Client answers the Section 3 questionnaire; agree the field mapping and delivery method.
  - Sign **DUA / BAA**; confirm hosting/region requirements.
  - Receive a **sample file + data dictionary**.
  - *(Track A, parallel)* Harden auth (rotate JWT secret, Secure cookies, tighten CORS), deploy to a
    live HTTPS environment, backups, monitoring.
- **Deliverables:** signed agreements, agreed schema mapping, sample data in hand, deployed hardened environment.
- **Exit criteria:** we can legally receive data, we know its exact shape, and there is a live target to load it into.
- **Depends on:** Section 3.1, 3.2, 3.3, 3.6.

### PHASE 1 — Ingestion & Normalization
**Sprints 1–2 · Weeks 2–6**

- **Goal:** Get their real claims flowing into the canonical schema, clean.
- **Scope:**
  - Build the **connector** for their delivery method (push endpoint or pull-from-SFTP/API scheduler).
  - Build the **format parser** (CSV/Excel = fast; FHIR EOB = +1 sprint; X12 837 = +1–2 sprints; CCLF/LDS = +1 sprint).
  - Map to canonical schema; handle **claim vs. claim-line** granularity.
  - **Data-quality handling:** de-dup, and process **adjustment/void** claims correctly.
  - Apply **PHI masking** per the compliance tier (mask MBI, partial patient names).
  - Run the **one-time backfill** and stand up the **ongoing feed** (batch or streaming per 3.1).
- **Deliverables:** working ingestion pipeline, backfill loaded, ongoing feed live, reconciliation report.
- **Exit criteria:** their claims land in the canonical schema; row/amount counts reconcile against their totals.
- **Depends on:** Section 3.1, 3.2, 3.3, 3.4, 3.7.

### PHASE 2 — Detection Calibration on Real Data
**Sprints 3–4 · Weeks 6–10**

- **Goal:** Tune the 16 rules to their real population and prove baseline accuracy.
- **Scope:**
  - Re-run all rules on real data; **tune thresholds** (volume multiplier, geo distance, cross-NPI
    threshold, upcoding multiplier, hospice duration, etc.) to their claim mix.
  - Wire in **reference data:** monthly **OIG LEIE** refresh, **death dates** (activates deceased-patient
    rule), **physician billing baselines**.
  - Build the **Established-Relationship check** (the fraud rule deferred earlier — feasible now that
    historical billing data exists).
  - Sit with their **FWA team** to review flagged samples; measure **precision / false-positive rate**;
    validate the evidence packs.
- **Deliverables:** calibrated rule set, baseline precision/FP report, investigator-validated evidence.
- **Exit criteria:** their investigators agree the top-ranked flags are worth acting on.
- **Depends on:** Section 3.3 (fields present), 3.5 (reference data).

### PHASE 3 — Live Pilot & Workflow Hardening
**Sprints 5–6 · Weeks 10–14**

- **Goal:** Run the full detect → dispute → resolve loop with their real users and real cases.
- **Scope:**
  - Onboard real payer/physician/vendor users; finalize the **SLA window** (15 vs 45 days, configurable).
  - Confirm **payer decision authority** flow; define & build the **post-document payer workflow**
    (currently undefined by client).
  - Finalize the **Proof-of-Work document spec** (currently undefined by client) and the review flow.
  - Turn on **push / SMS notifications** delivery (schema already supports it).
  - Add **role expansion** if required (Physician Office Admin, Compliance Officer, System Admin).
  - Auto-generate the **OIG referral package** on REPORT FRAUD.
- **Deliverables:** operating pilot, first real cases resolved, recovery-$ tracking live.
- **Exit criteria:** real disputes flow end-to-end and close; KPIs (recovery rate, time-to-resolution, vendor responsiveness) are being measured.
- **Depends on:** Phase 2 sign-off + client answers on the two open workflow gaps.

### PHASE 4 — Machine-Learning Layer
**Sprints 7–10 · Weeks 14–22 (supervised step gated on label volume)**

- **Goal:** Add ML *on top of* the rules (rules stay as the explainable safety net) and measure the accuracy lift.
- **Scope:**
  - Build the **feature pipeline** from stored flags + continuous signals (already captured today).
  - **Isolation Forest** (unsupervised anomaly detection) — surface novel patterns the rules don't encode.
  - **XGBoost** (supervised) trained on accumulated **physician-flag labels** from the pilot.
  - Productionize **LLM alert summaries** (the `ai_summary` prototype → per-alert "why this is suspicious").
  - **Graph ML** for provider–vendor–patient networks (kickback rings/collusion).
  - Run ML in **shadow mode**, then A/B against rules; report measured **precision improvement**.
- **Deliverables:** ML scoring in production alongside rules, non-breaking (only the scoring module changes — same schema, APIs, dashboards); measured accuracy report.
- **Exit criteria:** ML demonstrably lowers false positives vs. rules-only on their data.
- **Depends on:** **enough labeled flags** — a function of claim volume (3.4) and physician engagement.
  Supervised XGBoost starts when the label count is sufficient (typically a few hundred+); until then,
  the unsupervised + LLM work proceeds.

### PHASE 5 — Scale & Extend
**Sprints 11+ · Weeks 22+**

- **Goal:** Broaden coverage and take on the previously-deferred, integration-heavy items.
- **Scope (prioritized with client):**
  - **835 ERA real-time ingestion** (deferred item) — if they want live remittance-driven alerts.
  - **Native mobile app** (iOS/Android) for physicians (deferred item).
  - **Pre-authorization flow** (vendor requests physician sign-off before billing) (deferred item).
  - **Multi-state / multi-plan** rollout; **horizontal scaling** (shared message broker for SSE at load).
  - **Live CMS / NPPES / OIG** write-back integration to replace snapshots.
- **Exit criteria:** production-scale, multi-tenant, live-data operation.
- **Depends on:** pilot success and client prioritization.

---

## 6. Indicative timeline (from Day 0 = data + signed DUA/BAA)

| Phase | Sprints | Weeks | Milestone |
|---|---|---|---|
| 0 — Intake & readiness | 0 | 0–2 | Data contract signed, environment deployed |
| 1 — Ingestion | 1–2 | 2–6 | Real claims flowing, backfill loaded |
| 2 — Calibration | 3–4 | 6–10 | Rules tuned, baseline precision proven |
| 3 — Pilot | 5–6 | 10–14 | Real cases resolved, recovery tracked |
| 4 — ML layer | 7–10 | 14–22 | ML in production, accuracy lift measured |
| 5 — Scale/extend | 11+ | 22+ | 835/mobile/pre-auth/multi-state |

**Rules-calibrated & pilot-ready:** ~**3.5 months** after Day 0.
**ML in production:** ~**5–6 months** after Day 0 (supervised step contingent on label accumulation).

### How the intake answers shift these dates

| If the data is… | Effect on timeline |
|---|---|
| **CSV/Excel with a data dictionary** | Fastest — Phase 1 stays ~2 weeks |
| **FHIR EOB** | +~1 sprint for resource mapping |
| **X12 837 EDI** | +~1–2 sprints for EDI parsing/loop mapping |
| **CMS CCLF / LDS multi-file** | +~1 sprint for multi-file joins |
| **Identifiable PHI (vs LDS/de-identified)** | Adds lead time *before* Day 0 — BAA + hosting controls must be in place first |
| **No death dates / no physician billing history** | Deceased-patient & Established-Relationship rules stay off; calibration narrower |
| **Low daily volume / low physician engagement** | Supervised ML (Phase 4 XGBoost) slips until enough labels accumulate |
| **Adjustments/voids/duplicates in the feed** | Adds data-quality work in Phase 1 |

---

## 7. Assumptions & risks

- **Assumption:** a representative sample (or backfill) is provided early enough to calibrate before the live pilot.
- **Assumption:** the two client-open items (post-document payer workflow; Proof-of-Work document spec) are
  resolved before Phase 3.
- **Risk — label volume:** supervised ML needs enough physician-confirmed flags; low engagement delays Phase 4.
  *Mitigation:* rules + unsupervised ML deliver value regardless; supervised model layers in when data allows.
- **Risk — data quality/format surprises:** real feeds differ from the sample. *Mitigation:* Phase 1 reconciliation gate.
- **Risk — compliance lead time:** identifiable PHI without a signed BAA blocks Day 0. *Mitigation:* start Track A hardening and paperwork in parallel now.

---

## 8. What we need from the client to lock the timeline

1. Answers to the Section 3 questionnaire (delivery, format, fields, volume, reference data, compliance, quality).
2. A **sample data file + data dictionary**.
3. Signed **DUA / BAA** and confirmed **hosting requirements**.
4. Decisions on the two open workflow items (post-document payer step; Proof-of-Work document).

Once 1–3 are in hand, we convert the indicative weeks above into committed sprint dates.

---

_MediClaim Analytics · Confidential · July 2026_
