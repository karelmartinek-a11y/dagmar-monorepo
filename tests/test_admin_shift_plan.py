from types import SimpleNamespace

from app.api.v1.admin_shift_plan import _planned_minutes


def test_planned_minutes_supports_overnight_shift() -> None:
    row = SimpleNamespace(arrival_time="22:00", departure_time="06:00", status=None)

    assert _planned_minutes(row) == 8 * 60


def test_planned_minutes_ignores_off_and_holiday_statuses() -> None:
    for status in ("OFF", "HOLIDAY"):
        row = SimpleNamespace(arrival_time="08:00", departure_time="16:00", status=status)

        assert _planned_minutes(row) == 0
