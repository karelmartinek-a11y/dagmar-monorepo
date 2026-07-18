"""Add optional Google and Apple account linking.

Revision ID: 2026_07_18_0019
Revises: 2026_07_17_0018
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "2026_07_18_0019"
down_revision = "2026_07_17_0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "external_identities",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("account_type", sa.String(16), nullable=False),
        sa.Column("portal_user_id", sa.Integer(), sa.ForeignKey("portal_users.id", ondelete="CASCADE"), nullable=True),
        sa.Column("admin_username", sa.String(160), nullable=True),
        sa.Column("provider", sa.String(16), nullable=False),
        sa.Column("issuer", sa.String(255), nullable=False),
        sa.Column("subject", sa.String(255), nullable=False),
        sa.Column("email", sa.String(320), nullable=True),
        sa.Column("email_verified", sa.Boolean(), nullable=True),
        sa.Column("linked_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_ip_hash", sa.String(64), nullable=True),
        sa.Column("created_user_agent", sa.String(255), nullable=True),
        sa.CheckConstraint(
            "(account_type = 'employee' AND portal_user_id IS NOT NULL AND admin_username IS NULL) OR "
            "(account_type = 'admin' AND portal_user_id IS NULL AND admin_username IS NOT NULL)",
            name="ck_external_identity_account_target",
        ),
        sa.CheckConstraint("provider IN ('google', 'apple')", name="ck_external_identity_provider"),
        sa.UniqueConstraint("provider", "issuer", "subject", name="uq_external_identity_subject"),
        sa.UniqueConstraint("portal_user_id", "provider", name="uq_external_identity_employee_provider"),
        sa.UniqueConstraint("admin_username", "provider", name="uq_external_identity_admin_provider"),
    )
    op.create_index("ix_external_identity_portal_user", "external_identities", ["portal_user_id"])
    op.create_index("ix_external_identity_admin", "external_identities", ["admin_username"])

    op.create_table(
        "oauth_transactions",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("state_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("browser_hash", sa.String(64), nullable=False),
        sa.Column("provider", sa.String(16), nullable=False),
        sa.Column("purpose", sa.String(16), nullable=False),
        sa.Column("portal", sa.String(16), nullable=False),
        sa.Column("return_path", sa.String(255), nullable=False),
        sa.Column("portal_user_id", sa.Integer(), sa.ForeignKey("portal_users.id", ondelete="CASCADE"), nullable=True),
        sa.Column("admin_username", sa.String(160), nullable=True),
        sa.Column("nonce", sa.String(128), nullable=False),
        sa.Column("code_verifier", sa.String(128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("result_payload", sa.Text(), nullable=True),
        sa.Column("result_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("result_consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("provider IN ('google', 'apple')", name="ck_oauth_transaction_provider"),
        sa.CheckConstraint("purpose IN ('login', 'link')", name="ck_oauth_transaction_purpose"),
        sa.CheckConstraint("portal IN ('employee', 'admin')", name="ck_oauth_transaction_portal"),
    )
    op.create_index("ix_oauth_transaction_expires", "oauth_transactions", ["expires_at"])
    op.create_index("ix_oauth_transaction_browser", "oauth_transactions", ["browser_hash"])

    op.create_table(
        "external_auth_audit_logs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("account_type", sa.String(16), nullable=False),
        sa.Column("account_ref", sa.String(160), nullable=True),
        sa.Column("provider", sa.String(16), nullable=False),
        sa.Column("event", sa.String(48), nullable=False),
        sa.Column("outcome", sa.String(16), nullable=False),
        sa.Column("reason", sa.String(64), nullable=True),
        sa.Column("subject_hash", sa.String(64), nullable=True),
        sa.Column("request_id", sa.String(64), nullable=True),
        sa.Column("source_ip_hash", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_external_auth_audit_account", "external_auth_audit_logs", ["account_type", "account_ref"])
    op.create_index("ix_external_auth_audit_created", "external_auth_audit_logs", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_external_auth_audit_created", table_name="external_auth_audit_logs")
    op.drop_index("ix_external_auth_audit_account", table_name="external_auth_audit_logs")
    op.drop_table("external_auth_audit_logs")
    op.drop_index("ix_oauth_transaction_browser", table_name="oauth_transactions")
    op.drop_index("ix_oauth_transaction_expires", table_name="oauth_transactions")
    op.drop_table("oauth_transactions")
    op.drop_index("ix_external_identity_admin", table_name="external_identities")
    op.drop_index("ix_external_identity_portal_user", table_name="external_identities")
    op.drop_table("external_identities")
