import threading, time, json
import httpx, psycopg2

BASE = "http://localhost:8000"
STREAM = BASE + "/plan/alerts/stream"
DB = "postgresql://postgres:claimlens@localhost:5433/claimlens"


def reader(lines, stop, url):
    try:
        with httpx.stream("GET", url, timeout=40) as r:
            for line in r.iter_lines():
                lines.append(line)
                if stop.is_set():
                    break
    except Exception as e:
        lines.append(f"ERR:{e}")


# ---------------- TEST 7: connect, replay, keep-alive ----------------
lines7, stop7 = [], threading.Event()
threading.Thread(target=reader, args=(lines7, stop7, STREAM), daemon=True).start()
print("TEST 7: connected; waiting ~17s for replay + keep-alive...")
time.sleep(17)
stop7.set()
data7 = [l for l in lines7 if l.startswith("data:")]
ka7 = [l for l in lines7 if l.strip() == ": keep-alive"]
print(f"  replay data events: {len(data7)} | keep-alives: {len(ka7)}")
if data7:
    print(f"  first replay: {data7[0][:120]}")
t7 = len(ka7) >= 1 and len(data7) >= 1
print(f"[{'PASS' if t7 else 'FAIL'}] TEST 7 — SSE connects, replays, keep-alive")

# ---------------- TEST 8: full round trip ----------------
lines8, stop8 = [], threading.Event()
threading.Thread(target=reader, args=(lines8, stop8, STREAM), daemon=True).start()
time.sleep(1.5)  # ensure subscribed

conn = psycopg2.connect(DB); cur = conn.cursor()
cur.execute("SELECT id FROM claims WHERE npi='1234567890' AND reviewed=false LIMIT 1")
claim_id = str(cur.fetchone()[0]); conn.close()

t0 = time.time()
resp = httpx.post(BASE + "/actions", json={
    "claim_id": claim_id, "npi": "1234567890",
    "action_type": "flag_supplier", "note": "sse round-trip test"})
print(f"TEST 8: POST /actions -> {resp.status_code}; waiting for live event...")

got, latency = None, None
while time.time() - t0 < 3:
    for l in list(lines8):
        if l.startswith("data:"):
            try:
                p = json.loads(l[len("data:"):].strip())
            except Exception:
                continue
            if p.get("id") == resp.json()["id"]:
                got, latency = p, time.time() - t0
                break
    if got:
        break
    time.sleep(0.1)
stop8.set()

if got:
    print(f"  event in {latency:.2f}s: physician={got['physician_name']} "
          f"supplier={got['supplier_name']} amount={got['claim_amount']}")
t8 = (got is not None and latency < 2.0
      and got["physician_name"] == "Dr. James Wilson"
      and got["claim_amount"] > 0)
print(f"[{'PASS' if t8 else 'FAIL'}] TEST 8 — full SSE round trip < 2s")

print("\n" + "=" * 50)
print("SSE TESTS:", "ALL PASS" if (t7 and t8) else "SOME FAILED")
