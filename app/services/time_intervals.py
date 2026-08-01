from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta

from app.db.models import AttendanceEvent, AttendanceEventType
from app.services.prague_time import PRAGUE_TIMEZONE, prague_now


@dataclass(frozen=True)
class WorkInterval:
    start: datetime
    end: datetime

    @property
    def minutes(self) -> int:
        return int((self.end - self.start).total_seconds() // 60)


def ordered_events(events: list[AttendanceEvent]) -> list[AttendanceEvent]:
    return sorted(events, key=lambda event: (prague_now(event.occurred_at), event.id))


def pair_events(events: list[AttendanceEvent]) -> list[WorkInterval]:
    """Build closed work intervals without failing on incomplete history.

    Historical attendance can contain an open IN or an orphan OUT, especially
    for data converted from the pre-event schema. Those events remain visible
    to callers, while only chronologically valid IN/OUT pairs contribute to
    metrics. New event writes still enforce strict alternation at the API
    boundary.
    """
    ordered = ordered_events(events)
    intervals: list[WorkInterval] = []
    opened: AttendanceEvent | None = None
    for event in ordered:
        if event.event_type == AttendanceEventType.IN:
            # A second IN means the previous historical interval was never
            # closed. Start the next usable interval instead of failing the
            # whole month response.
            opened = event
            continue
        if opened is None:
            # Keep an orphan OUT visible, but it cannot form a work interval.
            continue
        start = prague_now(opened.occurred_at)
        end = prague_now(event.occurred_at)
        if end <= start:
            opened = None
            continue
        intervals.append(WorkInterval(start=start, end=end))
        opened = None
    return intervals


def split_by_day(interval: WorkInterval) -> list[tuple[date, WorkInterval]]:
    result: list[tuple[date, WorkInterval]] = []
    cursor = interval.start
    while cursor.date() < interval.end.date():
        boundary = datetime.combine(cursor.date() + timedelta(days=1), datetime.min.time(), tzinfo=PRAGUE_TIMEZONE)
        result.append((cursor.date(), WorkInterval(cursor, boundary)))
        cursor = boundary
    result.append((cursor.date(), WorkInterval(cursor, interval.end)))
    return [(day, item) for day, item in result if item.end > item.start]


def overlap_minutes(interval: WorkInterval, start: datetime, end: datetime) -> int:
    left = max(interval.start, start)
    right = min(interval.end, end)
    return max(0, int((right - left).total_seconds() // 60))


def break_segments(duration_minutes: int) -> tuple[list[int], int]:
    if duration_minutes <= 360:
        return [duration_minutes], 0
    breaks = 0
    while True:
        work_minutes = duration_minutes - breaks * 30
        if work_minutes >= breaks + 1 and work_minutes <= (breaks + 1) * 360:
            break
        breaks += 1
    remaining_work = work_minutes
    remaining_segments = breaks + 1
    segments: list[int] = []
    while remaining_segments:
        segment = min(360, remaining_work - (remaining_segments - 1))
        segments.append(segment)
        remaining_work -= segment
        remaining_segments -= 1
    return segments, breaks


def automatic_break_events(start: datetime, end: datetime) -> list[tuple[datetime, str]]:
    """Return inserted OUT/IN pairs for a newly closed interval."""
    segments, breaks = break_segments(int((end - start).total_seconds() // 60))
    if breaks == 0:
        return []
    result: list[tuple[datetime, str]] = []
    cursor = start
    for segment in segments[:-1]:
        cursor += timedelta(minutes=segment)
        result.append((cursor, "OUT"))
        cursor += timedelta(minutes=30)
        result.append((cursor, "IN"))
    return result
