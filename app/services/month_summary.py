from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import AppSettings, Attendance, Employment, ShiftPlan
from app.services.day_status import (
    DAY_STATUS_HOLIDAY,
    DAY_STATUS_PARAGRAPH,
    DAY_STATUS_SICKNESS,
)
from app.services.prague_time import prague_today

MINUTES_PER_DAY = 24 * 60
MINUTES_PER_HOUR = 60
DEFAULT_HPP_DAY_MINUTES = 8 * MINUTES_PER_HOUR


@dataclass(frozen=True)
class DaySummary:
    date: date
    attendance: Attendance | None
    plan: ShiftPlan | None
    effective_status: str | None
    worked_minutes: int
    worked_state: str
    planned_minutes: int
    planned_state: str
    afternoon_minutes: int
    weekend_holiday_minutes: int
    holiday_minutes: int
    weekend_minutes: int
    paragraph_minutes: int
    vacation_minutes: int
    sickness_days: int
    vacation_days: int
    fund_minutes: int


@dataclass(frozen=True)
class MonthSummary:
    day_summaries: list[DaySummary]
    work_fund_minutes: int
    work_fund_source: str
    planned_minutes: int
    worked_minutes: int
    vacation_minutes: int
    vacation_days: int
    sickness_days: int
    paragraph_minutes: int
    afternoon_minutes: int
    weekend_holiday_minutes: int
    plan_balance_minutes: int
    worked_balance_minutes: int | None
    elapsed_fund_minutes: int | None
    worked_balance_mode: str | None


def _month_range(year: int, month: int) -> tuple[date, date]:
    start = date(year, month, 1)
    end = date(year + (month // 12), (month % 12) + 1, 1)
    return start, end


def _load_afternoon_cutoff_minutes(db: Session) -> int:
    row = db.get(AppSettings, 1)
    if row is None:
        return 17 * MINUTES_PER_HOUR
    return row.afternoon_cutoff_minutes


def _easter_sunday(year: int) -> date:
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    offset = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * offset) // 451
    month = (h + offset - 7 * m + 114) // 31
    day = ((h + offset - 7 * m + 114) % 31) + 1
    return date(year, month, day)


def is_czech_holiday(value: date) -> bool:
    fixed = {
        (1, 1),
        (5, 1),
        (5, 8),
        (7, 5),
        (7, 6),
        (9, 28),
        (10, 28),
        (11, 17),
        (12, 24),
        (12, 25),
        (12, 26),
    }
    if (value.month, value.day) in fixed:
        return True
    easter_sunday = _easter_sunday(value.year)
    return value in {easter_sunday - timedelta(days=2), easter_sunday + timedelta(days=1)}


def _is_weekend(value: date) -> bool:
    return value.weekday() >= 5


def _minutes(value: str | None) -> int | None:
    if value is None:
        return None
    hour, minute = value.split(":")
    return int(hour) * MINUTES_PER_HOUR + int(minute)


def _intervals_for_row(day: date, start: str | None, end: str | None) -> list[tuple[datetime, datetime]]:
    start_minutes = _minutes(start)
    end_minutes = _minutes(end)
    if start_minutes is None or end_minutes is None:
        return []
    start_dt = datetime.combine(day, time.min) + timedelta(minutes=start_minutes)
    end_dt = datetime.combine(day, time.min) + timedelta(minutes=end_minutes)
    if end_dt <= start_dt:
        end_dt += timedelta(days=1)
    return [(start_dt, end_dt)]


def _attendance_intervals(row: Attendance | None) -> list[tuple[datetime, datetime]]:
    if row is None:
        return []
    return [
        *_intervals_for_row(row.date, row.arrival_time, row.departure_time),
        *_intervals_for_row(row.date, row.arrival_time_2, row.departure_time_2),
    ]


def _plan_intervals(row: ShiftPlan | None) -> list[tuple[datetime, datetime]]:
    if row is None:
        return []
    return _intervals_for_row(row.date, row.arrival_time, row.departure_time)


def _slice_interval(interval: tuple[datetime, datetime], target_day: date) -> int:
    day_start = datetime.combine(target_day, time.min)
    day_end = day_start + timedelta(days=1)
    start = max(interval[0], day_start)
    end = min(interval[1], day_end)
    if end <= start:
        return 0
    return int((end - start).total_seconds() // 60)


def _slice_after_cutoff(interval: tuple[datetime, datetime], target_day: date, cutoff_minutes: int) -> int:
    start = datetime.combine(target_day, time.min) + timedelta(minutes=cutoff_minutes)
    end = datetime.combine(target_day, time.min) + timedelta(days=1)
    overlap_start = max(interval[0], start)
    overlap_end = min(interval[1], end)
    if overlap_end <= overlap_start:
        return 0
    return int((overlap_end - overlap_start).total_seconds() // 60)


def _attendance_state(row: Attendance | None) -> str:
    if row is None:
        return "empty"
    pairs = [
        (row.arrival_time, row.departure_time),
        (row.arrival_time_2, row.departure_time_2),
    ]
    if any((start and not end) or (end and not start) for start, end in pairs):
        return "incomplete"
    if any(start and end for start, end in pairs):
        return "complete"
    return "empty"


def _plan_state(row: ShiftPlan | None) -> str:
    if row is None:
        return "empty"
    if (row.arrival_time and not row.departure_time) or (row.departure_time and not row.arrival_time):
        return "incomplete"
    if row.arrival_time and row.departure_time:
        return "complete"
    return "empty"


def _effective_status(attendance: Attendance | None, plan: ShiftPlan | None) -> str | None:
    if attendance is not None and attendance.status:
        return attendance.status
    if plan is not None and plan.status:
        return plan.status
    return None


def _fund_minutes_for_day(
    *,
    employment: Employment,
    day: date,
    plan_minutes: int,
) -> tuple[int, str]:
    if day < employment.start_date or (employment.end_date is not None and day > employment.end_date):
        return 0, "outside_period"
    if is_czech_holiday(day) or _is_weekend(day):
        return 0, "holiday_or_weekend"
    if employment.employment_type == "HPP":
        return DEFAULT_HPP_DAY_MINUTES, "calendar_hpp"
    return plan_minutes, "planned_dpp_dpc"


def build_month_summary(db: Session, *, employment: Employment, year: int, month: int) -> MonthSummary:
    start, end = _month_range(year, month)
    cutoff_minutes = _load_afternoon_cutoff_minutes(db)
    range_start = start - timedelta(days=1)
    range_end = end + timedelta(days=1)

    attendance_rows = db.execute(
        select(Attendance)
        .where(Attendance.employment_id == employment.id)
        .where(Attendance.date >= range_start)
        .where(Attendance.date < range_end)
    ).scalars().all()
    plan_rows = db.execute(
        select(ShiftPlan)
        .where(ShiftPlan.employment_id == employment.id)
        .where(ShiftPlan.date >= range_start)
        .where(ShiftPlan.date < range_end)
    ).scalars().all()
    attendance_by_date = {row.date: row for row in attendance_rows}
    plan_by_date = {row.date: row for row in plan_rows}

    day_summaries: list[DaySummary] = []
    fund_source = "calendar_hpp"
    for offset in range((end - start).days):
        current = start + timedelta(days=offset)
        attendance = attendance_by_date.get(current)
        plan = plan_by_date.get(current)
        attendance_intervals = []
        plan_intervals = []
        for row in attendance_rows:
            attendance_intervals.extend(_attendance_intervals(row))
        for row in plan_rows:
            plan_intervals.extend(_plan_intervals(row))
        worked_minutes = sum(_slice_interval(interval, current) for interval in attendance_intervals)
        planned_minutes = sum(_slice_interval(interval, current) for interval in plan_intervals)
        afternoon_minutes = sum(_slice_after_cutoff(interval, current, cutoff_minutes) for interval in attendance_intervals)
        holiday = is_czech_holiday(current)
        weekend = _is_weekend(current)
        weekend_holiday_minutes = worked_minutes if (holiday or weekend) else 0
        holiday_minutes = worked_minutes if holiday else 0
        weekend_minutes = worked_minutes if weekend else 0
        effective_status = _effective_status(attendance, plan)
        vacation_minutes = planned_minutes if effective_status == DAY_STATUS_HOLIDAY else 0
        fund_minutes, current_fund_source = _fund_minutes_for_day(
            employment=employment,
            day=current,
            plan_minutes=planned_minutes,
        )
        if current_fund_source == "planned_dpp_dpc":
            fund_source = current_fund_source
        day_summaries.append(
            DaySummary(
                date=current,
                attendance=attendance,
                plan=plan,
                effective_status=effective_status,
                worked_minutes=worked_minutes,
                worked_state=_attendance_state(attendance),
                planned_minutes=planned_minutes,
                planned_state=_plan_state(plan),
                afternoon_minutes=afternoon_minutes,
                weekend_holiday_minutes=weekend_holiday_minutes,
                holiday_minutes=holiday_minutes,
                weekend_minutes=weekend_minutes,
                paragraph_minutes=fund_minutes if effective_status == DAY_STATUS_PARAGRAPH else 0,
                vacation_minutes=vacation_minutes,
                sickness_days=1 if effective_status == DAY_STATUS_SICKNESS else 0,
                vacation_days=1 if effective_status == DAY_STATUS_HOLIDAY else 0,
                fund_minutes=fund_minutes,
            )
        )

    work_fund_minutes = sum(item.fund_minutes for item in day_summaries)
    planned_minutes = sum(item.planned_minutes for item in day_summaries)
    worked_minutes = sum(item.worked_minutes for item in day_summaries)
    vacation_minutes = sum(item.vacation_minutes for item in day_summaries)
    sickness_days = sum(item.sickness_days for item in day_summaries)
    paragraph_minutes = sum(item.paragraph_minutes for item in day_summaries)
    afternoon_minutes = sum(item.afternoon_minutes for item in day_summaries)
    weekend_holiday_minutes = sum(item.weekend_holiday_minutes for item in day_summaries)
    plan_balance_minutes = planned_minutes - work_fund_minutes

    today = prague_today()
    elapsed_fund_minutes: int | None = None
    worked_balance_minutes: int | None = None
    worked_balance_mode: str | None = None
    if end <= today.replace(day=1):
        elapsed_fund_minutes = work_fund_minutes
        worked_balance_minutes = worked_minutes - work_fund_minutes
        worked_balance_mode = "past"
    elif start <= today < end:
        cutoff_day = today - timedelta(days=1)
        elapsed_fund_minutes = sum(item.fund_minutes for item in day_summaries if item.date <= cutoff_day)
        worked_so_far = sum(item.worked_minutes for item in day_summaries if item.date <= cutoff_day)
        worked_balance_minutes = worked_so_far - elapsed_fund_minutes
        worked_balance_mode = "current"

    return MonthSummary(
        day_summaries=day_summaries,
        work_fund_minutes=work_fund_minutes,
        work_fund_source=fund_source,
        planned_minutes=planned_minutes,
        worked_minutes=worked_minutes,
        vacation_minutes=vacation_minutes,
        vacation_days=sum(item.vacation_days for item in day_summaries),
        sickness_days=sickness_days,
        paragraph_minutes=paragraph_minutes,
        afternoon_minutes=afternoon_minutes,
        weekend_holiday_minutes=weekend_holiday_minutes,
        plan_balance_minutes=plan_balance_minutes,
        worked_balance_minutes=worked_balance_minutes,
        elapsed_fund_minutes=elapsed_fund_minutes,
        worked_balance_mode=worked_balance_mode,
    )
