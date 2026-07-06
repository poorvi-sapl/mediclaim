"""add_fraud_to_action_type_check

Revision ID: a1c7f2e9b408
Revises: 93e318cc6915
Create Date: 2026-07-03 09:10:00.000000

Widens actions.chk_action_type to allow 'fraud' — the My Claims "Report Fraud"
button (ClaimsTable.jsx) now posts action_type='fraud', which the old constraint
rejected with a CheckViolation. Not declared in models.py's Action class at all;
it exists only in the live DB (see docs/DB_SCHEMA.md), which is itself stale —
it's missing 'did_not_order', which the live constraint already had before this
migration. This migration only adds 'fraud'; it does not touch that pre-existing
did_not_order documentation drift.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a1c7f2e9b408'
down_revision: Union[str, Sequence[str], None] = '93e318cc6915'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint('chk_action_type', 'actions', type_='check')
    op.create_check_constraint(
        'chk_action_type', 'actions',
        "action_type IN ('confirm','dispute','flag_supplier','unknown_patient','did_not_order','fraud')",
    )


def downgrade() -> None:
    op.drop_constraint('chk_action_type', 'actions', type_='check')
    op.create_check_constraint(
        'chk_action_type', 'actions',
        "action_type IN ('confirm','dispute','flag_supplier','unknown_patient','did_not_order')",
    )
