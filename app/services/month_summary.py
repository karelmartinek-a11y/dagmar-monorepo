"""Compatibility facade over the single backend time-metrics engine."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (
    Attendance,
    AttendanceEvent,
    DailyMetricSource,
    Employment,
    EmploymentDailyTimeMetric,
    ShiftPlan,
)
from app.services.czech_holidays import is_czech_public_holiday
from app.services.prague_time import prague_now
from app.services.time_intervals import pair_events, paired_event_ids, shift_plan_intervals
from app.services.time_metrics import (
    STATUS_METRIC_KEYS,
    DailyMetrics,
    DayStatusMetrics,
    MetricValue,
    calculate_daily_metrics,
    calculate_day_status_metrics,
    empty_daily_metrics,
)


@dataclass(frozen=True)
class DaySummary:
    date: date
    attendance: Attendance | None
    plan: ShiftPlan | None
    effective_status: str | None
    worked: DailyMetrics | None
    planned: DailyMetrics | None
    worked_state: str
    planned_state: str
    status_metrics: DayStatusMetrics

    @property
    def planned_minutes(self) -> int:
        return self.planned.total.minutes if self.planned else 0

    @property
    def planned_hours(self) -> float:
        return self.planned.total.hours if self.planned else 0.0


@dataclass(frozen=True)
class MonthSummary:
    day_summaries: list[DaySummary]
    worked: dict[str, MetricValue | None] | None
    planned: dict[str, MetricValue | None] | None
    status_metrics: dict[str, MetricValue | None]

    @property
    def planned_minutes(self) -> int:
        value = self.planned.get("total") if self.planned else None
        return value.minutes if value else 0

    @property
    def planned_hours(self) -> float:
        value = self.planned.get("total") if self.planned else None
        return value.hours if value else 0.0


def _month_range(year: int, month: int) -> tuple[date, date]:
    start = date(year, month, 1)
    return start, date(year + (month == 12), 1 if month == 12 else month + 1, 1)


def _sum(values: list[DailyMetrics], key: str) -> MetricValue | None:
    items = [getattr(value, key) for value in values if getattr(value, key) is not None]
    return (
        MetricValue(sum(item.minutes for item in items), sum(item.tenths for item in items))
        if items
        else None
    )


def _sum_status(values: list[DayStatusMetrics], key: str) -> MetricValue | None:
    items = [getattr(value, key) for value in values if getattr(value, key) is not None]
    return (
        MetricValue(sum(item.minutes for item in items), sum(item.tenths for item in items))
        if items
        else None
    )


def _stored_metrics(
    row: EmploymentDailyTimeMetric | None, employment: Employment
) -> DailyMetrics | None:
    if row is None:
        return empty_daily_metrics(employment)

    def value(minutes: int | None, tenths: int | None) -> MetricValue | None:
        return MetricValue(minutes, tenths) if minutes is not None and tenths is not None else None

    return DailyMetrics(
        total=MetricValue(row.total_minutes, row.total_tenths),
        afternoon=value(row.afternoon_minutes, row.afternoon_tenths),
        night=value(row.night_minutes, row.night_tenths),
        weekend=value(row.weekend_minutes, row.weekend_tenths),
        public_holiday=value(row.public_holiday_minutes, row.public_holiday_tenths),
    )


def build_month_summaries(
    db: Session,
    *,
    employments: list[Employment],
    year: int,
    month: int,
    use_persisted: bool = True,
) -> dict[int, MonthSummary]:
    start, end = _month_range(year, month)
    result: dict[int, MonthSummary] = {}
    for employment in employments:
        events = list(
            db.execute(
                select(AttendanceEvent)
                .where(AttendanceEvent.employment_id == employment.id)
                .order_by(AttendanceEvent.occurred_at, AttendanceEvent.id)
            ).scalars()
        )
        intervals = pair_events(events) if events else []
        closed_event_ids = paired_event_ids(events)
        attendance = {
            row.date: row
            for row in db.execute(
                select(Attendance).where(
                    Attendance.employment_id == employment.id,
                    Attendance.date >= start,
                    Attendance.date < end,
                )
            ).scalars()
        }
        plan_rows = list(
            db.execute(
                select(ShiftPlan).where(
                    ShiftPlan.employment_id == employment.id,
                    ShiftPlan.date >= start - timedelta(days=1),
                    ShiftPlan.date < end,
                )
            ).scalars()
        )
        plans = {row.date: row for row in plan_rows if row.date >= start}
        planned_intervals = shift_plan_intervals(plan_rows)
        stored = (
            {
                (row.metric_date, row.source): row
                for row in db.execute(
                    select(EmploymentDailyTimeMetric).where(
                        EmploymentDailyTimeMetric.employment_id == employment.id,
                        EmploymentDailyTimeMetric.metric_date >= start,
                        EmploymentDailyTimeMetric.metric_date < end,
                    )
                ).scalars()
            }
            if use_persisted
            else {}
        )
        days: list[DaySummary] = []
        worked_values: list[DailyMetrics] = []
        planned_values: list[DailyMetrics] = []
        status_values: list[DayStatusMetrics] = []
        for offset in range((end - start).days):
            day = start + timedelta(days=offset)
            day_events = [event for event in events if prague_now(event.occurred_at).date() == day]
            attendance_row = attendance.get(day)
            plan_row = plans.get(day)
            effective_status = (
                attendance_row.status
                if attendance_row is not None and attendance_row.status
                else plan_row.status
                if plan_row is not None
                else None
            )
            day_status_metrics = calculate_day_status_metrics(employment, effective_status)
            worked = (
                _stored_metrics(stored.get((day, DailyMetricSource.ATTENDANCE)), employment)
                if use_persisted
                else calculate_daily_metrics(employment, day, intervals)
            )
            planned = (
                _stored_metrics(stored.get((day, DailyMetricSource.SHIFT_PLAN)), employment)
                if use_persisted
                else calculate_daily_metrics(employment, day, planned_intervals)
            )
            if worked is not None:
                worked_values.append(worked)
            if planned is not None:
                planned_values.append(planned)
            status_values.append(day_status_metrics)
            worked_state = (
                "complete"
                if day_events and all(event.id in closed_event_ids for event in day_events)
                else "incomplete"
                if day_events
                else "empty"
            )
            days.append(
                DaySummary(
                    day,
                    attendance_row,
                    plan_row,
                    effective_status,
                    worked,
                    planned,
                    worked_state,
                    "complete" if planned and planned.total.minutes else "empty",
                    day_status_metrics,
                )
            )
        result[employment.id] = MonthSummary(
            days,
            {
                key: _sum(worked_values, key)
                for key in ("total", "afternoon", "night", "weekend", "public_holiday")
            }
            if worked_values
            else None,
            {
                key: _sum(planned_values, key)
                for key in ("total", "afternoon", "night", "weekend", "public_holiday")
            }
            if planned_values
            else None,
            {key: _sum_status(status_values, key) for key in STATUS_METRIC_KEYS},
        )
    return result


def build_month_summary(
    db: Session,
    *,
    employment: Employment,
    year: int,
    month: int,
    use_persisted: bool = True,
) -> MonthSummary:
    return build_month_summaries(
        db,
        employments=[employment],
        year=year,
        month=month,
        use_persisted=use_persisted,
    )[employment.id]


def is_czech_holiday(day: date) -> bool:
    return is_czech_public_holiday(day)
