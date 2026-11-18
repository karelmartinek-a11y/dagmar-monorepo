"""Record minimally scoped receipts in attendance mutation transactions."""

import sqlalchemy as sa

from alembic import op

revision = "2026_11_18_0032"
down_revision = "2026_11_13_0031"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "cml_attendance_activity",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("actor", sa.String(80), nullable=False),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_cml_attendance_activity_actor_id", "cml_attendance_activity", ["actor", "id"])


def downgrade():
    raise RuntimeError("Attendance activity receipts must survive code rollback")
