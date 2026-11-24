"""Store completed MCP attendance operations in their business transaction."""

import sqlalchemy as sa

from alembic import op

revision = "2026_11_24_0034"
down_revision = "2026_11_24_0033"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "attendance_mcp_operation",
        sa.Column("actor", sa.String(80), primary_key=True),
        sa.Column("operation_id", sa.String(36), primary_key=True),
        sa.Column("action", sa.String(45), nullable=False),
        sa.Column("request_digest", sa.String(64), nullable=False),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade():
    raise RuntimeError("Attendance MCP operation receipts must survive code rollback")
