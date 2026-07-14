"""Add employee shift plan edit permissions.

Revision ID: 2026_07_14_0016
Revises: 2026_07_14_0015
Create Date: 2026-07-14 17:10:00
"""

import sqlalchemy as sa
from alembic import op

revision = "2026_07_14_0016"
down_revision = "2026_07_14_0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "shift_plan_month_edit_policies",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("month", sa.Integer(), nullable=False),
        sa.Column("allow_employee_edits", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_by", sa.String(length=64), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("year", "month", name="uq_shift_plan_month_edit_policy"),
    )
    op.create_index(
        "ix_shift_plan_month_edit_policies_year_month",
        "shift_plan_month_edit_policies",
        ["year", "month"],
        unique=False,
    )
    op.create_table(
        "shift_plan_employment_edit_permissions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("employment_id", sa.Integer(), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("month", sa.Integer(), nullable=False),
        sa.Column("allow_employee_edits", sa.Boolean(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_by", sa.String(length=64), nullable=True),
        sa.ForeignKeyConstraint(["employment_id"], ["employments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("employment_id", "year", "month", name="uq_shift_plan_employment_edit_permission"),
    )
    op.create_index(
        "ix_shift_plan_employment_edit_permissions_month",
        "shift_plan_employment_edit_permissions",
        ["year", "month"],
        unique=False,
    )
    op.create_index(
        "ix_shift_plan_employment_edit_permissions_employment",
        "shift_plan_employment_edit_permissions",
        ["employment_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_shift_plan_employment_edit_permissions_employment", table_name="shift_plan_employment_edit_permissions")
    op.drop_index("ix_shift_plan_employment_edit_permissions_month", table_name="shift_plan_employment_edit_permissions")
    op.drop_table("shift_plan_employment_edit_permissions")
    op.drop_index("ix_shift_plan_month_edit_policies_year_month", table_name="shift_plan_month_edit_policies")
    op.drop_table("shift_plan_month_edit_policies")
