"""Add administratively managed employment groups for shared shift plans.

Revision ID: 2026_07_26_0021
Revises: 2026_07_22_0020
Create Date: 2026-07-26 12:00:00
"""

import sqlalchemy as sa
from alembic import op

revision = "2026_07_26_0021"
down_revision = "2026_07_22_0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "employment_groups",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_employment_groups_name_ci", "employment_groups", [sa.text("lower(name)")], unique=True)
    op.create_table(
        "employment_group_members",
        sa.Column("group_id", sa.Integer(), nullable=False),
        sa.Column("employment_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["employment_id"], ["employments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["group_id"], ["employment_groups.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("group_id", "employment_id"),
    )
    op.create_index("ix_employment_group_members_employment", "employment_group_members", ["employment_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_employment_group_members_employment", table_name="employment_group_members")
    op.drop_table("employment_group_members")
    op.drop_index("ix_employment_groups_name_ci", table_name="employment_groups")
    op.drop_table("employment_groups")
