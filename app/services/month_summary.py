from __future__ import annotations

from collections.abc import Sequence
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
    worked_hours: float
    worked_state: str
    planned_minutes: int
    planned_hours: float
    planned_state: str
    afternoon_minutes: int
    afternoon_hours: float
    weekend_holiday_minutes: int
    weekend_holiday_hours: float
    holiday_minutes: int
    holiday_hours: float
    weekend_minutes: int
    weekend_hours: float
    daytime_minutes: int
    daytime_hours: float
    night_minutes: int
    night_hours: float
    pause_minutes: int
    pause_hours: float
    paragraph_minutes: int
    paragraph_hours: float
    vacation_minutes: int
    vacation_hours: float
    accounted_minutes: int
    accounted_hours: float
    sickness_days: int
    vacation_days: int
    fund_minutes: int
    fund_hours: float


@dataclass(frozen=True)
class MonthSummary:
    day_summaries: list[DaySummary]
    work_fund_minutes: int
    work_fund_hours: float
    work_fund_source: str
    planned_minutes: int
    planned_hours: float
    worked_minutes: int
    worked_hours: float
    vacation_minutes: int
    vacation_hours: float
    vacation_days: int
    sickness_days: int
    paragraph_minutes: int
    paragraph_hours: float
    afternoon_minutes: int
    afternoon_hours: float
    weekend_holiday_minutes: int
    weekend_holiday_hours: float
    holiday_minutes: int
    holiday_hours: float
    weekend_minutes: int
    weekend_hours: float
    daytime_minutes: int
    daytime_hours: float
    night_minutes: int
    night_hours: float
    pause_minutes: int
    pause_hours: float
    accounted_minutes: int
    accounted_hours: float
    accounted_balance_minutes: int
    accounted_balance_hours: float
    plan_balance_minutes: int
    plan_balance_hours: float
    worked_balance_minutes: int | None
    worked_balance_hours: float | None
    elapsed_fund_minutes: int | None
    elapsed_fund_hours: float | None
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


def _slice_night(interval: tuple[datetime, datetime], target_day: date) -> int:
    day_start = datetime.combine(target_day, time.min)
    return _slice_interval((interval[0], interval[1]), target_day) - _slice_overlap(
        interval,
        day_start + timedelta(hours=6),
        day_start + timedelta(hours=22),
    )


def _slice_overlap(interval: tuple[datetime, datetime], start: datetime, end: datetime) -> int:
    overlap_start = max(interval[0], start)
    overlap_end = min(interval[1], end)
    if overlap_end <= overlap_start:
        return 0
    return int((overlap_end - overlap_start).total_seconds() // 60)


def _pause_intervals(row: Attendance | None) -> list[tuple[datetime, datetime]]:
    if row is None or row.departure_time is None or row.arrival_time_2 is None:
        return []
    start_minutes = _minutes(row.departure_time)
    end_minutes = _minutes(row.arrival_time_2)
    if start_minutes is None or end_minutes is None:
        return []
    start_dt = datetime.combine(row.date, time.min) + timedelta(minutes=start_minutes)
    end_dt = datetime.combine(row.date, time.min) + timedelta(minutes=end_minutes)
    if end_dt < start_dt:
        end_dt += timedelta(days=1)
    return [(start_dt, end_dt)]


def hours_from_minutes(minutes: int) -> float:
    """Convert non-negative daily minutes to authoritative tenths of an hour."""
    if minutes < 0:
        raise ValueError("daily minutes must not be negative")
    return (minutes // 6) / 10


def _sum_daily_hours(items: list[DaySummary], field: str) -> float:
    return sum(int(getattr(item, field)) // 6 for item in items) / 10


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


def _calculate_month_summary(
    *,
    employment: Employment,
    year: int,
    month: int,
    cutoff_minutes: int,
    attendance_rows: list[Attendance],
    plan_rows: list[ShiftPlan],
) -> MonthSummary:
    start, end = _month_range(year, month)
    attendance_by_date = {row.date: row for row in attendance_rows}
    plan_by_date = {row.date: row for row in plan_rows}
    attendance_intervals = [interval for row in attendance_rows for interval in _attendance_intervals(row)]
    plan_intervals = [interval for row in plan_rows for interval in _plan_intervals(row)]
    pause_intervals = [interval for row in attendance_rows for interval in _pause_intervals(row)]

    day_summaries: list[DaySummary] = []
    fund_source = "calendar_hpp"
    for offset in range((end - start).days):
        current = start + timedelta(days=offset)
        attendance = attendance_by_date.get(current)
        plan = plan_by_date.get(current)
        worked_minutes = sum(_slice_interval(interval, current) for interval in attendance_intervals)
        planned_minutes = sum(_slice_interval(interval, current) for interval in plan_intervals)
        afternoon_minutes = sum(_slice_after_cutoff(interval, current, cutoff_minutes) for interval in attendance_intervals)
        night_minutes = sum(_slice_night(interval, current) for interval in attendance_intervals)
        pause_minutes = sum(_slice_interval(interval, current) for interval in pause_intervals)
        holiday = is_czech_holiday(current)
        weekend = _is_weekend(current)
        weekend_holiday_minutes = worked_minutes if (holiday or weekend) else 0
        holiday_minutes = worked_minutes if holiday else 0
        weekend_minutes = worked_minutes if weekend else 0
        daytime_minutes = worked_minutes if not holiday and not weekend else 0
        effective_status = _effective_status(attendance, plan)
        vacation_minutes = planned_minutes if effective_status == DAY_STATUS_HOLIDAY else 0
        fund_minutes, current_fund_source = _fund_minutes_for_day(
            employment=employment,
            day=current,
            plan_minutes=planned_minutes,
        )
        if current_fund_source == "planned_dpp_dpc":
            fund_source = current_fund_source
        paragraph_minutes = fund_minutes if effective_status == DAY_STATUS_PARAGRAPH else 0
        accounted_minutes = worked_minutes + vacation_minutes
        worked_state = _attendance_state(attendance)
        if worked_state == "empty" and worked_minutes > 0:
            worked_state = "complete"
        planned_state = _plan_state(plan)
        if planned_state == "empty" and planned_minutes > 0:
            planned_state = "complete"
        day_summaries.append(
            DaySummary(
                date=current,
                attendance=attendance,
                plan=plan,
                effective_status=effective_status,
                worked_minutes=worked_minutes,
                worked_hours=hours_from_minutes(worked_minutes),
                worked_state=worked_state,
                planned_minutes=planned_minutes,
                planned_hours=hours_from_minutes(planned_minutes),
                planned_state=planned_state,
                afternoon_minutes=afternoon_minutes,
                afternoon_hours=hours_from_minutes(afternoon_minutes),
                weekend_holiday_minutes=weekend_holiday_minutes,
                weekend_holiday_hours=hours_from_minutes(weekend_holiday_minutes),
                holiday_minutes=holiday_minutes,
                holiday_hours=hours_from_minutes(holiday_minutes),
                weekend_minutes=weekend_minutes,
                weekend_hours=hours_from_minutes(weekend_minutes),
                daytime_minutes=daytime_minutes,
                daytime_hours=hours_from_minutes(daytime_minutes),
                night_minutes=night_minutes,
                night_hours=hours_from_minutes(night_minutes),
                pause_minutes=pause_minutes,
                pause_hours=hours_from_minutes(pause_minutes),
                paragraph_minutes=paragraph_minutes,
                paragraph_hours=hours_from_minutes(paragraph_minutes),
                vacation_minutes=vacation_minutes,
                vacation_hours=hours_from_minutes(vacation_minutes),
                accounted_minutes=accounted_minutes,
                accounted_hours=hours_from_minutes(accounted_minutes),
                sickness_days=1 if effective_status == DAY_STATUS_SICKNESS else 0,
                vacation_days=1 if effective_status == DAY_STATUS_HOLIDAY else 0,
                fund_minutes=fund_minutes,
                fund_hours=hours_from_minutes(fund_minutes),
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
    holiday_minutes = sum(item.holiday_minutes for item in day_summaries)
    weekend_minutes = sum(item.weekend_minutes for item in day_summaries)
    daytime_minutes = sum(item.daytime_minutes for item in day_summaries)
    night_minutes = sum(item.night_minutes for item in day_summaries)
    pause_minutes = sum(item.pause_minutes for item in day_summaries)
    accounted_minutes = sum(item.accounted_minutes for item in day_summaries)
    work_fund_hours = _sum_daily_hours(day_summaries, "fund_minutes")
    planned_hours = _sum_daily_hours(day_summaries, "planned_minutes")
    worked_hours = _sum_daily_hours(day_summaries, "worked_minutes")
    vacation_hours = _sum_daily_hours(day_summaries, "vacation_minutes")
    paragraph_hours = _sum_daily_hours(day_summaries, "paragraph_minutes")
    afternoon_hours = _sum_daily_hours(day_summaries, "afternoon_minutes")
    weekend_holiday_hours = _sum_daily_hours(day_summaries, "weekend_holiday_minutes")
    holiday_hours = _sum_daily_hours(day_summaries, "holiday_minutes")
    weekend_hours = _sum_daily_hours(day_summaries, "weekend_minutes")
    daytime_hours = _sum_daily_hours(day_summaries, "daytime_minutes")
    night_hours = _sum_daily_hours(day_summaries, "night_minutes")
    pause_hours = _sum_daily_hours(day_summaries, "pause_minutes")
    accounted_hours = _sum_daily_hours(day_summaries, "accounted_minutes")
    accounted_balance_minutes = accounted_minutes - work_fund_minutes
    accounted_balance_hours = (
        int(round(accounted_hours * 10)) - int(round(work_fund_hours * 10))
    ) / 10
    plan_balance_minutes = planned_minutes - work_fund_minutes
    plan_balance_hours = (int(round(planned_hours * 10)) - int(round(work_fund_hours * 10))) / 10

    today = prague_today()
    elapsed_fund_minutes: int | None = None
    worked_balance_minutes: int | None = None
    worked_balance_hours: float | None = None
    worked_balance_mode: str | None = None
    elapsed_fund_hours: float | None = None
    if end <= today.replace(day=1):
        elapsed_fund_minutes = work_fund_minutes
        elapsed_fund_hours = work_fund_hours
        worked_balance_minutes = worked_minutes - work_fund_minutes
        worked_balance_hours = (int(round(worked_hours * 10)) - int(round(work_fund_hours * 10))) / 10
        worked_balance_mode = "past"
    elif start <= today < end:
        cutoff_day = today - timedelta(days=1)
        elapsed_fund_minutes = sum(item.fund_minutes for item in day_summaries if item.date <= cutoff_day)
        elapsed_fund_hours = sum(item.fund_minutes // 6 for item in day_summaries if item.date <= cutoff_day) / 10
        worked_so_far = sum(item.worked_minutes for item in day_summaries if item.date <= cutoff_day)
        worked_hours_so_far = sum(item.worked_minutes // 6 for item in day_summaries if item.date <= cutoff_day) / 10
        worked_balance_minutes = worked_so_far - elapsed_fund_minutes
        worked_balance_hours = (
            int(round(worked_hours_so_far * 10)) - int(round(elapsed_fund_hours * 10))
        ) / 10
        worked_balance_mode = "current"

    return MonthSummary(
        day_summaries=day_summaries,
        work_fund_minutes=work_fund_minutes,
        work_fund_hours=work_fund_hours,
        work_fund_source=fund_source,
        planned_minutes=planned_minutes,
        planned_hours=planned_hours,
        worked_minutes=worked_minutes,
        worked_hours=worked_hours,
        vacation_minutes=vacation_minutes,
        vacation_hours=vacation_hours,
        vacation_days=sum(item.vacation_days for item in day_summaries),
        sickness_days=sickness_days,
        paragraph_minutes=paragraph_minutes,
        paragraph_hours=paragraph_hours,
        afternoon_minutes=afternoon_minutes,
        afternoon_hours=afternoon_hours,
        weekend_holiday_minutes=weekend_holiday_minutes,
        weekend_holiday_hours=weekend_holiday_hours,
        holiday_minutes=holiday_minutes,
        holiday_hours=holiday_hours,
        weekend_minutes=weekend_minutes,
        weekend_hours=weekend_hours,
        daytime_minutes=daytime_minutes,
        daytime_hours=daytime_hours,
        night_minutes=night_minutes,
        night_hours=night_hours,
        pause_minutes=pause_minutes,
        pause_hours=pause_hours,
        accounted_minutes=accounted_minutes,
        accounted_hours=accounted_hours,
        accounted_balance_minutes=accounted_balance_minutes,
        accounted_balance_hours=accounted_balance_hours,
        plan_balance_minutes=plan_balance_minutes,
        plan_balance_hours=plan_balance_hours,
        worked_balance_minutes=worked_balance_minutes,
        worked_balance_hours=worked_balance_hours,
        elapsed_fund_minutes=elapsed_fund_minutes,
        elapsed_fund_hours=elapsed_fund_hours,
        worked_balance_mode=worked_balance_mode,
    )


def build_month_summaries(
    db: Session,
    *,
    employments: Sequence[Employment],
    year: int,
    month: int,
) -> dict[int, MonthSummary]:
    if not employments:
        return {}
    start, end = _month_range(year, month)
    employment_ids = [employment.id for employment in employments]
    range_start = start - timedelta(days=1)
    attendance_rows = db.execute(
        select(Attendance)
        .where(Attendance.employment_id.in_(employment_ids))
        .where(Attendance.date >= range_start)
        .where(Attendance.date < end)
    ).scalars().all()
    plan_rows = db.execute(
        select(ShiftPlan)
        .where(ShiftPlan.employment_id.in_(employment_ids))
        .where(ShiftPlan.date >= range_start)
        .where(ShiftPlan.date < end)
    ).scalars().all()
    attendance_by_employment: dict[int, list[Attendance]] = {employment_id: [] for employment_id in employment_ids}
    plan_by_employment: dict[int, list[ShiftPlan]] = {employment_id: [] for employment_id in employment_ids}
    for attendance_row in attendance_rows:
        attendance_by_employment[attendance_row.employment_id].append(attendance_row)
    for plan_row in plan_rows:
        plan_by_employment[plan_row.employment_id].append(plan_row)
    cutoff_minutes = _load_afternoon_cutoff_minutes(db)
    return {
        employment.id: _calculate_month_summary(
            employment=employment,
            year=year,
            month=month,
            cutoff_minutes=cutoff_minutes,
            attendance_rows=attendance_by_employment[employment.id],
            plan_rows=plan_by_employment[employment.id],
        )
        for employment in employments
    }


def build_month_summary(db: Session, *, employment: Employment, year: int, month: int) -> MonthSummary:
    return build_month_summaries(db, employments=[employment], year=year, month=month)[employment.id]
