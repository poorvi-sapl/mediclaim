"""add_deceased_patient_dispute_type

Revision ID: f2d8a61c3b90
Revises: e5b91c04d7aa
Create Date: 2026-07-13 10:45:00.000000

Widens dispute_cases.chk_dc_dispute_type to allow 'DECEASED_PATIENT' — the
physician's "Deceased Patient" claim action now opens a full vendor dispute
case (same loop as DISPUTE/FRAUD_REPORT) with its own case type, instead of
only recording a flag action.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'f2d8a61c3b90'
down_revision: Union[str, Sequence[str], None] = 'e5b91c04d7aa'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint('chk_dc_dispute_type', 'dispute_cases', type_='check')
    op.create_check_constraint(
        'chk_dc_dispute_type', 'dispute_cases',
        "dispute_type IN ('DISPUTE', 'FRAUD_REPORT', 'DECEASED_PATIENT')",
    )


def downgrade() -> None:
    op.drop_constraint('chk_dc_dispute_type', 'dispute_cases', type_='check')
    op.create_check_constraint(
        'chk_dc_dispute_type', 'dispute_cases',
        "dispute_type IN ('DISPUTE', 'FRAUD_REPORT')",
    )
