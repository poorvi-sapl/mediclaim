"""rename_supplier_to_vendor_columns

Revision ID: 93e318cc6915
Revises: 0b3e27f241ef
Create Date: 2026-07-02 17:14:24.650650

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '93e318cc6915'
down_revision: Union[str, Sequence[str], None] = '0b3e27f241ef'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # claims — 4 renames
    op.alter_column('claims', 'supplier_name',  new_column_name='vendor_name')
    op.alter_column('claims', 'supplier_id',    new_column_name='vendor_id')
    op.alter_column('claims', 'supplier_state', new_column_name='vendor_state')
    op.alter_column('claims', 'supplier_zip',   new_column_name='vendor_zip')

    # actions — 2 renames
    op.alter_column('actions', 'supplier_name', new_column_name='vendor_name')
    op.alter_column('actions', 'supplier_id',   new_column_name='vendor_id')

    # rules_flags — 1 rename
    op.alter_column('rules_flags', 'supplier_id', new_column_name='vendor_id')

    # npi_risk_scores — 3 renames
    op.alter_column('npi_risk_scores', 'top_supplier_id',   new_column_name='top_vendor_id')
    op.alter_column('npi_risk_scores', 'top_supplier_name', new_column_name='top_vendor_name')
    op.alter_column('npi_risk_scores', 'new_supplier_flag', new_column_name='new_vendor_flag')


def downgrade() -> None:
    op.alter_column('npi_risk_scores', 'new_vendor_flag',  new_column_name='new_supplier_flag')
    op.alter_column('npi_risk_scores', 'top_vendor_name',  new_column_name='top_supplier_name')
    op.alter_column('npi_risk_scores', 'top_vendor_id',    new_column_name='top_supplier_id')

    op.alter_column('rules_flags', 'vendor_id', new_column_name='supplier_id')

    op.alter_column('actions', 'vendor_id',   new_column_name='supplier_id')
    op.alter_column('actions', 'vendor_name', new_column_name='supplier_name')

    op.alter_column('claims', 'vendor_zip',   new_column_name='supplier_zip')
    op.alter_column('claims', 'vendor_state', new_column_name='supplier_state')
    op.alter_column('claims', 'vendor_id',    new_column_name='supplier_id')
    op.alter_column('claims', 'vendor_name',  new_column_name='supplier_name')
