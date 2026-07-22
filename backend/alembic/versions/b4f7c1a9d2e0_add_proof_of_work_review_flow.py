"""add_proof_of_work_review_flow

Revision ID: b4f7c1a9d2e0
Revises: f2d8a61c3b90
Create Date: 2026-07-13 12:30:00.000000

Supports the proof-of-work document review flow:

- chk_dc_dispute_type widened for the two remaining flagging actions that now
  also open a vendor doc-request case: 'FLAG' (Flag Vendor) and
  'UNKNOWN_PATIENT' (Reassign Patient). DISPUTE / FRAUD_REPORT / DECEASED_PATIENT
  already existed.

- chk_dc_status widened for the two new states:
    PENDING_PHYSICIAN_REVIEW — vendor has uploaded proof-of-work docs, awaiting
                               the physician's approve/decline.
    REFERRED_TO_PAYER        — physician declined the docs; the case leaves the
                               vendor and is handed to the payer.

Only adds values; existing rows/statuses are untouched.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b4f7c1a9d2e0'
down_revision: Union[str, Sequence[str], None] = 'f2d8a61c3b90'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint('chk_dc_dispute_type', 'dispute_cases', type_='check')
    op.create_check_constraint(
        'chk_dc_dispute_type', 'dispute_cases',
        "dispute_type IN ('DISPUTE', 'FRAUD_REPORT', 'DECEASED_PATIENT', 'FLAG', 'UNKNOWN_PATIENT')",
    )
    op.drop_constraint('chk_dc_status', 'dispute_cases', type_='check')
    op.create_check_constraint(
        'chk_dc_status', 'dispute_cases',
        "status IN ('OPEN', 'RESPONDED_TO_MEDICARE', 'RESOLVED_BY_PHYSICIAN', 'NON_RESPONSIVE', "
        "'CLOSED', 'REFERRED_OIG', 'PENDING_PHYSICIAN_CONFIRMATION', 'PENDING_PHYSICIAN_REVIEW', "
        "'REFERRED_TO_PAYER')",
    )


def downgrade() -> None:
    op.drop_constraint('chk_dc_dispute_type', 'dispute_cases', type_='check')
    op.create_check_constraint(
        'chk_dc_dispute_type', 'dispute_cases',
        "dispute_type IN ('DISPUTE', 'FRAUD_REPORT', 'DECEASED_PATIENT')",
    )
    op.drop_constraint('chk_dc_status', 'dispute_cases', type_='check')
    op.create_check_constraint(
        'chk_dc_status', 'dispute_cases',
        "status IN ('OPEN', 'RESPONDED_TO_MEDICARE', 'RESOLVED_BY_PHYSICIAN', 'NON_RESPONSIVE', "
        "'CLOSED', 'REFERRED_OIG', 'PENDING_PHYSICIAN_CONFIRMATION')",
    )
