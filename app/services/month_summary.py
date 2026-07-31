"""Compatibility facade over the single backend time-metrics engine."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Attendance, AttendanceEvent, Employment, ShiftPlan
from app.services.czech_holidays import is_czech_public_holiday
from app.services.prague_time import PRAGUE_TIMEZONE, prague_now
from app.services.time_intervals import WorkInterval, pair_events
from app.services.time_metrics import (
    DailyMetrics,
    MetricValue,
    calculate_daily_metrics,
    round_minutes_to_tenths,
)


def hours_from_minutes(minutes: int) -> float:
    return round_minutes_to_tenths(minutes) / 10


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
    return MetricValue(sum(item.minutes for item in items), sum(item.tenths for item in items)) if items else None


def _plan_interval(day: date, plan: ShiftPlan | None) -> list[WorkInterval]:
    if plan is None or not plan.arrival_time or not plan.departure_time:
        return []
    h1, m1 = (int(value) for value in plan.arrival_time.split(":"))
    h2, m2 = (int(value) for value in plan.departure_time.split(":"))
    start = datetime.combine(day, datetime.min.time(), tzinfo=PRAGUE_TIMEZONE) + timedelta(hours=h1, minutes=m1)
    end = datetime.combine(day, datetime.min.time(), tzinfo=PRAGUE_TIMEZONE) + timedelta(hours=h2, minutes=m2)
    if end <= start:
        end += timedelta(days=1)
    return [WorkInterval(start, end)]


def build_month_summaries(db: Session, *, employments: list[Employment], year: int, month: int) -> dict[int, MonthSummary]:
    start, end = _month_range(year, month)
    result: dict[int, MonthSummary] = {}
    for employment in employments:
        events = list(db.execute(select(AttendanceEvent).where(AttendanceEvent.employment_id == employment.id).order_by(AttendanceEvent.occurred_at, AttendanceEvent.id)).scalars())
        intervals = pair_events(events) if events else []
        attendance = {row.date: row for row in db.execute(select(Attendance).where(Attendance.employment_id == employment.id, Attendance.date >= start, Attendance.date < end)).scalars()}
        plans = {row.date: row for row in db.execute(select(ShiftPlan).where(ShiftPlan.employment_id == employment.id, ShiftPlan.date >= start, ShiftPlan.date < end)).scalars()}
        days: list[DaySummary] = []
        worked_values: list[DailyMetrics] = []
        planned_values: list[DailyMetrics] = []
        for offset in range((end - start).days):
            day = start + timedelta(days=offset)
            worked = calculate_daily_metrics(employment, day, intervals)
            planned = calculate_daily_metrics(employment, day, _plan_interval(day, plans.get(day)))
            if worked is not None:
                worked_values.append(worked)
            if planned is not None:
                planned_values.append(planned)
            day_events = [event for event in events if prague_now(event.occurred_at).date() == day]
            attendance_row = attendance.get(day)
            plan_row = plans.get(day)
            effective_status = attendance_row.status if attendance_row is not None else plan_row.status if plan_row is not None else None
            days.append(DaySummary(day, attendance_row, plan_row, effective_status, worked, planned, "complete" if any(event.event_type.value == "OUT" for event in day_events) else "incomplete" if day_events else "empty", "complete" if planned and planned.total.minutes else "empty"))
        result[employment.id] = MonthSummary(days, {key: _sum(worked_values, key) for key in ("total", "afternoon", "night", "weekend", "public_holiday")} if worked_values else None, {key: _sum(planned_values, key) for key in ("total", "afternoon", "night", "weekend", "public_holiday")} if planned_values else None)
    return result


def build_month_summary(db: Session, *, employment: Employment, year: int, month: int) -> MonthSummary:
    return build_month_summaries(db, employments=[employment], year=year, month=month)[employment.id]


def is_czech_holiday(day: date) -> bool:
    return is_czech_public_holiday(day)
