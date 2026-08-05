# MEDICLAIM ANALYTICS
## User Guide
How the product works, who uses each part, and what every screen does

Version 1.0  |  4 August 2026
Prepared by: Poorvi Yadav (Developer)
Project Manager: Abhi Harshwal
Clients: Noel & Shawn  |  ProMed Medical Supplies

---

## How to use this document

This guide is organised the way the product is actually used — by role. Read
Part 1 for the concepts, then jump to the part that matches your role
(Physician, Payer, or Vendor). Parts 5 to 8 are reference material you look up
rather than read start to finish.

**Screenshot placeholders.** Every screen in this guide has a marked slot like
the one below. Replace the block with your image; keep the caption line, because
the numbered callouts in the surrounding text refer to it.

> ### 📷 SCREENSHOT SLOT — S-00
> **Caption:** *Short description of what the reader is looking at.*
> **Capture:** Which URL / which state the app should be in.
> **Callouts to mark on the image:** ① first thing to point at ② second thing
> **Suggested size:** Full-width, 1440 × 900

A consolidated list of every screenshot slot, in capture order, is in
[Appendix A](#appendix-a--screenshot-capture-checklist).

---

# TABLE OF CONTENTS

**Part 1 — Understanding the Product**
1.1 What MediClaim does
1.2 The three portals
1.3 How data flows through the system
1.4 Key terms

**Part 2 — Getting Started**
2.1 The landing page
2.2 Registering as a physician
2.3 Registering as a payer
2.4 Registering as a vendor
2.5 Signing in (password + email OTP)
2.6 Which portal you land in

**Part 3 — Physician Portal**
3.1 My Dashboard
3.2 My Claims
3.3 Claim Detail — and the six decisions
3.4 My Disputes
3.5 Dispute Detail — reviewing what the vendor sent
3.6 Your notification bell

**Part 4 — Payer Portal**
4.1 Dashboard
4.2 Physician Risk Leaderboard
4.3 NPI Detail
4.4 Vendor Watchlist
4.5 Vendor Case
4.6 NPI Disputes
4.7 Dispute Detail — and the four compliance actions
4.8 The AI Assistant
4.9 Live alerts

**Part 5 — Vendor Portal**
5.1 Dashboard
5.2 Claims
5.3 Action Required
5.4 Responding to a dispute
5.5 The emailed link (no login)

**Part 6 — The Dispute Lifecycle**
6.1 The full journey
6.2 Status reference
6.3 Deadlines and what happens when they pass

**Part 7 — Fraud Rules Reference**

**Part 8 — Risk Score Reference**

**Appendices**
A — Screenshot capture checklist
B — Glossary
C — Frequently asked questions

---
---

# PART 1 — UNDERSTANDING THE PRODUCT

## 1.1 What MediClaim does

MediClaim Analytics is an **NPI intelligence platform**. It sits on top of a
stream of medical claims and answers two questions that nobody could previously
answer quickly:

**For a physician:** *"Is someone billing Medicare using my NPI without my
knowledge?"*

A physician's National Provider Identifier is effectively a signing authority.
Any vendor — a DME supplier, a home health agency, a hospice — can submit a
claim naming that physician as the ordering provider. Historically the physician
never found out. MediClaim shows every claim filed under their NPI and lets them
approve or challenge each one, the way you would review a credit card statement.

**For a payer:** *"Of the thousands of NPIs and vendors we pay, which ones
should we investigate first?"*

The platform runs sixteen fraud detection rules across the claim population,
combines what fires into a single 0–100 risk score per physician and per vendor,
and ranks them. Investigators work top-down instead of sampling at random.

The two answers come from **one data feed**. A physician flagging a claim
immediately raises the risk score the payer sees — the physician's local
knowledge becomes the payer's signal, in real time.

> ### 📷 SCREENSHOT SLOT — S-01
> **Caption:** *MediClaim Analytics — the landing page.*
> **Capture:** `/welcome`, logged out, full page
> **Callouts:** ① product name ② the two "Sign in" / "Register" entry points
> **Suggested size:** Full-width, 1440 × 900

---

## 1.2 The three portals

One application, three completely separate experiences. A user only ever sees
the portal their role grants.

| Portal | Who signs in | What they do | URL |
|---|---|---|---|
| **Physician Portal** | The doctor whose NPI is on the claims | Review claims filed under their NPI; confirm, dispute, or report fraud | `/physician` |
| **Payer Portal** | Plan investigators, compliance officers | Rank NPIs and vendors by risk, investigate cases, act on escalations | `/payer` |
| **Vendor Portal** | The billing supplier | See the confirmation status of their claims; answer disputes with documentation | `/vendor/portal` |

A fourth, login-free surface exists: a **token-gated dispute page**
(`/vendor/disputes/{case_id}`) that a vendor reaches from an emailed link. It
shows exactly one case and nothing else.

> ### 📷 SCREENSHOT SLOT — S-02
> **Caption:** *The three portals side by side.*
> **Capture:** Compose three browser windows — physician dashboard, payer
> dashboard, vendor dashboard — into one image
> **Callouts:** ① Physician ② Payer ③ Vendor
> **Suggested size:** Full-width

---

## 1.3 How data flows through the system

Read this once and the rest of the guide will make sense.

```
   ┌──────────────────────────────────────────────────────────────┐
   │ 1. CLAIMS ARRIVE                                             │
   │    Each claim names a patient, a service (HCPCS code), a     │
   │    billing vendor, an ordering physician NPI, and an amount. │
   └───────────────────────────┬──────────────────────────────────┘
                               ▼
   ┌──────────────────────────────────────────────────────────────┐
   │ 2. ENRICHMENT                                                │
   │    • Vendor names are resolved to one canonical entity        │
   │    • Vendors are checked against the federal OIG exclusion    │
   │      list (LEIE)                                              │
   │    • Addresses are geocoded so distance can be measured       │
   └───────────────────────────┬──────────────────────────────────┘
                               ▼
   ┌──────────────────────────────────────────────────────────────┐
   │ 3. RULES ENGINE — 16 fraud rules run                         │
   │    Each rule that fires writes a flag against the physician   │
   │    NPI and/or the vendor, with the evidence that triggered it │
   └───────────────────────────┬──────────────────────────────────┘
                               ▼
   ┌──────────────────────────────────────────────────────────────┐
   │ 4. RISK SCORING — one 0-100 score per NPI and per vendor      │
   │    Rule points + physician feedback → saturating curve (0-80) │
   │    plus continuous signals (volume, dollars, breadth) (0-20)  │
   └──────────────┬───────────────────────────────┬───────────────┘
                  ▼                               ▼
   ┌──────────────────────────┐   ┌───────────────────────────────┐
   │ 5a. PHYSICIAN PORTAL     │   │ 5b. PAYER PORTAL              │
   │  Sees their own claims.  │   │  Sees the ranked population.  │
   │  Confirms / disputes /   │   │  Investigates top risks.      │
   │  reports fraud.          │   │  Acts on escalated cases.     │
   └──────────────┬───────────┘   └───────────────▲───────────────┘
                  │                               │
                  │  A dispute opens a CASE       │  Score rises
                  ▼                               │  immediately
   ┌──────────────────────────────────────────────┴───────────────┐
   │ 6. VENDOR PORTAL — 15 days to respond with documentation      │
   │    Responds → physician reviews → approved or declined        │
   │    Silent → case escalates to the payer automatically         │
   └──────────────────────────────────────────────────────────────┘
```

The loop in steps 5 and 6 is the heart of the product. Everything else exists to
feed it.

> ### 📷 SCREENSHOT SLOT — S-03
> **Caption:** *The data flow, as drawn above.*
> **Capture:** Redraw the ASCII diagram as a clean graphic, or screenshot it
> **Suggested size:** Full-width

---

## 1.4 Key terms

You need six terms to read this guide. The full glossary is
[Appendix B](#appendix-b--glossary).

**NPI** — National Provider Identifier. The 10-digit number that identifies a
physician. Claims are filed *under* an NPI.

**Claim** — One billed service. Carries a claim number (CCN), patient, date of
service, HCPCS code and description, service category, billing vendor, ordering
physician NPI, amount billed, and amount paid.

**Vendor** — The supplier that submitted the claim and gets paid. Called
"supplier" in some older screens.

**Fraud rule** — One detection pattern, e.g. *Ghost Billing*. When its
condition is met it *fires* and writes a **flag**.

**Risk score** — A 0–100 number per physician NPI and per vendor. Higher is
riskier. Grouped into four **bands**:

| Band | Score range | Meaning |
|---|---|---|
| **Critical** | 81 – 100 | Investigate now |
| **High** | 61 – 80 | Investigate soon |
| **Medium** | 31 – 60 | Monitor |
| **Low** | 0 – 30 | Nothing notable |

**Dispute case** — Opened when a physician challenges a claim. Has a case ID, a
15-day vendor response deadline, a status, and a full event timeline. This is the
object all three portals collaborate on.

---
---

# PART 2 — GETTING STARTED

## 2.1 The landing page

Everyone arrives at `/welcome`. It explains the product and offers two doors:
**Sign in** for existing users and **Register** for new accounts.

*See screenshot S-01.*

---

## 2.2 Registering as a physician

Registration starts by choosing which of the three roles you are:

| Card | For | Registers |
|---|---|---|
| 🩺 **Physician** | A licensed physician | Monitoring claims filed under your NPI |
| 🏢 **Payer Organization** | A health plan or payer | Investigating risk across the population |
| 🚚 **Vendor** | A supplier | Viewing and responding to claims you filed |

All three self-register. Vendors also have a login-free route into a single case
via an emailed link — see [5.5](#55-the-emailed-link-no-login).

> ### 📷 SCREENSHOT SLOT — S-04
> **Caption:** *Registration — choosing Physician, Payer, or Vendor.*
> **Capture:** `/register`, before selecting a card
> **Callouts:** ① Physician card ② Payer Organization card ③ Vendor card
> **Suggested size:** 1200 × 800

**What you enter**

| Field | Required | Notes |
|---|---|---|
| Email address | Yes | Becomes your username, and where alerts are sent |
| Password | Yes | Minimum 8 characters; a strength meter shows as you type |
| Confirm password | Yes | Must match |
| First name / Last name | Yes | |
| **NPI number** | Yes | 10 digits. Verified live against the NPPES registry |
| Date of birth | No | Used only to match your identity if a question arises |
| Phone | Yes | Best number to reach you |
| Organization / Practice | Yes | |
| Specialty | No | |
| Tax ID / EIN | No | Organisation-level EIN, if applicable |

**The NPI check.** As soon as ten digits are entered the form calls the NPPES
registry and shows one of three results underneath the field:

- *Verifying NPI…* — the check is in flight
- **✓ NPI verified — {name from NPPES}** — the number exists and matches a real provider
- **✗ NPI not found** — nothing in NPPES matches; check for a typo

This is a real registry lookup, not a format check. It is what stops someone
registering against an NPI that does not exist.

> ### 📷 SCREENSHOT SLOT — S-05
> **Caption:** *Physician registration with the NPI verified against NPPES.*
> **Capture:** `/register` → Physician, all fields filled, NPI showing the green
> ✓ confirmation line
> **Callouts:** ① NPI field ② "✓ NPI verified" line ③ password strength meter
> **Suggested size:** 1200 × 900

**No document uploads.** A note above the submit button explains why: on submit,
your identity is verified against **NPPES**, **PECOS**, your **state medical
board**, and **CMS enrollment records**. You do not upload your DEA
registration, state licence, or PTAN — those are checked against the source
systems instead, and the results appear as credential checks on the payer's view
of your NPI (see [4.3](#43-npi-detail)).

**Submitting.** The form runs through its verification steps in sequence and
shows each one resolving. If a step fails, the sequence stops there and tells you
which one and why. Nothing is created until every step passes.

> ### 📷 SCREENSHOT SLOT — S-06
> **Caption:** *Registration verification steps resolving one by one.*
> **Capture:** Immediately after clicking submit, while the step list is visible
> **Callouts:** ① completed steps ② the step currently running ③ the
> "no documents needed" note
> **Suggested size:** 900 × 700

---

## 2.3 Registering as a payer

Same form, **Payer** card selected. Payer registration identifies an
*organisation* rather than an individual, so it collects organisational
credentials instead of clinical ones. There is no NPI field and no NPPES check.

**What you enter**

| Field | Required | Notes |
|---|---|---|
| Email address | Yes | Becomes your username |
| Password | Yes | Minimum 8 characters |
| Confirm password | Yes | Must match |
| **Organization name** | Yes | Your health plan or payer organisation |
| **UEI** | Yes | 12-character Unique Entity Identifier. Verified live against SAM.gov |
| Authorized signatory name | Yes | Who is authorising this registration |
| Authorized signatory title | Yes | e.g. *Chief Compliance Officer* |
| **Attestation** | Yes | Checkbox confirming your authority to register the organisation |

**The UEI check** mirrors the physician NPI check. Enter twelve alphanumeric
characters and the form looks the organisation up in **SAM.gov**, then shows the
verified legal name it found. Two things can stop you:

- **Invalid UEI format** — the identifier is malformed
- **Organization found on SAM.gov exclusion list** — the organisation is
  federally excluded and cannot be registered

As with physician registration, the verification steps play out visibly and the
account is only created if every one passes.

> ### 📷 SCREENSHOT SLOT — S-07
> **Caption:** *Payer registration with the UEI verified against SAM.gov.*
> **Capture:** `/register` → Payer, all fields filled, UEI showing its verified
> organisation name
> **Callouts:** ① organisation name ② UEI field ③ SAM.gov verification result
> ④ authorised signatory ⑤ attestation checkbox
> **Suggested size:** 1200 × 900

---

## 2.4 Registering as a vendor

Same form, **Vendor** card selected. A vendor is identified by its
**organisational NPI** — the supplier's own NPI, not a physician's.

**What you enter**

| Field | Required | Notes |
|---|---|---|
| Email address | Yes | Becomes your username, and where dispute notices are sent |
| Password | Yes | Minimum 8 characters |
| Confirm password | Yes | Must match |
| **NPI number** | Yes | 10-digit organisational NPI. Verified against the supplier registry |
| Contact name | No | Who to address on account communications |
| Contact phone | No | |

**The NPI check does two things at once.** On submit your NPI is verified against
the **supplier registry** *and* the **OIG exclusion list**. A failure reads
**"✗ NPI not found or excluded"** — one message for two different problems,
because the outcome is the same either way: an excluded supplier cannot hold an
account on the platform.

No documents are required.

> ### 📷 SCREENSHOT SLOT — S-41
> **Caption:** *Vendor registration with the organisational NPI verified.*
> **Capture:** `/register` → Vendor, fields filled, NPI showing the green ✓ line
> **Callouts:** ① organisational NPI field ② verification result ③ the
> "supplier registry and OIG exclusion list" note
> **Suggested size:** 1200 × 900

---

## 2.5 Signing in (password + email OTP)

Sign-in is **two steps**. Both are required for every user, every time — this is
the platform's multi-factor authentication.

**Step 1 — Email and password.** At `/login`.

> ### 📷 SCREENSHOT SLOT — S-08
> **Caption:** *Step 1 — email and password.*
> **Capture:** `/login`
> **Callouts:** ① email ② password ③ Sign in button
> **Suggested size:** 1100 × 800

**Step 2 — The emailed code.** A one-time code is sent to your registered email
address and you land on `/otp/login`. Enter the code to complete sign-in.

> ### 📷 SCREENSHOT SLOT — S-09
> **Caption:** *Step 2 — entering the one-time code from email.*
> **Capture:** `/otp/login`, code partly entered
> **Callouts:** ① code entry field ② resend option ③ which email it went to
> **Suggested size:** 1100 × 800

**Why this matters for deep links.** If you click a link into the app while
signed out — a vendor clicking *Upload documentation* in a dispute email, for
example — the app remembers where you were headed, takes you through both login
steps, and then delivers you to that exact page rather than dumping you on a
generic dashboard.

**Notes**

- Repeated failed attempts trigger a 15-minute lockout.
- Older authenticator-app (TOTP) screens still exist in the codebase but are not
  part of the live login flow. Email OTP replaced them.
- After a backup-code sign-in, a one-time amber banner warns you if you are
  running low on codes.

---

## 2.6 Which portal you land in

Your role decides, automatically:

| Role | Lands on |
|---|---|
| `physician` | `/physician/dashboard` |
| `plan_investigator` | `/payer/dashboard` |
| `vendor` | `/vendor/portal` |

Roles are enforced on every route. A physician who types a `/payer` URL is
redirected back to their own dashboard — not shown an error, simply returned
where they belong. Old `/plan/*` links redirect to `/payer/*`.

---
---

# PART 3 — PHYSICIAN PORTAL

**Who this part is for:** the physician whose NPI appears on claims.

**What you can do here:** see every claim filed under your NPI, record a
decision on each one, and follow what happens after you challenge one.

**Navigation.** Three items, always in the left rail:

| Item | Purpose |
|---|---|
| **My Dashboard** | Your at-a-glance position |
| **My Claims** | Every claim under your NPI — where you act |
| **My Disputes** | Claims you have challenged, and where each stands |

> ### 📷 SCREENSHOT SLOT — S-10
> **Caption:** *Physician Portal — navigation and shell.*
> **Capture:** `/physician/dashboard`, full window
> **Callouts:** ① nav rail ② notification bell ③ your name and NPI ④ profile menu
> **Suggested size:** Full-width, 1440 × 900

---

## 3.1 My Dashboard

Your landing screen. It answers "is anything wrong, and does anything need me
today?" without you reading a single claim row.

**Your identity block** confirms whose data you are looking at: name, NPI, and
practice. Worth a glance — everything below is scoped to this NPI.

**Headline metrics**

| Metric | What it means |
|---|---|
| **Confirmation Rate** | Share of claims under your NPI you have confirmed as legitimate. Rises as you work through your queue. |
| **Dispute Resolution Rate** | Of the disputes you have opened, how many have reached a conclusion. Measures whether your challenges are actually going anywhere. |
| **Needs Your Confirmation** | Cases where a vendor has responded and is waiting on your verdict. **This is your to-do count.** Anything above zero is tagged *Action needed*. |
| **Fraud Reported** | How many claims you have escalated as fraud. |

**Claim decision breakdown** — a visual split of your claims by what you decided:
Confirmed, Disputed, Flagged, and so on. A large unreviewed slice means a backlog.

> ### 📷 SCREENSHOT SLOT — S-11
> **Caption:** *My Dashboard — metrics and claim decision breakdown.*
> **Capture:** `/physician/dashboard` with a populated account
> **Callouts:** ① identity block ② Confirmation Rate ③ Needs Your Confirmation
> (with the *Action needed* tag) ④ decision breakdown
> **Suggested size:** Full-width, 1440 × 900

---

## 3.2 My Claims

The working screen. Every claim any vendor has filed under your NPI, one row
each.

**Columns:** Claim (CCN) · Vendor · DOS (date of service) · Service Category ·
status badge · action buttons.

**Sorting.** Click Vendor, DOS, or Service Category to sort. The claim number
is deliberately not sortable — CCNs have no meaningful order.

**Filtering.** Filter by vendor, by claim number, by date range, and by service
category. *Clear all* resets everything including sort.

**Status badges** — one per row, showing where that claim stands:

| Badge | Meaning |
|---|---|
| **Unreviewed** | You have not decided yet |
| **Reviewed** | Opened, no decision recorded |
| **Confirmed** | You confirmed it as legitimate |
| **Disputed** | You challenged the details |
| **Fraud Reported** | You escalated it as fraud |
| **Flagged** | You flagged the vendor |
| **Unknown Patient** | You do not recognise the patient |
| **Deceased Patient** | You reported the patient as deceased |

> ### 📷 SCREENSHOT SLOT — S-12
> **Caption:** *My Claims — the full claims table.*
> **Capture:** `/physician/claims` with a mix of statuses visible
> **Callouts:** ① filter bar ② sortable headers ③ status badges ④ inline action
> buttons ⑤ Clear all
> **Suggested size:** Full-width, 1440 × 900

---

## 3.3 Claim Detail — and the six decisions

Click any row to open the claim in full: patient, service description and HCPCS
code, dates, amounts billed and paid, the vendor, and a **timeline** showing
when the vendor submitted it and every decision recorded since.

> ### 📷 SCREENSHOT SLOT — S-13
> **Caption:** *Claim Detail — full claim, with the six decision buttons.*
> **Capture:** `/physician/claims/{claimId}` on an undecided claim
> **Callouts:** ① claim facts ② timeline ③ the six decision buttons
> **Suggested size:** Full-width, 1440 × 900

### The six decisions

This is the most important table in the guide for a physician. Each button means
something specific and triggers something different downstream.

| Decision | Choose it when | What happens next |
|---|---|---|
| ✅ **Confirm** | The claim is legitimate — you recognise the vendor and the service | Recorded. Nothing escalates. Your confirmation rate rises. |
| 💬 **Dispute** | The amount or the service details look wrong to you | **Opens a dispute case.** The vendor is notified and has 15 days to respond with documentation. |
| 🛡️ **Report Fraud** | The claim appears fraudulent — billed for a service never provided | **Opens a dispute case at the highest severity.** Vendor notified, 15-day clock starts, and the payer sees a fraud report. |
| 🚩 **Flag Vendor** | The vendor is unknown or suspicious to you | Opens a case and raises the vendor's risk score. |
| 👤 **Reassign Patient** | You do not recognise the patient on this claim | Opens a case; recorded as an unknown-patient signal. |
| 💔 **Deceased Patient** | The patient is deceased, so the service could not have happened | Opens a case; recorded as a deceased-patient signal. |

Each button carries its own colour, so a decided claim reads at a glance —
green for confirmed, amber for disputed, red for fraud.

**The undo window.** Every decision can be undone shortly after you record it.
The vendor notification is intentionally *delayed* by that window, so an
accidental click never reaches the vendor. Once the window closes, the
notification goes out and the decision is part of the record.

**What your decision does to the payer's view.** Immediately, without waiting
for a nightly job:

- Flag Vendor, Reassign Patient, and Deceased Patient each add **5 points** to
  the relevant risk score
- A did-not-order denial adds **10 points**
- Physician feedback is capped at **20 points** in total, so no single
  physician's activity can dominate a score

> ### 📷 SCREENSHOT SLOT — S-14
> **Caption:** *Recording a decision, and the undo option.*
> **Capture:** Just after clicking Dispute, with the confirmation and undo
> affordance visible
> **Callouts:** ① recorded decision ② Undo
> **Suggested size:** 1200 × 700

---

## 3.4 My Disputes

Every claim you have challenged, and where each one stands. This is where you
come back to.

**Filter by type:** All · Disputed · Fraud reported · Deceased patient

**Filter by stage:**

| Filter | Meaning |
|---|---|
| **Not yet notified** | The case is open; the vendor has not been notified yet |
| **Awaiting vendor** | Vendor notified, clock running. Shows days remaining. |
| **Vendor responded** | Documents are in — **your review is needed** |
| **Overdue** | The 15 days elapsed with no response. Escalated to compliance. |

Each row shows a plain-language stage line, for example *"Awaiting vendor · 6d
left"*, *"Vendor uploaded docs — review"*, or *"Overdue — escalated to
compliance"*.

> ### 📷 SCREENSHOT SLOT — S-15
> **Caption:** *My Disputes — cases across every stage.*
> **Capture:** `/physician/disputes` showing awaiting, responded, and overdue rows
> **Callouts:** ① type filter ② stage filter ③ days-remaining indicator
> ④ a row needing your review
> **Suggested size:** Full-width, 1440 × 900

---

## 3.5 Dispute Detail — reviewing what the vendor sent

Open a case to see its whole history.

**The timeline** runs from your original challenge through every round of
back-and-forth: *"You disputed this claim"* → *"Vendor notified — 15 days to
respond"* → *"Vendor uploaded documentation"* → your verdict. Notes appear
quoted, and any uploaded document appears as a link you can open.

> ### 📷 SCREENSHOT SLOT — S-16
> **Caption:** *Dispute Detail — timeline with vendor documents attached.*
> **Capture:** `/physician/disputes/{id}` on a case where the vendor has responded
> **Callouts:** ① your original challenge ② vendor notified ③ vendor's note
> ④ downloadable documents ⑤ your Approve / Decline choice
> **Suggested size:** Full-width, 1440 × 900

**Your verdict.** When a vendor has uploaded documentation, you have **7 days**
to decide:

- **Approve** — the documentation satisfies you. The case closes as *Resolved by
  Physician*.
- **Decline** — it does not. The case is **referred to the payer**, arriving in
  their queue as *"Physician Declined — Your Review"* with your reason attached.

If you let the 7 days pass without deciding, the timeline records the window
expiring and the case moves on without your verdict.

Declining is not a dead end — it is a handoff. The payer has enforcement tools
you do not: suspending the vendor, referring to Medicare, or opening a formal
investigation.

---

## 3.6 Your notification bell

Top right, with an unread count. Opening it marks everything read.

**Tabs:** All · Fraud · Disputes

Each entry is one event on one of your cases, with a relative timestamp
("2h ago") and an icon showing the kind — a shield for fraud, a heart for
deceased-patient, a flag, a speech bubble for a dispute. Clicking an entry opens
that case.

> ### 📷 SCREENSHOT SLOT — S-17
> **Caption:** *Notification bell, open.*
> **Capture:** Physician portal, bell open, several notifications listed
> **Callouts:** ① unread badge ② tabs ③ one notification entry ④ Mark all read
> **Suggested size:** 800 × 700

---
---

# PART 4 — PAYER PORTAL

**Who this part is for:** plan investigators and compliance officers.

**What you can do here:** rank the entire monitored population by risk,
investigate any physician or vendor in depth, and act on cases escalated to you.

**Navigation.** Four items:

| Item | Purpose |
|---|---|
| **Dashboard** | What needs attention today |
| **Physician Leaderboard** | NPIs ranked by risk score |
| **Vendor Watchlist** | Vendors ranked by risk score |
| **NPI Disputes** | Every dispute case, and the ones awaiting your decision |

**Global search** sits in the header on every screen. Type an NPI, a physician
name, or a vendor name and jump straight there. On the NPI Disputes screen the
same box switches to searching claim numbers, vendors, and NPIs within the
dispute list.

**Breadcrumbs** show your position and are clickable — *Dashboard → Vendor
Watchlist → Acme Medical Supply*. Deep links, refresh, and browser back/forward
all work exactly as expected: every screen has a real URL, so you can bookmark an
NPI or paste a case link to a colleague.

> ### 📷 SCREENSHOT SLOT — S-18
> **Caption:** *Payer Portal — navigation, search, and breadcrumbs.*
> **Capture:** `/payer/dashboard`, full window
> **Callouts:** ① nav rail ② global search ③ breadcrumbs ④ notification bell
> ⑤ AI assistant launcher
> **Suggested size:** Full-width, 1440 × 900

---

## 4.1 Dashboard

Built around a simple question: *what should I look at first?*

**Three hero cards** — the day's three most urgent things, each a live summary
that clicks through to the work:

1. **Overdue disputes** — cases where the vendor's 15 days elapsed in silence.
   These are already escalated and waiting on you.
2. **Highest-risk physician** — the top NPI by risk score, named, with its score.
3. **Top offending vendor** — the vendor with the most concerning profile.

**Risk distribution** — how the monitored population splits across Critical,
High, Medium, and Low. This is your caseload shape: a growing Critical band
means the queue is getting worse.

**Activity feed** — dispute events as they happen, newest first, with relative
timestamps. Live: a vendor responding or a physician declining appears here
without a refresh.

> ### 📷 SCREENSHOT SLOT — S-19
> **Caption:** *Payer Dashboard — hero cards, risk distribution, activity feed.*
> **Capture:** `/payer/dashboard` with data
> **Callouts:** ① overdue disputes card ② highest-risk physician ③ top offending
> vendor ④ risk distribution ⑤ activity feed
> **Suggested size:** Full-width, 1440 × 900

---

## 4.2 Physician Risk Leaderboard

Every monitored NPI, ranked by risk score, highest first. The header greets you
by name with today's date instead of breadcrumbs.

**Band filter** — narrow to Critical, High, Medium, or Low. The selected band is
part of the URL (`/payer/leaderboard?band=critical`), so a filtered view is
shareable.

Each row shows the physician, their NPI, the risk score with its band colour,
and summary counts. Click a row for full detail. *View all* opens **All
Physicians** — the same data unranked, for when you are looking someone up rather
than working top-down.

> ### 📷 SCREENSHOT SLOT — S-20
> **Caption:** *Physician Risk Leaderboard, ranked by score.*
> **Capture:** `/payer/leaderboard`
> **Callouts:** ① greeting header ② band filter ③ risk score with band colour
> ④ a Critical-band row
> **Suggested size:** Full-width, 1440 × 900

---

## 4.3 NPI Detail

The full investigative picture for one physician. Reached from the leaderboard,
from a vendor case, from search, or from a direct link (`/payer/npi/{npi}`).

**Header** — name, NPI, practice, specialty, and the risk score with its band.

**Score breakdown** — *why* this NPI scores what it does, line by line: each
rule that fired with its point contribution, plus a **Physician feedback** row
covering flags raised by physicians. Read together with
[Part 8](#part-8--risk-score-reference) this makes the number fully auditable.

**Credential checks** — seven verifications, each Verified / Clear / Eligible or
flagged for review:

| Check | What it confirms |
|---|---|
| **NPPES** | The NPI exists in the federal registry |
| **OIG Exclusions** | Not on the federal exclusion list |
| **Order & Referring** | Eligible to order and refer, or needs manual review |
| **Revalidation** | Enrollment revalidation is current |
| **DEA License** | DEA registration status |
| **State License** | State medical license status |
| **PTAN** | Provider Transaction Access Number status |

Anything not clean is tinted — scan the column, not the labels.

**Claims table** — every claim under this NPI: Date · Patient · Description ·
Category · Vendor · Amount · Flags. Filter by category or by which rule flagged
it. Each row's Flags cell shows which rules fired on that specific claim, with
severity (Critical / High / Medium / Low) by point weight.

**Fraud patterns** — click any fired rule to open a drill-down explaining what
the pattern is and showing the exact claims that triggered it. This is your
evidence view: not "Volume Spike fired" but *these* claims, on *these* dates, at
*this* rate against *this* baseline.

**Physician actions** — every decision this physician recorded: Confirmed,
Disputed, Flagged Vendor, Unknown Patient, Deceased Patient, Did Not Order.

**Cross-navigation** — every vendor name opens that vendor's case; the Cross-NPI
pattern lets you jump to the other physicians the same vendor bills under. When
you arrive at an NPI from a vendor case, a *"← Back to {vendor}"* link appears so
you keep your place in the investigation.

> ### 📷 SCREENSHOT SLOT — S-21
> **Caption:** *NPI Detail — header, risk score, credential checks.*
> **Capture:** `/payer/npi/{npi}` on a Critical-band physician, top of page
> **Callouts:** ① identity ② risk score and band ③ score breakdown
> ④ credential checks
> **Suggested size:** Full-width, 1440 × 900

> ### 📷 SCREENSHOT SLOT — S-22
> **Caption:** *NPI Detail — claims with per-claim rule flags.*
> **Capture:** Same page, scrolled to the claims table
> **Callouts:** ① category filter ② flag filter ③ Flags cell with severity
> **Suggested size:** Full-width, 1440 × 900

> ### 📷 SCREENSHOT SLOT — S-23
> **Caption:** *Fraud pattern drill-down — the evidence behind a fired rule.*
> **Capture:** Same page, a pattern such as Cross-NPI Vendor expanded
> **Callouts:** ① rule name and explanation ② the triggering claims
> ③ cross-navigation link
> **Suggested size:** Full-width, 1440 × 900

---

## 4.4 Vendor Watchlist

The same idea as the leaderboard, for vendors. Ranked by risk score, filterable,
searchable from the header. *View all* opens **All Vendors**.

Vendors matter differently from physicians: a single fraudulent vendor typically
touches many NPIs, so one vendor case can unwind an entire ring.

> ### 📷 SCREENSHOT SLOT — S-24
> **Caption:** *Vendor Watchlist, ranked by risk.*
> **Capture:** `/payer/watchlist`
> **Callouts:** ① risk score ② a Critical vendor ③ search
> **Suggested size:** Full-width, 1440 × 900

---

## 4.5 Vendor Case

Full detail for one vendor (`/payer/vendor/{id}`): identity and NPI, risk score
with breakdown, OIG exclusion status, the physicians they bill under, their
claims, and every rule that fired against them.

**The physician list is the important part.** A vendor billing under many
unrelated NPIs is the Cross-NPI kickback signature. Click any physician to open
their NPI Detail; a back link returns you to the vendor.

> ### 📷 SCREENSHOT SLOT — S-25
> **Caption:** *Vendor Case — profile, risk, and the physicians billed under.*
> **Capture:** `/payer/vendor/{id}` on a high-risk vendor
> **Callouts:** ① vendor identity ② risk score ③ OIG status ④ physicians list
> ⑤ fired rules
> **Suggested size:** Full-width, 1440 × 900

---

## 4.6 NPI Disputes

Every dispute case in the system. Some are informational; some are waiting on
you specifically.

**Columns:** Claim # · Vendor · Due Date · Type · Status · Days Left · action

**Type** — Dispute, Fraud Report, or Deceased Patient, colour-coded.

**Status filter** — Open, Resolved, or All.

**Days Left sort** — *Overdue First* (your default when working the queue),
*High to Low*, or *Default Order*. Default Order means **most recently active
first**, so cases that just moved surface at the top.

**The action button tells you your role in the case.** *View* for cases that are
progressing normally; **Escalate** for cases that need you — vendor
non-responsive, physician declined, or deadline passed.

**Live updates.** The list refreshes itself when anything changes anywhere: a
vendor uploading documents or a physician recording a verdict updates this
screen without a reload.

**On mobile,** each case becomes a stacked card instead of a table row.

> ### 📷 SCREENSHOT SLOT — S-26
> **Caption:** *NPI Disputes — the full case queue.*
> **Capture:** `/payer/disputes`, mix of statuses including at least one Overdue
> **Callouts:** ① type badges ② status badges ③ Days Left chips (with Overdue)
> ④ Escalate vs View ⑤ column filters
> **Suggested size:** Full-width, 1440 × 900

---

## 4.7 Dispute Detail — and the four compliance actions

Open a case (`/payer/disputes/{caseId}`) for the complete record.

**Banner** — case ID, claim number, type and status badges, and four facts:
Vendor · Physician NPI · Response Due · Days Left (or *Overdue*).

**Claim details** — patient, service, HCPCS codes, dates of service, amount
billed, amount paid, physician, physician role, practice.

**Timeline** — every event in neutral third-person wording: *"Physician reported
this as fraud"*, *"Vendor notified"*, *"Vendor uploaded documentation"*,
*"Physician declined the response"*, *"Escalated to compliance"*. Notes appear
quoted; documents are downloadable. Escalation-flavoured events — overdue
escalation, expired confirmation window, rejected resolution — are marked in red.

Unlike the physician's view of the same case, compliance sees **every** vendor
response in full, whichever path the vendor took.

> ### 📷 SCREENSHOT SLOT — S-27
> **Caption:** *Dispute Detail — banner, claim details, full timeline.*
> **Capture:** `/payer/disputes/{caseId}` on a multi-round case
> **Callouts:** ① case banner with badges ② Days Left / Overdue ③ claim details
> ④ timeline ⑤ a red escalation event
> **Suggested size:** Full-width, 1440 × 900

### The four compliance actions

A **Compliance action** panel appears on the right when — and only when — a case
actually needs your decision:

- **Non Responsive** — the vendor let 15 days pass in silence
- **Physician Declined — Your Review** — the physician rejected the vendor's
  documentation and handed the case over

| Action | Use it when |
|---|---|
| 🛡️ **Refer to Medicare** | Evidence supports formal referral for recovery or prosecution |
| 🚩 **Suspend Vendor** | Stop paying this vendor pending investigation |
| 📄 **Request Documents** | You need more than what is on file before deciding |
| ✅ **Close Investigation** | No further action warranted |

Pick one, add optional notes explaining your reasoning, and submit. The decision
is written into the timeline with your notes attached, and the panel is replaced
by that timeline entry — the case now carries its own audit trail.

> ### 📷 SCREENSHOT SLOT — S-28
> **Caption:** *The Compliance action panel on an escalated case.*
> **Capture:** A case with status *Non Responsive* or *Physician Declined*, one
> action selected and notes typed
> **Callouts:** ① the four actions ② selected action ③ notes ④ Submit decision
> **Suggested size:** 1000 × 900

---

## 4.8 The AI Assistant

A chat panel available on every payer screen. It survives navigation — ask a
question, click into an NPI, come back, and the conversation is intact.

It answers from **live platform data plus the product's own rule definitions**,
so it can never describe a rule differently from the screen next to it. Both read
the same source.

**What it can do**

| Ask about | Example |
|---|---|
| Find an entity | *"Find Dr. Wilson"* / *"Look up NPI 1003000126"* |
| Explain a physician | *"Why is 1003000126 scoring 87?"* |
| Explain a vendor | *"Tell me about Acme Medical Supply"* |
| Explain a rule | *"What is cross-NPI billing?"* / *"What does ghost billing mean?"* |
| Explain the score | *"How is the risk score calculated?"* |
| Show evidence | *"Show me the claims that triggered the volume spike"* |
| Rank | *"Who are the top 10 critical-risk vendors?"* |
| Portfolio view | *"Give me an overview"* |
| Patients and claims | *"What's on claim {CCN}?"* / *"Look up this patient"* |
| Cases | *"What's the status of case 412?"* |
| Exclusions | *"Is this NPI on the OIG list?"* |

**It understands how people actually talk.** "Kickback", "ring", and "cross-NPI"
all resolve to the Cross-NPI Vendor rule. "OIG", "LEIE", "exclusion", and
"excluded" all reach the exclusion rule. "Phantom", "ghost", "upcode",
"unbundle", "dead", "impossible", "turnover" — all mapped.

**Design constraints worth knowing:** the assistant is **read-only** — it can
never change data — and every query is capped, so no question can pull an
unbounded result set.

> ### 📷 SCREENSHOT SLOT — S-29
> **Caption:** *The AI Assistant explaining a risk score.*
> **Capture:** Payer portal, assistant open, an answer that cites rules and points
> **Callouts:** ① launcher ② the question ③ the answer with specific figures
> **Suggested size:** 1000 × 900

---

## 4.9 Live alerts

The payer portal maintains a live connection to the server, so it does not need
polling or manual refreshes. When anything happens on a dispute case:

- the **notification bell** count updates
- the **activity feed** on the dashboard gains an entry
- the **NPI Disputes** list refetches
- an **open Dispute Detail** re-resolves to its new status

**The notification bell** has four tabs:

| Tab | Shows |
|---|---|
| **All** | Everything |
| **Reported** | A physician marked a claim — fraud, dispute, deceased, or flag |
| **Vendor response** | Documents uploaded, or the window expired unanswered |
| **Decisions** | A physician's approve or decline verdict |

Opening the bell clears the unread badge and refetches, so you never read a
stale snapshot. Clicking an entry opens that case.

> ### 📷 SCREENSHOT SLOT — S-30
> **Caption:** *Payer notification bell with its four tabs.*
> **Capture:** Payer portal, bell open, notifications across categories
> **Callouts:** ① unread badge ② tabs ③ a fraud-report entry ④ Mark all read
> **Suggested size:** 800 × 750

---
---

# PART 5 — VENDOR PORTAL

**Who this part is for:** the billing supplier.

**What you can do here:** see whether physicians have confirmed your claims, and
respond with documentation when one is challenged.

**Navigation.** Three items:

| Item | Purpose |
|---|---|
| **Dashboard** | Your claim and dispute position |
| **Claims** | Every claim you have submitted, with its confirmation status |
| **Action Required** | Disputes waiting on you — **the clock is running here** |

> ### 📷 SCREENSHOT SLOT — S-31
> **Caption:** *Vendor Portal — navigation and shell.*
> **Capture:** `/vendor/portal`, full window
> **Callouts:** ① nav rail ② Action Required ③ notification bell
> **Suggested size:** Full-width, 1440 × 900

---

## 5.1 Dashboard

**Urgency ring** — how close your open disputes are to their deadlines. This is
the number to watch: a case that runs out of time escalates to the payer
automatically and you lose the chance to explain.

**Countdown** — for your most urgent case, the days, hours, and minutes
remaining, shown as digits.

**Claim status breakdown** — Approved (physician confirmed), Pending (awaiting
review), and Action needed.

**Submission heatmap** — your claim submissions over time, calendar-style.

**Weekly status trend** — confirmed versus pending, week by week. A widening
pending gap means physicians are not keeping up, or something about your claims
is prompting hesitation.

> ### 📷 SCREENSHOT SLOT — S-32
> **Caption:** *Vendor Dashboard — urgency ring, countdown, trends.*
> **Capture:** `/vendor/portal` with at least one urgent open dispute
> **Callouts:** ① urgency ring ② countdown digits ③ status breakdown
> ④ submission heatmap ⑤ weekly trend
> **Suggested size:** Full-width, 1440 × 900

---

## 5.2 Claims

Every claim you have submitted, sortable and filterable.

**Claim status filter:** All · Pending · Confirmed · Action needed

**Dispute status filter:** All · Docs requested · Under review · Overdue · Closed

Click a claim to see its full record, including any dispute attached to it. A
**download** option exports your claims report.

> ### 📷 SCREENSHOT SLOT — S-33
> **Caption:** *Vendor Claims with both status filters.*
> **Capture:** `/vendor/portal/claims`, mixed statuses
> **Callouts:** ① claim status filter ② dispute status filter ③ status badges
> ④ download report
> **Suggested size:** Full-width, 1440 × 900

---

## 5.3 Action Required

Only the cases needing you. Three counters at the top:

| Counter | Meaning |
|---|---|
| **Open cases** | Disputes awaiting your response |
| **Overdue today** | Past deadline — already escalated |
| **Responses submitted** | Cases you have answered |

Each case shows the claim, what the physician said, the deadline, and days
remaining. **Respond** opens the response form.

> ### 📷 SCREENSHOT SLOT — S-34
> **Caption:** *Action Required — open cases with deadlines.*
> **Capture:** `/vendor/portal/action-required` with open and overdue cases
> **Callouts:** ① the three counters ② days remaining ③ Respond
> **Suggested size:** Full-width, 1440 × 900

---

## 5.4 Responding to a dispute

**You have 15 days from notification.** The case detail screen shows the
physician's challenge, the deadline, and the full timeline.

**To respond:** add a written explanation and upload supporting documentation —
the physician's order, delivery confirmation, signed paperwork, whatever
substantiates the claim. File names and sizes are shown as you attach them.

**After you submit,** the case moves to *Under review* and the physician has 7
days to decide:

- **They approve** → the case closes. You are notified: *"Your response was
  approved — case closed."*
- **They decline** → you are notified: *"Your response was declined."* The case
  goes to the payer, who may suspend you, refer the matter to Medicare, request
  more documents, or close it.

**If you do not respond within 15 days,** the case is marked **Non Responsive**
and escalates to the payer automatically. You lose the opportunity to explain,
and non-response is itself recorded on your file. Watch the urgency ring.

> ### 📷 SCREENSHOT SLOT — S-35
> **Caption:** *Responding to a dispute — note and document upload.*
> **Capture:** A vendor dispute detail with the response form open, a file attached
> **Callouts:** ① the physician's challenge ② deadline and days left
> ③ explanation field ④ uploaded documents ⑤ Submit
> **Suggested size:** Full-width, 1440 × 900

**Your notification bell** covers five events:

| Event | Notification |
|---|---|
| Dispute opened | A physician has challenged one of your claims |
| Vendor responded | Your response was recorded |
| Physician confirmed | *Your response was approved — case closed* |
| Physician rejected | *Your response was declined* |
| Non-responsive | The window closed without your response |

> ### 📷 SCREENSHOT SLOT — S-36
> **Caption:** *Vendor notification bell.*
> **Capture:** Vendor portal, bell open
> **Callouts:** ① unread badge ② notification entries
> **Suggested size:** 800 × 700

---

## 5.5 The emailed link (no login)

When a physician disputes a claim, the vendor receives an email with a link to
that single case (`/vendor/disputes/{case_id}`). The link is signed, so it grants
access to that one case and nothing else — no login required, no other data
visible.

This exists so a vendor can respond in minutes rather than hunting for
credentials. Vendors who do have accounts can use the full portal instead; the
emailed *Upload documentation* link takes them through login and delivers them to
the right case.

> ### 📷 SCREENSHOT SLOT — S-37
> **Caption:** *The token-gated public dispute page — one case, no login.*
> **Capture:** `/vendor/disputes/{case_id}` in a logged-out browser
> **Callouts:** ① the single case ② response form ③ no navigation to other data
> **Suggested size:** Full-width, 1440 × 900

---
---

# PART 6 — THE DISPUTE LIFECYCLE

This part explains the mechanism the whole product turns on. Read it once and
every status badge in every portal becomes self-explanatory.

## 6.1 The full journey

```
  ┌─────────────────────────────────────────────────────────────────┐
  │ A vendor submits a claim naming a physician's NPI               │
  └──────────────────────────────┬──────────────────────────────────┘
                                 ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │ PHYSICIAN reviews it in My Claims                               │
  └──────┬──────────────────────────────────────────────────────────┘
         │
         ├── Confirm ──────────────► Recorded. Nothing escalates. ✅
         │
         └── Dispute / Report Fraud / Flag Vendor / Reassign Patient
             / Deceased Patient
                        │
                        ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │ CASE OPENS  (status: OPEN)                                      │
  │  • Risk score rises immediately                                 │
  │  • Payer sees it in NPI Disputes and the activity feed           │
  │  • Undo window runs before the vendor is notified                │
  └──────────────────────────────┬──────────────────────────────────┘
                                 ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │ VENDOR NOTIFIED — 15 days to respond                            │
  └──────┬───────────────────────────────────────┬──────────────────┘
         │                                       │
    responds in time                    15 days pass, silence
         │                                       │
         ▼                                       ▼
  ┌──────────────────────────┐   ┌──────────────────────────────────┐
  │ PENDING_PHYSICIAN_REVIEW │   │ NON_RESPONSIVE                   │
  │ Docs uploaded.           │   │ Escalated to the payer.           │
  │ Physician has 7 days.    │   │ Vendor lost its chance to answer. │
  └──────┬────────────┬──────┘   └──────────────┬───────────────────┘
         │            │                         │
    approves      declines                      │
         │            │                         │
         ▼            ▼                         ▼
  ┌────────────┐  ┌──────────────────────────────────────────────────┐
  │ RESOLVED_  │  │ REFERRED_TO_PAYER  /  NON_RESPONSIVE             │
  │ BY_        │  │ Compliance action panel appears. Payer picks:    │
  │ PHYSICIAN  │  │  • Refer to Medicare   • Suspend Vendor          │
  │ Closed ✅  │  │  • Request Documents   • Close Investigation     │
  └────────────┘  └──────────────────────┬───────────────────────────┘
                                         ▼
                          ┌──────────────────────────────┐
                          │ CLOSED  /  REFERRED_OIG      │
                          │ Decision written to timeline │
                          └──────────────────────────────┘
```

> ### 📷 SCREENSHOT SLOT — S-38
> **Caption:** *The dispute lifecycle, as drawn above.*
> **Capture:** Redraw as a clean graphic
> **Suggested size:** Full-width

---

## 6.2 Status reference

The same case shows different wording in each portal, because each reader needs a
different thing from it. This table is the decoder.

| Status | Payer sees | Physician sees | Vendor sees | Who acts next |
|---|---|---|---|---|
| `OPEN` | Open | Not yet notified / Awaiting vendor | Docs requested | **Vendor** |
| `PENDING_PHYSICIAN_REVIEW` | Awaiting Physician Review | Vendor uploaded docs — review | Under review | **Physician** |
| `PENDING_PHYSICIAN_CONFIRMATION` | Pending Physician Confirmation | Awaiting your confirmation | Under review | **Physician** |
| `NON_RESPONSIVE` | **Non Responsive** | Overdue — escalated to compliance | **Overdue** | **Payer** |
| `REFERRED_TO_PAYER` | **Physician Declined — Your Review** | You declined the response | Response declined | **Payer** |
| `RESOLVED_BY_PHYSICIAN` | Resolved by Physician | Resolved | Approved — closed | — |
| `RESPONDED_TO_MEDICARE` | Responded to Medicare | Resolved | Closed | — |
| `CLOSED` | Closed | Closed | Closed | — |
| `REFERRED_OIG` | Referred to OIG | Referred | Referred | — |

**Colour convention, consistent everywhere:**

| Colour | Meaning |
|---|---|
| 🔴 **Red** | Needs attention now — non-responsive, physician declined, overdue |
| 🟡 **Amber** | Open, clock running |
| 🔵 **Blue** | In flight, awaiting the other party |
| 🟢 **Green** | Resolved |

---

## 6.3 Deadlines and what happens when they pass

| Deadline | Length | Who it is on | If it passes |
|---|---|---|---|
| **Undo window** | Short, right after the decision | Physician | Vendor notification is sent; decision is final |
| **Vendor response** | **15 days** from notification | Vendor | Case becomes `NON_RESPONSIVE` and escalates to the payer |
| **Physician confirmation** | **7 days** from vendor response | Physician | Timeline records the expiry; case proceeds without a verdict |

**Days Left chips**, shown in every dispute list:

| Chip | Meaning |
|---|---|
| **Overdue** (red) | Deadline passed |
| **{n}d** (amber) | 7 days or fewer remaining |
| **{n}d** (grey) | More than 7 days remaining |
| **—** | Resolved; no deadline applies |

Reminders go out at day 7 and day 13, with an expiry notice at day 15 — a vendor
who misses the deadline has been told three times.

---
---

# PART 7 — FRAUD RULES REFERENCE

Sixteen rules run across the claim population. Each fires independently and
contributes points to the risk score. **Points are a rule's raw contribution,
not points added directly onto the 0–100 score** — see
[Part 8](#part-8--risk-score-reference).

Every rule below is shown with its live threshold. The product reads these from
one shared definition, so this table, the drill-downs on screen, and the AI
assistant can never disagree.

---

### High severity (20+ points)

#### 🛡️ OIG LEIE Hit — 35 points
**What it is:** A vendor on these claims appears on the federal OIG exclusion
list. Medicare and Medicaid cannot reimburse excluded providers.
**When it fires:** The vendor's NPI or legal name matches the federal List of
Excluded Individuals/Entities.
**Why it matters:** The one rule that is a hard legal bar rather than a
statistical signal. Payment to an excluded entity is not reimbursable at all, so
every such claim is recoverable.

#### ⏱️ Impossible Day — 40 points
**What it is:** The provider billed an implausible number of claims on a single
day — more patients than is physically possible to see.
**When it fires:** 40 or more claims on one calendar day.
**Why it matters:** A physical-impossibility argument is the hardest kind for a
provider to explain away, which makes this one of the strongest single signals
available.

#### 📈 Volume Spike — 25 points
**What it is:** The provider's claim rate in the last 30 days is far above their
own prior baseline — sudden over-billing.
**When it fires:** The last-30-day rate is at least **2×** the provider's own
earlier baseline. Always compared against their own history, never against other
providers.
**Why it matters:** A legitimate practice grows gradually. A step change usually
means either a billing system change or deliberate inflation ahead of an expected
audit or shutdown.

#### 💔 Deceased Patient — 30 points
**What it is:** Claims for patients with no activity for over six months who then
resurface under a different physician — consistent with billing after death, or
identity reuse.
**When it fires:** A patient has a gap of more than **180 days** with no
activity, then reappears under a different NPI.
**Why it matters:** Billing after death is unambiguous fraud. The same footprint
appears when a dormant identity is resold, which is why the rule keys on the gap
rather than a death record.

#### 🔄 Rapid Patient Cycling — 30 points
**What it is:** An unusually high number of distinct patients billed in one day.
**When it fires:** **25 or more distinct patients** in a single day.
**Why it matters:** Distinct from Impossible Day — the volume could be plausible
for repeat visits, but not for that many different people.

#### 👥 Patient Identity Reuse — 20 points
**What it is:** The same patient billed under multiple unrelated physician NPIs —
a phantom-billing signal.
**When it fires:** One patient ID appears under **3 or more** unrelated physician
NPIs.
**Why it matters:** A stolen or purchased beneficiary identity gets reused across
whatever NPIs the ring controls. The patient is usually real; the visits are not.

#### 💰 Upcoding — 20 points
**What it is:** Claim amounts far above the norm for the service category — a
higher-paying code than warranted.
**When it fires:** A claim is at least **3×** the norm for its category **and**
above **$500** (the floor keeps small-dollar noise out).
**Why it matters:** The service may genuinely have happened — just billed as a
more expensive version of itself. Hard to spot per claim, obvious in aggregate.

#### 👻 Ghost Billing — 20 points
**What it is:** The vendor billed for a service with no matching physician bill
on file. The service may never have been provided.
**When it fires:** A vendor's claim has no corresponding physician bill for that
patient within a **3-day window** either side.
**Why it matters:** If no physician billed for ordering or supervising the
service, there is a real chance nothing was delivered and the patient never knew.

---

### Medium severity (15–19 points)

#### 📍 Geographic Anomaly — 15 points
**What it is:** Claims filed for patients located far from the provider's
practice address.
**When it fires:** Straight-line distance from practice address to patient ZIP
exceeds **30 miles**.
**Why it matters:** Home health and DME are inherently local. Distant patients
suggest the patient list was bought or fabricated rather than actually treated.

#### 🏥 Abnormal Hospice Duration — 15 points
**What it is:** A hospice patient kept enrolled far longer than is clinically
typical.
**When it fires:** Hospice enrollment runs longer than **180 days**.
**Why it matters:** Hospice pays a daily rate for patients certified as
terminally ill. Keeping an ineligible patient enrolled is a steady,
low-visibility revenue stream.

#### 🧩 Unbundling — 15 points
**What it is:** A single service split into multiple separately-billed component
codes to inflate reimbursement.
**When it fires:** At least **3 component codes** billed for one patient and date
where a single bundled code was appropriate.
**Why it matters:** The mirror image of upcoding — instead of one inflated code,
several legitimate-looking small ones that together pay more than the bundle.

#### 🏷️ Modifier Abuse — 24 points
**What it is:** Near-identical services billed separately for the same patient on
the same date — reworded line items to bypass duplicate checks.
**When it fires:** Two service descriptions for the same patient are between
**40% and 85% similar** within **7 days** — similar enough to be the same
service, different enough to slip past an exact-match duplicate check.
**Why it matters:** Duplicate billing by someone who knows a duplicate check
exists. The deliberate rewording is itself evidence of intent.

#### 🔗 Vendor Concentration — 18 points
**What it is:** An unusually large share of a provider's billing flows through a
single vendor.
**When it fires:** At least **85%** of a provider's billing goes through one
vendor.
**Why it matters:** Exclusivity is the payoff side of a kickback — the vendor
pays for referrals and receives effectively all of that provider's business.

---

### Lower severity (under 15 points)

#### 🕸️ Cross-NPI Vendor — 10 points
**What it is:** A vendor billing under many unrelated physician NPIs — the
classic kickback-ring pattern.
**When it fires:** One vendor bills under at least **3 distinct physician NPIs**
with no practice relationship to each other.
**Why it matters:** One vendor spread thin across unrelated physicians is the
signature of a kickback ring: the vendor is buying access to NPIs rather than
serving one practice's patients.

#### 📑 Duplicate Billing — 10 points
**What it is:** The same service billed twice for one patient within a short
window.
**When it fires:** The same patient, same HCPCS code, and same date of service
under one NPI is billed by more than one supplier.
**Why it matters:** Sometimes a genuine clerical error, which is why it carries
low points. Repeated across many claims it stops looking clerical.

#### 🆕 New High-Value Vendor — 6 points
**What it is:** A brand-new vendor relationship appearing with unusually
high-dollar claims.
**When it fires:** A vendor with no prior history appears within **30 days** and
bills more than **$500**.
**Why it matters:** Fraudulent vendors are disposable — set up, billed hard,
abandoned before an audit lands. High value with no history is the start of that
arc.

---

### Summary table

| Rule | Points | Threshold |
|---|---|---|
| Impossible Day | 40 | ≥ 40 claims in one day |
| OIG LEIE Hit | 35 | Match on federal exclusion list |
| Deceased Patient | 30 | > 180-day gap, then new NPI |
| Rapid Patient Cycling | 30 | ≥ 25 distinct patients in one day |
| Volume Spike | 25 | ≥ 2× own 30-day baseline |
| Modifier Abuse | 24 | 40–85% description similarity within 7 days |
| Patient Identity Reuse | 20 | ≥ 3 unrelated NPIs per patient |
| Upcoding | 20 | ≥ 3× category norm and > $500 |
| Ghost Billing | 20 | No physician bill within ±3 days |
| Vendor Concentration | 18 | ≥ 85% of billing via one vendor |
| Geographic Anomaly | 15 | > 30 miles from practice |
| Abnormal Hospice Duration | 15 | > 180 days enrolled |
| Unbundling | 15 | ≥ 3 component codes, one patient/date |
| Cross-NPI Vendor | 10 | ≥ 3 unrelated physician NPIs |
| Duplicate Billing | 10 | Same patient/code/date, 2+ suppliers |
| New High-Value Vendor | 6 | No history, < 30 days, > $500 |

> ### 📷 SCREENSHOT SLOT — S-39
> **Caption:** *Fraud rules firing on a real NPI, with points.*
> **Capture:** NPI Detail score breakdown showing several rules and their contributions
> **Callouts:** ① rule names ② point contributions ③ Physician feedback row
> **Suggested size:** Full-width

---
---

# PART 8 — RISK SCORE REFERENCE

## The question this answers

*"This physician has eight rules fired totalling 180 points. Why is the score 87
and not 100?"*

Because a straight sum would put **every** serious offender at exactly 100 and
make ranking them impossible. The entire purpose of the score is deciding who to
investigate **first**. A metric that saturates cannot do that.

## How the score is built

**Step 1 — Collect raw points.**
Every fired rule contributes its points (Part 7). Physician feedback adds more:

- **5 points** per flag (Flag Vendor, Reassign Patient, Deceased Patient)
- **10 points** per did-not-order denial
- Capped at **20 points** total, so no single physician's activity dominates

**Step 2 — Put raw points through a saturating curve → 0–80.**
The curve flattens as points grow. A provider with eight rules does not simply
pin at 100; severe cases stay distinguishable from each other. It asymptotes
towards 80 and never hard-caps.

**Step 3 — Add continuous signals → up to 20 more points.**
Measured as percentile rank against the monitored population, so the spread stays
even regardless of the raw distribution's shape:

| Signal | Weight |
|---|---|
| Claim volume | 30% |
| Dollars billed | 30% |
| Breadth of distinct counterparties | 20% |
| Share of claims OIG-flagged | 20% |

For a physician, "breadth" means distinct vendors. For a vendor, distinct
physician NPIs.

**Step 4 — Add the two parts, cap at 100.**

```
  raw points (rules + physician feedback, capped at 20)
        │
        ▼
  saturating curve ──────────────► severity   0 – 80
                                                  +
  percentile rank of volume / $ /
  breadth / % flagged ───────────► continuous 0 – 20
                                              ─────────
                                     TOTAL    0 – 100
```

## Bands

| Band | Range | Action |
|---|---|---|
| **Critical** | 81 – 100 | Investigate now |
| **High** | 61 – 80 | Investigate soon |
| **Medium** | 31 – 60 | Monitor |
| **Low** | 0 – 30 | Nothing notable |

The "high risk" count on the dashboard uses a score **above 80**, so it equals
the Critical band exactly, everywhere in the product.

## Two entities, one method

Scores are computed per **physician NPI** and per **vendor** using the same
method. Scoring covers NPIs that actually have claims — the physicians under
management — not the entire ~692,000-row NPPES reference dump.

## When scores change

Recomputed when the fraud check re-runs for an entity, and **immediately** when a
physician records a flag. Each score carries a `last_calculated` timestamp so you
can always tell how fresh it is.

> ### 📷 SCREENSHOT SLOT — S-40
> **Caption:** *A risk score fully decomposed.*
> **Capture:** NPI Detail with the complete score breakdown visible
> **Callouts:** ① final score and band ② per-rule points ③ physician feedback
> ④ continuous component
> **Suggested size:** Full-width

---
---

# APPENDIX A — SCREENSHOT CAPTURE CHECKLIST

Capture in this order and you will move through the app naturally, in three
sessions — one per role.

### Session 1 — Public and setup (logged out)

| # | Screen | URL / state |
|---|---|---|
| S-01 | Landing page | `/welcome` |
| S-04 | Registration — three role cards | `/register` |
| S-05 | Physician registration, NPI verified | `/register` → Physician, filled |
| S-06 | Registration verification steps | Mid-submit |
| S-07 | Payer registration, UEI verified | `/register` → Payer, filled |
| S-41 | Vendor registration, NPI verified | `/register` → Vendor, filled |
| S-08 | Login step 1 | `/login` |
| S-09 | Login step 2 — email OTP | `/otp/login` |
| S-37 | Public dispute page (no login) | `/vendor/disputes/{case_id}` |

### Session 2 — Physician portal

| # | Screen | URL / state |
|---|---|---|
| S-10 | Portal shell and nav | `/physician/dashboard` |
| S-11 | My Dashboard | `/physician/dashboard`, populated |
| S-12 | My Claims | `/physician/claims`, mixed statuses |
| S-13 | Claim Detail, six decisions | `/physician/claims/{id}`, undecided |
| S-14 | Decision recorded + undo | Just after clicking Dispute |
| S-15 | My Disputes | `/physician/disputes`, all stages |
| S-16 | Dispute Detail with vendor docs | `/physician/disputes/{id}`, responded |
| S-17 | Notification bell | Bell open |

### Session 3 — Payer portal

| # | Screen | URL / state |
|---|---|---|
| S-18 | Portal shell, search, breadcrumbs | `/payer/dashboard` |
| S-19 | Dashboard | `/payer/dashboard`, populated |
| S-20 | Physician Leaderboard | `/payer/leaderboard` |
| S-21 | NPI Detail — top | `/payer/npi/{npi}`, Critical band |
| S-22 | NPI Detail — claims and flags | Same, scrolled |
| S-23 | Fraud pattern drill-down | Same, pattern expanded |
| S-39 | Score breakdown with rules | Same, breakdown visible |
| S-40 | Score fully decomposed | Same |
| S-24 | Vendor Watchlist | `/payer/watchlist` |
| S-25 | Vendor Case | `/payer/vendor/{id}`, high risk |
| S-26 | NPI Disputes queue | `/payer/disputes`, incl. Overdue |
| S-27 | Dispute Detail | `/payer/disputes/{caseId}`, multi-round |
| S-28 | Compliance action panel | Escalated case, action selected |
| S-29 | AI Assistant | Assistant open with an answer |
| S-30 | Payer notification bell | Bell open |

### Session 4 — Vendor portal

| # | Screen | URL / state |
|---|---|---|
| S-31 | Portal shell and nav | `/vendor/portal` |
| S-32 | Dashboard — urgency and countdown | `/vendor/portal`, urgent case open |
| S-33 | Claims with both filters | `/vendor/portal/claims` |
| S-34 | Action Required | `/vendor/portal/action-required` |
| S-35 | Responding — note and upload | Response form, file attached |
| S-36 | Vendor notification bell | Bell open |

### Diagrams to draw (not screenshots)

| # | Diagram | Source |
|---|---|---|
| S-02 | Three portals side by side | Composite of three windows |
| S-03 | Data flow | Section 1.3 |
| S-38 | Dispute lifecycle | Section 6.1 |

**Capture notes**

- Use the same demo account and the same browser width throughout, so the guide
  reads as one product rather than several.
- Full-width screens at **1440 × 900**; panels and modals at their natural size.
- Seed data before you start so no screen shows an empty state — except where you
  are deliberately documenting one.
- For S-26 and S-34 you need at least one genuinely overdue case. Seed a dispute
  with a past deadline first.

---

# APPENDIX B — GLOSSARY

| Term | Meaning |
|---|---|
| **835 / ERA** | Electronic Remittance Advice — the Medicare file format carrying claim payment detail |
| **Band** | Risk grouping: Critical (81–100), High (61–80), Medium (31–60), Low (0–30) |
| **CCN** | Claim Control Number — the unique identifier for one claim |
| **Compliance action** | One of four decisions a payer records on an escalated case |
| **Cross-NPI** | A vendor billing under multiple unrelated physician NPIs |
| **DEA number** | Drug Enforcement Administration registration number |
| **Dispute case** | The record created when a physician challenges a claim |
| **DME** | Durable Medical Equipment |
| **DOS** | Date of Service |
| **Flag** | A record written when a fraud rule fires, holding its evidence |
| **HCPCS** | Healthcare Common Procedure Coding System — the billed service code |
| **LEIE** | List of Excluded Individuals/Entities — the federal OIG exclusion list |
| **NPI** | National Provider Identifier — 10-digit physician identifier |
| **NPPES** | National Plan and Provider Enumeration System — the federal NPI registry |
| **OIG** | Office of Inspector General |
| **OTP** | One-Time Password — the code emailed at login |
| **Payer** | The health plan or government body paying claims |
| **PTAN** | Provider Transaction Access Number |
| **Risk score** | 0–100 per physician NPI and per vendor; higher is riskier |
| **Rule** | One fraud detection pattern |
| **UEI** | Unique Entity Identifier — federal organisation identifier |
| **Vendor** | The billing supplier. "Supplier" in some older screens. |

---

# APPENDIX C — FREQUENTLY ASKED QUESTIONS

### For physicians

**Why am I seeing claims I never filed?**
That is the point of the platform. Any vendor can submit a claim naming your NPI
as the ordering provider. These are claims *filed under* your NPI, not claims you
submitted. Reviewing them is how you find out whether your NPI is being misused.

**What is the difference between Dispute and Report Fraud?**
*Dispute* says the details look wrong — amount, service, something is off.
*Report Fraud* says you believe the service never happened. Both open a case and
start the 15-day vendor clock; Report Fraud is recorded at the highest severity
and shows to the payer as a fraud report.

**I clicked the wrong button.**
Undo it. Every decision has an undo window, and the vendor notification is
deliberately delayed until that window closes, so an accidental click never
reaches them.

**The vendor sent documents I do not find convincing.**
Decline. The case goes to the payer with your reason attached. They have
enforcement options you do not — suspending the vendor, referring to Medicare, or
opening a formal investigation.

**Nothing happened after I disputed.**
Check My Disputes. The stage line tells you exactly where it is: *Not yet
notified*, *Awaiting vendor · {n}d left*, *Vendor uploaded docs — review*, or
*Overdue — escalated to compliance*.

### For payers

**Why does an NPI with 180 rule points score 87 instead of 100?**
By design. The score runs raw points through a saturating curve so severe cases
stay distinguishable from each other. A straight sum would put every serious
offender at 100 and make ranking impossible. See [Part 8](#part-8--risk-score-reference).

**Where do I start each day?**
The Dashboard's three hero cards, then NPI Disputes sorted *Overdue First*.
Anything showing **Escalate** rather than **View** is waiting on you specifically.

**How do I see the evidence behind a fired rule?**
Open the NPI or vendor, then click the rule in the fraud patterns section. The
drill-down shows the exact claims that triggered it, not just the rule name.

**Can the AI assistant change data?**
No. It is read-only, and every query it makes is capped. It cannot alter a case,
a score, or a claim.

**Why do the physician's and my view of one case use different wording?**
Deliberately. The physician sees first-person wording ("You disputed this
claim"); compliance sees neutral third-person wording and the full content of
every vendor response, including material the physician's view does not show.

### For vendors

**A claim of mine is disputed. What do I do?**
Go to Action Required, open the case, write an explanation, and upload
documentation — the order, delivery confirmation, signed paperwork. You have 15
days from notification.

**What if I miss the 15 days?**
The case is marked Non Responsive and escalates to the payer automatically. You
lose the chance to explain, and the non-response itself is recorded. Reminders go
out at day 7 and day 13, so watch the urgency ring on your dashboard.

**The physician declined my response.**
The case moved to the payer, who will refer it to Medicare, suspend you pending
investigation, request more documents, or close it. Have your documentation ready.

**Can I respond without an account?**
Yes. The email you received contains a signed link to that one case. It grants
access to that case only.

### General

**I typed a URL for another portal and got redirected.**
Roles are enforced on every route. You are returned to your own dashboard rather
than shown an error.

**Does the payer portal need refreshing?**
No. It holds a live connection, so notification counts, the activity feed,
dispute lists, and any open case update themselves as events occur.

**Can I bookmark or share a specific screen?**
Yes. Every screen has a real URL — an NPI, a vendor, a case, even a
band-filtered leaderboard. Bookmarks, refresh, browser back/forward, and pasted
links all work.

---

*End of User Guide*
