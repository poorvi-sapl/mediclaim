"""DEACTIVATED — this suite exercises the TOTP/authenticator login flow
(/auth/login -> mfa_pending_token -> /auth/mfa/login) that was intentionally replaced
by Email OTP. /auth/login no longer issues a session cookie / mfa_pending_token for
non-demo accounts, so this flow is no longer reachable. The TOTP endpoints remain in the
codebase (kept for future enterprise use) but are not part of the active login path.

Active replacement: test_email_otp.py. This file is kept (not deleted) to mirror the
"deactivate, don't delete" treatment of the TOTP screens/endpoints.
"""
import sys
print("SKIPPED: test_mfa_frontend.py covers the deactivated TOTP login flow "
      "(replaced by Email OTP — see test_email_otp.py).")
sys.exit(0)

import uuid
import pyotp
import requests
import psycopg2

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, "d:/Mediclaim")
from backend.auth import hash_password  # reuse the app's bcrypt hashing

BASE = "http://localhost:8000"
DB = "postgresql://postgres:claimlens@localhost:5433/claimlens"
PW = "Test1234!"
WRONG = "000000"

PHYS = "test.mfa@example.com"
PAYER = "test.payer@example.com"

results = []
def check(name, ok, detail=""):
    results.append(ok)
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))

# --- seed two real (non-demo) users, mfa disabled ---
conn = psycopg2.connect(DB); conn.autocommit = True
cur = conn.cursor()
for email, role, npi in [(PHYS, "physician", "1234567890"), (PAYER, "plan_investigator", None)]:
    cur.execute("DELETE FROM users WHERE email=%s", (email,))
    cur.execute(
        "INSERT INTO users (id,email,password_hash,role,npi,full_name,created_at,mfa_enabled) "
        "VALUES (%s,%s,%s,%s,%s,%s,now(),FALSE)",
        (str(uuid.uuid4()), email, hash_password(PW), role, npi, "Test User"),
    )
print(f"seeded {PHYS} (physician) + {PAYER} (payer), mfa disabled\n")

def login(email):
    return requests.post(f"{BASE}/auth/login", json={"email": email, "password": PW})

# === SCENARIO 10: demo accounts unaffected (no mfa_required, normal cookie) ===
ok10 = True
for demo in ["physician@mediclaim.com", "payer@mediclaim.com"]:
    s = requests.Session()
    b = s.post(f"{BASE}/auth/login", json={"email": demo, "password": "demo1234"}).json()
    ok10 = ok10 and b.get("mfa_required") is None and "claimlens_token" in s.cookies and b.get("mfa_enabled") is False
check("10. demo @claimlens.com accounts log in normally (no MFA, gate bypassed)", ok10)

# === SCENARIO 1: un-configured real user -> mfa_enabled:false (SPA gates to /mfa/setup) ===
s = requests.Session()
b = s.post(f"{BASE}/auth/login", json={"email": PHYS, "password": PW}).json()
gate_ok = b.get("mfa_required") is None and b.get("mfa_enabled") is False and "claimlens_token" in s.cookies
# setup call with the session cookie
setup = s.post(f"{BASE}/auth/mfa/setup").json()
secret = setup.get("manual_code")
check("1. real un-configured user: login gives mfa_enabled=false + /auth/mfa/setup returns QR",
      gate_ok and setup.get("qr_uri", "").startswith("otpauth://totp/") and bool(secret))

# === SCENARIO 1 cont / 2: verify-setup -> 10 backup codes, then /auth/me flips to true ===
vs = s.post(f"{BASE}/auth/mfa/verify-setup", json={"code": pyotp.TOTP(secret).now()}).json()
backup_codes = vs.get("backup_codes", [])
me = s.get(f"{BASE}/auth/me").json()
check("2. verify-setup returns 10 backup codes AND /auth/me now reports mfa_enabled=true (gate releases)",
      vs.get("success") is True and len(backup_codes) == 10 and me.get("mfa_enabled") is True)

# === SCENARIO 3: MFA-enabled login -> mfa_required + token, NO cookie ===
s3 = requests.Session()
r3 = s3.post(f"{BASE}/auth/login", json={"email": PHYS, "password": PW})
b3 = r3.json()
pending = b3.get("mfa_pending_token")
check("3. MFA-enabled login -> mfa_required:true + pending token, no session cookie",
      b3.get("mfa_required") is True and bool(pending) and "claimlens_token" not in s3.cookies)

# === SCENARIO 4: /auth/mfa/login TOTP -> cookie + redirect (physician) ===
s4 = requests.Session()
r4 = s4.post(f"{BASE}/auth/mfa/login",
             json={"code": pyotp.TOTP(secret).now(), "mfa_pending_token": pending})
b4 = r4.json()
check("4. /auth/mfa/login (physician) sets cookie + redirect=/physician/dashboard",
      r4.status_code == 200 and "claimlens_token" in s4.cookies and b4.get("redirect") == "/physician/dashboard")

# === SCENARIO 3 (payer): payer MFA login redirects to /plan/dashboard ===
sp = requests.Session()
psetup = sp.post(f"{BASE}/auth/login", json={"email": PAYER, "password": PW})  # mfa off -> cookie
psecret = sp.post(f"{BASE}/auth/mfa/setup").json()["manual_code"]
sp.post(f"{BASE}/auth/mfa/verify-setup", json={"code": pyotp.TOTP(psecret).now()})
ppend = requests.post(f"{BASE}/auth/login", json={"email": PAYER, "password": PW}).json()["mfa_pending_token"]
rp = requests.post(f"{BASE}/auth/mfa/login", json={"code": pyotp.TOTP(psecret).now(), "mfa_pending_token": ppend})
check("3b. payer MFA login redirect=/plan/dashboard", rp.json().get("redirect") == "/plan/dashboard")

# === SCENARIO 6: backup-code login succeeds; 7: reuse -> 400 ===
def fresh(email):
    return requests.post(f"{BASE}/auth/login", json={"email": email, "password": PW}).json()["mfa_pending_token"]

used = backup_codes[0]
s6 = requests.Session()
r6 = s6.post(f"{BASE}/auth/mfa/backup", json={"backup_code": used, "mfa_pending_token": fresh(PHYS)})
check("6. backup-code login succeeds + sets cookie", r6.status_code == 200 and "claimlens_token" in s6.cookies)
r7 = requests.post(f"{BASE}/auth/mfa/backup", json={"backup_code": used, "mfa_pending_token": fresh(PHYS)})
check("7. reusing a consumed backup code -> 400", r7.status_code == 400)

# === SCENARIO 5: 5 wrong TOTP -> 6th = 429 lockout ===
# reset limiter with one success first for a clean count
requests.post(f"{BASE}/auth/mfa/login", json={"code": pyotp.TOTP(secret).now(), "mfa_pending_token": fresh(PHYS)})
tok = fresh(PHYS)
statuses = [requests.post(f"{BASE}/auth/mfa/login",
            json={"code": WRONG, "mfa_pending_token": tok}).status_code for _ in range(6)]
check("5. 5 wrong codes then 6th -> 429 lockout", statuses[:5] == [400]*5 and statuses[5] == 429,
      f"statuses={statuses}")

# --- cleanup: remove the test users ---
cur.execute("DELETE FROM users WHERE email IN (%s,%s)", (PHYS, PAYER))
cur.close(); conn.close()
print("\ncleanup: removed test users")

passed = sum(results)
print(f"\n{passed}/{len(results)} API-level checks passed")
print("Scenarios 8 (direct /mfa/backup-codes -> 'already shown' message) and "
      "9 (direct /mfa/login w/o token -> /login) are client-side sessionStorage guards "
      "[verified by code + passing production build].")
sys.exit(0 if passed == len(results) else 1)
