"""Atomically bind newly created native profiles to central CML identities."""
import sqlalchemy as sa

from alembic import op

revision = "2026_10_31_0030"
down_revision = "2026_10_30_0029"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("cml_profile_provision",
        sa.Column("operation_id", sa.String(36), primary_key=True),
        sa.Column("central_user_id", sa.String(36), nullable=False, unique=True),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("native_id", sa.Integer(), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))


def downgrade():
    raise RuntimeError("Downgrade is intentionally unsupported: profile receipts must survive code rollback")
