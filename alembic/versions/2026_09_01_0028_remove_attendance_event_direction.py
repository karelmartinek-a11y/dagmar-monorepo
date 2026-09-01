"""Remove obsolete attendance-event direction metadata.

Revision ID: 2026_09_01_0028
Revises: 2026_08_11_0027
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "2026_09_01_0028"
down_revision = "2026_08_11_0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {
        column["name"] for column in sa.inspect(bind).get_columns("attendance_events")
    }
    if "event_type" not in columns:
        return
    if bind.dialect.name == "postgresql":
        op.drop_constraint("ck_attendance_event_type", "attendance_events", type_="check")
        op.drop_column("attendance_events", "event_type")
        postgresql.ENUM(name="attendance_event_type").drop(bind, checkfirst=True)
        return
    with op.batch_alter_table("attendance_events") as batch:
        batch.drop_constraint("ck_attendance_event_type", type_="check")
        batch.drop_column("event_type")


def downgrade() -> None:
    raise RuntimeError("Downgrade is intentionally unsupported after metadata removal")
