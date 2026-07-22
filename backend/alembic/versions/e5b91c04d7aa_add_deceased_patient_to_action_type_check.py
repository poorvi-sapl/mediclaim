"""add_deceased_patient_to_action_type_check

Revision ID: e5b91c04d7aa
Revises: 9a80687f5956
Create Date: 2026-07-13 10:30:00.000000

Widens actions.chk_action_type to allow 'deceased_patient' — the My Claims
"Deceased Patient" button (ClaimsTable.jsx) posts action_type='deceased_patient',
which the old constraint rejected with a CheckViolation. Same shape as
a1c7f2e9b408 (which added 'fraud' the same way); the constraint still isn't
declared on models.py's Action class — it lives only in the DB.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e5b91c04d7aa'
down_revision: Union[str, Sequence[str], None] = '9a80687f5956'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint('chk_action_type', 'actions', type_='check')
    op.create_check_constraint(
        'chk_action_type', 'actions',
        "action_type IN ('confirm','dispute','flag_supplier','unknown_patient','did_not_order','fraud','deceased_patient')",
    )


def downgrade() -> None:
    op.drop_constraint('chk_action_type', 'actions', type_='check')
    op.create_check_constraint(
        'chk_action_type', 'actions',
        "action_type IN ('confirm','dispute','flag_supplier','unknown_patient','did_not_order','fraud')",
    )
