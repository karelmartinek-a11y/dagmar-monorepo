# ruff: noqa: B008
from __future__ import annotations

import datetime as dt
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.deps import PortalUserAuth, require_portal_user_auth
from app.api.errors import raise_api_error
from app.db.models import Attendance, Employment, ShiftPlan
from app.db.session import get_db
from app.services.day_status import (
    DAY_STATUS_PARAGRAPH,
    DAY_STATUS_SICKNESS,
    collect_day_status_conflicts,
    day_status_label,
    get_day_status,
    set_attendance_status,
)
from app.services.employment_access import employment_label
from app.services.locks import LockType, ensure_month_unlocked, is_month_locked
from app.services.month_summary import DaySummary, MonthSummary, build_month_summary
from app.services.prague_time import prague_minutes_since_midnight, prague_today
from app.utils.timeparse import parse_hhmm_or_none

router = APIRouter(tags=["attendance"])


class AttendanceDayOut(BaseModel):
    date: str
    arrival_time: str | None = None
    departure_time: str | None = None
    arrival_time_2: str | None = None
    departure_time_2: str | None = None
    planned_arrival_time: str | None = None
    planned_departure_time: str | None = None
    planned_status: str | None = None
    attendance_status: str | None = None
    effective_status: str | None = None
    is_within_employment_period: bool
    worked_minutes: int = 0
    worked_hours: float = 0.0
    worked_state: str = "empty"
    planned_minutes: int = 0
    planned_hours: float = 0.0
    planned_state: str = "empty"
    fund_minutes: int = 0
    fund_hours: float = 0.0
    vacation_minutes: int = 0
    vacation_hours: float = 0.0
    paragraph_minutes: int = 0
    paragraph_hours: float = 0.0
    afternoon_minutes: int = 0
    afternoon_hours: float = 0.0
    weekend_holiday_minutes: int = 0
    weekend_holiday_hours: float = 0.0
    holiday_minutes: int = 0
    holiday_hours: float = 0.0
    weekend_minutes: int = 0
    weekend_hours: float = 0.0
    daytime_minutes: int = 0
    daytime_hours: float = 0.0
    night_minutes: int = 0
    night_hours: float = 0.0
    pause_minutes: int = 0
    pause_hours: float = 0.0
    accounted_minutes: int = 0
    accounted_hours: float = 0.0


class AttendanceMonthSummaryOut(BaseModel):
    work_fund_minutes: int
    work_fund_hours: float
    work_fund_source: str
    planned_minutes: int
    planned_hours: float
    worked_minutes: int
    worked_hours: float
    vacation_minutes: int
    vacation_hours: float
    vacation_days: int
    sickness_days: int
    paragraph_minutes: int
    paragraph_hours: float
    afternoon_minutes: int
    afternoon_hours: float
    weekend_holiday_minutes: int
    weekend_holiday_hours: float
    holiday_minutes: int
    holiday_hours: float
    weekend_minutes: int
    weekend_hours: float
    daytime_minutes: int
    daytime_hours: float
    night_minutes: int
    night_hours: float
    pause_minutes: int
    pause_hours: float
    accounted_minutes: int
    accounted_hours: float
    accounted_balance_minutes: int
    accounted_balance_hours: float
    plan_balance_minutes: int
    plan_balance_hours: float
    worked_balance_minutes: int | None = None
    worked_balance_hours: float | None = None
    elapsed_fund_minutes: int | None = None
    elapsed_fund_hours: float | None = None
    worked_balance_mode: str | None = None


class AttendanceMonthOut(BaseModel):
    employment_id: int
    employment_label: str
    locked: bool = False
    attendance_locked: bool = False
    shift_plan_locked: bool = False
    days: list[AttendanceDayOut]
    summary: AttendanceMonthSummaryOut


class AttendanceUpsertIn(BaseModel):
    employment_id: int
    date: str = Field(..., description="YYYY-MM-DD")
    arrival_time: str | None = Field(None, description="HH:MM or null")
    departure_time: str | None = Field(None, description="HH:MM or null")
    arrival_time_2: str | None = Field(None, description="HH:MM or null")
    departure_time_2: str | None = Field(None, description="HH:MM or null")


class AttendanceStatusUpsertIn(BaseModel):
    employment_id: int = Field(..., ge=1)
    date: str = Field(..., description="YYYY-MM-DD")
    status: str | None = Field(
        None,
        description="SICKNESS | PARAGRAPH | null",
        pattern="^(SICKNESS|PARAGRAPH)?$",
        examples=["SICKNESS", "PARAGRAPH"],
    )
    confirm_delete_conflicts: bool = False


def attendance_day_out(item: DaySummary, employment: Employment) -> AttendanceDayOut:
    return AttendanceDayOut(
        date=item.date.isoformat(),
        arrival_time=item.attendance.arrival_time if item.attendance else None,
        departure_time=item.attendance.departure_time if item.attendance else None,
        arrival_time_2=item.attendance.arrival_time_2 if item.attendance else None,
        departure_time_2=item.attendance.departure_time_2 if item.attendance else None,
        planned_arrival_time=item.plan.arrival_time if item.plan else None,
        planned_departure_time=item.plan.departure_time if item.plan else None,
        planned_status=item.plan.status if item.plan else None,
        attendance_status=item.attendance.status if item.attendance else None,
        effective_status=item.effective_status,
        is_within_employment_period=employment.start_date <= item.date
        and (employment.end_date is None or item.date <= employment.end_date),
        worked_minutes=item.worked_minutes,
        worked_hours=item.worked_hours,
        worked_state=item.worked_state,
        planned_minutes=item.planned_minutes,
        planned_hours=item.planned_hours,
        planned_state=item.planned_state,
        fund_minutes=item.fund_minutes,
        fund_hours=item.fund_hours,
        vacation_minutes=item.vacation_minutes,
        vacation_hours=item.vacation_hours,
        paragraph_minutes=item.paragraph_minutes,
        paragraph_hours=item.paragraph_hours,
        afternoon_minutes=item.afternoon_minutes,
        afternoon_hours=item.afternoon_hours,
        weekend_holiday_minutes=item.weekend_holiday_minutes,
        weekend_holiday_hours=item.weekend_holiday_hours,
        holiday_minutes=item.holiday_minutes,
        holiday_hours=item.holiday_hours,
        weekend_minutes=item.weekend_minutes,
        weekend_hours=item.weekend_hours,
        daytime_minutes=item.daytime_minutes,
        daytime_hours=item.daytime_hours,
        night_minutes=item.night_minutes,
        night_hours=item.night_hours,
        pause_minutes=item.pause_minutes,
        pause_hours=item.pause_hours,
        accounted_minutes=item.accounted_minutes,
        accounted_hours=item.accounted_hours,
    )


def attendance_summary_out(summary: MonthSummary) -> AttendanceMonthSummaryOut:
    return AttendanceMonthSummaryOut(
        work_fund_minutes=summary.work_fund_minutes,
        work_fund_hours=summary.work_fund_hours,
        work_fund_source=summary.work_fund_source,
        planned_minutes=summary.planned_minutes,
        planned_hours=summary.planned_hours,
        worked_minutes=summary.worked_minutes,
        worked_hours=summary.worked_hours,
        vacation_minutes=summary.vacation_minutes,
        vacation_hours=summary.vacation_hours,
        vacation_days=summary.vacation_days,
        sickness_days=summary.sickness_days,
        paragraph_minutes=summary.paragraph_minutes,
        paragraph_hours=summary.paragraph_hours,
        afternoon_minutes=summary.afternoon_minutes,
        afternoon_hours=summary.afternoon_hours,
        weekend_holiday_minutes=summary.weekend_holiday_minutes,
        weekend_holiday_hours=summary.weekend_holiday_hours,
        holiday_minutes=summary.holiday_minutes,
        holiday_hours=summary.holiday_hours,
        weekend_minutes=summary.weekend_minutes,
        weekend_hours=summary.weekend_hours,
        daytime_minutes=summary.daytime_minutes,
        daytime_hours=summary.daytime_hours,
        night_minutes=summary.night_minutes,
        night_hours=summary.night_hours,
        pause_minutes=summary.pause_minutes,
        pause_hours=summary.pause_hours,
        accounted_minutes=summary.accounted_minutes,
        accounted_hours=summary.accounted_hours,
        accounted_balance_minutes=summary.accounted_balance_minutes,
        accounted_balance_hours=summary.accounted_balance_hours,
        plan_balance_minutes=summary.plan_balance_minutes,
        plan_balance_hours=summary.plan_balance_hours,
        worked_balance_minutes=summary.worked_balance_minutes,
        worked_balance_hours=summary.worked_balance_hours,
        elapsed_fund_minutes=summary.elapsed_fund_minutes,
        elapsed_fund_hours=summary.elapsed_fund_hours,
        worked_balance_mode=summary.worked_balance_mode,
    )


def _month_range(year: int, month: int) -> tuple[dt.date, dt.date]:
    if month < 1 or month > 12:
        raise ValueError("month out of range")
    start = dt.date(year, month, 1)
    if month == 12:
        end = dt.date(year + 1, 1, 1)
    else:
        end = dt.date(year, month + 1, 1)
    return start, end


def _minutes_from_hhmm(value: str | None) -> int | None:
    if value is None:
        return None
    hour, minute = value.split(":")
    return int(hour) * 60 + int(minute)


def _require_accessible_employment(
    employment_id: int,
    auth: PortalUserAuth,
    db: Session,
) -> Employment:
    employment = db.get(Employment, employment_id)
    if employment is None or employment.user_id != auth.user.id:
        raise_api_error(404, "employment_not_found", "Úvazek nebyl nalezen.")
    return employment


def _ensure_day_in_employment_period(employment: Employment, day: dt.date) -> None:
    if day < employment.start_date or (employment.end_date is not None and day > employment.end_date):
        raise_api_error(status.HTTP_409_CONFLICT, "employment_period_mismatch", "Zvolené datum neleží v období platnosti vybraného úvazku.")


def _ensure_month_not_locked(employment_id: int, year: int, month: int, db: Session) -> None:
    ensure_month_unlocked(db, lock_type=LockType.ATTENDANCE, employment_id=employment_id, year=year, month=month)


def _month_is_locked(employment_id: int, year: int, month: int, db: Session) -> bool:
    return is_month_locked(db, lock_type=LockType.ATTENDANCE, employment_id=employment_id, year=year, month=month)


def _enforce_portal_attendance_entry_rules(
    *,
    day: dt.date,
    arrival: str | None,
    departure: str | None,
    arrival_2: str | None,
    departure_2: str | None,
    existing: Attendance | None,
) -> None:
    today = prague_today()
    if day > today:
        raise_api_error(status.HTTP_400_BAD_REQUEST, "attendance_future_entry_forbidden", "Budoucí průchod uživatel nesmí zadat.")

    if day == today:
        now_minutes = prague_minutes_since_midnight()
        values = [arrival, departure, arrival_2, departure_2]
        if any(value is not None and (_minutes_from_hhmm(value) or 0) > now_minutes for value in values):
            raise_api_error(
                status.HTTP_400_BAD_REQUEST,
                "attendance_future_time_forbidden",
                "U dnešního dne nelze zadat čas v budoucnosti podle času v Praze.",
            )
        return

    if existing is None:
        return

    if existing.arrival_time is not None and arrival != existing.arrival_time:
        raise_api_error(
            status.HTTP_400_BAD_REQUEST,
            "attendance_past_edit_forbidden",
            "Na minulých dnech lze doplnit jen chybějící příchod nebo odchod. Uložené hodnoty už měnit nejdou.",
        )
    if existing.departure_time is not None and departure != existing.departure_time:
        raise_api_error(
            status.HTTP_400_BAD_REQUEST,
            "attendance_past_edit_forbidden",
            "Na minulých dnech lze doplnit jen chybějící příchod nebo odchod. Uložené hodnoty už měnit nejdou.",
        )
    if existing.arrival_time_2 is not None and arrival_2 != existing.arrival_time_2:
        raise_api_error(
            status.HTTP_400_BAD_REQUEST,
            "attendance_past_edit_forbidden",
            "Na minulých dnech lze doplnit jen chybějící příchod nebo odchod. Uložené hodnoty už měnit nejdou.",
        )
    if existing.departure_time_2 is not None and departure_2 != existing.departure_time_2:
        raise_api_error(
            status.HTTP_400_BAD_REQUEST,
            "attendance_past_edit_forbidden",
            "Na minulých dnech lze doplnit jen chybějící příchod nebo odchod. Uložené hodnoty už měnit nejdou.",
        )


@router.get("/api/v1/attendance", response_model=AttendanceMonthOut)
def get_month_attendance(
    employment_id: int = Query(..., ge=1),
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    db: Session = Depends(get_db),
    auth: PortalUserAuth = Depends(require_portal_user_auth),
) -> AttendanceMonthOut:
    start, end = _month_range(year, month)
    employment = _require_accessible_employment(employment_id, auth, db)
    attendance_locked = _month_is_locked(employment.id, year, month, db)
    shift_plan_locked = is_month_locked(
        db,
        lock_type=LockType.SHIFT_PLAN,
        employment_id=employment.id,
        year=year,
        month=month,
    )

    db.execute(
        select(Attendance)
        .where(Attendance.employment_id == employment.id)
        .where(Attendance.date >= start)
        .where(Attendance.date < end)
        .order_by(Attendance.date.asc())
    ).scalars().all()

    try:
        db.execute(
            select(ShiftPlan)
            .where(ShiftPlan.employment_id == employment.id)
            .where(ShiftPlan.date >= start)
            .where(ShiftPlan.date < end)
        ).scalars().all()
    except SQLAlchemyError as exc:
        logging.getLogger(__name__).warning("ShiftPlan unavailable for attendance: %s", exc)

    month_summary = build_month_summary(db, employment=employment, year=year, month=month)
    days = [attendance_day_out(item, employment) for item in month_summary.day_summaries]

    return AttendanceMonthOut(
        employment_id=employment.id,
        employment_label=employment_label(employment, auth.user.name),
        locked=attendance_locked,
        attendance_locked=attendance_locked,
        shift_plan_locked=shift_plan_locked,
        days=days,
        summary=attendance_summary_out(month_summary),
    )


@router.put("/api/v1/attendance", response_model=AttendanceDayOut)
def upsert_attendance(
    body: AttendanceUpsertIn,
    db: Session = Depends(get_db),
    auth: PortalUserAuth = Depends(require_portal_user_auth),
) -> AttendanceDayOut:
    try:
        day = dt.date.fromisoformat(body.date)
    except ValueError:
        raise_api_error(status.HTTP_400_BAD_REQUEST, "invalid_date_format", "Invalid date format, expected YYYY-MM-DD")

    employment = _require_accessible_employment(body.employment_id, auth, db)
    _ensure_day_in_employment_period(employment, day)
    _ensure_month_not_locked(employment.id, day.year, day.month, db)
    blocked_status = get_day_status(db, employment_id=employment.id, day=day)
    if blocked_status is not None:
        raise_api_error(
            status.HTTP_409_CONFLICT,
            "attendance_blocked_by_day_status",
            f"Do dne označeného jako {day_status_label(blocked_status)} nelze zapisovat docházku.",
            blocked_status=blocked_status,
        )

    try:
        arrival = parse_hhmm_or_none(body.arrival_time)
        departure = parse_hhmm_or_none(body.departure_time)
        arrival_2 = parse_hhmm_or_none(body.arrival_time_2)
        departure_2 = parse_hhmm_or_none(body.departure_time_2)
    except ValueError as exc:
        raise_api_error(status.HTTP_400_BAD_REQUEST, "invalid_time_format", str(exc))

    existing = db.execute(
        select(Attendance).where(
            Attendance.employment_id == employment.id,
            Attendance.date == day,
        )
    ).scalar_one_or_none()

    _enforce_portal_attendance_entry_rules(
        day=day,
        arrival=arrival,
        departure=departure,
        arrival_2=arrival_2,
        departure_2=departure_2,
        existing=existing,
    )

    if existing is None:
        existing = Attendance(
            employment_id=employment.id,
            instance_id=auth.instance.id,
            date=day,
            arrival_time=arrival,
            departure_time=departure,
            arrival_time_2=arrival_2,
            departure_time_2=departure_2,
            status=None,
        )
        db.add(existing)
    else:
        existing.arrival_time = arrival
        existing.departure_time = departure
        existing.arrival_time_2 = arrival_2
        existing.departure_time_2 = departure_2
        existing.status = None
        existing.instance_id = auth.instance.id

    db.commit()
    summary = build_month_summary(db, employment=employment, year=day.year, month=day.month)
    return attendance_day_out(next(item for item in summary.day_summaries if item.date == day), employment)


@router.put("/api/v1/attendance/day-status", response_model=dict[str, bool])
def upsert_attendance_status(
    body: AttendanceStatusUpsertIn,
    db: Session = Depends(get_db),
    auth: PortalUserAuth = Depends(require_portal_user_auth),
) -> dict[str, bool]:
    try:
        day = dt.date.fromisoformat(body.date)
    except ValueError:
        raise_api_error(status.HTTP_400_BAD_REQUEST, "invalid_date_format", "Invalid date format, expected YYYY-MM-DD")

    employment = _require_accessible_employment(body.employment_id, auth, db)
    _ensure_day_in_employment_period(employment, day)
    _ensure_month_not_locked(employment.id, day.year, day.month, db)

    if body.status not in (None, DAY_STATUS_SICKNESS, DAY_STATUS_PARAGRAPH):
        raise_api_error(status.HTTP_400_BAD_REQUEST, "invalid_day_status", "Neplatný stav dne.")

    conflicts = collect_day_status_conflicts(db, employment_id=employment.id, day=day)
    if body.status is not None and conflicts.shift_plan_exists:
        raise_api_error(
            status.HTTP_409_CONFLICT,
            "attendance_status_conflicts_with_shift_plan",
            "Nejprve odstraňte data plánu služeb nebo celodenní stav plánu služeb pro tento den.",
        )

    conflicts = set_attendance_status(
        db,
        employment=employment,
        day=day,
        status=body.status,
        confirm_reset_existing_attendance=body.confirm_delete_conflicts,
        instance_id=auth.instance.id,
    )
    if body.status is not None and conflicts.attendance_exists and not body.confirm_delete_conflicts:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "day_status_conflict",
                "message": "V tomto dni už existuje docházka. Potvrzením budou stávající docházková data smazána.",
                "employment_id": employment.id,
                "date": day.isoformat(),
                "next_status": body.status,
                "requires_confirmation": True,
                "attendance_exists": True,
                "shift_plan_exists": False,
                "params": {
                    "employment_id": employment.id,
                    "date": day.isoformat(),
                    "next_status": body.status,
                    "requires_confirmation": True,
                    "attendance_exists": True,
                    "shift_plan_exists": False,
                },
            },
        )

    db.commit()
    return {"ok": True}
