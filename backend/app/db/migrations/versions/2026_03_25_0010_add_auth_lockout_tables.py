"""Add auth lockout tables.

Revision ID: 0010
Revises: 0009
Create Date: 2026-03-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "auth_lockout_state",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("actor_type", sa.String(length=16), nullable=False),
        sa.Column("principal", sa.String(length=160), nullable=False),
        sa.Column("failed_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("first_failed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_failed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_forgot_sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        "ix_auth_lockout_state_actor_principal",
        "auth_lockout_state",
        ["actor_type", "principal"],
    )

    op.create_table(
        "auth_unlock_token",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("actor_type", sa.String(length=16), nullable=False),
        sa.Column("principal", sa.String(length=160), nullable=False),
        sa.Column("purpose", sa.String(length=32), nullable=False),
        sa.Column("token_hash", sa.String(length=128), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        "ix_auth_unlock_token_actor_principal_purpose",
        "auth_unlock_token",
        ["actor_type", "principal", "purpose"],
    )
    op.create_index("ix_auth_unlock_token_hash", "auth_unlock_token", ["token_hash"])


def downgrade() -> None:
    op.drop_index("ix_auth_unlock_token_hash", table_name="auth_unlock_token")
    op.drop_index("ix_auth_unlock_token_actor_principal_purpose", table_name="auth_unlock_token")
    op.drop_table("auth_unlock_token")

    op.drop_index("ix_auth_lockout_state_actor_principal", table_name="auth_lockout_state")
    op.drop_table("auth_lockout_state")
