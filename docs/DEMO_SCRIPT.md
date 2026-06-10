# DEMO_SCRIPT — 5-Minute Demo Script
## ClaimLens — NPI Intelligence Platform

---

## Document Purpose

This is the exact script for every ClaimLens demo. It covers what to click, what to say, what the plan executive should be thinking at each moment, and how to handle common interruptions. Practice this until you can run it in under 5 minutes without looking at the script.

---

## Demo Setup Checklist

Run this checklist before every demo. No exceptions.

### 30 Minutes Before

- [ ] Run demo reset: `cd backend && python data/demo_reset.py`
- [ ] Wait for reset to complete — verify "825 claims, 344 flags" in output
- [ ] Run health check: `curl http://localhost:8000/health`
- [ ] Confirm `total_claims: 825` and `total_flags: 344` in response
- [ ] Open http://localhost:3000 and verify physician dashboard loads
- [ ] Switch to Plan Investigator and verify Dr. Wilson is in top 3 on leaderboard
- [ ] Navigate to `/plan/alerts` — verify 5 pre-seeded alert cards visible
- [ ] Take screenshots of every key screen as backup (see backup section)

### 5 Minutes Before

- [ ] Open two browser windows:
  - Window 1: http://localhost:3000/plan — Plan dashboard NPI leaderboard
  - Window 2: http://localhost:3000/physician — Physician dashboard
- [ ] Position them side by side if presenting on a wide screen, or use separate browser tabs
- [ ] Close all other browser tabs
- [ ] Close Slack, email, and any notification-generating apps
- [ ] Set screen to "Do Not Disturb"
- [ ] If presenting remotely — share the browser window, not the entire screen
- [ ] If presenting on a projector — test that localhost:3000 is visible at the room's resolution

### Right Before Starting

- [ ] Confirm Window 1 is showing the Plan dashboard NPI leaderboard
- [ ] Confirm Dr. Wilson is visible in the top 3 rows with a red or dark-red score badge
- [ ] Confirm Window 2 is showing Dr. Wilson's physician dashboard with unreviewed claims visible
- [ ] Take one breath. You know this product. Present it clearly.

---

## The Demo — Three Acts

**Total time: 4 minutes 30 seconds to 5 minutes**
**Audience: Health plan executive, compliance officer, or fraud investigator**
**Goal: Make them say "I want my data in this system"**

---

## Act 1 — The Plan View (90 seconds)

**You are presenting as the Plan Investigator. Window 1 is active.**

---

**[OPEN on the NPI Risk Leaderboard]**

Say:
> "This is what your fraud investigator sees on Monday morning. Every physician billing under your plan, ranked by risk score. The system has already done the work — you just work down the list."

*Point to the red scores at the top of the leaderboard.*

> "Red scores above 80 are critical. Those get opened first. Let me show you what one looks like."

---

**[CLICK Dr. Wilson's row]**

*The NPI detail page loads. Let them see the header with the score breakdown.*

Say:
> "Dr. James Wilson. Risk score 90. Here is exactly why — volume spike worth 25 points, a supplier billing under 9 different physicians worth 30, an OIG-excluded supplier worth 35. That is 90 points before a single doctor has flagged anything."

*Pause. Let them read the score breakdown.*

> "Now look at his claim history."

*Scroll down to the claims table. Point to the flag badges on the rows.*

> "Every red badge is a fired rule. This claim right here — the patient is 340 miles from Dr. Wilson's practice. This one — the supplier is on the federal exclusion list. Without this system, none of this is visible until your investigators manually pull reports, weeks after the money has already been paid."

---

**[NAVIGATE to Supplier Watchlist]**

*Click Supplier Watchlist in the navigation.*

Say:
> "Now look at the supplier side."

*Point to MedSupply Pro LLC at row 1.*

> "MedSupply Pro LLC. OIG excluded. Billing under 9 different physicians this month. $180,000 in claims. 5 physician flags already received. Risk score 85."

*Pause.*

> "That is your bad actor. Not a suspicion — a pattern. Now let me show you where those 5 flags came from."

*Anchor it to a real case.*

> "This is not hypothetical. In 2023 a Miami DME ring used 47 physician NPIs to bill $38 million before detection. Your system would have flagged the cross-NPI pattern within the first 30 days of billing."

---

## Act 2 — The Physician View (90 seconds)

**Switch to Window 2. You are now Dr. Wilson.**

---

**[SWITCH to physician dashboard in Window 2 — or switch demo user to Dr. Wilson]**

Say:
> "This is what Dr. Wilson sees when he logs in. Every claim filed under his NPI — home health, hospice, DME, drugs, hospital — all in one place. He has never had this visibility before. No system shows physicians what is being billed under their name. This one does."

*Point to the unreviewed count badge in the summary card.*

> "43 claims waiting for his review. Let me sort by unreviewed."

*If not already sorted that way, apply the unreviewed filter.*

---

**[FIND a MedSupply Pro claim — patient 340+ miles away]**

*Scroll to find a DME claim from MedSupply Pro LLC with geographic anomaly badge. It should be near the top since fraud claims are prioritized.*

Say:
> "Here. MedSupply Pro LLC. Standard wheelchair. $1,850. Patient zip — Beverly Hills. Dr. Wilson practices in San Francisco. 340 miles. He has never seen this patient."

*Point to the OIG badge and the flag badges on the row.*

> "OIG excluded supplier. Cross-NPI flag. Geographic anomaly. Three red flags on one claim."

*Hover over one of the flag badges to show the tooltip.*

> "He sees this in 30 seconds. And now watch what happens when he flags it."

---

**[CLICK the "⚑ Flag Supplier" button on that claim]**

*The button shows a loading spinner for less than 1 second, then the row grays out with a "Reviewed" badge.*

Say:
> "Done. That flag just fired. Watch Window 1."

---

## Act 3 — The Real-Time Moment (60 seconds)

**Bring Window 1 back to focus. Navigate to the Alerts page.**

---

**[SWITCH to Window 1 — navigate to /plan/alerts]**

*The new alert card should already be at the top of the feed.*

Say:
> "Dr. Wilson's flag. Already here. Under 1 second."

*Point to the alert card showing his name, MedSupply Pro, the patient, and the amount.*

> "Now go back to the supplier watchlist."

---

**[NAVIGATE to Supplier Watchlist]**

*MedSupply Pro's physician flag count has incremented. Risk score may have updated.*

Say:
> "MedSupply Pro now has 6 physician flags. One more doctor confirmed they do not recognize this supplier."

*Pause. This is the key moment. Let it land.*

> "That was one doctor. One click. 30 seconds of his time."

*Now deliver the close.*

> "In your network, you have hundreds of physicians. If 40 of them flag the same supplier — and they will, because this supplier is billing under 9 NPIs right now — your fraud unit sees that pattern before the next claim is paid. Not in the next audit cycle. Today."

*Pause.*

> "That signal has never existed before. There is no system today that shows physicians what is billed under their name and routes their responses back to the plan in real time. This is it."

---

## The Ask (30 seconds)

Say:
> "Everything you just saw runs on synthetic data we generated to show you the concept. The dashboards, the rules engine, the real-time alerts — all functional."

> "What we need from you is one thing: a 90-day sample of de-identified claims. DME only, one state. We will show you the first real fraud signal within 30 days of receiving the file. If we don't, we stop."

*Let them respond. Do not fill the silence.*

---

## Handling Questions Mid-Demo

These questions come up most often. Have these answers ready.

---

**"How do you get the physician to actually log in and use it?"**

> "That is the adoption question and it is the right one to ask. The answer is — the system sends physicians a monthly summary of everything billed under their NPI. Most doctors do not know this visibility is possible. When they see $94,000 billed under their name in one month when they expected $12,000 — they log in. And they keep logging in."

---

**"What about HIPAA?"**

> "The demo runs on synthetic data — zero PHI. For the pilot, we work with de-identified claims only, patient names replaced with IDs. Before any real patient data touches the system, we have HIPAA BAAs in place with every vendor and a formal data sharing agreement signed with you. We have a healthcare attorney reviewing the product before pilot launch. HIPAA compliance is not an afterthought — it is the first gate before we touch real data."

---

**"Is this real-time? Our claims data has a 24-48 hour lag."**

> "Yes, we know — that is true for most plan systems. Near-real-time is sufficient. A claim submitted today appearing in the physician dashboard tomorrow is still 30 days ahead of where you are now. And the physician flag signal routes back to your fraud team the moment the doctor clicks — that part is genuinely real-time regardless of when the claim arrived."

---

**"Can this work with our existing claims format?"**

> "Yes. The ETL normalization layer is designed to handle any format — CSV, JSON, EDI 837, flat file. Different plans format their data differently. We map it to our canonical schema at ingestion. If your format is non-standard, we spend a few days on the mapping. That is a one-time setup cost, not an ongoing one."

---

**"What does this cost?"**

> "We are not selling yet — we are finding pilot partners. The pilot is free in exchange for the data access. We prove value on your data, you see the fraud signals, and then we have a pricing conversation. The business model is a per-NPI or per-claim monitored fee. We can discuss specifics after you have seen what it does on your actual claims."

---

**"We already have a fraud detection system."**

> "Most plans do — rules-based scoring or third-party FWA tools. What none of them have is the physician signal. Your existing system looks at claim patterns in your data. This system asks the ordering physician directly: 'Did you order this?' That is a fundamentally different signal. The two are complementary — not competing. What we catch that rules-based systems miss is exactly what you just saw: the doctor saying 'I have never seen this patient in my life.'"

---

**"What happens after we flag something? Does your system take action?"**

> "No — and that is intentional. We surface the signal, your fraud unit decides what to do with it. We are not in the payment chain, we do not approve or deny claims, and we do not contact anyone. We flag → you investigate → you decide. That keeps the legal liability model clean and the integration complexity low."

---

## If the Demo Has a Technical Problem

Stay calm. This is a prototype demo, not a production system. Honesty about that is fine.

**If the SSE alert does not appear within 5 seconds:**

Say: "The real-time connection sometimes has a brief delay on the demo environment — let me refresh the alerts page."

*Refresh `/plan/alerts`. The alert should appear immediately after refresh since it was written to the database.*

**If a page fails to load:**

Say: "Let me pull up the backup screenshots while that loads."

*Open the screenshot PDF you prepared in the setup checklist. Walk through the screenshots.*

*Do not apologize excessively. Say: "This is a prototype environment — the production build will be on a properly provisioned server. What matters is the concept is working."*

**If the backend is down:**

Say: "Let me take 2 minutes — the server needs a restart."

*Open a terminal, restart uvicorn, verify health endpoint, continue.*

*If you cannot fix it in 2 minutes:* "Let me walk you through the demo using screenshots and we can schedule a live session at your convenience."

---

## Backup Screenshots

Take these screenshots after demo reset, before every pitch. Save as a numbered PDF.

| # | Screen | URL |
|---|---|---|
| 1 | Plan NPI leaderboard — Dr. Wilson in top 3 | /plan |
| 2 | Dr. Wilson NPI detail — score breakdown | /plan/npi/1234567890 |
| 3 | NPI detail — claims table with flag badges | /plan/npi/1234567890 (scrolled) |
| 4 | Supplier watchlist — MedSupply Pro at row 1 | /plan/suppliers |
| 5 | Physician dashboard — unreviewed claims | /physician |
| 6 | Physician dashboard — MedSupply Pro claim with badges | /physician (scrolled to claim) |
| 7 | Plan alerts — 5 pre-seeded alert cards | /plan/alerts |
| 8 | Plan alerts — new alert card after flag (take this live during demo) | /plan/alerts |

---

## What Success Looks Like

The demo succeeds if the plan executive says any of the following before you finish:

- "How quickly can we get our data into this?"
- "Who do I talk to about the data agreement?"
- "Can you show me what this would look like with DME claims specifically?"
- "We have been looking for something exactly like this."

Any of these means proceed immediately to the ask. Do not finish the full demo script. Go straight to:

> "We need one thing — a 90-day de-identified DME sample. We show you the first fraud signal in 30 days."

---

## Post-Demo Actions

Immediately after the meeting:

1. Send a follow-up email within 2 hours
2. Include: what was discussed, the specific data ask (90-day DME sample), next steps
3. If they showed strong interest: attach a one-page summary of what ClaimLens does
4. If they asked technical questions: follow up with answers in writing
5. If they asked about pricing: provide a range, not a fixed number at this stage

---

## Demo Timing Reference

| Section | Target Time | Hard Max |
|---|---|---|
| Act 1 — Plan View | 90 seconds | 2 minutes |
| Act 2 — Physician View | 90 seconds | 2 minutes |
| Act 3 — Real-Time Moment | 60 seconds | 90 seconds |
| The Ask | 30 seconds | 45 seconds |
| **Total** | **4:30** | **6:15** |

If you are running over 6 minutes, cut Act 1 short — skip the supplier watchlist and go straight to the physician view. The SSE moment in Act 3 is the most important part of the demo. Never cut Act 3.
