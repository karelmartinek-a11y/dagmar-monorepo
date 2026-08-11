"""Enforce removal of inactive database-backed admin authentication tables."""

from __future__ import annotations

import logging

import sqlalchemy as sa
from alembic import op

revision = "2026_08_11_0027"
down_revision = "2026_08_11_0026"
branch_labels = None
depends_on = None

logger = logging.getLogger("alembic.runtime.migration")
INACTIVE_TABLES = ("admin_sessions", "admin_users")


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = set(inspector.get_table_names())
    for table_name in INACTIVE_TABLES:
        if table_name not in existing:
            continue
        references = [
            f"{source}.{foreign_key.get('name') or '<unnamed>'}"
            for source in existing
            for foreign_key in inspector.get_foreign_keys(source)
            if foreign_key.get("referred_table") == table_name
        ]
        if references:
            raise RuntimeError(
                f"0027 precondition failed: {table_name} is referenced by {references}"
            )
        table = sa.Table(table_name, sa.MetaData(), autoload_with=bind)
        row_count = bind.execute(sa.select(sa.func.count()).select_from(table)).scalar_one()
        logger.info(
            "Dropping inactive non-authoritative auth table %s rows=%s",
            table_name,
            row_count,
        )
        op.drop_table(table_name)

    remaining = set(sa.inspect(bind).get_table_names()).intersection(INACTIVE_TABLES)
    if remaining:
        raise RuntimeError(f"0027 postcondition failed: inactive auth tables remain: {sorted(remaining)}")


def downgrade() -> None:
    # Removed tables were non-authoritative and are intentionally not recreated.
    return
