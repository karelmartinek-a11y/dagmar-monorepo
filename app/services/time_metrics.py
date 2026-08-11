from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from app.db.models import Employment, EmploymentType
from app.services.czech_holidays import is_czech_public_holiday
from app.services.prague_time import PRAGUE_TIMEZONE
from app.services.time_intervals import WorkInterval, overlap_minutes, split_by_day


@dataclass(frozen=True)
class MetricValue:
    minutes: int
    tenths: int

    @property
    def hours(self) -> float:
        return self.tenths / 10


@dataclass(frozen=True)
class DailyMetrics:
    total: MetricValue
    afternoon: MetricValue | None
    night: MetricValue | None
    weekend: MetricValue | None
    public_holiday: MetricValue | None


def round_minutes_to_tenths(minutes: int) -> int:
    if minutes < 0:
        raise ValueError("minutes must be non-negative")
    return (minutes + 3) // 6


def metric_value(minutes: int) -> MetricValue:
    return MetricValue(minutes=minutes, tenths=round_minutes_to_tenths(minutes))


def empty_daily_metrics(employment: Employment) -> DailyMetrics | None:
    """Return backend-owned zero values for an hourly profile with no persisted facts."""
    if employment.employment_type == EmploymentType.TASK_SHIFT_BASED:
        return None
    zero = metric_value(0)
    return DailyMetrics(
        total=zero,
        afternoon=zero if employment.afternoon_hours_enabled else None,
        night=zero if employment.night_hours_enabled else None,
        weekend=zero if employment.weekend_hours_enabled else None,
        public_holiday=zero if employment.public_holiday_hours_enabled else None,
    )


def _window(day: date, start: int, end: int) -> tuple[datetime, datetime]:
    return (
        datetime.combine(day, time.min, tzinfo=PRAGUE_TIMEZONE) + timedelta(minutes=start),
        datetime.combine(day, time.min, tzinfo=PRAGUE_TIMEZONE) + timedelta(minutes=end),
    )


def calculate_daily_metrics(
    employment: Employment, day: date, intervals: list[WorkInterval]
) -> DailyMetrics | None:
    if employment.employment_type == EmploymentType.TASK_SHIFT_BASED:
        return None
    day_intervals = [
        part
        for interval in intervals
        for item_day, part in split_by_day(interval)
        if item_day == day
    ]
    total = sum(item.minutes for item in day_intervals)
    afternoon = (
        sum(
            overlap_minutes(item, *_window(day, employment.afternoon_start_minutes or 0, 22 * 60))
            for item in day_intervals
        )
        if employment.afternoon_hours_enabled
        else None
    )
    night = (
        sum(
            overlap_minutes(item, *_window(day, 0, 6 * 60))
            + overlap_minutes(item, *_window(day, 22 * 60, 24 * 60))
            for item in day_intervals
        )
        if employment.night_hours_enabled
        else None
    )
    weekend = (
        total
        if employment.weekend_hours_enabled and day.weekday() >= 5
        else 0
        if employment.weekend_hours_enabled
        else None
    )
    public_holiday = (
        total
        if employment.public_holiday_hours_enabled and is_czech_public_holiday(day)
        else 0
        if employment.public_holiday_hours_enabled
        else None
    )
    return DailyMetrics(
        metric_value(total),
        metric_value(afternoon) if afternoon is not None else None,
        metric_value(night) if night is not None else None,
        metric_value(weekend) if weekend is not None else None,
        metric_value(public_holiday) if public_holiday is not None else None,
    )


def monthly_sum(daily: list[DailyMetrics | None], field: str) -> MetricValue | None:
    values = [
        getattr(item, field)
        for item in daily
        if item is not None and getattr(item, field) is not None
    ]
    if not values:
        return None
    return MetricValue(
        sum(value.minutes for value in values), sum(value.tenths for value in values)
    )
