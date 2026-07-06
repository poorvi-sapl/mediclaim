import psycopg2, os
from dotenv import load_dotenv
load_dotenv()
conn = psycopg2.connect(os.getenv("DATABASE_URL"))
cur = conn.cursor()

print("=== 1. Patient distribution ===")
cur.execute("SELECT npi, COUNT(DISTINCT patient_name) FROM claims GROUP BY npi ORDER BY 2 DESC LIMIT 10")
for r in cur.fetchall(): print(r)

print("=== 2. Claims by service category ===")
cur.execute("SELECT service_category, COUNT(*), ROUND(AVG(claim_amount)::numeric,2), ROUND(MIN(claim_amount)::numeric,2), ROUND(MAX(claim_amount)::numeric,2) FROM claims GROUP BY service_category")
for r in cur.fetchall(): print(r)

print("=== 3. Claims per month ===")
cur.execute("SELECT DATE_TRUNC('month', date_of_service), COUNT(*) FROM claims GROUP BY 1 ORDER BY 1")
for r in cur.fetchall(): print(r)

print("=== 4. Top 10 HCPCS codes ===")
cur.execute("SELECT hcpcs_code, COUNT(*) FROM claims WHERE hcpcs_code IS NOT NULL GROUP BY hcpcs_code ORDER BY 2 DESC LIMIT 10")
for r in cur.fetchall(): print(r)

print("=== 5. Top 10 suppliers ===")
cur.execute("SELECT supplier_name, COUNT(*), ROUND(SUM(claim_amount)::numeric,2) FROM claims GROUP BY supplier_name ORDER BY 2 DESC LIMIT 10")
for r in cur.fetchall(): print(r)

conn.close()
