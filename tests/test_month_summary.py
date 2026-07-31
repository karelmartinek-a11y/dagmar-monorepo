from __future__ import annotations

from collections.abc import Iterator
from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db.models import Attendance, Base, Employment, PortalUser, PortalUserRole, ShiftPlan
from app.services.month_summary import build_month_summary, hours_from_minutes


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    with Session(engine) as session:
        yield session


def _employment(db: Session) -> Employment:
    user = PortalUser(
        email="hours@example.test",
        name="Hodinový test",
        role=PortalUserRole.EMPLOYEE,
        password_hash="hash",
        is_active=True,
    )
    db.add(user)
    db.flush()
    employment = Employment(
        user_id=user.id,
        title="Test",
        employment_type="DPP_DPC",
        start_date=date(2026, 1, 1),
        is_active=True,
    )
    db.add(employment)
    db.flush()
    return employment


@pytest.mark.parametrize(("minutes", "hours"), [(479, 7.9), (480, 8.0), (485, 8.0)])
def test_hours_are_floored_to_daily_tenths(minutes: int, hours: float) -> None:
    assert hours_from_minutes(minutes) == hours


def test_complete_pairs_count_and_incomplete_pair_is_ignored(db: Session) -> None:
    employment = _employment(db)
    db.add_all(
        [
            Attendance(
                employment_id=employment.id,
                date=date(2026, 1, 5),
                arrival_time="08:00",
                departure_time="11:59",
                arrival_time_2="12:00",
                departure_time_2="16:00",
            ),
            Attendance(
                employment_id=employment.id,
                date=date(2026, 1, 6),
                arrival_time="08:00",
                departure_time=None,
                arrival_time_2="13:00",
                departure_time_2="21:00",
            ),
            Attendance(
                employment_id=employment.id,
                date=date(2026, 1, 7),
                arrival_time="08:00",
                departure_time=None,
            ),
        ]
    )
    db.commit()

    summary = build_month_summary(db, employment=employment, year=2026, month=1)
    first, second, third = summary.day_summaries[4:7]
    assert (first.worked_minutes, first.worked_hours, first.worked_state) == (479, 7.9, "complete")
    assert (second.worked_minutes, second.worked_hours, second.worked_state) == (480, 8.0, "incomplete")
    assert (third.worked_minutes, third.worked_hours, third.worked_state) == (0, 0.0, "incomplete")


def test_month_hours_sum_already_rounded_days(db: Session) -> None:
    employment = _employment(db)
    db.add_all(
        [
            Attendance(
                employment_id=employment.id,
                date=date(2026, 1, day),
                arrival_time="08:00",
                departure_time="15:59",
            )
            for day in (5, 6)
        ]
    )
    db.commit()

    summary = build_month_summary(db, employment=employment, year=2026, month=1)
    assert summary.worked_minutes == 958
    assert summary.worked_hours == 15.8
    assert summary.accounted_balance_hours == summary.accounted_hours - summary.work_fund_hours


def test_attendance_and_plan_are_split_across_midnight_and_month(db: Session) -> None:
    employment = _employment(db)
    db.add(
        Attendance(
            employment_id=employment.id,
            date=date(2026, 1, 31),
            arrival_time="22:00",
            departure_time="02:00",
        )
    )
    db.add(
        ShiftPlan(
            employment_id=employment.id,
            date=date(2026, 1, 31),
            arrival_time="22:00",
            departure_time="02:00",
        )
    )
    db.commit()

    january = build_month_summary(db, employment=employment, year=2026, month=1)
    february = build_month_summary(db, employment=employment, year=2026, month=2)
    assert (january.day_summaries[-1].worked_minutes, january.day_summaries[-1].planned_minutes) == (120, 120)
    assert (february.day_summaries[0].worked_minutes, february.day_summaries[0].planned_minutes) == (120, 120)
    assert (february.day_summaries[0].worked_state, february.day_summaries[0].planned_state) == ("complete", "complete")
    assert (january.worked_hours, january.planned_hours) == (2.0, 2.0)
    assert (february.worked_hours, february.planned_hours) == (2.0, 2.0)
