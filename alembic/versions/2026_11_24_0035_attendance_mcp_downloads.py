"""Store private, expiring MCP export files."""

import sqlalchemy as sa

from alembic import op

revision = "2026_11_24_0035"
down_revision = "2026_11_24_0034"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "attendance_mcp_export",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("actor", sa.String(80), nullable=False),
        sa.Column("filename", sa.String(200), nullable=False),
        sa.Column("media_type", sa.String(64), nullable=False),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.BigInteger(), nullable=False),
    )
    op.create_index(
        "ix_attendance_mcp_export_expiration", "attendance_mcp_export", ["expires_at"]
    )


def downgrade():
    op.drop_table("attendance_mcp_export")
