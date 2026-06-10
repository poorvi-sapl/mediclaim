import asyncio, json, time
import httpx, psycopg2

BASE = "http://localhost:8000"
DB = "postgresql://postgres:claimlens@localhost:5433/claimlens"


async def main():
    result = {}
    async with httpx.AsyncClient(timeout=30) as client:
        async with client.stream("GET", BASE + "/plan/alerts/stream") as resp:

            async def do_post():
                await asyncio.sleep(1.0)  # let stream replay + subscribe
                conn = psycopg2.connect(DB); cur = conn.cursor()
                cur.execute("SELECT id FROM claims WHERE npi='1234567890' "
                            "AND reviewed=false LIMIT 1")
                claim = str(cur.fetchone()[0]); conn.close()
                result["t0"] = time.monotonic()
                async with httpx.AsyncClient() as c2:
                    r = await c2.post(BASE + "/actions", json={
                        "claim_id": claim, "npi": "1234567890",
                        "action_type": "flag_supplier", "note": "async rt"})
                result["id"] = r.json()["id"]

            task = asyncio.create_task(do_post())
            async for line in resp.aiter_lines():
                if line.startswith("data:") and result.get("id"):
                    p = json.loads(line[len("data:"):].strip())
                    if p.get("id") == result["id"]:
                        result["t1"] = time.monotonic()
                        result["evt"] = p
                        break
            await task

    lat = result["t1"] - result["t0"]
    e = result["evt"]
    print(f"latency={lat:.3f}s  physician={e['physician_name']}  "
          f"supplier={e['supplier_name']}  amount={e['claim_amount']}")
    ok = lat < 2.0 and e["physician_name"] == "Dr. James Wilson" and e["claim_amount"] > 0
    print(f"[{'PASS' if ok else 'FAIL'}] TEST 8 — full SSE round trip < 2s")


asyncio.run(main())
