from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta

from app.db.models import AttendanceEvent, ShiftPlan
from app.services.prague_time import PRAGUE_TIMEZONE, prague_now


@dataclass(frozen=True)
class WorkInterval:
    start: datetime
    end: datetime

    @property
    def minutes(self) -> int:
        return int((self.end - self.start).total_seconds() // 60)


def shift_plan_interval(plan: ShiftPlan) -> WorkInterval | None:
    """Convert one stored same-day shift into its canonical interval."""
    if not plan.arrival_time or not plan.departure_time:
        return None
    start_hour, start_minute = (int(value) for value in plan.arrival_time.split(":"))
    end_hour, end_minute = (int(value) for value in plan.departure_time.split(":"))
    start = datetime.combine(plan.date, datetime.min.time(), tzinfo=PRAGUE_TIMEZONE) + timedelta(
        hours=start_hour, minutes=start_minute
    )
    end = datetime.combine(plan.date, datetime.min.time(), tzinfo=PRAGUE_TIMEZONE) + timedelta(
        hours=end_hour, minutes=end_minute
    )
    if end <= start:
        return None
    return WorkInterval(start, end)


def shift_plan_intervals(plans: list[ShiftPlan]) -> list[WorkInterval]:
    return [interval for plan in plans if (interval := shift_plan_interval(plan)) is not None]


def shift_plan_months(plan: ShiftPlan | None) -> set[tuple[int, int]]:
    if plan is None:
        return set()
    return {(plan.date.year, plan.date.month)}


def shift_plan_days(plan: ShiftPlan | None) -> set[date]:
    if plan is None:
        return set()
    return {plan.date}


def shift_plans_overlap(left: ShiftPlan | None, right: ShiftPlan | None) -> bool:
    left_interval = shift_plan_interval(left) if left is not None else None
    right_interval = shift_plan_interval(right) if right is not None else None
    return bool(
        left_interval
        and right_interval
        and left_interval.start < right_interval.end
        and right_interval.start < left_interval.end
    )


def ordered_events(events: list[AttendanceEvent]) -> list[AttendanceEvent]:
    return sorted(events, key=lambda event: (prague_now(event.occurred_at), event.id))


def pair_event_rows(events: list[AttendanceEvent]) -> list[tuple[AttendanceEvent, AttendanceEvent]]:
    """Pair stored times independently inside each local calendar day.

    Each local day starts its own pairing at the first stored time, so an old
    orphan cannot shift every later interval. An odd final time is incomplete
    and never pairs with another day.
    """
    ordered = ordered_events(events)
    pairs: list[tuple[AttendanceEvent, AttendanceEvent]] = []
    by_day: dict[date, list[AttendanceEvent]] = {}
    for event in ordered:
        by_day.setdefault(prague_now(event.occurred_at).date(), []).append(event)

    for day_events in by_day.values():
        closed_count = len(day_events) - (len(day_events) % 2)
        for index in range(0, closed_count, 2):
            start, end = day_events[index : index + 2]
            start_at = prague_now(start.occurred_at)
            end_at = prague_now(end.occurred_at)
            if timedelta(0) < end_at - start_at < timedelta(days=1):
                pairs.append((start, end))
    return pairs


def paired_event_ids(events: list[AttendanceEvent]) -> set[int]:
    """Return IDs of events that belong to a closed interval."""
    return {event.id for pair in pair_event_rows(events) for event in pair}


def pair_events(events: list[AttendanceEvent]) -> list[WorkInterval]:
    """Build closed intervals from consecutive chronological stored times."""
    return [
        WorkInterval(start=prague_now(start.occurred_at), end=prague_now(end.occurred_at))
        for start, end in pair_event_rows(events)
    ]


def split_by_day(interval: WorkInterval) -> list[tuple[date, WorkInterval]]:
    result: list[tuple[date, WorkInterval]] = []
    cursor = interval.start
    while cursor.date() < interval.end.date():
        boundary = datetime.combine(
            cursor.date() + timedelta(days=1), datetime.min.time(), tzinfo=PRAGUE_TIMEZONE
        )
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


def automatic_break_events(start: datetime, end: datetime) -> list[datetime]:
    """Return the two chronological boundary times for every inserted pause."""
    segments, breaks = break_segments(int((end - start).total_seconds() // 60))
    if breaks == 0:
        return []
    result: list[datetime] = []
    cursor = start
    for segment in segments[:-1]:
        cursor += timedelta(minutes=segment)
        result.append(cursor)
        cursor += timedelta(minutes=30)
        result.append(cursor)
    return result


def missing_break_event_groups(
    intervals: list[WorkInterval],
    *,
    range_start: datetime,
    range_end: datetime,
) -> list[list[datetime]]:
    """Return missing pause boundaries while crediting already recorded pause time."""
    ordered = sorted(intervals, key=lambda item: (item.start, item.end))
    sessions: list[list[WorkInterval]] = []
    for interval in ordered:
        if not sessions or interval.start - sessions[-1][-1].end >= timedelta(minutes=30):
            sessions.append([interval])
        else:
            sessions[-1].append(interval)

    additions: list[list[datetime]] = []
    for session in sessions:
        session_start = session[0].start
        session_end = session[-1].end
        if session_end <= range_start or session_start >= range_end:
            continue
        gross_minutes = int((session_end - session_start).total_seconds() // 60)
        _segments, required_breaks = break_segments(gross_minutes)
        existing_break_minutes = sum(
            max(0, int((right.start - left.end).total_seconds() // 60))
            for left, right in zip(session, session[1:], strict=False)
        )
        missing_minutes = max(0, required_breaks * 30 - existing_break_minutes)
        if missing_minutes == 0:
            continue

        session_additions: list[datetime] = []
        remaining = missing_minutes
        for break_index in range(required_breaks):
            duration = min(30, remaining)
            if duration <= 0:
                break
            target = session_start + timedelta(minutes=360 * (break_index + 1))
            placement: datetime | None = None
            for interval in session:
                earliest = interval.start + timedelta(minutes=1)
                latest = interval.end - timedelta(minutes=duration + 1)
                if earliest <= latest:
                    placement = min(max(target, earliest), latest)
                    if earliest <= target <= latest:
                        break
            if placement is None:
                break
            session_additions.extend([placement, placement + timedelta(minutes=duration)])
            remaining -= duration
        if remaining == 0:
            additions.append(session_additions)
    return additions
