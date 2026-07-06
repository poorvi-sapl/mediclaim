"""add_vendor_columns_to_claims

Revision ID: 0b3e27f241ef
Revises: 2dacd9343885
Create Date: 2026-07-02 17:03:38.676443

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0b3e27f241ef'
down_revision: Union[str, Sequence[str], None] = '2dacd9343885'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('claims',
        sa.Column('vendor_npi',    sa.String(10),  nullable=True))
    op.add_column('claims',
        sa.Column('vendor_type',   sa.String(50),  nullable=True))
    op.add_column('claims',
        sa.Column('contact_email', sa.String(200), nullable=True))
    op.add_column('claims',
        sa.Column('contact_name',  sa.String(200), nullable=True))
    op.add_column('claims',
        sa.Column('contact_phone', sa.String(20),  nullable=True))


def downgrade() -> None:
    op.drop_column('claims', 'contact_phone')
    op.drop_column('claims', 'contact_name')
    op.drop_column('claims', 'contact_email')
    op.drop_column('claims', 'vendor_type')
    op.drop_column('claims', 'vendor_npi')
