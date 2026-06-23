"""Add integration client scope modes.

Revision ID: 2026_06_23_0013
Revises: 2026_06_22_0012
Create Date: 2026-06-23 09:30:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "2026_06_23_0013"
down_revision = "2026_06_22_0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "integration_clients",
        sa.Column("data_scope_mode", sa.String(length=32), nullable=False, server_default="ALL_EMPLOYMENTS"),
    )
    op.add_column(
        "integration_clients",
        sa.Column("include_inactive_employments", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )

    op.execute(
        """
        UPDATE integration_clients
        SET data_scope_mode = CASE
            WHEN json_array_length(COALESCE(allowed_employee_ids, '[]'::json)) > 0 THEN 'SELECTED_EMPLOYEES'
            WHEN json_array_length(COALESCE(allowed_employment_ids, '[]'::json)) > 0 THEN 'SELECTED_EMPLOYMENTS'
            ELSE 'ALL_EMPLOYMENTS'
        END,
        include_inactive_employments = CASE
            WHEN json_array_length(COALESCE(allowed_employee_ids, '[]'::json)) > 0 THEN true
            ELSE false
        END
        """
    )

    op.alter_column("integration_clients", "data_scope_mode", server_default=None)
    op.alter_column("integration_clients", "include_inactive_employments", server_default=None)


def downgrade() -> None:
    op.drop_column("integration_clients", "include_inactive_employments")
    op.drop_column("integration_clients", "data_scope_mode")
