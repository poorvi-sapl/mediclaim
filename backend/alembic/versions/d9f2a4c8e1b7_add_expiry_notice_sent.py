"""Add dispute_cases.expiry_notice_sent for the day-15 vendor expiry email

Existing NON_RESPONSIVE cases are backfilled to TRUE so the first run of the
reminder worker doesn't blast expiry emails for cases that lapsed long ago.

Revision ID: d9f2a4c8e1b7
Revises: c7e3f9a1b2d4
Create Date: 2026-07-15
"""
import sqlalchemy as sa
from alembic import op

revision = "d9f2a4c8e1b7"
down_revision = "c7e3f9a1b2d4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "dispute_cases",
        sa.Column("expiry_notice_sent", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute("UPDATE dispute_cases SET expiry_notice_sent = TRUE WHERE status = 'NON_RESPONSIVE'")


def downgrade() -> None:
    op.drop_column("dispute_cases", "expiry_notice_sent")
