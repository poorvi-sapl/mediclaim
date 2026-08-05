# Business Requirements Document (BRD)
## ClaimLens — NPI Intelligence & Medicare Fraud-Detection Platform
### (Project repo: *MediClaim*)

---

## 1. Document Control

| Field | Detail |
|---|---|
| Document title | Business Requirements Document — ClaimLens |
| Product / project | ClaimLens (MediClaim) |
| Version | 1.0 (Draft) |
| Author | *[Your name]* — Business Analyst |
| Date | *[Date]* |
| Status | Draft — for review |
| Reviewers / Approvers | *[Manager], [Product Owner], [Compliance]* |

**Change log**

| Version | Date | Author | Summary |
|---|---|---|---|
| 1.0 | *[Date]* | *[You]* | Initial draft |

---

## 2. Executive Summary

ClaimLens is a web-based **NPI intelligence and Medicare fraud-detection platform**. It ingests healthcare claims data, runs an automated **rules engine** across sixteen fraud patterns, assigns each provider (NPI) and vendor a **risk score**, and surfaces the highest-risk entities to plan investigators through a real-time **fraud command centre**.

Beyond detection, ClaimLens closes the loop with a structured **dispute and resolution workflow** across three role-based portals — **Payer/Investigator, Physician, and Vendor** — so that a flagged claim can be reviewed, disputed, responded to (with supporting documents), confirmed, and escalated to compliance, all with a full audit trail.

The platform is currently a working system (React + FastAPI + PostgreSQL) with ~18,000 synthetic claims across 100 physicians and 100 vendors, used for demonstration and pilot evaluation.

---

## 3. Business Context & Problem Statement

Medicare improper payments and fraud, waste & abuse (FWA) cost the healthcare system tens of billions of dollars annually. Key challenges the business faces today:

- **Fraud is hard to detect at scale.** Patterns such as ghost billing, upcoding, unbundling, use of OIG-excluded providers, deceased-patient billing, and geographically implausible claims are buried in high claim volumes.
- **Physicians are unaware of claims billed under their NPI.** A provider's identity can be used by a vendor to bill for services the physician never ordered or performed, with no easy way for the physician to see or challenge it.
- **No structured dispute/resolution path.** When a claim is suspected fraudulent, there is no consistent, auditable workflow to notify the billing vendor, collect their response, and resolve or escalate the case within a defined SLA.
- **Investigators lack a single pane of glass.** FWA analysts need one prioritised view of the riskiest NPIs and vendors, the evidence behind each flag, and the status of open cases.

ClaimLens addresses these gaps with automated detection, transparent per-provider visibility, and a governed dispute lifecycle.

---

## 4. Project Objectives & Goals

| # | Objective | Business Outcome |
|---|---|---|
| O1 | Detect fraudulent / improper billing automatically | Surface high-risk NPIs and vendors early, before payment leakage grows |
| O2 | Quantify and challenge fraudulent billing in dollar terms | Give the plan a measurable "$ challenged / recoverable" figure |
| O3 | Empower physicians to review and dispute claims under their NPI | Catch identity misuse and protect provider reputation |
| O4 | Give vendors a fair, structured channel to respond to disputes | Due process + faster, defensible resolutions |
| O5 | Reduce time-to-resolution on flagged cases | Enforce response SLAs and auto-escalate non-responsive vendors |
| O6 | Provide an auditable, compliance-ready record of every action | Support investigations, audits, and regulatory reporting |

---

## 5. Scope

### 5.1 In Scope
- Three role-based web portals: **Payer/Investigator, Physician, Vendor**.
- **Automated fraud rules engine** (16 rules) and **weighted risk scoring** per NPI and vendor.
- **Fraud command centre** dashboards, **physician risk leaderboard**, and **vendor watchlist**.
- **Dispute & fraud-report lifecycle**: raise → notify vendor → vendor responds (with document upload) → physician confirms/rejects → escalate to compliance.
- **Real-time notifications and live alerts** (server-sent events) across portals.
- **Secure multi-role authentication** (password + email OTP; optional TOTP MFA) and **provider verification** at registration (NPI/NPPES, OIG, DEA, State License, PTAN, SAM/UEI).
- **Analytics** (claims trends, reviewed-vs-flagged, recovery rate, case-review status).

### 5.2 Out of Scope (current phase)
- Real claims **adjudication or payment** processing.
- **Live, write-back integration** with CMS/NPPES/OIG (currently mocked / snapshot-based).
- **Machine-learning** fraud models (detection is rules-based in this phase).
- **Native mobile** applications.
- Production-grade data volumes (current dataset is synthetic/demo).

---

## 6. Stakeholders & User Roles

| Role | Description | Primary Goals in ClaimLens |
|---|---|---|
| **Plan / Payer Investigator** | FWA analyst employed by the health plan | Review the risk leaderboard & vendor watchlist, inspect evidence per NPI, manage & escalate disputes, track recovery |
| **Physician** | Licensed provider with claims under their NPI | Review claims billed under their NPI, dispute or report fraud, track dispute outcomes |
| **Vendor / Supplier** | Billing entity (e.g., DME, hospice, home-health) | View their claims, respond to disputes, upload proof-of-work documents |
| **Compliance Team** | Handles escalations | Receive and action cases escalated past SLA / non-responsive vendors |
| **System (automated)** | ETL, rules engine, scoring, notification jobs | Ingest data, flag fraud, score risk, notify parties — no human interaction |
| **Administrator** | Platform operator | Manage users/accounts, configuration, deployment |

---

## 7. Business Requirements

*(Written at business level; detailed acceptance criteria live in `FUNCTIONAL_REQUIREMENTS.md`.)*

### 7.1 Fraud Detection & Risk Scoring
- **BR-101** The system shall automatically evaluate all claims against a defined set of fraud-pattern rules.
- **BR-102** The system shall assign each NPI and each vendor a numeric **risk score** and a risk band (Critical / High / Medium / Low).
- **BR-103** The system shall record, for every flag, the **evidence** (rule, contributing claims, severity) so an investigator can justify action.
- **BR-104** The system shall re-run detection and scoring repeatably (idempotently) so results are consistent and refreshable.

**Fraud rules covered (16):**

| Rule | What it detects (business terms) |
|---|---|
| Volume spike | Sudden surge in an NPI's claim rate vs its own baseline |
| Geographic anomaly | Patient location implausibly far from the provider's practice |
| Cross-NPI supplier | One vendor billing across many unrelated physicians |
| New high-value supplier | Newly appearing vendor billing high-value claims |
| OIG LEIE hit | Vendor/provider on the OIG exclusion list |
| Duplicate billing | Same service billed more than once |
| Identity reuse | Same patient identity reused across implausible claims |
| Abnormal hospice duration | Hospice episodes of implausible length |
| Upcoding | Billing a higher-complexity code than warranted |
| Unbundling | Splitting a bundled service into separately billed codes |
| Deceased patient | Claims dated after a patient's death |
| Impossible day | More services/hours billed in a day than physically possible |
| Modifier abuse | Improper use of billing modifiers to inflate payment |
| Rapid cycling | Rapid repeated billing cycles indicating automation/abuse |
| Supplier concentration | A physician's claims abnormally concentrated in one vendor |
| Ghost billing | Billing for services never actually provided |

### 7.2 Payer / Investigator Portal
- **BR-201** Provide a **fraud command centre** highlighting what needs attention now (overdue disputes, highest-risk NPI, repeat-offender vendors).
- **BR-202** Provide a **physician risk leaderboard** sortable by risk, claims, billed amount, and flags.
- **BR-203** Provide a **vendor watchlist** and a per-vendor **case view** (all NPIs a vendor bills, flags, total billed).
- **BR-204** Provide an **NPI detail** view with score breakdown, fired rules, claims, and drill-down evidence.
- **BR-205** Provide network-level **analytics** (claims trend, reviewed vs flagged, recovery rate, open vs closed cases, total billed/challenged).

### 7.3 Physician Portal
- **BR-301** Allow a physician to view **all claims billed under their NPI**, filterable by vendor, category, and status.
- **BR-302** Allow a physician to **dispute** a claim, **report it as fraud**, or flag a **deceased-patient** claim.
- **BR-303** Allow a physician to **track every dispute** they raised and its resolution status.
- **BR-304** Allow a physician to **review and confirm/reject** a vendor's response to their dispute.

### 7.4 Vendor Portal
- **BR-401** Allow a vendor to view **their own claims** and an **"action required"** queue of open disputes.
- **BR-402** Allow a vendor to **respond to a dispute** and **upload supporting documents** (proof of work).
- **BR-403** Show the vendor a **countdown to the response deadline** for each open case.

### 7.5 Dispute & Resolution Lifecycle
- **BR-501** When a physician disputes/reports a claim, the system shall open a **dispute case** and (after a configurable undo window) **notify the billing vendor**.
- **BR-502** The vendor shall have a **defined response window (SLA, e.g., 15 days)**; the case shall track days remaining.
- **BR-503** If the vendor does not respond within the SLA, the case shall be marked **non-responsive** and become eligible for **escalation to compliance/payer**.
- **BR-504** The physician shall be able to **confirm resolution or reject** the vendor's response, moving the case to its next state.
- **BR-505** The system shall maintain a complete, ordered **event history** for every case (raised → notified → responded → confirmed/escalated).

*Dispute case states:* Open · Pending Physician Review · Pending Physician Confirmation · Responded to Medicare · Resolved by Physician · Non-Responsive · Referred to Payer.

### 7.6 Notifications & Real-Time Alerts
- **BR-601** The system shall push **real-time alerts** to the relevant portal when a case changes (vendor responds, case reopened, escalation), without manual refresh.
- **BR-602** Each role shall have a **notification centre** (bell) showing events caused by others, with unread counts.
- **BR-603** The system shall send **email notifications** for key events (dispute raised to vendor, response due, login OTP).

### 7.7 Authentication, Access & Provider Verification
- **BR-701** All portals shall require **authenticated login** with role-based access.
- **BR-702** Login shall support a **second factor** — email OTP — with optional TOTP-based MFA.
- **BR-703** Registration shall **verify provider identity** against NPI/NPPES, OIG exclusion, DEA, State License, PTAN, and SAM/UEI checks (mocked in the current phase).
- **BR-704** A user shall only see data appropriate to their **role and identity** (a physician sees only their NPI; a vendor sees only their claims).

### 7.8 Compliance, Audit & Data
- **BR-801** The system shall keep an **audit log** of every physician/vendor/investigator action and every case state change.
- **BR-802** **Patient identifiers (PHI)** shall be minimised/masked in the UI (e.g., partial names, masked MBI).
- **BR-803** The system shall retain claims, flags, scores, disputes, and audit history for reporting and investigation.

---

## 8. Key Business Processes

**Fraud-to-resolution flow:**
1. Claims are ingested and screened (incl. OIG exclusion check) by the system.
2. The rules engine flags suspicious claims; risk scores are computed per NPI/vendor.
3. An investigator (or a physician) reviews flagged claims and evidence.
4. A physician disputes / reports a claim → a **dispute case** opens.
5. The vendor is notified and has an SLA window to respond (with documents).
6. The physician confirms or rejects; unresponsive cases escalate to compliance.
7. Every step is recorded for audit; dashboards reflect updated risk & recovery metrics.

---

## 9. Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Security** | Encrypted credentials, JWT sessions, email-OTP second factor, optional TOTP MFA, encryption of sensitive secrets at rest, role-based authorisation. |
| **Compliance / Privacy** | Handle PHI in line with **HIPAA** principles — data minimisation, masking of patient identifiers, least-privilege access, auditability. |
| **Auditability** | Full, immutable action & case-event history for every dispute and decision. |
| **Performance** | Dashboards and lists should load responsively; real-time alerts delivered within seconds of an event. |
| **Availability & Recoverability** | Backend and frontend run as managed services with restart-on-failure; database backups before schema changes. |
| **Usability** | Clear role-specific navigation; deep-linkable URLs per screen; consistent look across portals. |
| **Maintainability** | Schema evolution via migrations; environment-based configuration; documented deploy process. |

---

## 10. Data Requirements

- **Core entities:** claims, NPI/physician profiles, vendor/supplier profiles, actions, rules-flags, risk scores, dispute cases & events, claim notifications, documents, physician bills.
- **Reference data:** OIG LEIE exclusion lists (NPIs and names).
- **Sensitive data:** patient name/zip/MBI (masked/minimised), physician contact details.
- **Data sources:** CMS / NPPES / OIG (snapshot or mocked in current phase; live integration is a future enhancement).
- **Retention:** claims, flags, scores, and full dispute/audit history retained for investigation & reporting.

---

## 11. Assumptions, Constraints & Dependencies

**Assumptions**
- Current dataset is **synthetic/demo** (~18k claims, 100 physicians, 100 vendors).
- CMS/NPPES/OIG/DEA/SAM verifications are **mocked** for demonstration.
- Detection is **rules-based** (no ML) in this phase.

**Constraints**
- Single-region cloud deployment (AWS); shared server resources.
- Real-time alerts use in-process broadcasting (single backend worker) — horizontal scaling of the API requires a shared message broker (future).
- Email delivery depends on an external SMTP provider.

**Dependencies**
- External data feeds (CMS/NPPES/OIG) for production accuracy.
- SMTP service for OTP and notification emails.
- Cloud hosting (AWS) and PostgreSQL database.

---

## 12. Success Metrics / KPIs

| KPI | Definition |
|---|---|
| Fraudulent billing challenged ($) | Total dollar value of billing raised in disputes/fraud reports |
| High-risk NPIs identified (#) | Count of NPIs scored in the Critical/High band |
| Detection precision / false-positive rate | Share of flags confirmed as genuine after review |
| Dispute resolution rate | % of opened cases resolved (vs still open) |
| Average time-to-resolution | Mean time from dispute raised to closure |
| Recovery rate | % of challenged amount resolved without escalation |
| Vendor responsiveness | % of disputes answered within the SLA window |

---

## 13. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| False positives flag legitimate providers | Provider friction, wasted investigator time | Evidence-backed flags, tunable weights/thresholds, human review before action |
| PHI exposure / HIPAA non-compliance | Legal & reputational | Data masking, least-privilege access, audit logs, encryption |
| Low user adoption (physicians/vendors) | Workflow stalls | Clear notifications, simple dispute UX, SLA-driven prompts |
| Poor / stale reference data (OIG, NPPES) | Missed or wrong flags | Live data integration (future), scheduled refresh |
| Scaling limits (single-worker real-time) | Degraded performance at load | Move real-time to a shared broker; production build & tuning |
| Mocked verifications mistaken for real | Compliance gap in production | Clearly gate mocks behind config; enable live checks before go-live |

---

## 14. Glossary

| Term | Meaning |
|---|---|
| **NPI** | National Provider Identifier — unique ID for a healthcare provider |
| **CCN** | Claim Control Number |
| **HCPCS / CPT** | Standard procedure/service billing codes |
| **MBI** | Medicare Beneficiary Identifier (patient) |
| **OIG LEIE** | Office of Inspector General — List of Excluded Individuals/Entities |
| **NPPES** | National Plan & Provider Enumeration System (NPI registry) |
| **FWA** | Fraud, Waste & Abuse |
| **Upcoding / Unbundling / Ghost billing** | Common fraudulent billing techniques |
| **SLA** | Service-Level Agreement — the vendor response deadline |
| **Dispute case** | A tracked record of a physician's challenge to a claim |

---

## 15. References
- `FUNCTIONAL_REQUIREMENTS.md` — detailed feature-level requirements & acceptance criteria
- `HLD.md` / `LLD.md` — architecture & design
- `DB_SCHEMA.md` — data model
- `DATA_FLOW.md` — end-to-end data flow
- `API_SPEC.md` — API contract

---

## 16. Approvals

| Name | Role | Signature | Date |
|---|---|---|---|
| | Business Analyst | | |
| | Product Owner / Manager | | |
| | Compliance | | |
| | Engineering Lead | | |
