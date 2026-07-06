"""schema_alignment_drop_dead_columns

Revision ID: 2dacd9343885
Revises: aca2a9a16296
Create Date: 2026-07-02 16:32:08.280874

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2dacd9343885'
down_revision: Union[str, Sequence[str], None] = 'aca2a9a16296'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── Drop 13 dead NPPES columns from physicians ──
    op.drop_column('physicians', 'oig_excluded')
    op.drop_column('physicians', 'credential_text')
    op.drop_column('physicians', 'sex_code')
    op.drop_column('physicians', 'entity_type_code')
    op.drop_column('physicians', 'enumeration_date')
    op.drop_column('physicians', 'deactivation_date')
    op.drop_column('physicians', 'last_update_date')
    op.drop_column('physicians', 'practice_postal_code')
    op.drop_column('physicians', 'primary_taxonomy_switch')
    op.drop_column('physicians', 'middle_name')
    op.drop_column('physicians', 'organization_name')
    op.drop_column('physicians', 'practice_city')
    op.drop_column('physicians', 'practice_state')

    # ── Add surrogate PK to oig_excluded_names ──
    # SERIAL handles sequence creation + backfill for existing rows in one step
    op.execute("ALTER TABLE oig_excluded_names ADD COLUMN id SERIAL PRIMARY KEY")


def downgrade() -> None:
    # ── Remove id from oig_excluded_names (sequence is OWNED BY col, drops automatically) ──
    op.drop_column('oig_excluded_names', 'id')

    # ── Restore 13 physician columns ──
    op.add_column('physicians',
        sa.Column('practice_state',
                  sa.String(), nullable=True))
    op.add_column('physicians',
        sa.Column('practice_city',
                  sa.String(), nullable=True))
    op.add_column('physicians',
        sa.Column('organization_name',
                  sa.String(), nullable=True))
    op.add_column('physicians',
        sa.Column('middle_name',
                  sa.String(), nullable=True))
    op.add_column('physicians',
        sa.Column('primary_taxonomy_switch',
                  sa.String(), nullable=True))
    op.add_column('physicians',
        sa.Column('practice_postal_code',
                  sa.String(), nullable=True))
    op.add_column('physicians',
        sa.Column('last_update_date',
                  sa.Date(), nullable=True))
    op.add_column('physicians',
        sa.Column('deactivation_date',
                  sa.Date(), nullable=True))
    op.add_column('physicians',
        sa.Column('enumeration_date',
                  sa.Date(), nullable=True))
    op.add_column('physicians',
        sa.Column('entity_type_code',
                  sa.SmallInteger(), nullable=True))
    op.add_column('physicians',
        sa.Column('sex_code',
                  sa.String(), nullable=True))
    op.add_column('physicians',
        sa.Column('credential_text',
                  sa.String(), nullable=True))
    op.add_column('physicians',
        sa.Column('oig_excluded',
                  sa.Boolean(), nullable=True))
