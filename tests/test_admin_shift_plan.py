from datetime import date

from app.db.models import ShiftPlan
from app.services.time_intervals import shift_plan_interval


def test_planned_minutes_rejects_overnight_shift() -> None:
    row = ShiftPlan(
        employment_id=1,
        date=date(2026, 7, 31),
        arrival_time="22:00",
        departure_time="06:00",
    )

    interval = shift_plan_interval(row)
    assert interval is None


def test_status_only_plan_has_no_time_interval() -> None:
    row = ShiftPlan(
        employment_id=1,
        date=date(2026, 8, 1),
        status="HOLIDAY",
    )

    assert shift_plan_interval(row) is None
