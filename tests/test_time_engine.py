from datetime import date

from app.db.models import EmploymentType
from app.services.czech_holidays import is_czech_public_holiday
from app.services.time_intervals import break_segments
from app.services.time_metrics import round_minutes_to_tenths


def test_daily_rounding_is_half_up_in_tenths() -> None:
    assert [round_minutes_to_tenths(value) for value in (0, 2, 3, 5, 6, 8, 9, 57, 60, 62, 63, 66)] == [0, 0, 1, 1, 1, 1, 2, 10, 10, 10, 11, 11]


def test_break_distribution_is_minimal_and_deterministic() -> None:
    assert break_segments(360) == ([360], 0)
    assert break_segments(721) == ([360, 331], 1)
    assert break_segments(1440) == ([360, 360, 360, 270], 3)


def test_czech_holidays_include_easter_and_fixed_days() -> None:
    assert is_czech_public_holiday(date(2026, 4, 3))
    assert is_czech_public_holiday(date(2026, 4, 6))
    assert is_czech_public_holiday(date(2026, 7, 5))


def test_canonical_employment_types_are_exactly_four() -> None:
    assert {item.value for item in EmploymentType} == {"WORK_CONTRACT", "DPP_DPC", "TASK_SHIFT_BASED", "EXTERNAL_HOURLY"}
