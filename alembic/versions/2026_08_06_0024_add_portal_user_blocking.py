"""Add an independent employee access block state."""

import sqlalchemy as sa

from alembic import op

revision = "2026_08_06_0024"
down_revision = "2026_08_01_0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "portal_users",
        sa.Column("is_blocked", sa.Boolean(), server_default=sa.false(), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("portal_users", "is_blocked")
