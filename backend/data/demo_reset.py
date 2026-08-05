"""
Reset ClaimLens to the EXPANDED demo state: 100 physicians / 100 suppliers / ~18,000
claims, tiered into clean / suspicious / high-risk cohorts.

Preserves the users table (auth/MFA/OTP/CMS accounts) and the reference tables
(npi_profiles, supplier_profiles, oig_excluded_*). Only the per-demo tables
(claims, rules_flags, npi_risk_scores, actions) are rebuilt.

Pipeline: generate_expanded -> oig_seed -> geocode -> rules -> score -> link demo
physician to the index-90 Tier-3 NPI -> verify.
"""

import os
import sys
import time
import json
import subprocess

from sqlalchemy import text

from backend.database import engine, SessionLocal
from backend.models import Base
from backend.config import get_settings
from backend.rules.engine import run_all_rules
from backend.scoring.risk_score import calculate_all_scores

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCRIPTS = os.path.join(ROOT, "scripts")
TIERED = os.path.join(SCRIPTS, "tiered_npis.json")


def run_module(module: str):
    if subprocess.run([sys.executable, "-m", module], cwd=ROOT).returncode != 0:
        raise RuntimeError(f"{module} failed")


def run_script(name: str):
    if subprocess.run([sys.executable, os.path.join(SCRIPTS, name)], cwd=ROOT).returncode != 0:
        raise RuntimeError(f"scripts/{name} failed")


def scalar(db, sql):
    return db.execute(text(sql)).scalar()


def main() -> int:
    start = time.monotonic()
    print("Resetting ClaimLens demo data (EXPANDED: 100/100/~18k)...")
    try:
        # Build the tiered NPI cohort if it isn't present yet (network step; cached after).
        if not os.path.exists(TIERED):
            print("tiered_npis.json missing — fetching real NPIs + tiering...")
            run_script("fetch_real_npis.py")
            run_script("tier_npis.py")

        # Ensure all model tables exist (idempotent — creates physician_bills if new).
        Base.metadata.create_all(engine)

        # Rebuild only per-demo tables — users + reference data are preserved.
        with engine.begin() as conn:
            conn.execute(text("TRUNCATE action_status_log, actions, rules_flags, "
                              "npi_risk_scores, physician_bills, claims RESTART IDENTITY CASCADE"))

        # Add verification_status column to claims if it doesn't exist yet.
        with engine.begin() as conn:
            conn.execute(text(
                "ALTER TABLE claims ADD COLUMN IF NOT EXISTS "
                "verification_status VARCHAR(32) DEFAULT 'unverified'"
            ))
        print("Per-demo tables cleared (users + reference data preserved)")

        run_script("generate_expanded.py")
        print("Expanded synthetic claims generated")

        run_module("backend.data.seed_physician_bills")
        print("Physician bills seeded (coverage: T1=100%, T2=70%, T3=30%)")

        run_script("oig_seed.py")
        print("OIG exclusion tables seeded (Tier-3 suppliers)")

        run_module("backend.data.geocode_physicians")
        print("Physician geocoding complete")

        # Widen the rule_name CHECK constraint to cover the new rules (the original
        # schema only whitelisted the first rules). Idempotent.
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE rules_flags DROP CONSTRAINT IF EXISTS chk_rule_name"))
            conn.execute(text(
                "ALTER TABLE rules_flags ADD CONSTRAINT chk_rule_name CHECK (rule_name IN ("
                "'volume_spike','geographic_anomaly','cross_npi_supplier','new_high_value_supplier',"
                "'oig_leie_hit','duplicate_billing','identity_reuse','abnormal_hospice_duration',"
                "'upcoding','unbundling','deceased_patient','impossible_day','modifier_abuse',"
                "'rapid_cycling','supplier_concentration','ghost_billing'))"))
        print("rule_name CHECK constraint widened for new rules")

        # Canonicalize vendor identity to the supplier NPI BEFORE rules/scoring, so
        # one real vendor (one NPI) is never split across multiple synthetic ids —
        # matching how real ingested claims are keyed (routers/ingest.py).
        from backend.data.canonicalize_vendors import canonicalize_vendor_ids
        db = SessionLocal()
        try:
            cs = canonicalize_vendor_ids(db)
            print(f"Vendor identity canonicalized to NPI: "
                  f"{cs['vendor_ids_before']} -> {cs['vendor_ids_after']} vendor_ids "
                  f"({cs['claims_updated']} claims re-keyed)")
        finally:
            db.close()

        settings = get_settings()
        db = SessionLocal()
        try:
            flags = run_all_rules(db, settings)
            print(f"Rules engine: {flags} flags written")
        finally:
            db.close()

        db = SessionLocal()
        try:
            calculate_all_scores(db, settings)
            print("Scoring complete")
        finally:
            db.close()

        # Part 6 — link the demo physician account to the index-90 Tier-3 NPI so the
        # demo login surfaces real fraud signals. Other accounts are untouched.
        with open(TIERED, encoding="utf-8") as f:
            t3_90 = next(p for p in json.load(f)["physicians"] if p["index"] == 90)
        with engine.begin() as conn:
            conn.execute(text("UPDATE users SET npi=:npi WHERE email='physician@claimlens.com'"),
                         {"npi": t3_90["npi"]})
        print(f"Demo physician account linked to Tier-3 NPI {t3_90['npi']}")

        # Flag the 10 Tier-3 physicians for manual review (amber icon + verification block).
        run_script("seed_flagged_reviews.py")
        print("Tier-3 physicians flagged for manual review")

        # Verification
        db = SessionLocal()
        try:
            claims_n = scalar(db, "SELECT COUNT(*) FROM claims")
            phys_n = scalar(db, "SELECT COUNT(DISTINCT npi) FROM claims")
            supp_n = scalar(db, "SELECT COUNT(DISTINCT vendor_id) FROM claims")
            high = scalar(db, "SELECT COUNT(*) FROM npi_risk_scores WHERE entity_type='npi' AND risk_score>70")
            mid = scalar(db, "SELECT COUNT(*) FROM npi_risk_scores WHERE entity_type='npi' AND risk_score BETWEEN 30 AND 70")
            low = scalar(db, "SELECT COUNT(*) FROM npi_risk_scores WHERE entity_type='npi' AND risk_score<30")
            flags_n = scalar(db, "SELECT COUNT(*) FROM rules_flags")
            flagged = scalar(db, "SELECT COUNT(*) FROM users u JOIN npi_risk_scores s "
                                 "ON s.entity_id=u.npi AND s.entity_type='npi' "
                                 "WHERE u.needs_manual_review=TRUE")
            imp_n = scalar(db, "SELECT COUNT(DISTINCT npi) FROM rules_flags WHERE rule_name='impossible_day'")
            conc_n = scalar(db, "SELECT COUNT(DISTINCT npi) FROM rules_flags WHERE rule_name='supplier_concentration'")
            upc_n = scalar(db, "SELECT COUNT(DISTINCT npi) FROM rules_flags WHERE rule_name='upcoding'")
            ghost_n = scalar(db, "SELECT COUNT(DISTINCT npi) FROM rules_flags WHERE rule_name='ghost_billing'")
            new_rule_rows = db.execute(text(
                "SELECT rule_name, COUNT(*) c, COUNT(DISTINCT npi) n FROM rules_flags "
                "WHERE rule_name IN ('deceased_patient','impossible_day','modifier_abuse',"
                "'rapid_cycling','supplier_concentration','upcoding','ghost_billing') "
                "GROUP BY rule_name ORDER BY rule_name")).fetchall()
        finally:
            db.close()

        checks = [
            ("claims ~18,000-20,000 (15k-21k)", 15000 <= claims_n <= 21000, claims_n),
            ("distinct physician NPIs = 100", phys_n == 100, phys_n),
            ("distinct suppliers >= 100", supp_n >= 100, supp_n),
            ("high-risk (>70) ~= 10", 7 <= high <= 22, high),
            ("mid-risk (30-70) ~= 30", 22 <= mid <= 45, mid),
            ("clean (<30) ~= 60", 44 <= low <= 72, low),
            ("manual-review flagged NPIs >= 10", flagged >= 10, flagged),
            ("impossible_day physicians >= 3", imp_n >= 3, imp_n),
            ("supplier_concentration physicians >= 5", conc_n >= 5, conc_n),
            ("upcoding physicians present (Tier-2/3)", upc_n >= 1, upc_n),
            ("ghost_billing physicians >= 38 (T2+T3 only)", ghost_n >= 38, ghost_n),
        ]
        all_pass = True
        print("\n" + "=" * 55)
        for name, ok, actual in checks:
            print(f"[{'PASS' if ok else 'FAIL'}] {name}  (actual={actual})")
            all_pass = all_pass and ok

        # Top physician-supplier pairings — confirm long-tail variance (not equal batches).
        db = SessionLocal()
        try:
            top = db.execute(text(
                "SELECT npi, vendor_name, COUNT(*) c FROM claims "
                "GROUP BY npi, vendor_name ORDER BY c DESC LIMIT 5"
            )).fetchall()
            # a single physician's spread (their top 5 suppliers)
            top_npi = db.execute(text(
                "SELECT npi FROM claims GROUP BY npi ORDER BY COUNT(*) DESC LIMIT 1"
            )).scalar()
            spread = db.execute(text(
                "SELECT vendor_name, COUNT(*) c FROM claims WHERE npi=:n "
                "GROUP BY vendor_name ORDER BY c DESC LIMIT 5"
            ), {"n": top_npi}).fetchall()
        finally:
            db.close()

        elapsed = time.monotonic() - start
        print("=" * 55)
        print(f"Claims: {claims_n} | Physicians: {phys_n} | Suppliers: {supp_n} | Flags: {flags_n}")
        print(f"Risk: high>70={high}  mid 30-70={mid}  low<30={low}")
        print("New-rule flags (rule_name: flags / physicians):")
        for rn, c, n in new_rule_rows:
            print(f"  {rn}: {c} / {n}")
        print("\nTop 5 physician-supplier pairings by claim count:")
        for npi, sname, c in top:
            print(f"  NPI {npi} — {sname}: {c} claims")
        print(f"\nClaim spread for one physician (NPI {top_npi}):")
        for sname, c in spread:
            print(f"  {sname}: {c} claims")
        print(f"\nTime: {elapsed:.1f}s")
        print("=" * 55)
        return 0 if all_pass else 1

    except Exception as e:
        print(f"\nERROR during demo reset: {e}")
        import traceback; traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
