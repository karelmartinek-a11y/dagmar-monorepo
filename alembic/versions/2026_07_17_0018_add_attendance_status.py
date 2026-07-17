"""add attendance status

Revision ID: 2026_07_17_0018
Revises: 2026_07_17_0017
Create Date: 2026-07-17 12:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "2026_07_17_0018"
down_revision = "2026_07_17_0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("attendance", sa.Column("status", sa.String(length=16), nullable=True))


def downgrade() -> None:
    op.drop_column("attendance", "status")
