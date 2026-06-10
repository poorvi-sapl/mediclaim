"""Part-7 verification for the dataset expansion (scenarios 1-7, 9 via API/DB).
Scenarios 8 & 10 (auth flows + existing suites) are covered by re-running the
three existing test suites separately."""
import sys, json, psycopg2, requests
from dotenv import load_dotenv; import os
load_dotenv(r"D:\Mediclaim\.env")
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
BASE = "http://localhost:8000"

conn = psycopg2.connect(os.environ["DATABASE_URL"]); cur = conn.cursor()
def q(sql, *a):
    cur.execute(sql, a); return cur.fetchone()[0]

results = []
def check(name, ok, detail=""):
    results.append(ok); print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))

phys = json.load(open("scripts/tiered_npis.json"))["physicians"]
t3_npi = next(p["npi"] for p in phys if p["index"] == 90)

# payer + physician demo sessions (demo bypass -> instant cookie)
sp = requests.Session(); sp.post(f"{BASE}/auth/login", json={"email": "plan@claimlens.com", "password": "demo1234"})
sd = requests.Session(); rd = sd.post(f"{BASE}/auth/login", json={"email": "physician@claimlens.com", "password": "demo1234"})
demo_npi = sd.get(f"{BASE}/auth/me").json().get("npi")

# 1. ~18,000 claims
n = q("SELECT COUNT(*) FROM claims")
check("1. claims table ~18,000", 15000 <= n <= 19000, n)

# 2. 100 physician records (distinct monitored NPIs)
check("2. 100 distinct physician NPIs", q("SELECT COUNT(DISTINCT npi) FROM claims") == 100)

# 3. leaderboard 100, top 10 all > 70
lb = sp.get(f"{BASE}/plan/npi-risk-list?page_size=100").json()["items"]
top10 = [r["risk_score"] for r in lb[:10]]
check("3. leaderboard shows 100, top 10 all >70", len(lb) == 100 and all(s > 70 for s in top10),
      f"count={len(lb)} top10={top10}")

# 4. >=10 amber manual-review icons on leaderboard
amber = sum(1 for r in lb if r.get("needs_manual_review"))
check("4. >=10 amber manual-review icons on leaderboard", amber >= 10, f"amber={amber}")

# 5. demo physician My Claims shows flagged claims
claims_resp = sd.get(f"{BASE}/physician/{demo_npi}/claims")
flags_for_demo = q("SELECT COUNT(*) FROM rules_flags WHERE npi=%s", demo_npi)
check("5. demo physician claims load + have fraud flags",
      claims_resp.status_code == 200 and flags_for_demo > 0,
      f"npi={demo_npi} http={claims_resp.status_code} flags={flags_for_demo}")

# 6. supplier watchlist 100, Tier-3 at top with OIG badges
sw = sp.get(f"{BASE}/plan/suppliers?page_size=100").json()["items"]
top_oig = sum(1 for r in sw[:15] if r.get("oig_flag"))
check("6. supplier watchlist 100, OIG suppliers near top", len(sw) == 100 and top_oig >= 5,
      f"count={len(sw)} oig_in_top15={top_oig}")

# 7. live alerts endpoint + SSE stream reachable
alerts = sp.get(f"{BASE}/plan/alerts")
sse = sp.get(f"{BASE}/plan/alerts/stream", stream=True, timeout=5)
check("7. live alerts + SSE stream reachable", alerts.status_code == 200 and sse.status_code == 200,
      f"alerts={alerts.status_code} sse={sse.status_code}")
sse.close()

# 9. NPI detail for Tier-3: high score, multiple flags, verification block
det = sp.get(f"{BASE}/plan/npi/{t3_npi}/detail").json()
score = det.get("score", {}).get("risk_score", 0)
breakdown = det.get("score", {}).get("score_breakdown", [])
check("9. Tier-3 NPI detail: high score + multiple flags + verification block",
      score > 70 and len([b for b in breakdown if b.get("rule")]) >= 2 and det.get("verification") is not None,
      f"npi={t3_npi} score={score} rule_factors={len([b for b in breakdown if b.get('rule')])} "
      f"verification={'yes' if det.get('verification') else 'no'}")

cur.close(); conn.close()
passed = sum(results)
print(f"\n{passed}/{len(results)} Part-7 API/DB scenarios passed")
sys.exit(0 if passed == len(results) else 1)
