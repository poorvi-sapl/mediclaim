"""add_physician_confirmation_workflow

Revision ID: c4d6e0a19f27
Revises: a1c7f2e9b408
Create Date: 2026-07-03 10:00:00.000000

Adds the physician-confirmation loop for vendor dispute responses: a vendor's
"resolved with physician" response now must be confirmed by the physician
before it's final. Adds two columns to dispute_cases and widens
chk_dc_status to allow the new PENDING_PHYSICIAN_CONFIRMATION status.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4d6e0a19f27'
down_revision: Union[str, Sequence[str], None] = 'a1c7f2e9b408'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('dispute_cases', sa.Column('physician_confirmation_due_date', sa.DateTime(), nullable=True))
    op.add_column('dispute_cases', sa.Column('escalation_unlocked', sa.Boolean(), nullable=False, server_default=sa.false()))

    op.drop_constraint('chk_dc_status', 'dispute_cases', type_='check')
    op.create_check_constraint(
        'chk_dc_status', 'dispute_cases',
        "status IN ('OPEN','RESPONDED_TO_MEDICARE','RESOLVED_BY_PHYSICIAN','NON_RESPONSIVE','CLOSED','REFERRED_OIG','PENDING_PHYSICIAN_CONFIRMATION')",
    )


def downgrade() -> None:
    op.drop_constraint('chk_dc_status', 'dispute_cases', type_='check')
    op.create_check_constraint(
        'chk_dc_status', 'dispute_cases',
        "status IN ('OPEN','RESPONDED_TO_MEDICARE','RESOLVED_BY_PHYSICIAN','NON_RESPONSIVE','CLOSED','REFERRED_OIG')",
    )

    op.drop_column('dispute_cases', 'escalation_unlocked')
    op.drop_column('dispute_cases', 'physician_confirmation_due_date')
