from datetime import UTC, date, datetime
from types import SimpleNamespace

from app.api.v1.attendance import _metric_out
from app.db.models import EmploymentType
from app.services.attendance_mutations import has_strict_event_sequence
from app.services.czech_holidays import is_czech_public_holiday
from app.services.time_intervals import break_segments, pair_events
from app.services.time_metrics import (
    MetricValue,
    calculate_day_status_metrics,
    round_minutes_to_tenths,
)


def test_daily_rounding_is_half_up_in_tenths() -> None:
    assert [
        round_minutes_to_tenths(value) for value in (0, 2, 3, 5, 6, 8, 9, 57, 60, 62, 63, 66)
    ] == [0, 0, 1, 1, 1, 1, 2, 10, 10, 10, 11, 11]


def test_metric_output_includes_backend_owned_clock_format() -> None:
    metric = _metric_out(MetricValue(minutes=1505, tenths=251))

    assert metric is not None
    assert metric.clock == "25:05"


def test_full_day_status_metrics_are_backend_owned_and_separate() -> None:
    employment = SimpleNamespace(employment_type=EmploymentType.WORK_CONTRACT)

    holiday = calculate_day_status_metrics(employment, "HOLIDAY")
    sickness = calculate_day_status_metrics(employment, "SICKNESS")
    paragraph = calculate_day_status_metrics(employment, "PARAGRAPH")
    off = calculate_day_status_metrics(employment, "OFF")

    assert holiday.holiday is not None and holiday.holiday.hours == 8.0
    assert sickness.sickness is not None and sickness.sickness.hours == 8.0
    assert paragraph.paragraph is not None and paragraph.paragraph.hours == 8.0
    assert off == type(off)(holiday=None, sickness=None, paragraph=None)


def test_shift_based_employment_has_no_hourly_status_credit() -> None:
    employment = SimpleNamespace(employment_type=EmploymentType.TASK_SHIFT_BASED)

    metrics = calculate_day_status_metrics(employment, "HOLIDAY")

    assert metrics.holiday is None


def test_break_distribution_is_minimal_and_deterministic() -> None:
    assert break_segments(360) == ([360], 0)
    assert break_segments(721) == ([360, 331], 1)
    assert break_segments(1440) == ([360, 360, 360, 270], 3)


def test_pair_events_ignores_incomplete_historical_sequences() -> None:
    events = [
        SimpleNamespace(id=1, occurred_at=datetime(2026, 7, 1, 8, tzinfo=UTC), event_type="IN"),
        SimpleNamespace(id=2, occurred_at=datetime(2026, 7, 2, 8, tzinfo=UTC), event_type="IN"),
        SimpleNamespace(id=3, occurred_at=datetime(2026, 7, 2, 16, tzinfo=UTC), event_type="OUT"),
    ]

    intervals = pair_events(events)

    assert [(item.start.date(), item.end.date(), item.minutes) for item in intervals] == [
        (date(2026, 7, 2), date(2026, 7, 2), 480)
    ]


def test_pair_events_sums_two_work_intervals_separated_by_a_pause() -> None:
    events = [
        SimpleNamespace(id=1, occurred_at=datetime(2026, 8, 27, 5, 30), event_type="IN"),
        SimpleNamespace(id=2, occurred_at=datetime(2026, 8, 27, 9), event_type="OUT"),
        SimpleNamespace(id=3, occurred_at=datetime(2026, 8, 27, 9, 30), event_type="IN"),
        SimpleNamespace(id=4, occurred_at=datetime(2026, 8, 27, 13), event_type="OUT"),
    ]

    intervals = pair_events(events)

    assert [item.minutes for item in intervals] == [210, 210]
    assert has_strict_event_sequence(events)


def test_czech_holidays_include_easter_and_fixed_days() -> None:
    assert is_czech_public_holiday(date(2026, 4, 3))
    assert is_czech_public_holiday(date(2026, 4, 6))
    assert is_czech_public_holiday(date(2026, 7, 5))


def test_canonical_employment_types_are_exactly_four() -> None:
    assert {item.value for item in EmploymentType} == {
        "WORK_CONTRACT",
        "DPP_DPC",
        "TASK_SHIFT_BASED",
        "EXTERNAL_HOURLY",
    }
