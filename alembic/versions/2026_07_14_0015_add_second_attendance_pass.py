"""Add second attendance pass.

Revision ID: 2026_07_14_0015
Revises: 2026_06_23_0014
Create Date: 2026-07-14 15:05:00
"""

import sqlalchemy as sa
from alembic import op

revision = "2026_07_14_0015"
down_revision = "2026_06_23_0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("attendance", sa.Column("arrival_time_2", sa.String(length=5), nullable=True))
    op.add_column("attendance", sa.Column("departure_time_2", sa.String(length=5), nullable=True))


def downgrade() -> None:
    op.drop_column("attendance", "departure_time_2")
    op.drop_column("attendance", "arrival_time_2")
