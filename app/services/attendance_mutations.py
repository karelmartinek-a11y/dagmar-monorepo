"""Shared validation and impact detection for attendance-event mutations."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Attendance, AttendanceEvent, AttendanceEventType, ShiftPlan
from app.services.prague_time import prague_now
from app.services.time_intervals import WorkInterval, pair_events, split_by_day

IntervalSignature = tuple[datetime, datetime]


def interval_signatures(events: list[AttendanceEvent]) -> set[IntervalSignature]:
    return {(interval.start, interval.end) for interval in pair_events(events)}


def has_strict_event_sequence(events: list[AttendanceEvent]) -> bool:
    """Validate alternating write types and same-day closed pairs."""
    ordered = sorted(events, key=lambda item: (prague_now(item.occurred_at), item.id))
    alternates = all(
        event.event_type == (AttendanceEventType.IN if index % 2 == 0 else AttendanceEventType.OUT)
        for index, event in enumerate(ordered)
    )
    same_day_pairs = all(
        prague_now(ordered[index].occurred_at).date()
        == prague_now(ordered[index + 1].occurred_at).date()
        for index in range(0, len(ordered) - 1, 2)
    )
    return alternates and same_day_pairs


def changed_event_days(
    before: set[IntervalSignature],
    after: set[IntervalSignature],
    *,
    timestamps: tuple[datetime, ...] = (),
) -> set[date]:
    days = {prague_now(value).date() for value in timestamps}
    for start, end in before.symmetric_difference(after):
        days.update(day for day, _part in split_by_day(WorkInterval(start, end)))
    return days


def months_for_days(days: set[date]) -> set[tuple[int, int]]:
    return {(day.year, day.month) for day in days}


def ensure_days_have_no_status(
    db: Session,
    *,
    employment_id: int,
    days: set[date],
) -> None:
    if not days:
        return
    attendance_status = db.execute(
        select(Attendance.id).where(
            Attendance.employment_id == employment_id,
            Attendance.date.in_(days),
            Attendance.status.is_not(None),
        )
    ).first()
    plan_status = db.execute(
        select(ShiftPlan.id).where(
            ShiftPlan.employment_id == employment_id,
            ShiftPlan.date.in_(days),
            ShiftPlan.status.is_not(None),
        )
    ).first()
    if attendance_status or plan_status:
        raise ValueError("attendance_day_status_conflict")


def days_between(start: date, end: date) -> set[date]:
    return {start + timedelta(days=offset) for offset in range((end - start).days + 1)}
