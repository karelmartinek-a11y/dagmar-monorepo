"""Canonical creation of attendance events and physical automatic breaks."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import AttendanceEvent, Employment
from app.services.prague_time import prague_now
from app.services.time_intervals import automatic_break_events


def add_closed_interval_with_breaks(
    db: Session,
    *,
    employment: Employment,
    started_at: datetime,
    ended_at: datetime,
) -> list[AttendanceEvent]:
    """Atomically add a closed interval and any configured physical break events."""
    start = prague_now(started_at)
    end = prague_now(ended_at)
    if end.date() != start.date():
        raise ValueError("Uzavřený pár průchodů musí zůstat ve stejném dni.")
    if end <= start:
        raise ValueError("Odchod musí následovat po příchodu.")
    additions = [
        AttendanceEvent(
            employment_id=employment.id,
            occurred_at=start,
        )
    ]
    if employment.automatic_breaks_enabled:
        additions.extend(
            AttendanceEvent(
                employment_id=employment.id,
                occurred_at=occurred_at,
            )
            for occurred_at in automatic_break_events(start, end)
        )
    additions.append(
        AttendanceEvent(
            employment_id=employment.id,
            occurred_at=end,
        )
    )
    db.add_all(additions)
    return additions


def add_event_with_breaks(
    db: Session, *, employment: Employment, event: AttendanceEvent
) -> list[AttendanceEvent]:
    existing = list(
        db.execute(
            select(AttendanceEvent)
            .where(AttendanceEvent.employment_id == employment.id)
            .order_by(AttendanceEvent.occurred_at, AttendanceEvent.id)
        ).scalars()
    )
    event_time = prague_now(event.occurred_at)
    same_day = [
        item for item in existing if prague_now(item.occurred_at).date() == event_time.date()
    ]
    ordered_day = sorted(
        [*same_day, event], key=lambda item: (prague_now(item.occurred_at), item.id or 0)
    )
    event_index = ordered_day.index(event)
    previous = ordered_day[event_index - 1] if event_index % 2 == 1 else None
    additions = [event]
    if (
        previous is not None
        and employment.automatic_breaks_enabled
    ):
        for occurred_at in automatic_break_events(
            prague_now(previous.occurred_at), prague_now(event.occurred_at)
        ):
            additions.append(
                AttendanceEvent(
                    employment_id=employment.id,
                    occurred_at=occurred_at,
                )
            )
    db.add_all(additions)
    return additions
