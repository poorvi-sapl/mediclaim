"""Assign deterministic fraud tiers to the fetched physicians and suppliers.

Tiers are index-based (not random) so re-runs are identical. Reads
real_physician_npis.json + real_supplier_npis.json, writes tiered_npis.json.
"""
import os
import json

BASE = os.path.dirname(os.path.abspath(__file__))


def tier_physicians(phys: list) -> list:
    out = []
    for i, p in enumerate(phys):
        rec = dict(p)
        if i < 60:                       # Tier 1 — clean
            rec.update(tier=1, risk_target="low", low_claim_volume=True, fraud_patterns=[])
        elif i < 90:                     # Tier 2 — suspicious
            patterns = (["cross_npi_supplier", "volume_spike"] if i % 2 == 0
                        else ["cross_npi_supplier"])
            rec.update(tier=2, risk_target="medium", low_claim_volume=False,
                       fraud_patterns=patterns)
        else:                            # Tier 3 — high risk (indices 90-99)
            patterns = ["oig_leie_hit", "cross_npi_supplier"]
            if i % 2 == 0:
                patterns.append("duplicate_billing")
            if i % 3 == 0:
                patterns.append("geo_anomaly")
            rec.update(tier=3, risk_target="high", low_claim_volume=False,
                       fraud_patterns=patterns)
        rec["index"] = i
        out.append(rec)
    return out


def tier_suppliers(supp: list) -> list:
    out = []
    for i, s in enumerate(supp):
        rec = dict(s)
        if i < 60:                       # Tier 1 — clean
            rec.update(tier=1, fraud_involvement=[], oig_leie_match=False)
        elif i < 90:                     # Tier 2 — suspicious (cross-NPI)
            rec.update(tier=2, fraud_involvement=["cross_npi"], oig_leie_match=False)
        else:                            # Tier 3 — flagged (OIG)
            rec.update(tier=3, fraud_involvement=["oig_hit", "cross_npi", "high_volume"],
                       oig_leie_match=True)
        rec["index"] = i
        out.append(rec)
    return out


def main():
    with open(os.path.join(BASE, "real_physician_npis.json"), encoding="utf-8") as f:
        phys = json.load(f)
    with open(os.path.join(BASE, "real_supplier_npis.json"), encoding="utf-8") as f:
        supp = json.load(f)

    tiered = {"physicians": tier_physicians(phys), "suppliers": tier_suppliers(supp)}
    with open(os.path.join(BASE, "tiered_npis.json"), "w", encoding="utf-8") as f:
        json.dump(tiered, f, indent=2)

    pc = {t: sum(1 for p in tiered["physicians"] if p["tier"] == t) for t in (1, 2, 3)}
    sc = {t: sum(1 for s in tiered["suppliers"] if s["tier"] == t) for t in (1, 2, 3)}
    print(f"physicians by tier: {pc}  suppliers by tier: {sc}")
    print("Wrote scripts/tiered_npis.json")


if __name__ == "__main__":
    main()
