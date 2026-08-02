from datetime import date
from types import SimpleNamespace

from app.api.v1.admin_employments import _normalize_profile_for_type
from app.api.v1.admin_users import _to_employment_out


def test_employment_output_accepts_projection_without_time_profile_fields() -> None:
    employment = SimpleNamespace(
        id=7,
        user_id=3,
        title="Výchozí úvazek",
        employment_type="DPP_DPC",
        start_date=date(2025, 1, 1),
        end_date=None,
        is_active=True,
        user=SimpleNamespace(name="Jana Nováková"),
    )

    result = _to_employment_out(employment)

    assert result.employment_type == "DPP_DPC"
    assert result.label == "Jana Nováková - DPP/DPČ - Výchozí úvazek"
    assert result.time_profile == {
        "automatic_breaks_enabled": False,
        "total": {"enabled": True, "mandatory": False},
        "afternoon": {"enabled": False, "mandatory": False, "start": None},
        "night": {"enabled": False, "mandatory": False},
        "weekend": {"enabled": False, "mandatory": False},
        "public_holiday": {"enabled": False, "mandatory": False},
    }


def test_employment_type_change_normalizes_incompatible_profile() -> None:
    profile = {
        "workload_fraction": 1,
        "total_hours_enabled": True,
        "automatic_breaks_enabled": True,
        "afternoon_hours_enabled": True,
        "afternoon_start_minutes": 1020,
        "night_hours_enabled": True,
        "weekend_hours_enabled": True,
        "public_holiday_hours_enabled": True,
    }

    result = _normalize_profile_for_type("TASK_SHIFT_BASED", profile, type_changed=True)

    assert result == {
        "workload_fraction": None,
        "total_hours_enabled": False,
        "automatic_breaks_enabled": False,
        "afternoon_hours_enabled": False,
        "afternoon_start_minutes": None,
        "night_hours_enabled": False,
        "weekend_hours_enabled": False,
        "public_holiday_hours_enabled": False,
    }
