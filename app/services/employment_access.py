from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from app.db.models import Employment, EmploymentType, PortalUser

LOGIN_WINDOW_MONTHS = 1


def add_calendar_months(value: date, months: int) -> date:
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def employment_type_is_valid(value: str) -> bool:
    return value in {item.value for item in EmploymentType}


def validate_time_profile(
    *,
    employment_type: str,
    workload_fraction: Decimal | None = None,
    automatic_breaks_enabled: bool = False,
    afternoon_hours_enabled: bool = False,
    afternoon_start_minutes: int | None = None,
    night_hours_enabled: bool = False,
    weekend_hours_enabled: bool = False,
    public_holiday_hours_enabled: bool = False,
) -> None:
    if not employment_type_is_valid(employment_type):
        raise ValueError("Neplatný typ úvazku.")
    if employment_type == EmploymentType.WORK_CONTRACT.value:
        if workload_fraction is None or not (Decimal("0") < workload_fraction <= Decimal("1")):
            raise ValueError("Velikost úvazku pracovní smlouvy musí být větší než 0 a nejvýše 1.")
        if not (night_hours_enabled and weekend_hours_enabled and public_holiday_hours_enabled):
            raise ValueError("Pracovní smlouva musí sledovat noční, víkendové a sváteční hodiny.")
    elif workload_fraction is not None:
        raise ValueError("Velikost úvazku patří pouze pracovní smlouvě.")
    if employment_type == EmploymentType.TASK_SHIFT_BASED.value and any((automatic_breaks_enabled, afternoon_hours_enabled, night_hours_enabled, weekend_hours_enabled, public_holiday_hours_enabled)):
        raise ValueError("Úkolová / směnová odměna nemá časové metriky.")
    if afternoon_hours_enabled and (afternoon_start_minutes is None or not 0 <= afternoon_start_minutes <= 1319):
        raise ValueError("Začátek odpoledního pásma musí být mezi 00:00 a 21:59.")
    if not afternoon_hours_enabled and afternoon_start_minutes is not None:
        raise ValueError("Začátek odpoledního pásma lze nastavit pouze při jeho sledování.")


def _safe_start_date(employment: Employment) -> date | None:
    value = getattr(employment, "start_date", None)
    return value if isinstance(value, date) else None


def _safe_end_date(employment: Employment) -> date | None:
    value = getattr(employment, "end_date", None)
    return value if isinstance(value, date) else None


def employment_is_valid_on_day(employment: Employment, day: date) -> bool:
    start_date = _safe_start_date(employment)
    end_date = _safe_end_date(employment)
    if start_date is None:
        return False
    if not employment.is_active:
        return False
    if start_date > day:
        return False
    if end_date is not None and end_date < day:
        return False
    return True


def employment_is_within_login_window(employment: Employment, day: date) -> bool:
    start_date = _safe_start_date(employment)
    end_date = _safe_end_date(employment)
    if start_date is None:
        return False
    if not employment.is_active:
        return False
    allowed_from = add_calendar_months(start_date, -LOGIN_WINDOW_MONTHS)
    if day < allowed_from:
        return False
    if end_date is None:
        return True
    allowed_until = add_calendar_months(end_date, LOGIN_WINDOW_MONTHS)
    return day <= allowed_until


def employment_overlaps_month(employment: Employment, month_start: date, month_end: date) -> bool:
    start_date = _safe_start_date(employment)
    end_date = _safe_end_date(employment)
    if start_date is None:
        return False
    if not employment.is_active:
        return False
    if start_date >= month_end:
        return False
    if end_date is not None and end_date < month_start:
        return False
    return True


def employment_label(employment: Employment, user_name: str | None = None) -> str:
    resolved_user_name = user_name
    if resolved_user_name is None:
        employment_user = getattr(employment, "user", None)
        if employment_user is not None:
            resolved_user_name = getattr(employment_user, "name", None)
    base = (resolved_user_name or "").strip()
    employment_type = getattr(employment, "employment_type", "")
    raw_type = str(getattr(employment_type, "value", employment_type) or "").strip().upper()
    if raw_type == EmploymentType.WORK_CONTRACT.value:
        type_label = "Pracovní smlouva"
    elif raw_type == "DPP_DPC":
        type_label = "DPP/DPČ"
    elif raw_type == EmploymentType.TASK_SHIFT_BASED.value:
        type_label = "Úkolová / směnová odměna"
    elif raw_type == EmploymentType.EXTERNAL_HOURLY.value:
        type_label = "Externí hodinová fakturace"
    else:
        type_label = "Neurčený typ"
    title = str(getattr(employment, "title", "") or "").strip() or "Bez názvu úvazku"
    if base:
        return f"{base} - {type_label} - {title}"
    return f"{type_label} - {title}"


@dataclass(frozen=True)
class LoginEmploymentSelection:
    available: list[Employment]
    default: Employment | None


def select_login_employments(user: PortalUser, today: date) -> LoginEmploymentSelection:
    eligible = [employment for employment in user.employments if employment_is_within_login_window(employment, today)]
    eligible.sort(key=lambda item: (_safe_start_date(item) or date.max, item.id))

    current = [employment for employment in eligible if employment_is_valid_on_day(employment, today)]
    if current:
        current.sort(key=lambda item: (_safe_start_date(item) or date.max, item.id))
        return LoginEmploymentSelection(available=eligible, default=current[0])

    upcoming = [employment for employment in eligible if (_safe_start_date(employment) or date.min) > today]
    if upcoming:
        upcoming.sort(key=lambda item: (_safe_start_date(item) or date.max, item.id))
        return LoginEmploymentSelection(available=eligible, default=upcoming[0])

    recent = [employment for employment in eligible if (_safe_end_date(employment) or date.max) < today]
    recent.sort(key=lambda item: (_safe_end_date(item) or today, item.id), reverse=True)
    return LoginEmploymentSelection(available=eligible, default=recent[0] if recent else None)
