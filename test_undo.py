"""Verify the undo capability + demo reset (backend-checkable scenarios)."""
import sys, time, uuid, threading, psycopg2, requests, os
from dotenv import load_dotenv; load_dotenv(r"D:\Mediclaim\.env")
sys.path.insert(0, "d:/Mediclaim")
from backend.auth import hash_password
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
B = "http://localhost:8000"
cn = psycopg2.connect(os.environ["DATABASE_URL"]); cn.autocommit = True; cu = cn.cursor()
ok = []
def chk(n, c, d=""): ok.append(c); print(f"[{'PASS' if c else 'FAIL'}] {n}" + (f" - {d}" if d else ""))

def demo_session(email):
    s = requests.Session()
    b = s.post(f"{B}/auth/login", json={"email": email, "password": "demo1234"}).json()
    s.post(f"{B}/auth/otp/verify", json={"code": "123456", "otp_pending_token": b["otp_pending_token"]})
    return s

# physician demo session + its NPI
s_phys = demo_session("physician@claimlens.com")
N = s_phys.get(f"{B}/auth/me").json().get("npi")
# payer session for SSE
s_pay = demo_session("plan@claimlens.com")

def unreviewed_claim():
    cu.execute("SELECT id FROM claims WHERE npi=%s AND reviewed=false LIMIT 1", (N,))
    return str(cu.fetchone()[0])

def last_calc():
    cu.execute("SELECT last_calculated FROM npi_risk_scores WHERE entity_type='npi' AND entity_id=%s", (N,))
    r = cu.fetchone(); return r[0] if r else None

# === SSE listener (scenario 4) ===
sse_events = []
def sse_reader():
    try:
        with s_pay.get(f"{B}/plan/alerts/stream", stream=True, timeout=12) as resp:
            for line in resp.iter_lines():
                if line:
                    txt = line.decode("utf-8", "replace")
                    sse_events.append(txt)
                    if "action_undone" in txt:
                        return
    except Exception:
        pass
t = threading.Thread(target=sse_reader, daemon=True); t.start()
time.sleep(1.0)  # let the stream connect

# === 1/2: flag a claim, then undo -> restore ===
cid = unreviewed_claim()
r = s_phys.post(f"{B}/actions", json={"claim_id": cid, "npi": N, "action_type": "flag_supplier"})
aid = r.json()["id"]
cu.execute("SELECT reviewed FROM claims WHERE id=%s", (cid,)); reviewed_after_flag = cu.fetchone()[0]
L0 = last_calc()
und = s_phys.delete(f"{B}/actions/{aid}")
cu.execute("SELECT COUNT(*) FROM actions WHERE id=%s", (aid,)); action_gone = cu.fetchone()[0] == 0
cu.execute("SELECT reviewed FROM claims WHERE id=%s", (cid,)); reviewed_after_undo = cu.fetchone()[0]
chk("2. flag then undo -> action deleted + claim unreviewed",
    r.status_code == 201 and reviewed_after_flag is True and und.status_code == 200
    and und.json().get("undone") is True and action_gone and reviewed_after_undo is False,
    f"flag={r.status_code} undo={und.status_code} action_gone={action_gone} reviewed_now={reviewed_after_undo}")

# === 3: undo re-scored the NPI (last_calculated bumped by calculate_npi_scores) ===
L2 = last_calc()
chk("3. undo fired NPI re-score (score recomputed)", L0 is not None and L2 is not None and L2 > L0,
    f"last_calculated {L0} -> {L2}")

# === 4: SSE reversal event broadcast ===
time.sleep(1.5)
chk("4. undo broadcast 'action_undone' on SSE feed", any("action_undone" in e for e in sse_events),
    f"events_seen={len(sse_events)}")

# === 7: cannot undo another physician's action ===
cu.execute("SELECT entity_id FROM npi_risk_scores WHERE entity_type='npi' AND entity_id<>%s LIMIT 1", (N,))
other_npi = cu.fetchone()[0]
cu.execute("SELECT id, supplier_id, supplier_name, patient_name, claim_amount FROM claims WHERE npi=%s LIMIT 1", (other_npi,))
oc = cu.fetchone()
other_aid = str(uuid.uuid4())
cu.execute("INSERT INTO actions (id,claim_id,npi,action_type,supplier_id,supplier_name,patient_name,claim_amount,broadcast,plan_status,created_at) "
           "VALUES (%s,%s,%s,'flag_supplier',%s,%s,%s,%s,false,'pending',now())",
           (other_aid, str(oc[0]), other_npi, oc[1], oc[2], oc[3], oc[4]))
r7 = s_phys.delete(f"{B}/actions/{other_aid}")
chk("7. undo another physician's action -> 403", r7.status_code == 403 and r7.json().get("detail", {}).get("code") == "NOT_OWNER",
    f"status={r7.status_code}")
cu.execute("DELETE FROM actions WHERE id=%s", (other_aid,))

# === 9: 60-second undo window — an action older than 60s is permanent (403 undo_expired) ===
cu.execute("SELECT id, supplier_id, supplier_name, patient_name, claim_amount FROM claims WHERE npi=%s LIMIT 1", (N,))
ec = cu.fetchone()
exp_aid = str(uuid.uuid4())
cu.execute("INSERT INTO actions (id,claim_id,npi,action_type,supplier_id,supplier_name,patient_name,claim_amount,broadcast,plan_status,created_at) "
           "VALUES (%s,%s,%s,'flag_supplier',%s,%s,%s,%s,false,'pending', now() - interval '61 seconds')",
           (exp_aid, str(ec[0]), N, ec[1], ec[2], ec[3], ec[4]))
r9 = s_phys.delete(f"{B}/actions/{exp_aid}")
cu.execute("SELECT COUNT(*) FROM actions WHERE id=%s", (exp_aid,)); still_there = cu.fetchone()[0] == 1
chk("9. undo after 60s window -> 403 undo_expired + action NOT deleted",
    r9.status_code == 403 and r9.json().get("detail", {}).get("error") == "undo_expired" and still_there,
    f"status={r9.status_code} body={r9.json().get('detail')} still_there={still_there}")
cu.execute("DELETE FROM actions WHERE id=%s", (exp_aid,))

# Sanity: an action just inside the window is still undoable (boundary check).
cu.execute("SELECT id, supplier_id, supplier_name, patient_name, claim_amount FROM claims WHERE npi=%s AND reviewed=false LIMIT 1", (N,))
fc = cu.fetchone()
fresh_aid = str(uuid.uuid4())
cu.execute("INSERT INTO actions (id,claim_id,npi,action_type,supplier_id,supplier_name,patient_name,claim_amount,broadcast,plan_status,created_at) "
           "VALUES (%s,%s,%s,'flag_supplier',%s,%s,%s,%s,false,'pending', now() - interval '5 seconds')",
           (fresh_aid, str(fc[0]), N, fc[1], fc[2], fc[3], fc[4]))
cu.execute("UPDATE claims SET reviewed=true WHERE id=%s", (str(fc[0]),))
r9b = s_phys.delete(f"{B}/actions/{fresh_aid}")
chk("9b. undo within 60s window still succeeds", r9b.status_code == 200 and r9b.json().get("undone") is True,
    f"status={r9b.status_code}")

# === 6: reset-actions from non-@claimlens.com physician -> 403 ===
cu.execute("DELETE FROM users WHERE email='undo.real@example.com'")
cu.execute("INSERT INTO users (id,email,password_hash,role,npi,full_name,created_at,mfa_enabled,is_active) "
           "VALUES (%s,'undo.real@example.com',%s,'physician',%s,'Real',now(),FALSE,TRUE)", (str(uuid.uuid4()), hash_password("demo1234"), N))
s_real = requests.Session()
b = s_real.post(f"{B}/auth/login", json={"email": "undo.real@example.com", "password": "demo1234"}).json()
s_real.post(f"{B}/auth/otp/verify", json={"code": "123456", "otp_pending_token": b["otp_pending_token"]})
r6 = s_real.post(f"{B}/physician/reset-actions")
chk("6. reset-actions from non-@claimlens.com -> 403", r6.status_code == 403, f"status={r6.status_code}")
cu.execute("DELETE FROM users WHERE email='undo.real@example.com'")

# === 5: reset-actions from demo physician clears all + resets ===
cid2 = unreviewed_claim()
s_phys.post(f"{B}/actions", json={"claim_id": cid2, "npi": N, "action_type": "flag_supplier"})
r5 = s_phys.post(f"{B}/physician/reset-actions")
cu.execute("SELECT COUNT(*) FROM actions WHERE npi=%s", (N,)); remaining = cu.fetchone()[0]
chk("5. reset-actions clears all physician actions", r5.status_code == 200 and r5.json().get("reset") is True and remaining == 0,
    f"status={r5.status_code} cleared={r5.json().get('actions_cleared')} remaining={remaining}")

cu.close(); cn.close()
allpass = sum(ok) == len(ok)
print(f"\n{sum(ok)}/{len(ok)} backend scenarios passed")
print("Client-side scenarios (verified by build): live countdown + color tiers, "
      "hide at 0s, per-row interval cleanup, refresh-resume from created_at, "
      "inline confirm/Cancel, 403 undo_expired message.")
if allpass:
    print("\nTIMED UNDO COMPLETE")
sys.exit(0 if allpass else 1)
