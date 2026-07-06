"""add_claim_control_numbers

Revision ID: b9b015f3110e
Revises: c4d6e0a19f27
Create Date: 2026-07-06 14:30:00.000000

Adds a short, CMS-style Claim Control Number (CCN) to `claims`, generated from
the claim's ingest date + a DB sequence, so it reads like a real Medicare ICN
(YYJJJ + 6-digit sequence) instead of the raw UUID primary key. Denormalizes
it (plus a genuine `claim_id` FK, replacing today's fragile
`uuid.UUID(claim_number)` parse in npi_watch.py) onto `claim_notifications` so
every screen that shows "claim number" can display the short form without an
extra join. Rows created by the external payer-ingest path (claim_number not
a UUID matching any `claims.id`) are left with claim_id/claim_ccn NULL and
keep showing their original externally-supplied claim_number as a fallback.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'b9b015f3110e'
down_revision: Union[str, Sequence[str], None] = 'c4d6e0a19f27'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_CCN_EXPR = (
    "to_char(ingested_at, 'YY') || to_char(ingested_at, 'DDD') "
    "|| lpad(nextval('claim_ccn_seq')::text, 6, '0')"
)


def upgrade() -> None:
    op.execute("CREATE SEQUENCE claim_ccn_seq")

    op.add_column('claims', sa.Column('ccn', sa.String(length=20), nullable=True))
    op.execute(f"UPDATE claims SET ccn = {_CCN_EXPR}")
    op.alter_column('claims', 'ccn', nullable=False)
    op.create_unique_constraint('uq_claims_ccn', 'claims', ['ccn'])
    op.create_index('ix_claims_ccn', 'claims', ['ccn'])
    # Future inserts that don't set ccn explicitly (e.g. raw seed scripts) still get one.
    op.execute(
        "ALTER TABLE claims ALTER COLUMN ccn SET DEFAULT "
        "(to_char(now(), 'YY') || to_char(now(), 'DDD') || lpad(nextval('claim_ccn_seq')::text, 6, '0'))"
    )

    op.add_column('claim_notifications', sa.Column('claim_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('claim_notifications', sa.Column('claim_ccn', sa.String(length=20), nullable=True))
    op.create_foreign_key(
        'fk_claim_notifications_claim_id', 'claim_notifications', 'claims',
        ['claim_id'], ['id'],
    )
    op.create_index('ix_claim_notifications_claim_id', 'claim_notifications', ['claim_id'])
    # Only backfill rows whose claim_number really is str(claims.id) — the internal
    # notify_vendor_from_claim_action path. External payer-ingest rows (claim_number is
    # an arbitrary non-UUID string) are left NULL and keep showing their original value.
    op.execute("""
        UPDATE claim_notifications cn
        SET claim_id = c.id, claim_ccn = c.ccn
        FROM claims c
        WHERE cn.claim_number ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND cn.claim_number::uuid = c.id
    """)


def downgrade() -> None:
    op.drop_index('ix_claim_notifications_claim_id', table_name='claim_notifications')
    op.drop_constraint('fk_claim_notifications_claim_id', 'claim_notifications', type_='foreignkey')
    op.drop_column('claim_notifications', 'claim_ccn')
    op.drop_column('claim_notifications', 'claim_id')

    op.drop_index('ix_claims_ccn', table_name='claims')
    op.drop_constraint('uq_claims_ccn', 'claims', type_='unique')
    op.drop_column('claims', 'ccn')

    op.execute("DROP SEQUENCE IF EXISTS claim_ccn_seq")
