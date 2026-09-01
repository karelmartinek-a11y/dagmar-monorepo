from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.db.models import (
    AttendanceEvent,
    AttendanceReminderEvent,
    Base,
    Employment,
    EmploymentType,
    PortalUser,
    PortalUserRole,
    ShiftPlan,
)
from app.services.attendance_reminders import (
    PREVIOUS_DAY_DEPARTURE_REMINDER,
    SAME_DAY_DEPARTURE_REMINDER,
    process_attendance_reminders,
)
from app.services.prague_time import PRAGUE_TIMEZONE


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


def test_reminder_uses_odd_same_day_time_count() -> None:
    db, employment = _db_with_employment()
    db.add_all(
        [
            ShiftPlan(
                employment_id=employment.id,
                date=date(2026, 8, 10),
                arrival_time="08:00",
                departure_time="18:00",
            ),
            AttendanceEvent(
                employment_id=employment.id,
                occurred_at=datetime(2026, 8, 10, 6, tzinfo=PRAGUE_TIMEZONE),
            ),
        ]
    )
    db.commit()
    sent: list[str] = []

    process_attendance_reminders(
        db,
        object(),  # type: ignore[arg-type]
        now=datetime(2026, 8, 10, 20, 30, tzinfo=PRAGUE_TIMEZONE),
        send_email=lambda _email, subject, _body: sent.append(subject),
    )

    assert sent
    reminder_types = db.execute(select(AttendanceReminderEvent.reminder_type)).scalars().all()
    assert reminder_types
    assert set(reminder_types) == {SAME_DAY_DEPARTURE_REMINDER}


def test_reminder_keeps_each_calendar_day_independent() -> None:
    db, employment = _db_with_employment()
    db.add_all(
        [
            AttendanceEvent(
                employment_id=employment.id,
                occurred_at=datetime(2026, 8, 9, 6, tzinfo=PRAGUE_TIMEZONE),
            ),
            AttendanceEvent(
                employment_id=employment.id,
                occurred_at=datetime(2026, 8, 10, 7, tzinfo=PRAGUE_TIMEZONE),
            ),
        ]
    )
    db.commit()

    process_attendance_reminders(
        db,
        object(),  # type: ignore[arg-type]
        now=datetime(2026, 8, 10, 8, 30, tzinfo=PRAGUE_TIMEZONE),
        send_email=lambda _email, _subject, _body: None,
    )

    reminder_types = db.execute(select(AttendanceReminderEvent.reminder_type)).scalars().all()
    assert PREVIOUS_DAY_DEPARTURE_REMINDER in reminder_types
