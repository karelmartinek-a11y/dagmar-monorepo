"""Unify employment profiles and attendance events.

The migration deliberately keeps the legacy values only while converting the
existing database.  The application schema after this revision has no legacy
attendance columns or instance-level employment profile.
"""

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "2026_07_31_0022"
down_revision = "2026_07_26_0021"
branch_labels = None
depends_on = None

PRAGUE_TIMEZONE = ZoneInfo("Europe/Prague")


def _at(day: date, value: str) -> datetime:
    hour, minute = (int(part) for part in value.split(":"))
    # Legacy attendance values are Czech wall-clock times.  Explicitly attach
    # the application timezone so PostgreSQL session settings cannot reinterpret
    # them as UTC while writing the new TIMESTAMPTZ event column.
    return datetime.combine(day, time(hour, minute), tzinfo=PRAGUE_TIMEZONE)


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        sa.Enum("WORK_CONTRACT", "DPP_DPC", "TASK_SHIFT_BASED", "EXTERNAL_HOURLY", name="employment_type").create(bind, checkfirst=True)
        sa.Enum("IN", "OUT", name="attendance_event_type").create(bind, checkfirst=True)
        sa.Enum("ATTENDANCE", "SHIFT_PLAN", name="daily_metric_source").create(bind, checkfirst=True)

    op.add_column("employments", sa.Column("workload_fraction", sa.Numeric(4, 3), nullable=True))
    op.add_column("employments", sa.Column("automatic_breaks_enabled", sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column("employments", sa.Column("afternoon_hours_enabled", sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column("employments", sa.Column("afternoon_start_minutes", sa.Integer(), nullable=True))
    op.add_column("employments", sa.Column("night_hours_enabled", sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column("employments", sa.Column("weekend_hours_enabled", sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column("employments", sa.Column("public_holiday_hours_enabled", sa.Boolean(), server_default=sa.false(), nullable=False))

    if bind.dialect.name == "postgresql":
        op.execute(sa.text("ALTER TABLE employments ALTER COLUMN employment_type TYPE employment_type USING CASE WHEN employment_type = 'HPP' THEN 'WORK_CONTRACT' ELSE employment_type END::employment_type"))
    else:
        op.execute(sa.text("UPDATE employments SET employment_type = 'WORK_CONTRACT' WHERE employment_type = 'HPP'"))
    op.execute(sa.text("UPDATE employments SET workload_fraction = 1.000, night_hours_enabled = true, weekend_hours_enabled = true, public_holiday_hours_enabled = true, afternoon_hours_enabled = true, afternoon_start_minutes = COALESCE((SELECT afternoon_cutoff_minutes FROM app_settings WHERE app_settings.id = 1), 1020) WHERE employment_type = 'WORK_CONTRACT'"))
    op.execute(sa.text("UPDATE employments SET night_hours_enabled = true, weekend_hours_enabled = true, public_holiday_hours_enabled = true, afternoon_hours_enabled = true, afternoon_start_minutes = COALESCE((SELECT afternoon_cutoff_minutes FROM app_settings WHERE app_settings.id = 1), 1020) WHERE employment_type = 'DPP_DPC'"))

    op.create_table(
        "attendance_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("employment_id", sa.Integer(), sa.ForeignKey("employments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("event_type", postgresql.ENUM("IN", "OUT", name="attendance_event_type", create_type=False) if bind.dialect.name == "postgresql" else sa.String(3), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("employment_id", "occurred_at", name="uq_attendance_event_employment_timestamp"),
        sa.CheckConstraint("event_type IN ('IN', 'OUT')", name="ck_attendance_event_type"),
    )
    op.create_index("ix_attendance_events_employment_occurred_id", "attendance_events", ["employment_id", "occurred_at", "id"])
    rows = bind.execute(sa.text("SELECT employment_id, date, arrival_time, departure_time, arrival_time_2, departure_time_2 FROM attendance WHERE arrival_time IS NOT NULL OR departure_time IS NOT NULL OR arrival_time_2 IS NOT NULL OR departure_time_2 IS NOT NULL")).mappings()
    for row in rows:
        previous: datetime | None = None
        for start, end in ((row["arrival_time"], row["departure_time"]), (row["arrival_time_2"], row["departure_time_2"])):
            if start is None and end is None:
                continue
            if start is None:
                raise RuntimeError(f"Attendance {row['employment_id']}/{row['date']} has an OUT without an IN")
            start_at = _at(row["date"], start)
            while previous is not None and start_at <= previous:
                start_at += timedelta(days=1)
            if end is not None:
                end_at = _at(row["date"], end)
                while end_at <= start_at:
                    end_at += timedelta(days=1)
                if previous is not None and end_at <= previous:
                    raise RuntimeError(f"Attendance {row['employment_id']}/{row['date']} cannot be ordered")
                bind.execute(sa.text("INSERT INTO attendance_events (employment_id, occurred_at, event_type) VALUES (:employment_id, :occurred_at, 'IN'), (:employment_id, :ended_at, 'OUT')"), {"employment_id": row["employment_id"], "occurred_at": start_at, "ended_at": end_at})
                previous = end_at
            else:
                bind.execute(sa.text("INSERT INTO attendance_events (employment_id, occurred_at, event_type) VALUES (:employment_id, :occurred_at, 'IN')"), {"employment_id": row["employment_id"], "occurred_at": start_at})
                previous = start_at

    op.drop_column("attendance", "arrival_time")
    op.drop_column("attendance", "departure_time")
    op.drop_column("attendance", "arrival_time_2")
    op.drop_column("attendance", "departure_time_2")
    op.drop_column("instances", "employment_template")
    op.drop_column("app_settings", "afternoon_cutoff_minutes")

    op.create_table(
        "employment_daily_time_metrics",
        sa.Column("employment_id", sa.Integer(), sa.ForeignKey("employments.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("metric_date", sa.Date(), primary_key=True),
        sa.Column("source", postgresql.ENUM("ATTENDANCE", "SHIFT_PLAN", name="daily_metric_source", create_type=False) if bind.dialect.name == "postgresql" else sa.String(12), primary_key=True),
        sa.Column("total_minutes", sa.Integer(), nullable=False), sa.Column("total_tenths", sa.Integer(), nullable=False),
        sa.Column("afternoon_minutes", sa.Integer()), sa.Column("afternoon_tenths", sa.Integer()),
        sa.Column("night_minutes", sa.Integer()), sa.Column("night_tenths", sa.Integer()),
        sa.Column("weekend_minutes", sa.Integer()), sa.Column("weekend_tenths", sa.Integer()),
        sa.Column("public_holiday_minutes", sa.Integer()), sa.Column("public_holiday_tenths", sa.Integer()),
        sa.Column("calculation_revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_daily_time_metrics_employment_date", "employment_daily_time_metrics", ["employment_id", "metric_date"])

    op.create_check_constraint("ck_employment_workload_fraction", "employments", "(employment_type = 'WORK_CONTRACT' AND workload_fraction IS NOT NULL AND workload_fraction > 0 AND workload_fraction <= 1) OR (employment_type <> 'WORK_CONTRACT' AND workload_fraction IS NULL)")
    op.create_check_constraint("ck_employment_afternoon_start", "employments", "afternoon_start_minutes IS NULL OR (afternoon_start_minutes >= 0 AND afternoon_start_minutes <= 1319)")
    op.create_check_constraint("ck_employment_afternoon_required", "employments", "NOT afternoon_hours_enabled OR afternoon_start_minutes IS NOT NULL")
    op.create_check_constraint("ck_employment_task_profile", "employments", "employment_type <> 'TASK_SHIFT_BASED' OR (NOT automatic_breaks_enabled AND NOT afternoon_hours_enabled AND afternoon_start_minutes IS NULL AND NOT night_hours_enabled AND NOT weekend_hours_enabled AND NOT public_holiday_hours_enabled)")
    op.create_check_constraint("ck_employment_work_contract_profile", "employments", "employment_type <> 'WORK_CONTRACT' OR (night_hours_enabled AND weekend_hours_enabled AND public_holiday_hours_enabled)")


def downgrade() -> None:
    raise RuntimeError("Downgrade is intentionally unsupported after attendance event migration")
