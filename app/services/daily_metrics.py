"""Transactional persistence for backend-authoritative daily time metrics."""

from __future__ import annotations

from datetime import date
from typing import TYPE_CHECKING

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db.models import DailyMetricSource, Employment, EmploymentDailyTimeMetric
from app.services.time_metrics import DailyMetrics

if TYPE_CHECKING:
    from app.services.month_summary import MonthSummary

CALCULATION_REVISION = 2


def month_summary_source_presence(summary: MonthSummary) -> tuple[bool, bool]:
    """Return whether attendance/plan raw facts exist anywhere in the month."""
    attendance = any(
        day.attendance is not None
        or day.worked_state != "empty"
        or (day.worked is not None and day.worked.total.minutes > 0)
        for day in summary.day_summaries
    )
    planned = any(
        day.plan is not None
        or day.planned_state != "empty"
        or (day.planned is not None and day.planned.total.minutes > 0)
        for day in summary.day_summaries
    )
    return attendance, planned


def _row(
    *, employment_id: int, metric_date: date, source: DailyMetricSource, metrics: DailyMetrics
) -> EmploymentDailyTimeMetric:
    return EmploymentDailyTimeMetric(
        employment_id=employment_id,
        metric_date=metric_date,
        source=source,
        total_minutes=metrics.total.minutes,
        total_tenths=metrics.total.tenths,
        afternoon_minutes=metrics.afternoon.minutes if metrics.afternoon else None,
        afternoon_tenths=metrics.afternoon.tenths if metrics.afternoon else None,
        night_minutes=metrics.night.minutes if metrics.night else None,
        night_tenths=metrics.night.tenths if metrics.night else None,
        weekend_minutes=metrics.weekend.minutes if metrics.weekend else None,
        weekend_tenths=metrics.weekend.tenths if metrics.weekend else None,
        public_holiday_minutes=metrics.public_holiday.minutes if metrics.public_holiday else None,
        public_holiday_tenths=metrics.public_holiday.tenths if metrics.public_holiday else None,
        calculation_revision=CALCULATION_REVISION,
    )


def sync_employment_month_metrics(
    db: Session, *, employment: Employment, year: int, month: int
) -> None:
    """Replace one employment/month atomically from the canonical engine."""
    from app.services.month_summary import build_month_summary

    start = date(year, month, 1)
    end = date(year + (month == 12), 1 if month == 12 else month + 1, 1)
    db.execute(
        delete(EmploymentDailyTimeMetric).where(
            EmploymentDailyTimeMetric.employment_id == employment.id,
            EmploymentDailyTimeMetric.metric_date >= start,
            EmploymentDailyTimeMetric.metric_date < end,
        )
    )
    summary = build_month_summary(
        db,
        employment=employment,
        year=year,
        month=month,
        use_persisted=False,
    )
    attendance_present, plan_present = month_summary_source_presence(summary)
    for day in summary.day_summaries:
        if attendance_present and day.worked is not None:
            db.add(
                _row(
                    employment_id=employment.id,
                    metric_date=day.date,
                    source=DailyMetricSource.ATTENDANCE,
                    metrics=day.worked,
                )
            )
        if plan_present and day.planned is not None:
            db.add(
                _row(
                    employment_id=employment.id,
                    metric_date=day.date,
                    source=DailyMetricSource.SHIFT_PLAN,
                    metrics=day.planned,
                )
            )


def sync_employment_metric_months(
    db: Session,
    *,
    employment: Employment,
    months: set[tuple[int, int]],
) -> None:
    """Rebuild only months whose source facts changed."""
    for year, month in sorted(months):
        sync_employment_month_metrics(
            db,
            employment=employment,
            year=year,
            month=month,
        )


def sync_employment_metrics(db: Session, *, employment: Employment) -> None:
    """Rebuild every persisted month for a profile change."""
    from app.db.models import Attendance, AttendanceEvent, ShiftPlan
    from app.services.prague_time import prague_now
    from app.services.time_intervals import pair_events, shift_plan_intervals, split_by_day

    events = list(
        db.execute(
            select(AttendanceEvent).where(AttendanceEvent.employment_id == employment.id)
        ).scalars()
    )
    dates = {prague_now(event.occurred_at).date() for event in events}
    dates.update(day for interval in pair_events(events) for day, _part in split_by_day(interval))
    dates.update(
        db.execute(
            select(Attendance.date).where(Attendance.employment_id == employment.id)
        ).scalars()
    )
    plans = list(
        db.execute(select(ShiftPlan).where(ShiftPlan.employment_id == employment.id)).scalars()
    )
    dates.update(plan.date for plan in plans)
    dates.update(
        day for interval in shift_plan_intervals(plans) for day, _part in split_by_day(interval)
    )
    months = {(item.year, item.month) for item in dates}
    existing_rows = list(
        db.execute(
            select(EmploymentDailyTimeMetric).where(
                EmploymentDailyTimeMetric.employment_id == employment.id
            )
        ).scalars()
    )
    for row in existing_rows:
        if (row.metric_date.year, row.metric_date.month) not in months:
            db.delete(row)
    sync_employment_metric_months(
        db,
        employment=employment,
        months=months,
    )
