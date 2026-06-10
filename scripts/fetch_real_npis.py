"""Pull 100 real physician NPIs and 100 real supplier NPIs for the expanded dataset.

PHYSICIANS (Part 1): tries the CMS Order & Referring data-api; on failure (this
environment cannot reach data.cms.gov — same egress restriction as CMS verification)
falls back to the npi_profiles table, which already holds real, NPPES-sourced NPIs that
passed NPPES checks. Eligibility flags (hha/dme/hospice) are synthesized deterministically
since the fallback source lacks them.

SUPPLIERS (Part 2): pulls real Type-2 (organization) NPIs live from the NPPES registry
API (npiregistry.cms.hhs.gov), which IS reachable.

Outputs scripts/real_physician_npis.json and scripts/real_supplier_npis.json.
Deterministic (no RNG) so re-runs produce the same cohort.
"""
import os
import json
import sys

import httpx
import psycopg2
from dotenv import load_dotenv

BASE = os.path.dirname(os.path.abspath(__file__))
ENV_PATH = r"D:\Mediclaim\.env"
ORDER_REFERRING_URL = "https://data.cms.gov/data-api/v1/dataset/c99b5865-1119-4436-bb80-c5af2773ea1f/data"
NPI_REGISTRY_URL = "https://npiregistry.cms.hhs.gov/api/"
TIMEOUT = 12
N_PHYS = 100
N_SUPP = 100


# ── PART 1 — physicians ──────────────────────────────────────────────────────
def _flags_for(i: int) -> dict:
    """Deterministic eligibility flags; every physician has at least one."""
    hha = (i % 2 == 0)
    dme = (i % 3 != 0)
    hospice = (i % 4 == 0)
    if not (hha or dme or hospice):
        dme = True
    return {"hha": hha, "dme": dme, "hospice": hospice}


def fetch_physicians_cms() -> list:
    """Step 1-3: HHA=Y, then keep DME=Y or HOSPICE=Y, dedupe, take 100."""
    r = httpx.get(ORDER_REFERRING_URL, params={"filter[HHA]": "Y", "size": 500}, timeout=TIMEOUT)
    r.raise_for_status()
    data = r.json()
    seen, out = set(), []
    for rec in data:
        npi = rec.get("NPI")
        if not npi or npi in seen:
            continue
        if rec.get("DME") == "Y" or rec.get("HOSPICE") == "Y":
            seen.add(npi)
            out.append({
                "npi": npi, "first_name": rec.get("FIRST_NAME"), "last_name": rec.get("LAST_NAME"),
                "state": None,
                "hha": rec.get("HHA") == "Y", "dme": rec.get("DME") == "Y",
                "hospice": rec.get("HOSPICE") == "Y",
            })
        if len(out) >= N_PHYS:
            break
    return out


def fetch_physicians_fallback() -> list:
    load_dotenv(ENV_PATH)
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    cur = conn.cursor()
    # Real NPPES NPIs already in our reference table, geocoded (needed for the geo rule).
    cur.execute(
        "SELECT npi, physician_name, practice_state, practice_zip FROM npi_profiles "
        "WHERE practice_lat IS NOT NULL ORDER BY npi LIMIT %s", (N_PHYS,))
    out = []
    for i, (npi, name, state, zip_) in enumerate(cur.fetchall()):
        parts = (name or "").replace("Dr. ", "").split()
        first = parts[0] if parts else ""
        last = parts[-1] if len(parts) > 1 else ""
        out.append({"npi": npi, "first_name": first, "last_name": last,
                    "state": state, "synthetic": False, **_flags_for(i)})
    cur.close(); conn.close()
    return out


def get_physicians() -> list:
    try:
        out = fetch_physicians_cms()
        if len(out) >= N_PHYS:
            print(f"physicians: pulled {len(out)} live from CMS Order & Referring")
            return out[:N_PHYS]
        raise RuntimeError(f"only {len(out)} from CMS")
    except Exception as e:
        print(f"physicians: CMS unreachable ({type(e).__name__}); using fallback.")
        print("USING FALLBACK NPIs (from npi_profiles — real NPPES NPIs) — "
              "replace with live CMS Order & Referring data before production demo")
        return fetch_physicians_fallback()


# ── PART 2 — suppliers (live NPPES registry) ─────────────────────────────────
SUPPLIER_QUERIES = [
    ("DME", "Durable Medical Equipment", 50),
    ("HOME_HEALTH", "Home Health", 30),
    ("HOSPICE", "Hospice", 30),
]


def fetch_suppliers() -> list:
    seen, out = set(), []
    for stype, taxonomy, limit in SUPPLIER_QUERIES:
        try:
            r = httpx.get(NPI_REGISTRY_URL, params={
                "version": "2.1", "enumeration_type": "NPI-2",
                "taxonomy_description": taxonomy, "limit": limit, "skip": 0,
            }, timeout=TIMEOUT)
            r.raise_for_status()
            results = r.json().get("results", [])
        except Exception as e:
            print(f"suppliers: NPPES query '{taxonomy}' failed ({type(e).__name__})")
            results = []
        for rec in results:
            npi = str(rec.get("number") or "")
            if not npi or npi in seen:
                continue
            basic = rec.get("basic", {})
            name = basic.get("organization_name") or basic.get("name") or f"{stype} ORG {npi}"
            addrs = rec.get("addresses") or [{}]
            state = addrs[0].get("state") if addrs else None
            seen.add(npi)
            out.append({"npi": npi, "name": name.upper(), "state": state, "type": stype})
    return out


def get_suppliers() -> list:
    out = fetch_suppliers()
    if len(out) >= N_SUPP:
        print(f"suppliers: pulled {len(out)} real org NPIs live from NPPES registry")
        return out[:N_SUPP]
    # Fallback: pad with realistic org-style NPIs (rare — only if NPPES unreachable).
    print("USING FALLBACK supplier NPIs — replace with real CMS/NPPES data before production demo")
    types = ["DME", "HOME_HEALTH", "HOSPICE"]
    i = 0
    while len(out) < N_SUPP:
        npi = f"1{(900000000 + i):09d}"[:10]
        out.append({"npi": npi, "name": f"FALLBACK SUPPLIER {i} LLC", "state": "CA",
                    "type": types[i % 3], "synthetic": True})
        i += 1
    return out[:N_SUPP]


def main():
    phys = get_physicians()
    supp = get_suppliers()
    with open(os.path.join(BASE, "real_physician_npis.json"), "w", encoding="utf-8") as f:
        json.dump(phys, f, indent=2)
    with open(os.path.join(BASE, "real_supplier_npis.json"), "w", encoding="utf-8") as f:
        json.dump(supp, f, indent=2)
    print(f"\nWrote {len(phys)} physicians, {len(supp)} suppliers to scripts/*.json")


if __name__ == "__main__":
    main()
