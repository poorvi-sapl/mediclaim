import os
import sys
from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context

# ── Make sure the project root is on the path ──
# so we can import from backend.config, backend.models etc
sys.path.insert(0, os.path.join(
    os.path.dirname(__file__), '..', '..'
))

# ── Import settings the same way the app does ──
from backend.config import get_settings
settings = get_settings()

# ── Import Base + all models so Alembic can see them ──
# This is critical — every model must be imported
# here or Alembic won't detect it for autogenerate
from backend.database import Base
from backend.models import (
    Claim, User, NpiProfile, Action,
    ActionStatusLog, RulesFlag, NpiRiskScore,
    Document, PhysicianBill, Physician,
    ClaimNotification, DisputeCase,
    SupplierProfile,
    OigExcludedNpi, OigExcludedName,
)

# ── Alembic config object ───────────────────────
config = context.config

# ── Override sqlalchemy.url with settings ───────
# This ensures Alembic ALWAYS uses the same
# connection string as the running app —
# never a hardcoded duplicate
config.set_main_option(
    "sqlalchemy.url",
    settings.database_url
)

# ── Set target metadata ─────────────────────────
# This is what Alembic compares against the DB
# to detect what needs to change
target_metadata = Base.metadata

# ── Logging ────────────────────────────────────
if config.config_file_name is not None:
    fileConfig(config.config_file_name)


# ── Run migrations ──────────────────────────────
def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
