"""End-to-end verification of the 8 MFA scenarios. Run with the venv python.

Drives the real HTTP API on localhost:8000 using the physician demo account, then
resets that account's MFA state so normal demo logins keep working.
"""
import sys
import pyotp
import requests

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "http://localhost:8000"
EMAIL = "physician@mediclaim.com"
PW = "demo1234"
WRONG = "000000"

results = []
def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))

# --- bootstrap: normal login (MFA not yet enabled) to get a session cookie ---
s = requests.Session()
r = s.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PW})
assert r.status_code == 200, f"bootstrap login failed: {r.status_code} {r.text}"
assert "claimlens_token" in s.cookies, "expected session cookie on non-MFA login"
NPI = r.json().get("npi")
PROTECTED = f"{BASE}/physician/{NPI}/summary"  # requires physician role (middleware-guarded)

# === SCENARIO 1: POST /auth/mfa/setup -> qr_uri + manual_code ===
r = s.post(f"{BASE}/auth/mfa/setup")
ok = r.status_code == 200 and "qr_uri" in r.json() and "manual_code" in r.json()
secret = r.json().get("manual_code") if ok else None
check("1. /auth/mfa/setup returns qr_uri + manual_code",
      ok and r.json()["qr_uri"].startswith("otpauth://totp/"),
      f"manual_code={secret}")

# === SCENARIO 2: verify-setup with correct TOTP -> backup codes + mfa_enabled=TRUE ===
code = pyotp.TOTP(secret).now()
r = s.post(f"{BASE}/auth/mfa/verify-setup", json={"code": code})
body = r.json()
backup_codes = body.get("backup_codes", [])
check("2. /auth/mfa/verify-setup returns 10 backup codes",
      r.status_code == 200 and body.get("success") is True and len(backup_codes) == 10,
      f"{len(backup_codes)} codes")

# === SCENARIO 3: /auth/login on MFA account -> mfa_required, no cookie ===
s2 = requests.Session()
r = s2.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PW})
body = r.json()
check("3. /auth/login returns mfa_required + token, NO cookie",
      r.status_code == 200 and body.get("mfa_required") is True
      and bool(body.get("mfa_pending_token")) and "claimlens_token" not in s2.cookies,
      f"cookie_set={'claimlens_token' in s2.cookies}")
pending = body.get("mfa_pending_token")

# === SCENARIO 8a: mfa_pending token REJECTED on a protected route ===
r = requests.get(PROTECTED, headers={"Authorization": f"Bearer {pending}"})
check("8a. mfa_pending token REJECTED on protected route",
      r.status_code == 401, f"status={r.status_code} (route={PROTECTED})")

# === SCENARIO 4: /auth/mfa/login with correct TOTP -> cookie + redirect ===
s3 = requests.Session()
code = pyotp.TOTP(secret).now()
r = s3.post(f"{BASE}/auth/mfa/login", json={"code": code, "mfa_pending_token": pending})
body = r.json()
check("4. /auth/mfa/login sets cookie + returns redirect",
      r.status_code == 200 and body.get("success") is True
      and "claimlens_token" in s3.cookies
      and body.get("redirect") == "/physician/dashboard",
      f"redirect={body.get('redirect')}")

# === SCENARIO 8b: the real access cookie WORKS on the protected route ===
r = s3.get(PROTECTED)
check("8b. real claimlens_token works on protected route",
      r.status_code == 200, f"status={r.status_code}")

# === SCENARIO 6: /auth/mfa/backup with a valid backup code -> login, code consumed ===
def fresh_pending():
    rr = requests.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PW})
    return rr.json()["mfa_pending_token"]

used_code = backup_codes[0]
s4 = requests.Session()
r = s4.post(f"{BASE}/auth/mfa/backup",
            json={"backup_code": used_code, "mfa_pending_token": fresh_pending()})
body = r.json()
check("6. /auth/mfa/backup with valid code logs in",
      r.status_code == 200 and body.get("success") is True and "claimlens_token" in s4.cookies,
      f"redirect={body.get('redirect')}")

# === SCENARIO 7: reuse the same (now-consumed) backup code -> 400 ===
r = requests.post(f"{BASE}/auth/mfa/backup",
                  json={"backup_code": used_code, "mfa_pending_token": fresh_pending()})
check("7. reusing a consumed backup code -> 400",
      r.status_code == 400, f"status={r.status_code} body={r.text[:120]}")

# === SCENARIO 5: 5 wrong TOTP codes -> 6th attempt returns 429 (lockout) ===
# First do a successful login to reset the limiter for a clean count.
code = pyotp.TOTP(secret).now()
requests.post(f"{BASE}/auth/mfa/login", json={"code": code, "mfa_pending_token": fresh_pending()})
statuses = []
tok = fresh_pending()
for i in range(6):
    r = requests.post(f"{BASE}/auth/mfa/login", json={"code": WRONG, "mfa_pending_token": tok})
    statuses.append(r.status_code)
check("5. 5 wrong codes then 6th -> 429 lockout",
      statuses[:5] == [400, 400, 400, 400, 400] and statuses[5] == 429,
      f"statuses={statuses}")

# --- cleanup: reset the demo account so normal (non-MFA) logins keep working ---
import subprocess
subprocess.run([
    "docker", "exec", "-e", "PGPASSWORD=claimlens", "claimlens-pg",
    "psql", "-U", "postgres", "-d", "claimlens", "-c",
    "UPDATE users SET mfa_enabled=FALSE, mfa_secret=NULL, mfa_pending_secret=NULL, "
    "mfa_backup_codes=NULL WHERE email='physician@mediclaim.com';",
], check=False)
print("cleanup: physician demo account MFA reset to disabled")

# --- summary ---
passed = sum(1 for _, ok, _ in results if ok)
print(f"\n{passed}/{len(results)} checks passed")
sys.exit(0 if passed == len(results) else 1)
