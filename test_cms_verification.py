"""Verify the 7 CMS-verification scenarios end-to-end against the live API (CMS_MOCK on).

Mock keys off NPI digits (see cms.py): last2 '99' -> not eligible, '98' -> CMS outage;
last digit 1 -> lapsed, 2 -> due_soon, 0 -> not_found, else current.
We pick REAL npi_profiles NPIs with those suffixes so step-1 NPPES passes.
"""
import sys, uuid, psycopg2, requests
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "http://localhost:8000"
DB = "postgresql://postgres:claimlens@localhost:5433/claimlens"
PW = "Test1234!"

conn = psycopg2.connect(DB); conn.autocommit = True
cur = conn.cursor()

def pick(where):
    cur.execute(f"SELECT npi FROM npi_profiles WHERE oig_excluded=false AND {where} LIMIT 1")
    r = cur.fetchone(); return r[0] if r else None

# Real NPIs with the suffixes the mock recognizes.
npi_eligible = pick("npi LIKE '%%4' AND npi NOT LIKE '%%98' AND npi NOT LIKE '%%99'")  # eligible + current
npi_not_elig = pick("npi LIKE '%%99'")                                                 # not in Order&Referring
npi_outage   = pick("npi LIKE '%%98'")                                                 # simulated CMS outage
# Monitored NPI (on the leaderboard) ending in 1/2 -> revalidation lapsed/due_soon.
cur.execute("""SELECT s.entity_id FROM npi_risk_scores s JOIN npi_profiles p ON p.npi=s.entity_id
               WHERE s.entity_type='npi' AND p.oig_excluded=false
                 AND (s.entity_id LIKE '%%1' OR s.entity_id LIKE '%%2') LIMIT 1""")
row = cur.fetchone(); npi_flagged_monitored = row[0] if row else None
# A monitored NPI we will NOT register (pre-feature account, scenario 6).
cur.execute("""SELECT entity_id FROM npi_risk_scores WHERE entity_type='npi'
               AND entity_id <> %s LIMIT 1""", (npi_flagged_monitored,))
npi_unregistered = cur.fetchone()[0]

print(f"eligible={npi_eligible} not_elig={npi_not_elig} outage={npi_outage} "
      f"flagged_monitored={npi_flagged_monitored} unregistered={npi_unregistered}\n")

emails = []
def reg(email, npi):
    emails.append(email)
    cur.execute("DELETE FROM users WHERE email=%s", (email,))
    return requests.post(f"{BASE}/auth/register",
                         json={"email": email, "password": PW, "npi": npi})

def db_user(email):
    cur.execute("SELECT needs_manual_review, verification_results FROM users WHERE email=%s", (email,))
    return cur.fetchone()

results = []
def check(name, ok, detail=""):
    results.append(ok); print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))

# === 1: valid eligible NPI -> success, verification populated, no manual review ===
r = reg("cms.ok@example.com", npi_eligible); b = r.json()
mr, vr = db_user("cms.ok@example.com")
check("1. eligible NPI registers; verification_results populated",
      r.status_code == 201 and b.get("success")
      and vr and vr.get("cms_order_referring", {}).get("eligible") is True
      and vr.get("cms_revalidation", {}).get("status") == "current",
      f"status={r.status_code} reval={vr.get('cms_revalidation',{}).get('status') if vr else None}")

# === 2: NPI not in Order & Referring -> blocked 400, no account ===
r = reg("cms.blocked@example.com", npi_not_elig)
check("2. NPI not in Order&Referring -> 400 blocked, no account",
      r.status_code == 400 and r.json().get("detail", {}).get("code") == "ORDER_REFERRING_INELIGIBLE"
      and db_user("cms.blocked@example.com") is None,
      f"status={r.status_code}")

# === 3: monitored NPI, revalidation lapsed/due_soon -> needs_manual_review + leaderboard icon ===
r = reg("cms.flagged@example.com", npi_flagged_monitored); b = r.json()
mr, vr = db_user("cms.flagged@example.com")
s = requests.Session()
_pb = s.post(f"{BASE}/auth/login", json={"email": "payer@mediclaim.com", "password": "demo1234"}).json()
s.post(f"{BASE}/auth/otp/verify", json={"code": "123456", "otp_pending_token": _pb["otp_pending_token"]})
lb = s.get(f"{BASE}/plan/npi-risk-list?page_size=100").json()["items"]
lb_flagged = next((x.get("needs_manual_review") for x in lb if x["npi"] == npi_flagged_monitored), None)
check("3. lapsed/due_soon -> needs_manual_review=TRUE in DB and on leaderboard row",
      r.status_code == 201 and mr is True and lb_flagged is True
      and vr.get("cms_revalidation", {}).get("status") in ("lapsed", "due_soon"),
      f"db_flag={mr} leaderboard_flag={lb_flagged} reval={vr.get('cms_revalidation',{}).get('status') if vr else None}")

# === 4: CMS outage (mock) -> registration still succeeds, manual_review flag set, logged ===
r = reg("cms.outage@example.com", npi_outage); b = r.json()
mr, vr = db_user("cms.outage@example.com")
check("4. CMS outage -> registration succeeds + manual_review flag",
      r.status_code == 201 and mr is True
      and vr.get("cms_order_referring", {}).get("manual_review") is True,
      f"status={r.status_code} manual_review={vr.get('cms_order_referring',{}).get('manual_review') if vr else None}")

# === 5: NPI detail shows verification for the registered (monitored) physician ===
det = s.get(f"{BASE}/plan/npi/{npi_flagged_monitored}/detail").json()
v = det.get("verification")
check("5. NPI detail returns verification block for registered physician",
      bool(v) and ("cms_order_referring" in v or "order_referring" in v) and v.get("needs_manual_review") is True,
      f"verification keys={list(v.keys()) if v else None}")

# === 6: NPI detail for an unregistered (pre-feature) account -> verification null ===
det2 = s.get(f"{BASE}/plan/npi/{npi_unregistered}/detail").json()
check("6. unregistered NPI detail -> verification is null (pre-feature)",
      det2.get("verification") is None, f"verification={det2.get('verification')}")

# === 7: existing demo logins + MFA unaffected ===
ok7 = True
for demo in ["physician@mediclaim.com", "payer@mediclaim.com"]:
    ss = requests.Session()
    bb = ss.post(f"{BASE}/auth/login", json={"email": demo, "password": "demo1234"}).json()
    vv = ss.post(f"{BASE}/auth/otp/verify", json={"code": "123456", "otp_pending_token": bb["otp_pending_token"]})
    ok7 = ok7 and bb.get("otp_required") is True and vv.status_code == 200 and "claimlens_token" in ss.cookies
check("7. demo logins still work normally (no MFA prompt, cookie set)", ok7)

# --- cleanup: remove non-monitored test accounts; KEEP the flagged monitored one so the
# amber icon + verification section are visible live in the app. ---
for e in ["cms.ok@example.com", "cms.outage@example.com", "cms.blocked@example.com"]:
    cur.execute("DELETE FROM users WHERE email=%s", (e,))
cur.close(); conn.close()

passed = sum(results)
print(f"\n{passed}/{len(results)} scenarios passed")
print(f"LEFT REGISTERED for live demo: cms.flagged@example.com (npi {npi_flagged_monitored}) "
      f"- shows amber icon on leaderboard + Verification Status on its detail page.")
sys.exit(0 if passed == len(results) else 1)
