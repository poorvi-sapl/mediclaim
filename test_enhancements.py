import socket, threading, time, json
import httpx, psycopg2

BASE = "http://localhost:8000"
DB = "postgresql://postgres:claimlens@localhost:5433/claimlens"
results = []


def get_claim():
    conn = psycopg2.connect(DB); cur = conn.cursor()
    cur.execute("SELECT id FROM claims WHERE npi='1234567890' AND reviewed=false LIMIT 1")
    cid = str(cur.fetchone()[0]); conn.close()
    return cid


# ---- TEST 2 setup: open raw SSE socket BEFORE posting ----
buf = bytearray()
s = socket.create_connection(("127.0.0.1", 8000))
s.sendall(b"GET /plan/alerts/stream HTTP/1.1\r\nHost: localhost\r\n"
          b"Accept: text/event-stream\r\n\r\n")
s.settimeout(15)
threading.Thread(target=lambda: [buf.extend(s.recv(4096)) for _ in iter(int, 1)],
                 daemon=True).start()
time.sleep(1.0)  # drain replay, subscribe

# ---- TEST 1: did_not_order accepted ----
claim_id = get_claim()
r = httpx.post(BASE + "/actions", json={
    "claim_id": claim_id, "npi": "1234567890", "action_type": "did_not_order"})
t1 = (r.status_code == 201 and r.json().get("action_type") == "did_not_order")
results.append(("TEST 1 did_not_order accepted (201)", t1,
                f"status={r.status_code} type={r.json().get('action_type')}"))
action_id = r.json().get("id")

# ---- TEST 2: SSE event has escalation fields ----
evt = None
deadline = time.time() + 3
while time.time() < deadline:
    if action_id and action_id.encode() in buf:
        text = buf.decode("utf-8", "replace")
        for line in text.splitlines():
            if line.startswith("data:") and action_id in line:
                try:
                    evt = json.loads(line[len("data:"):].strip())
                except Exception:
                    pass
        if evt:
            break
    time.sleep(0.05)
s.close()
t2 = (evt is not None and evt.get("escalation") is True
      and evt.get("escalation_label") == "PHYSICIAN DENIAL")
results.append(("TEST 2 SSE escalation fields", t2,
                f"escalation={evt.get('escalation') if evt else None} "
                f"label={evt.get('escalation_label') if evt else None}"))

# ---- TEST 3: supplier physicians endpoint ----
conn = psycopg2.connect(DB); cur = conn.cursor()
cur.execute("SELECT supplier_id FROM claims WHERE supplier_name='MedSupply Pro LLC' LIMIT 1")
sup_id = cur.fetchone()[0]; conn.close()
d = httpx.get(f"{BASE}/plan/suppliers/{sup_id}/physicians").json()
phys = d.get("physicians", [])
t3 = (d.get("distinct_npi_count") == 9 and len(phys) == 9
      and all(p.get("physician_name") and p.get("claim_count", 0) > 0 for p in phys)
      and all("specialty" in p and "practice_city" in p and "practice_state" in p for p in phys))
results.append(("TEST 3 supplier physicians (9 entries)", t3,
                f"distinct={d.get('distinct_npi_count')} entries={len(phys)} "
                f"total_denials={d.get('total_denials')}"))

# ---- TEST 4: did_not_order supplier appears in flagged-suppliers ----
fs = httpx.get(f"{BASE}/physician/1234567890/flagged-suppliers").json()
# supplier of the claim we actioned in TEST 1
conn = psycopg2.connect(DB); cur = conn.cursor()
cur.execute("SELECT supplier_id FROM claims WHERE id=%s", (claim_id,))
actioned_sup = cur.fetchone()[0]; conn.close()
t4 = any(item["supplier_id"] == actioned_sup for item in fs.get("items", []))
results.append(("TEST 4 denied supplier in flagged-suppliers", t4,
                f"suppliers={[i['supplier_name'] for i in fs.get('items', [])]}"))

# ---- TEST 5: invalid action type rejected ----
r5 = httpx.post(BASE + "/actions", json={
    "claim_id": "00000000-0000-0000-0000-000000000000",
    "npi": "1234567890", "action_type": "approve"})
body = r5.json()
t5 = (r5.status_code == 422 and body.get("detail", {}).get("code") == "INVALID_ACTION_TYPE")
results.append(("TEST 5 invalid action_type rejected (422)", t5,
                f"status={r5.status_code} code={body.get('detail', {}).get('code')}"))

print("=" * 60)
allpass = True
for name, ok, detail in results:
    print(f"[{'PASS' if ok else 'FAIL'}] {name}  ({detail})")
    allpass = allpass and ok
print("=" * 60)
print("ENHANCEMENTS COMPLETE" if allpass else "SOME TESTS FAILED")
