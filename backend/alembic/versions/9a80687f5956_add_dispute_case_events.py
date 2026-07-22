"""add_dispute_case_events

Revision ID: 9a80687f5956
Revises: c2a4f7e91d3b
Create Date: 2026-07-07 09:00:00.000000

Adds dispute_case_events, an append-only history log for DisputeCase state
transitions. DisputeCase's own vendor_response/vendor_responded_at/
provider_response_type/vendor_docs columns only ever hold the latest
snapshot — every new vendor response overwrites them — so a case that goes
through more than one round (vendor resolves with physician -> physician
rejects -> vendor responds to Medicare) silently loses everything before the
most recent round. This table lets the full sequence be reconstructed.

Backfills one event per existing DisputeCase from whatever snapshot state
survives, so already-seeded/live cases keep showing exactly what their
timeline already showed today — no regression — while every case goes
forward with full multi-round history from here on.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '9a80687f5956'
down_revision: Union[str, Sequence[str], None] = 'c2a4f7e91d3b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'dispute_case_events',
        sa.Column('event_id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('case_id', sa.Integer(), nullable=False),
        sa.Column('event_type', sa.String(length=30), nullable=False),
        sa.Column('actor', sa.String(length=20), nullable=False),
        sa.Column('response_type', sa.String(length=40), nullable=True),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('docs', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['case_id'], ['dispute_cases.case_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('event_id'),
        sa.CheckConstraint(
            "event_type IN ('DISPUTE_OPENED', 'VENDOR_RESPONDED', 'PHYSICIAN_CONFIRMED', "
            "'PHYSICIAN_REJECTED', 'NON_RESPONSIVE', 'CONFIRMATION_EXPIRED')",
            name='chk_dce_event_type',
        ),
        sa.CheckConstraint("actor IN ('PHYSICIAN', 'VENDOR', 'SYSTEM')", name='chk_dce_actor'),
    )
    op.create_index('ix_dispute_case_events_case_id', 'dispute_case_events', ['case_id'])

    # --- Backfill one event per existing case from its current snapshot ---
    op.execute("""
        INSERT INTO dispute_case_events (case_id, event_type, actor, note, created_at)
        SELECT case_id, 'DISPUTE_OPENED', 'PHYSICIAN', physician_notes, opened_at
        FROM dispute_cases
    """)
    op.execute("""
        INSERT INTO dispute_case_events (case_id, event_type, actor, response_type, note, docs, created_at)
        SELECT
            case_id,
            'VENDOR_RESPONDED',
            'VENDOR',
            COALESCE(provider_response_type, 'RESOLVED_WITH_PHYSICIAN'),
            vendor_response,
            vendor_docs,
            vendor_responded_at
        FROM dispute_cases
        WHERE vendor_responded_at IS NOT NULL
    """)
    op.execute("""
        INSERT INTO dispute_case_events (case_id, event_type, actor, created_at)
        SELECT case_id, 'PHYSICIAN_CONFIRMED', 'PHYSICIAN', closed_at
        FROM dispute_cases
        WHERE status = 'RESOLVED_BY_PHYSICIAN' AND closed_at IS NOT NULL
    """)
    op.execute("""
        INSERT INTO dispute_case_events (case_id, event_type, actor, created_at)
        SELECT case_id, 'NON_RESPONSIVE', 'SYSTEM', response_due_date
        FROM dispute_cases
        WHERE status = 'NON_RESPONSIVE' AND response_due_date IS NOT NULL
    """)


def downgrade() -> None:
    op.drop_index('ix_dispute_case_events_case_id', table_name='dispute_case_events')
    op.drop_table('dispute_case_events')
