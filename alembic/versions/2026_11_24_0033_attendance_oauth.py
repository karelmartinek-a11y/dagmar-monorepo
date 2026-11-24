"""Store scoped OAuth authorizations for the Docházka MCP endpoint."""

import sqlalchemy as sa

from alembic import op

revision = "2026_11_24_0033"
down_revision = "2026_11_18_0032"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "attendance_oauth_client",
        sa.Column("id", sa.String(160), primary_key=True),
        sa.Column("payload", sa.JSON(), nullable=False),
    )
    op.create_table(
        "attendance_oauth_grant",
        sa.Column("digest", sa.String(64), primary_key=True),
        sa.Column("kind", sa.String(12), nullable=False),
        sa.Column("family", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.BigInteger(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
    )
    op.create_index("ix_attendance_oauth_grant_family", "attendance_oauth_grant", ["family"])


def downgrade():
    raise RuntimeError("Attendance OAuth grants must survive code rollback")
