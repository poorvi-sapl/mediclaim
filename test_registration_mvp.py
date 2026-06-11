"""Part-10 verification for the registration MVP (API-checkable scenarios)."""
import sys, re, uuid, psycopg2, requests, os
from dotenv import load_dotenv; load_dotenv(r"D:\Mediclaim\.env")
sys.path.insert(0, "d:/Mediclaim")
from backend.verification.mock_util import is_mock_fail
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
B = "http://localhost:8000"; LOG = "d:/Mediclaim/uvicorn_run.log"
conn = psycopg2.connect(os.environ["DATABASE_URL"]); conn.autocommit = True; cur = conn.cursor()
ok = []
def chk(n, c, d=""): ok.append(c); print(f"[{'PASS' if c else 'FAIL'}] {n}" + (f" - {d}" if d else ""))
def latest_otp(email):
    o = None
    for ln in open(LOG, encoding="utf-8", errors="replace"):
        m = re.search(r"DEV OTP MODE.*email=" + re.escape(email) + r" \| otp=(\d{6})", ln)
        if m: o = m.group(1)
    return o

# pick real NPIs from npi_profiles
def pick(where):
    cur.execute(f"SELECT npi FROM npi_profiles WHERE oig_excluded=false AND practice_lat IS NOT NULL AND {where} "
                "AND npi NOT IN (SELECT npi FROM users WHERE npi IS NOT NULL) LIMIT 1")
    r = cur.fetchone(); return r[0] if r else None
npi_ok = pick("npi NOT LIKE '%%98' AND npi NOT LIKE '%%99'")
npi_inelig = pick("npi LIKE '%%99'")
# monitored NPI (on leaderboard) for detail check
cur.execute("""SELECT s.entity_id FROM npi_risk_scores s JOIN npi_profiles p ON p.npi=s.entity_id
   WHERE s.entity_type='npi' AND p.oig_excluded=false AND s.entity_id NOT LIKE '%%98'
   AND s.entity_id NOT LIKE '%%99' AND s.entity_id NOT IN (SELECT npi FROM users WHERE npi IS NOT NULL) LIMIT 1""")
npi_monitored = cur.fetchone()[0]
# UEI: valid+clean, and excluded
def find_uei(excluded):
    i = 0
    while True:
        u = f"UEI{i:09d}"[:12].ljust(12, "X")
        bad10 = is_mock_fail(u, 10); ex = is_mock_fail(u, 15)
        if not excluded and not bad10 and not ex: return u
        if excluded and ex: return u
        i += 1
uei_ok = find_uei(False); uei_excl = find_uei(True)
emails = []
def reg_phys(email, **kw):
    emails.append(email); cur.execute("DELETE FROM users WHERE email=%s", (email,))
    body = {"email": email, "password": "Passw0rd!", "role": "physician", "last_name": "TESTER"}; body.update(kw)
    return requests.post(f"{B}/auth/register", json=body)
def reg_payer(email, **kw):
    emails.append(email); cur.execute("DELETE FROM users WHERE email=%s", (email,))
    body = {"email": email, "password": "Passw0rd!", "role": "plan_investigator",
            "organization_name": "Acme Health Plan", "authorized_signatory_name": "Jane Doe",
            "authorized_signatory_title": "CCO", "attestation": True}; body.update(kw)
    return requests.post(f"{B}/auth/register/payer", json=body)
def db_user(email):
    cur.execute("SELECT is_active, needs_manual_review, verification_results FROM users WHERE email=%s", (email,))
    return cur.fetchone()

# 2: physician happy path -> account + login works
r = reg_phys("reg.ok@example.com", npi=npi_ok, dea_number="AB1234563",
             state_license_number="A12345", state_license_state="CA", ptan="P1234567")
s = requests.Session(); s.post(f"{B}/auth/login", json={"email":"reg.ok@example.com","password":"Passw0rd!"})
otp = latest_otp("reg.ok@example.com")
pend = requests.post(f"{B}/auth/login", json={"email":"reg.ok@example.com","password":"Passw0rd!"}).json()
v = s.post(f"{B}/auth/otp/verify", json={"code":latest_otp('reg.ok@example.com'),"otp_pending_token":pend["otp_pending_token"]})
chk("2. physician happy path registers + logs in", r.status_code==201 and v.status_code==200 and v.json().get("redirect")=="/physician/dashboard",
    f"reg={r.status_code} login={v.status_code}")

# 3: NPI not in Order&Referring -> blocked
r = reg_phys("reg.inelig@example.com", npi=npi_inelig, dea_number="AB1234563")
chk("3. NPI not in Order&Referring -> 400 blocked", r.status_code==400 and r.json().get("detail",{}).get("code")=="ORDER_REFERRING_INELIGIBLE", f"status={r.status_code}")

# 4: DEA + license omitted -> succeeds, needs_manual_review true
r = reg_phys("reg.bare@example.com", npi=pick("npi NOT LIKE '%%98' AND npi NOT LIKE '%%99'"))
mr = db_user("reg.bare@example.com")
chk("4. DEA/license omitted -> succeeds + needs_manual_review", r.status_code==201 and mr and mr[1] is True, f"status={r.status_code} nmr={mr[1] if mr else None}")

# 5: DEA invalid checksum -> advisory, not blocked, dea.valid false
r = reg_phys("reg.deabad@example.com", npi=pick("npi NOT LIKE '%%98' AND npi NOT LIKE '%%99'"), dea_number="AB1234560")
mr = db_user("reg.deabad@example.com")
dea_valid = (mr[2] or {}).get("dea", {}).get("valid") if mr else None
chk("5. invalid DEA checksum -> not blocked, dea.valid=false", r.status_code==201 and dea_valid is False, f"status={r.status_code} dea_valid={dea_valid}")

# 6: payer happy path -> pending activation, is_active false, cannot access protected route
r = reg_payer("reg.payer@example.com", uei=uei_ok)
pu = db_user("reg.payer@example.com")
# login + otp, then try protected route -> 403
sp = requests.Session(); sp.post(f"{B}/auth/login", json={"email":"reg.payer@example.com","password":"Passw0rd!"})
pend = requests.post(f"{B}/auth/login", json={"email":"reg.payer@example.com","password":"Passw0rd!"}).json()
sp.post(f"{B}/auth/otp/verify", json={"code":latest_otp('reg.payer@example.com'),"otp_pending_token":pend["otp_pending_token"]})
prot = sp.get(f"{B}/plan/summary")
chk("6. payer registers pending + inactive + 403 on protected", r.status_code==201 and pu and pu[0] is False and prot.status_code==403,
    f"reg={r.status_code} is_active={pu[0] if pu else None} protected={prot.status_code}")

# 7: payer SAM exclusion -> blocked
r = reg_payer("reg.excl@example.com", uei=uei_excl)
chk("7. payer SAM exclusion -> 400 blocked", r.status_code==400 and r.json().get("detail",{}).get("code")=="SAM_EXCLUDED", f"status={r.status_code}")

# 8: attestation false -> 400
r = reg_payer("reg.noatt@example.com", uei=uei_ok, attestation=False)
chk("8. attestation false -> 400", r.status_code==400 and r.json().get("detail",{}).get("code")=="ATTESTATION_REQUIRED", f"status={r.status_code}")

# 9 + 10: admin sees pending payer, activates, payer can then access
cur.execute("SELECT id FROM users WHERE email='reg.payer@example.com'"); payer_id = cur.fetchone()[0]
adm = requests.Session(); adm.post(f"{B}/auth/login", json={"email":"payer@mediclaim.com","password":"demo1234"})
ap = requests.post(f"{B}/auth/login", json={"email":"payer@mediclaim.com","password":"demo1234"}).json()
adm.post(f"{B}/auth/otp/verify", json={"code":"123456","otp_pending_token":ap["otp_pending_token"]})
pending = adm.get(f"{B}/admin/users/pending").json()
in_pending = any(u["id"]==str(payer_id) for u in pending)
act = adm.post(f"{B}/admin/users/{payer_id}/activate")
is_active_after = db_user("reg.payer@example.com")[0]
chk("10. admin pending list shows payer before activation", in_pending, f"pending={len(pending)}")
chk("9. admin activates payer -> is_active true", act.status_code==200 and is_active_after is True, f"activate={act.status_code} is_active={is_active_after}")

# 11: NPI detail (registered monitored physician) shows DEA/state/PTAN keys
reg_phys("reg.detail@example.com", npi=npi_monitored, dea_number="AB1234563", state_license_number="A12345", state_license_state="CA", ptan="P1234567")
det = adm.get(f"{B}/plan/npi/{npi_monitored}/detail").json().get("verification") or {}
chk("11. NPI detail verification has dea/state_license/ptan", all(k in det for k in ("dea","state_license","ptan")), f"keys={sorted(det.keys())}")

# 13: demo logins unaffected
ok13 = True
for em in ["physician@mediclaim.com","payer@mediclaim.com"]:
    ss=requests.Session(); b=ss.post(f"{B}/auth/login", json={"email":em,"password":"demo1234"}).json()
    vv=ss.post(f"{B}/auth/otp/verify", json={"code":"123456","otp_pending_token":b["otp_pending_token"]})
    ok13 = ok13 and vv.status_code==200
chk("13. demo logins (123456) still work", ok13)

# 14: verify endpoints + rate limit
vn = requests.get(f"{B}/auth/verify-npi?npi={npi_ok}").json()
vu = requests.get(f"{B}/auth/verify-uei?uei={uei_ok}").json()
# hammer to trip rate limit (10/min)
codes = [requests.get(f"{B}/auth/verify-npi?npi={npi_ok}").status_code for _ in range(12)]
chk("14. verify-npi/uei work + rate limited (429)", vn.get("valid") is True and vu.get("valid") is True and 429 in codes,
    f"npi_valid={vn.get('valid')} uei_valid={vu.get('valid')} hit429={429 in codes}")

# cleanup
for e in emails + ["reg.detail@example.com"]:
    cur.execute("DELETE FROM users WHERE email=%s", (e,))
cur.close(); conn.close()
print(f"\n{sum(ok)}/{len(ok)} API-checkable scenarios passed")
sys.exit(0 if sum(ok)==len(ok) else 1)
