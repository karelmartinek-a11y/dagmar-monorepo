"""Add total visibility and require only total/night for work contracts.

Revision ID: 2026_08_01_0023
Revises: 2026_07_31_0022
"""

import sqlalchemy as sa

from alembic import op

revision = "2026_08_01_0023"
down_revision = "2026_07_31_0022"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.add_column(
        "employments",
        sa.Column("total_hours_enabled", sa.Boolean(), server_default=sa.true(), nullable=False),
    )
    op.execute(sa.text("UPDATE employments SET total_hours_enabled = false WHERE employment_type = 'TASK_SHIFT_BASED'"))
    op.drop_constraint("ck_employment_task_profile", "employments", type_="check")
    op.create_check_constraint(
        "ck_employment_task_profile",
        "employments",
        "employment_type <> 'TASK_SHIFT_BASED' OR "
        "(NOT total_hours_enabled AND NOT automatic_breaks_enabled AND NOT afternoon_hours_enabled "
        "AND afternoon_start_minutes IS NULL AND NOT night_hours_enabled AND NOT weekend_hours_enabled "
        "AND NOT public_holiday_hours_enabled)",
    )
    op.drop_constraint("ck_employment_work_contract_profile", "employments", type_="check")
    op.create_check_constraint(
        "ck_employment_work_contract_profile",
        "employments",
        "employment_type <> 'WORK_CONTRACT' OR (total_hours_enabled AND night_hours_enabled)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_employment_task_profile", "employments", type_="check")
    op.create_check_constraint(
        "ck_employment_task_profile",
        "employments",
        "employment_type <> 'TASK_SHIFT_BASED' OR "
        "(NOT automatic_breaks_enabled AND NOT afternoon_hours_enabled AND afternoon_start_minutes IS NULL "
        "AND NOT night_hours_enabled AND NOT weekend_hours_enabled AND NOT public_holiday_hours_enabled)",
    )
    op.drop_constraint("ck_employment_work_contract_profile", "employments", type_="check")
    op.execute(
        sa.text(
            "UPDATE employments SET weekend_hours_enabled = true, public_holiday_hours_enabled = true "
            "WHERE employment_type = 'WORK_CONTRACT'"
        )
    )
    op.create_check_constraint(
        "ck_employment_work_contract_profile",
        "employments",
        "employment_type <> 'WORK_CONTRACT' OR "
        "(night_hours_enabled AND weekend_hours_enabled AND public_holiday_hours_enabled)",
    )
    op.drop_column("employments", "total_hours_enabled")
