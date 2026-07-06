"""drop_suppliers_table

Revision ID: aca2a9a16296
Revises: d3f684a46f96
Create Date: 2026-07-02 16:16:52.791017

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'aca2a9a16296'
down_revision: Union[str, Sequence[str], None] = 'd3f684a46f96'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_table('suppliers')


def downgrade() -> None:
    """Downgrade schema."""
    op.create_table(
        'suppliers',
        sa.Column('npi',                    sa.String(10),  nullable=False),
        sa.Column('entity_type_code',       sa.SmallInteger(), nullable=True),
        sa.Column('organization_name',      sa.Text(),      nullable=True),
        sa.Column('last_name',              sa.Text(),      nullable=True),
        sa.Column('first_name',             sa.Text(),      nullable=True),
        sa.Column('middle_name',            sa.Text(),      nullable=True),
        sa.Column('credential_text',        sa.Text(),      nullable=True),
        sa.Column('practice_address',       sa.Text(),      nullable=True),
        sa.Column('practice_city',          sa.Text(),      nullable=True),
        sa.Column('practice_state',         sa.String(40),  nullable=True),
        sa.Column('practice_postal_code',   sa.String(20),  nullable=True),
        sa.Column('enumeration_date',       sa.Date(),      nullable=True),
        sa.Column('last_update_date',       sa.Date(),      nullable=True),
        sa.Column('deactivation_date',      sa.Date(),      nullable=True),
        sa.Column('sex_code',               sa.String(1),   nullable=True),
        sa.Column('taxonomy_code',          sa.String(10),  nullable=True),
        sa.Column('primary_taxonomy_switch', sa.String(1),  nullable=True),
        sa.Column('oig_excluded',           sa.Boolean(),   nullable=True),
        sa.PrimaryKeyConstraint('npi')
    )
