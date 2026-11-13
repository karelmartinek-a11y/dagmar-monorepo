"""Keep idempotent receipts for employment creation through CML."""

import sqlalchemy as sa

from alembic import op

revision = "2026_11_13_0031"
down_revision = "2026_10_31_0030"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "cml_employment_creation",
        sa.Column("operation_id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("actor", sa.String(80), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("employment_id", sa.Integer(), nullable=False, unique=True),
    )


def downgrade():
    raise RuntimeError("Employment receipts must survive code rollback")
