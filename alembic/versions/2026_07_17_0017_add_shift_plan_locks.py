"""add shift plan locks

Revision ID: 2026_07_17_0017
Revises: 2026_07_14_0016
Create Date: 2026-07-17 10:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "2026_07_17_0017"
down_revision = "2026_07_14_0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "shift_plan_locks",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("employment_id", sa.Integer(), nullable=False),
        sa.Column("instance_id", sa.String(length=36), nullable=True),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("month", sa.Integer(), nullable=False),
        sa.Column("locked_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("locked_by", sa.String(length=64), nullable=True),
        sa.ForeignKeyConstraint(["employment_id"], ["employments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["instance_id"], ["instances.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("employment_id", "year", "month", name="uq_shift_plan_lock_employment_month"),
    )
    op.create_index(
        "ix_shift_plan_locks_employment_month",
        "shift_plan_locks",
        ["employment_id", "year", "month"],
        unique=False,
    )
    op.create_index(
        "ix_shift_plan_locks_instance_month",
        "shift_plan_locks",
        ["instance_id", "year", "month"],
        unique=False,
    )
    op.execute(
        sa.text(
            """
            INSERT INTO shift_plan_locks (employment_id, instance_id, year, month, locked_at, locked_by)
            SELECT employment_id, instance_id, year, month, locked_at, locked_by
            FROM attendance_locks
            """
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            """
            INSERT INTO attendance_locks (employment_id, instance_id, year, month, locked_at, locked_by)
            SELECT spl.employment_id, spl.instance_id, spl.year, spl.month, spl.locked_at, spl.locked_by
            FROM shift_plan_locks spl
            LEFT JOIN attendance_locks al
              ON al.employment_id = spl.employment_id
             AND al.year = spl.year
             AND al.month = spl.month
            WHERE al.id IS NULL
            """
        )
    )
    op.drop_index("ix_shift_plan_locks_instance_month", table_name="shift_plan_locks")
    op.drop_index("ix_shift_plan_locks_employment_month", table_name="shift_plan_locks")
    op.drop_table("shift_plan_locks")
