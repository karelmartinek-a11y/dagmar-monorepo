# ruff: noqa: B008
from __future__ import annotations

import datetime as dt
import logging

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.deps import PortalUserAuth, require_portal_user_auth
from app.api.errors import raise_api_error
from app.db.models import Attendance, Employment, ShiftPlan
from app.db.session import get_db
from app.services.day_status import day_status_label, get_day_status
from app.services.employment_access import employment_label
from app.services.locks import LockType, ensure_month_unlocked, is_month_locked
from app.services.prague_time import prague_minutes_since_midnight, prague_today
from app.services.shift_plan_editing import can_employee_edit_shift_plan
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
    is_within_employment_period: bool


class AttendanceMonthOut(BaseModel):
    employment_id: int
    employment_label: str
    locked: bool = False
    attendance_locked: bool = False
    shift_plan_locked: bool = False
    shift_plan_editable: bool = False
    days: list[AttendanceDayOut]


class AttendanceUpsertIn(BaseModel):
    employment_id: int
    date: str = Field(..., description="YYYY-MM-DD")
    arrival_time: str | None = Field(None, description="HH:MM or null")
    departure_time: str | None = Field(None, description="HH:MM or null")
    arrival_time_2: str | None = Field(None, description="HH:MM or null")
    departure_time_2: str | None = Field(None, description="HH:MM or null")


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


def _enforce_user_forensic_rules(
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

    rows = db.execute(
        select(Attendance)
        .where(Attendance.employment_id == employment.id)
        .where(Attendance.date >= start)
        .where(Attendance.date < end)
        .order_by(Attendance.date.asc())
    ).scalars().all()

    by_date: dict[dt.date, Attendance] = {r.date: r for r in rows}

    plan_by_date: dict[dt.date, ShiftPlan] = {}
    try:
        plan_rows = db.execute(
            select(ShiftPlan)
            .where(ShiftPlan.employment_id == employment.id)
            .where(ShiftPlan.date >= start)
            .where(ShiftPlan.date < end)
        ).scalars().all()
        plan_by_date = {r.date: r for r in plan_rows}
    except SQLAlchemyError as exc:
        logging.getLogger(__name__).warning("ShiftPlan unavailable for attendance: %s", exc)

    days: list[AttendanceDayOut] = []
    cur = start
    while cur < end:
        row = by_date.get(cur)
        plan = plan_by_date.get(cur)
        days.append(
            AttendanceDayOut(
                date=cur.isoformat(),
                arrival_time=row.arrival_time if row else None,
                departure_time=row.departure_time if row else None,
                arrival_time_2=row.arrival_time_2 if row else None,
                departure_time_2=row.departure_time_2 if row else None,
                planned_arrival_time=plan.arrival_time if plan else None,
                planned_departure_time=plan.departure_time if plan else None,
                planned_status=plan.status if plan else None,
                is_within_employment_period=employment.start_date <= cur and (employment.end_date is None or cur <= employment.end_date),
            )
        )
        cur = cur + dt.timedelta(days=1)

    return AttendanceMonthOut(
        employment_id=employment.id,
        employment_label=employment_label(employment, auth.user.name),
        locked=attendance_locked,
        attendance_locked=attendance_locked,
        shift_plan_locked=shift_plan_locked,
        shift_plan_editable=can_employee_edit_shift_plan(db, employment_id=employment.id, year=year, month=month),
        days=days,
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

    _enforce_user_forensic_rules(
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
        )
        db.add(existing)
    else:
        existing.arrival_time = arrival
        existing.departure_time = departure
        existing.arrival_time_2 = arrival_2
        existing.departure_time_2 = departure_2
        existing.instance_id = auth.instance.id

    db.commit()
    return AttendanceDayOut(
        date=day.isoformat(),
        arrival_time=existing.arrival_time,
        departure_time=existing.departure_time,
        arrival_time_2=existing.arrival_time_2,
        departure_time_2=existing.departure_time_2,
        planned_arrival_time=None,
        planned_departure_time=None,
        planned_status=None,
        is_within_employment_period=True,
    )
