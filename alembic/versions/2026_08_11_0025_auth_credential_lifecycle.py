"""Harden employee credential and reset-token lifecycle."""

from __future__ import annotations

import logging

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "2026_08_11_0025"
down_revision = "2026_08_06_0024"
branch_labels = None
depends_on = None

RESET_STATE = postgresql.ENUM("PENDING", "SENT", "FAILED", name="reset_delivery_state", create_type=False)
logger = logging.getLogger("alembic.runtime.migration")


def _drop_inactive_auth_table(name: str) -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if name not in inspector.get_table_names():
        return
    references = []
    for table_name in inspector.get_table_names():
        for foreign_key in inspector.get_foreign_keys(table_name):
            if foreign_key.get("referred_table") == name:
                references.append(f"{table_name}.{foreign_key.get('name') or '<unnamed>'}")
    if references:
        raise RuntimeError(
            f"Precondition failed: inactive table {name!r} is still referenced by {references}"
        )
    table = sa.Table(name, sa.MetaData(), autoload_with=bind)
    row_count = bind.execute(sa.select(sa.func.count()).select_from(table)).scalar_one()
    logger.info("Dropping inactive auth table %s with %s non-authoritative rows", name, row_count)
    op.drop_table(name)


def _require_table(name: str) -> None:
    if name not in sa.inspect(op.get_bind()).get_table_names():
        raise RuntimeError(f"Precondition failed: required table {name!r} does not exist")


def upgrade() -> None:
    bind = op.get_bind()
    for table_name in (
        "portal_user_reset_tokens",
        "portal_users",
        "instances",
        "attendance",
        "shift_plan",
        "shift_plan_month_instances",
        "attendance_locks",
        "shift_plan_locks",
        "attendance_reminder_events",
    ):
        _require_table(table_name)
    if bind.dialect.name == "postgresql":
        postgresql.ENUM("PENDING", "SENT", "FAILED", name="reset_delivery_state").create(
            bind, checkfirst=True
        )
    op.add_column(
        "portal_user_reset_tokens",
        sa.Column("delivery_state", RESET_STATE, nullable=True),
    )
    op.add_column(
        "portal_user_reset_tokens",
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute(
        sa.text(
            """
            UPDATE portal_user_reset_tokens
               SET delivery_state = CASE
                       WHEN used_at IS NULL THEN 'FAILED'::reset_delivery_state
                       ELSE 'SENT'::reset_delivery_state
                   END,
                   revoked_at = CASE WHEN used_at IS NULL THEN CURRENT_TIMESTAMP ELSE revoked_at END
            """
        )
    )
    invalid_lifecycle_rows = bind.execute(
        sa.text(
            "SELECT count(*) FROM portal_user_reset_tokens "
            "WHERE delivery_state IS NULL "
            "OR (delivery_state = 'FAILED' AND used_at IS NULL AND revoked_at IS NULL)"
        )
    ).scalar_one()
    if invalid_lifecycle_rows:
        raise RuntimeError("Postcondition failed: reset-token lifecycle backfill is incomplete")
    op.alter_column("portal_user_reset_tokens", "delivery_state", nullable=False)
    op.create_index(
        "uq_portal_reset_one_active_sent",
        "portal_user_reset_tokens",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text(
            "delivery_state = 'SENT' AND used_at IS NULL AND revoked_at IS NULL"
        ),
    )

    # These tables are not part of the active stateless admin-cookie contract.
    _drop_inactive_auth_table("admin_sessions")
    _drop_inactive_auth_table("admin_users")
    remaining_admin_tables = {
        name
        for name in ("admin_sessions", "admin_users")
        if name in sa.inspect(bind).get_table_names()
    }
    if remaining_admin_tables:
        raise RuntimeError(
            f"Postcondition failed: inactive admin tables remain: {sorted(remaining_admin_tables)}"
        )

    # Remove only WEB instances created for a deleted user and never referenced elsewhere.
    op.execute(
        sa.text(
            """
            DELETE FROM instances i
             WHERE i.client_type = 'WEB'
               AND i.device_fingerprint LIKE 'user:%'
               AND NOT EXISTS (SELECT 1 FROM portal_users u WHERE u.instance_id = i.id)
               AND NOT EXISTS (SELECT 1 FROM instances child WHERE child.profile_instance_id = i.id)
               AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.instance_id = i.id)
               AND NOT EXISTS (SELECT 1 FROM shift_plan s WHERE s.instance_id = i.id)
               AND NOT EXISTS (SELECT 1 FROM shift_plan_month_instances s WHERE s.instance_id = i.id)
               AND NOT EXISTS (SELECT 1 FROM attendance_locks l WHERE l.instance_id = i.id)
               AND NOT EXISTS (SELECT 1 FROM shift_plan_locks l WHERE l.instance_id = i.id)
               AND NOT EXISTS (SELECT 1 FROM attendance_reminder_events e WHERE e.instance_id = i.id)
            """
        )
    )


def downgrade() -> None:
    op.drop_index("uq_portal_reset_one_active_sent", table_name="portal_user_reset_tokens")
    op.drop_column("portal_user_reset_tokens", "revoked_at")
    op.drop_column("portal_user_reset_tokens", "delivery_state")
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        postgresql.ENUM(name="reset_delivery_state").drop(bind, checkfirst=True)
