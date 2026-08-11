from __future__ import annotations

from datetime import UTC, date, datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db.models import (
    AttendanceEvent,
    AttendanceEventType,
    Base,
    Employment,
    EmploymentType,
    PortalUser,
    PortalUserRole,
)
from app.services.attendance_reminders import _last_events_by_employment


def _db_with_employment() -> tuple[Session, Employment]:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = Session(engine)
    user = PortalUser(email="reminder@example.test", name="Reminder", role=PortalUserRole.EMPLOYEE)
    employment = Employment(
        user=user,
        title="Test",
        employment_type=EmploymentType.DPP_DPC,
        start_date=date(2026, 1, 1),
    )
    db.add(employment)
    db.commit()
    db.refresh(employment)
    return db, employment


def _event(db: Session, employment: Employment, value: datetime, kind: AttendanceEventType) -> None:
    db.add(AttendanceEvent(employment_id=employment.id, occurred_at=value, event_type=kind))
    db.commit()


def test_latest_event_uses_full_in_out_in_chronology() -> None:
    db, employment = _db_with_employment()
    _event(db, employment, datetime(2026, 8, 10, 8, tzinfo=UTC), AttendanceEventType.IN)
    _event(db, employment, datetime(2026, 8, 10, 12, tzinfo=UTC), AttendanceEventType.OUT)
    _event(db, employment, datetime(2026, 8, 10, 13, tzinfo=UTC), AttendanceEventType.IN)

    latest = _last_events_by_employment(db, [employment.id])[employment.id]
    assert latest.event_type == AttendanceEventType.IN
    assert latest.occurred_at.hour == 13


def test_cross_midnight_out_closes_previous_day_shift() -> None:
    db, employment = _db_with_employment()
    _event(db, employment, datetime(2026, 8, 10, 21, tzinfo=UTC), AttendanceEventType.IN)
    _event(db, employment, datetime(2026, 8, 11, 2, tzinfo=UTC), AttendanceEventType.OUT)

    latest = _last_events_by_employment(db, [employment.id])[employment.id]
    assert latest.event_type == AttendanceEventType.OUT


def test_multiple_closed_intervals_remain_closed() -> None:
    db, employment = _db_with_employment()
    for hour, kind in (
        (8, AttendanceEventType.IN),
        (10, AttendanceEventType.OUT),
        (11, AttendanceEventType.IN),
        (15, AttendanceEventType.OUT),
    ):
        _event(db, employment, datetime(2026, 8, 10, hour, tzinfo=UTC), kind)

    latest = _last_events_by_employment(db, [employment.id])[employment.id]
    assert latest.event_type == AttendanceEventType.OUT


def test_latest_event_query_has_stable_id_tiebreaker() -> None:
    db, employment = _db_with_employment()
    db.bind.echo = False
    _event(db, employment, datetime(2026, 8, 10, 8, tzinfo=UTC), AttendanceEventType.IN)
    latest = _last_events_by_employment(db, [employment.id])[employment.id]
    assert latest.id > 0
    source = __import__("inspect").getsource(_last_events_by_employment)
    assert "occurred_at.desc(), AttendanceEvent.id.desc()" in source
