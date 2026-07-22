"""Widen chk_rule_name to include ghost_billing

The rules engine gained a ghost_billing rule but the live DB constraint
still whitelisted only the first 15 rule names, so run_all_rules()'s
bulk insert failed on any dataset where ghost_billing fires. This brings
the constraint in line with backend/data/demo_reset.py's list.

Revision ID: c7e3f9a1b2d4
Revises: b4f7c1a9d2e0
Create Date: 2026-07-15
"""
from alembic import op

revision = "c7e3f9a1b2d4"
down_revision = "b4f7c1a9d2e0"
branch_labels = None
depends_on = None

RULE_NAMES = (
    "'volume_spike','geographic_anomaly','cross_npi_supplier','new_high_value_supplier',"
    "'oig_leie_hit','duplicate_billing','identity_reuse','abnormal_hospice_duration',"
    "'upcoding','unbundling','deceased_patient','impossible_day','modifier_abuse',"
    "'rapid_cycling','supplier_concentration','ghost_billing'"
)

OLD_RULE_NAMES = RULE_NAMES.replace(",'ghost_billing'", "")


def upgrade() -> None:
    op.execute("ALTER TABLE rules_flags DROP CONSTRAINT IF EXISTS chk_rule_name")
    op.execute(
        f"ALTER TABLE rules_flags ADD CONSTRAINT chk_rule_name CHECK (rule_name IN ({RULE_NAMES}))"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE rules_flags DROP CONSTRAINT IF EXISTS chk_rule_name")
    op.execute(
        f"ALTER TABLE rules_flags ADD CONSTRAINT chk_rule_name CHECK (rule_name IN ({OLD_RULE_NAMES}))"
    )
