"""Canonical creation of attendance events and physical automatic breaks."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import AttendanceEvent, AttendanceEventType, Employment
from app.services.prague_time import prague_now
from app.services.time_intervals import automatic_break_events


def _strict_sequence(events: list[AttendanceEvent]) -> bool:
    ordered = sorted(
        events,
        key=lambda item: (
            prague_now(item.occurred_at),
            item.id if item.id is not None else -1,
        ),
    )
    return all(
        event.event_type
        == (AttendanceEventType.IN if index % 2 == 0 else AttendanceEventType.OUT)
        for index, event in enumerate(ordered)
    )


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
    if end <= start:
        raise ValueError("Odchod musí následovat po příchodu.")
    existing = list(
        db.execute(
            select(AttendanceEvent)
            .where(AttendanceEvent.employment_id == employment.id)
            .order_by(AttendanceEvent.occurred_at, AttendanceEvent.id)
        ).scalars()
    )
    additions = [
        AttendanceEvent(
            employment_id=employment.id,
            occurred_at=start,
            event_type=AttendanceEventType.IN,
        )
    ]
    if employment.automatic_breaks_enabled:
        additions.extend(
            AttendanceEvent(
                employment_id=employment.id,
                occurred_at=occurred_at,
                event_type=AttendanceEventType(event_type),
            )
            for occurred_at, event_type in automatic_break_events(start, end)
        )
    additions.append(
        AttendanceEvent(
            employment_id=employment.id,
            occurred_at=end,
            event_type=AttendanceEventType.OUT,
        )
    )
    if not _strict_sequence([*existing, *additions]):
        raise ValueError("Průchody musí střídat IN a OUT.")
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
    previous = next(
        (item for item in reversed(existing) if prague_now(item.occurred_at) < event_time),
        None,
    )
    additions = [event]
    if event.event_type == AttendanceEventType.OUT and previous is not None and employment.automatic_breaks_enabled:
        for occurred_at, event_type in automatic_break_events(prague_now(previous.occurred_at), prague_now(event.occurred_at)):
            break_event = AttendanceEvent(
                employment_id=employment.id,
                occurred_at=occurred_at,
                event_type=AttendanceEventType(event_type),
            )
            additions.append(break_event)
    if not _strict_sequence([*existing, *additions]):
        raise ValueError("Průchody musí střídat IN a OUT.")
    db.add_all(additions)
    return additions
