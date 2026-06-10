# NON_FUNCTIONAL_REQUIREMENTS — Non-Functional Requirements
## ClaimLens — NPI Intelligence Platform

---

## Document Purpose

This document defines how well ClaimLens must perform, how secure it must be, how available it must be, and what compliance obligations apply at each phase. Non-functional requirements are not features — they are constraints and quality attributes that every feature must operate within.

Each requirement is tagged with the phase it applies to:

- `[MVP]` — Required for the 10-day demo build
- `[PILOT]` — Required before ingesting real plan data
- `[PRODUCTION]` — Required before enterprise contracts

---

## Section 1 — Performance

---

### NFR-001 — Physician Dashboard Load Time `[MVP]`

The physician claims table must load and render within an acceptable time so that the demo does not feel slow during a live pitch.

**Requirements:**
- GET /physician/{npi}/claims must return a response in under 300ms for 800 claims
- GET /physician/{npi}/summary must return in under 100ms
- The physician dashboard page must be fully interactive within 2 seconds of navigation on a standard broadband connection
- Pagination must be implemented — returning all 800 claims in one response is not acceptable

**Measurement:** Timed with browser DevTools Network tab during demo rehearsal on Day 10.

---

### NFR-002 — Plan Dashboard Load Time `[MVP]`

The plan NPI risk leaderboard must load quickly enough that a plan executive does not wait during the demo.

**Requirements:**
- GET /plan/npi-risk-list must return in under 400ms for 15 NPIs
- GET /plan/suppliers must return in under 300ms
- GET /plan/npi/{npi}/detail must return in under 500ms
- Plan dashboard page must be fully interactive within 2 seconds of navigation

**Measurement:** Timed with browser DevTools during demo rehearsal.

---

### NFR-003 — SSE Alert Delivery Latency `[MVP]`

The real-time alert from a physician flag must appear on the plan dashboard fast enough to be visibly instant during the demo — this moment is the product's most important demonstration.

**Requirements:**
- Time from physician clicking Flag Supplier to alert card appearing on plan dashboard must be under 1 second on localhost
- Time from physician clicking Flag Supplier to alert card appearing on plan dashboard must be under 2 seconds on the production server over a standard broadband connection
- SSE keep-alive must be sent every 15 seconds to prevent proxy timeouts

**Measurement:** Stopwatch during live demo rehearsal. Two browser windows side by side.

---

### NFR-004 — Demo Reset Performance `[MVP]`

The demo reset script must complete in a predictable, fast time so that it can be run reliably before any pitch meeting.

**Requirements:**
- `python data/demo_reset.py` must complete in under 3 minutes on the production server
- Script must print progress at each step so the developer is not left waiting at a blank terminal
- Script must exit with code 0 on success and code 1 on any failure

---

### NFR-005 — Pilot Data Ingestion Performance `[PILOT]`

When the first real plan data file arrives, the ETL pipeline must handle realistic data volumes without timing out or running out of memory.

**Requirements:**
- ETL pipeline must process up to 500,000 claims without crashing
- Memory usage must not exceed 4GB during ingestion of 500,000 records (use chunked processing)
- Ingestion of 500,000 records must complete in under 2 hours
- Progress must be logged every 10,000 records
- If ingestion fails mid-run, it must be resumable without reprocessing already-ingested records

---

### NFR-006 — Production API Response Times `[PRODUCTION]`

At production scale with millions of claims and thousands of concurrent users, the API must remain responsive.

**Requirements:**
- P95 response time for all GET endpoints under 500ms with 1,000 concurrent users
- P99 response time under 1,500ms
- SSE stream must support at least 100 concurrent plan investigator connections without degradation
- Database query time must not exceed 200ms for indexed queries on tables up to 10 million rows

---

## Section 2 — Availability and Reliability

---

### NFR-007 — MVP Demo Uptime `[MVP]`

The production server must be reliably accessible during pitch meetings. A crashed server during a demo is a failed pitch.

**Requirements:**
- Server must be running and accessible for all scheduled demo sessions
- If the server crashes, it must be restartable in under 5 minutes by the developer
- The health check endpoint GET /health must return 200 at all times when the system is operational
- Uvicorn must be managed by systemd — automatic restart on crash

**Monitoring:** Developer manually checks GET /health before every pitch meeting.

---

### NFR-008 — SSE Connection Resilience `[MVP]`

The SSE connection must survive normal network interruptions without manual intervention.

**Requirements:**
- Browser must automatically attempt SSE reconnection within 3 seconds of a dropped connection
- On reconnection, any alerts missed during the disconnection must be replayed (using broadcast = false query)
- The SSE endpoint must handle up to 10 simultaneous connections without error (MVP scale)
- A dropped SSE connection must not cause the FastAPI server to crash or log an unhandled exception

---

### NFR-009 — Production Availability `[PRODUCTION]`

**Requirements:**
- 99.5% monthly uptime SLA (approximately 3.6 hours downtime per month allowed)
- Planned maintenance windows communicated 48 hours in advance
- Zero data loss — all physician actions must be persisted before SSE broadcast
- Database backups taken daily, retained for 30 days
- Recovery Time Objective (RTO): 4 hours
- Recovery Point Objective (RPO): 24 hours

---

## Section 3 — Security

---

### NFR-010 — Transport Security `[MVP]`

All traffic between client and server must be encrypted so that claims data is never transmitted in plaintext.

**Requirements:**
- HTTPS enforced on all endpoints via Nginx + Certbot (Let's Encrypt)
- HTTP requests must be automatically redirected to HTTPS — no plain HTTP access
- TLS 1.2 minimum, TLS 1.3 preferred
- SSL certificate must be valid and not expired at all times
- Certificate auto-renewal must be configured via Certbot cron

---

### NFR-011 — Credentials and Secrets Management `[MVP]`

All credentials must be stored securely and never exposed in source code or logs.

**Requirements:**
- All secrets stored in `.env` file — never committed to version control
- `.env` is listed in `.gitignore` — verified before first commit
- `.env.example` contains all variable names with placeholder values and descriptions — committed to repo
- OpenAI API key must never appear in any log output
- Database credentials must never appear in any log output
- Environment variables must be set in the server's system environment — not in a file on the production server accessible via the web

---

### NFR-012 — Database Access Control `[MVP]`

The PostgreSQL database must not be accessible from the public internet.

**Requirements:**
- PostgreSQL listens on 127.0.0.1 (localhost) only — not 0.0.0.0
- Port 5432 must not be open in the server firewall (UFW rules)
- Only the FastAPI backend process (running on the same server) can connect to PostgreSQL
- The database user used by the application must have only SELECT, INSERT, UPDATE, DELETE privileges — not SUPERUSER, not CREATEDB

---

### NFR-013 — Input Validation `[MVP]`

All API inputs must be validated before reaching the database to prevent injection attacks and data corruption.

**Requirements:**
- All request bodies validated by Pydantic models in FastAPI — invalid input returns 422 before any DB operation
- NPI path parameters validated as exactly 10 numeric characters
- action_type validated against the enum before insert
- claim_id validated as a valid UUID format before any query
- No raw SQL string interpolation anywhere in the codebase — all queries use SQLAlchemy ORM or parameterized queries
- SQL injection is not possible through any API endpoint

---

### NFR-014 — Authentication and Authorization `[PILOT]`

Before any real patient data is ingested, physician identity must be verified and access must be scoped to the authenticated user's NPI.

**Requirements:**
- Auth0 integration required before pilot data ingestion
- Physician must register with verified email and NPI number
- NPI number verified against NPI Registry API at registration time
- Physician JWT token scoped to their NPI — API layer rejects any request where token NPI does not match path NPI
- Plan investigator role authenticated separately — cannot access physician-scoped endpoints
- Admin role required for database reset and ETL operations
- MFA required for all users
- Session tokens expire after 8 hours — re-authentication required
- All authentication events logged with timestamp, user ID, and IP address

---

### NFR-015 — Data Encryption at Rest `[PILOT]`

All data containing patient information must be encrypted at rest before any real plan data is processed.

**Requirements:**
- Database storage volume encrypted (LUKS on Linux, or managed database encryption)
- Backups encrypted before transfer to backup storage
- Any exported files (CSV reports, etc.) encrypted before storage
- Encryption key management documented and accessible to at least 2 team members
- AES-256 minimum encryption standard

---

### NFR-016 — Audit Logging `[PILOT]`

Every access to patient data must be logged immutably for HIPAA compliance.

**Requirements:**
- Every API call that returns patient data must be logged with: timestamp, user ID, NPI accessed, endpoint called, IP address
- Audit logs must be append-only — no update or delete operations on audit log table
- Audit logs retained for minimum 6 years (HIPAA requirement)
- Audit log table must be in a separate schema with restricted write access (audit schema, not public)
- Log rotation must not delete audit entries — archive to cold storage instead

---

### NFR-017 — HIPAA Compliance `[PILOT]`

Before any real Protected Health Information (PHI) is processed, all HIPAA technical safeguards must be in place.

**Requirements:**
- HIPAA Business Associate Agreement (BAA) signed with all vendors that touch PHI:
  - Cloud hosting provider
  - Database hosting provider (if managed)
  - OpenAI (if used on real data — separate BAA required)
  - Any email or notification service
- Healthcare attorney review of the product and data handling before pilot launch
- HIPAA risk assessment completed and documented
- Workforce training documented (all team members who access PHI)
- Incident response plan documented before pilot launch
- Data use agreement with the pilot plan signed before any data transfer

---

### NFR-018 — Cyber Liability Insurance `[PILOT]`

**Requirements:**
- Cyber liability insurance policy in place before pilot data transfer
- Policy must cover: data breach, ransomware, business interruption, regulatory fines
- Minimum coverage: $1 million per occurrence (verify with healthcare attorney)
- Policy documentation provided to pilot plan if requested

---

### NFR-019 — Penetration Testing `[PRODUCTION]`

**Requirements:**
- Third-party penetration test completed before production launch
- All critical and high findings remediated before launch
- Medium findings remediated within 30 days of launch
- Re-test performed after remediation of critical findings
- Penetration test report available for enterprise customer due diligence

---

### NFR-020 — SOC 2 Type II `[PRODUCTION]`

**Requirements:**
- SOC 2 Type II audit initiated before enterprise contract signing
- Security, Availability, and Confidentiality trust service criteria at minimum
- Annual audit cadence maintained
- SOC 2 report available under NDA for enterprise prospects

---

## Section 4 — Scalability

---

### NFR-021 — Horizontal Scaling `[PRODUCTION]`

**Requirements:**
- FastAPI backend must be stateless — no in-memory session state — so that multiple instances can run behind a load balancer
- SSE broadcast must work across multiple backend instances using Redis pub/sub (not in-memory asyncio queue)
- Database connection pooling configured — maximum 20 connections per backend instance
- Next.js frontend deployable as static export or serverless functions

---

### NFR-022 — Database Scalability `[PRODUCTION]`

**Requirements:**
- Claims table partitioned by date_of_service month when row count exceeds 10 million
- Read replicas configured for plan dashboard queries to offload analytics from primary
- pgvector extension installed and ready for semantic search in Phase 2 (no schema migration required)
- Query explain plans reviewed for all dashboard queries before production launch — no sequential scans on large tables

---

### NFR-023 — Multi-Plan Scalability `[PRODUCTION]`

**Requirements:**
- ETL pipeline must support ingestion from multiple plans simultaneously without data cross-contamination
- plan_name column on claims table enables per-plan filtering at query time
- Plan-level access control ensures plan investigator A cannot see plan B's data
- Adding a new plan requires only ETL configuration — no code changes to dashboards or API

---

## Section 5 — Maintainability

---

### NFR-024 — Code Quality `[MVP]`

**Requirements:**
- All Python code formatted with Black (line length 88)
- All Python code linted with Ruff — zero errors before commit
- All TypeScript code formatted with Prettier
- No commented-out code committed to main branch
- No hardcoded values that belong in environment variables
- Every function longer than 20 lines has a docstring explaining its purpose
- No function longer than 50 lines — extract to helpers if needed

---

### NFR-025 — Logging `[MVP]`

**Requirements:**
- FastAPI backend uses Python `logging` module — not print statements
- Log levels used correctly: DEBUG for development detail, INFO for normal operations, WARNING for recoverable issues, ERROR for failures
- Every ETL step logs: step name, record count processed, time elapsed
- Rules engine logs: rule name, number of flags fired, time elapsed per rule
- Risk scoring logs: entity count scored, time elapsed
- SSE events logged at DEBUG level — not INFO (too verbose for production)
- No patient names or claim amounts logged — log IDs only

---

### NFR-026 — Documentation `[MVP]`

**Requirements:**
- All 16 documentation files in the `docs/` folder completed before coding begins
- FastAPI auto-generated docs at `/docs` are accurate — Pydantic models must match actual responses
- Every environment variable documented in `.env.example` with a description comment
- Every database table and column has a comment in `DB_SCHEMA.md`
- `ENVIRONMENT_SETUP.md` must be followed by a developer who has never seen the project — verified by having the frontend developer follow it independently

---

### NFR-027 — Dependency Management `[MVP]`

**Requirements:**
- Python dependencies pinned in `requirements.txt` with exact versions
- Node dependencies pinned in `package-lock.json`
- No dependency installed that is not actively used
- Dependencies reviewed for known CVEs before production launch (use `pip audit` and `npm audit`)

---

## Section 6 — Data Integrity

---

### NFR-028 — Actions Table Immutability `[MVP]`

The actions table is an audit record. It must never be modified after insert.

**Requirements:**
- No UPDATE operations on the actions table — ever
- No DELETE operations on the actions table — ever
- Application code must not contain any UPDATE or DELETE statements targeting the actions table
- If a physician changes their mind, a new action record is inserted — the old one remains
- Database user used by the application does not have UPDATE or DELETE privileges on the actions table `[PILOT]`

---

### NFR-029 — Transaction Integrity `[MVP]`

Critical multi-step operations must be atomic — either all steps succeed or none do.

**Requirements:**
- ETL bulk insert is a single transaction — partial inserts are not acceptable
- POST /actions inserts the action AND updates claims.reviewed in a single transaction
- If either step fails, both are rolled back
- No orphaned action records pointing to non-existent claims
- Foreign key constraints enforced at database level — not just application level

---

### NFR-030 — Demo Data Determinism `[MVP]`

The demo dataset must be reproducible and consistent so that every pitch meeting starts from the same known state.

**Requirements:**
- Running demo_reset.py twice produces the same database state both times
- All 4 verification queries return the same results after every reset
- The fraud patterns are always visible in the same positions in the dashboards
- No randomness in synthetic data generation that would cause fraud patterns to be absent on some runs (use seeded random where needed)
- The demo script in `docs/DEMO_SCRIPT.md` works correctly against the reset database every time

---

## Summary Table

| ID | Requirement | Phase | Priority |
|---|---|---|---|
| NFR-001 | Physician dashboard < 300ms | MVP | Critical |
| NFR-002 | Plan dashboard < 400ms | MVP | Critical |
| NFR-003 | SSE alert < 1 second | MVP | Critical |
| NFR-004 | Demo reset < 3 minutes | MVP | Critical |
| NFR-005 | Pilot ingestion 500K records | Pilot | High |
| NFR-006 | Production P95 < 500ms | Production | High |
| NFR-007 | Demo server uptime | MVP | Critical |
| NFR-008 | SSE reconnection resilience | MVP | High |
| NFR-009 | 99.5% uptime SLA | Production | High |
| NFR-010 | HTTPS enforced | MVP | Critical |
| NFR-011 | Secrets management | MVP | Critical |
| NFR-012 | DB not public-facing | MVP | Critical |
| NFR-013 | Input validation | MVP | Critical |
| NFR-014 | Auth0 + NPI verification | Pilot | Critical |
| NFR-015 | Encryption at rest | Pilot | Critical |
| NFR-016 | Audit logging | Pilot | Critical |
| NFR-017 | HIPAA compliance + BAAs | Pilot | Critical |
| NFR-018 | Cyber liability insurance | Pilot | Critical |
| NFR-019 | Penetration testing | Production | High |
| NFR-020 | SOC 2 Type II | Production | High |
| NFR-021 | Horizontal scaling | Production | Medium |
| NFR-022 | DB scalability | Production | Medium |
| NFR-023 | Multi-plan scalability | Production | Medium |
| NFR-024 | Code quality standards | MVP | High |
| NFR-025 | Structured logging | MVP | High |
| NFR-026 | Documentation complete | MVP | Critical |
| NFR-027 | Dependency management | MVP | Medium |
| NFR-028 | Actions immutability | MVP | Critical |
| NFR-029 | Transaction integrity | MVP | Critical |
| NFR-030 | Demo data determinism | MVP | Critical |
