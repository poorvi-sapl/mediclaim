"""fix_supplier_profiles_missing_columns

Revision ID: c2a4f7e91d3b
Revises: b9b015f3110e
Create Date: 2026-07-06 18:00:00.000000

`supplier_profiles` was never actually created by an Alembic migration — it (and
most other core tables) came from `Base.metadata.create_all()` on first app
startup (backend/main.py), which only creates missing tables and never adds
columns to ones that already exist. Anyone whose local Postgres database first
saw `supplier_profiles` before address/city/state/zip/enrollment_date/
last_update/contact_*/npi_watch_registered/is_synthetic were added to the
model is stuck with a stale, narrower table forever — `alembic upgrade head`
alone can't fix it since no prior migration ever added these columns.
This migration is idempotent (IF NOT EXISTS) so it's a no-op on databases that
already have the full column set (e.g. ones bootstrapped fresh via create_all
against current models.py) and a real fix for ones that don't.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c2a4f7e91d3b'
down_revision: Union[str, Sequence[str], None] = 'b9b015f3110e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLUMNS = [
    ("address",              "TEXT"),
    ("city",                 "TEXT"),
    ("state",                "VARCHAR(10)"),
    ("zip",                  "VARCHAR(10)"),
    ("enrollment_date",      "DATE"),
    ("last_update",          "DATE"),
    ("oig_excluded",         "BOOLEAN DEFAULT false"),
    ("contact_email",        "VARCHAR(200)"),
    ("contact_name",         "VARCHAR(200)"),
    ("contact_phone",        "VARCHAR(20)"),
    ("npi_watch_registered", "BOOLEAN DEFAULT false"),
    ("is_synthetic",         "BOOLEAN DEFAULT false"),
]


def upgrade() -> None:
    for name, ddl_type in _COLUMNS:
        op.execute(f"ALTER TABLE supplier_profiles ADD COLUMN IF NOT EXISTS {name} {ddl_type}")


def downgrade() -> None:
    # No-op: this migration only heals environments missing columns that
    # models.py has always declared. Dropping them would break the app on
    # every environment, not just restore some prior state.
    pass
