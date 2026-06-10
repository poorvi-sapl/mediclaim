"""Authoritative SSE latency test via a raw socket (no client buffering)."""
import socket, threading, time
import httpx, psycopg2

HOST, PORT = "127.0.0.1", 8000
DB = "postgresql://postgres:claimlens@localhost:5433/claimlens"

buf = bytearray()
sock = socket.create_connection((HOST, PORT))
sock.sendall(
    b"GET /plan/alerts/stream HTTP/1.1\r\nHost: localhost\r\n"
    b"Accept: text/event-stream\r\n\r\n"
)
sock.settimeout(20)


def recv_loop():
    while True:
        try:
            d = sock.recv(4096)
        except Exception:
            break
        if not d:
            break
        buf.extend(d)


threading.Thread(target=recv_loop, daemon=True).start()
time.sleep(1.0)  # connect, drain replay, subscribe

conn = psycopg2.connect(DB); cur = conn.cursor()
cur.execute("SELECT id FROM claims WHERE npi='1234567890' AND reviewed=false LIMIT 1")
claim = str(cur.fetchone()[0]); conn.close()

t0 = time.monotonic()
r = httpx.post("http://127.0.0.1:8000/actions", json={
    "claim_id": claim, "npi": "1234567890",
    "action_type": "flag_supplier", "note": "socket rt"})
action_id = r.json()["id"]
post_done = time.monotonic()

lat = None
while time.monotonic() - t0 < 5:
    if action_id.encode() in buf:
        lat = time.monotonic() - t0
        break
    time.sleep(0.02)

sock.close()
print(f"POST returned in {post_done - t0:.3f}s")
if lat is not None:
    print(f"event observed at {lat:.3f}s after POST start")
    ok = lat < 2.0 and b"Dr. James Wilson" in buf
    print(f"[{'PASS' if ok else 'FAIL'}] TEST 8 - full SSE round trip < 2s")
else:
    print("[FAIL] TEST 8 - event not observed within 5s")
