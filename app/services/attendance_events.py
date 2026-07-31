"""Canonical creation of attendance events and physical automatic breaks."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import AttendanceEvent, AttendanceEventType, Employment
from app.services.prague_time import prague_now
from app.services.time_intervals import automatic_break_events


def latest_event(db: Session, employment_id: int) -> AttendanceEvent | None:
    return db.execute(
        select(AttendanceEvent)
        .where(AttendanceEvent.employment_id == employment_id)
        .order_by(AttendanceEvent.occurred_at.desc(), AttendanceEvent.id.desc())
    ).scalars().first()


def add_event_with_breaks(db: Session, *, employment: Employment, event: AttendanceEvent) -> None:
    previous = latest_event(db, employment.id)
    if previous is not None and previous.event_type == event.event_type:
        raise ValueError("Průchody musí střídat IN a OUT.")
    db.add(event)
    if event.event_type == AttendanceEventType.OUT and previous is not None and employment.automatic_breaks_enabled:
        for occurred_at, event_type in automatic_break_events(prague_now(previous.occurred_at), prague_now(event.occurred_at)):
            db.add(AttendanceEvent(employment_id=employment.id, occurred_at=occurred_at, event_type=AttendanceEventType(event_type)))
