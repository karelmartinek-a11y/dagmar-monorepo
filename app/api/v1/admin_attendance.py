# ruff: noqa: B008
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.api.deps import require_admin
from app.api.errors import raise_api_error
from app.db.models import Attendance, AttendanceLock, Employment, ShiftPlan
from app.db.session import get_db
from app.security.csrf import require_csrf
from app.services.day_status import day_status_label, get_day_status
from app.services.employment_access import employment_label
from app.utils.timeparse import parse_hhmm_or_none, parse_yyyy_mm_dd

router = APIRouter(tags=["admin"])


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
    days: list[AttendanceDayOut]


class AttendanceMatrixRowOut(BaseModel):
    employment_id: int
    user_id: int
    user_name: str
    employment_label: str
    employment_title: str
    employment_type: str
    user_is_active: bool
    employment_is_active: bool
    start_date: str
    end_date: str | None = None
    is_active_in_month: bool
    locked: bool = False
    days: list[AttendanceDayOut]


class AttendanceMatrixMonthOut(BaseModel):
    year: int
    month: int
    rows: list[AttendanceMatrixRowOut]


class AttendanceUpsertIn(BaseModel):
    employment_id: int = Field(..., ge=1)
    date: str = Field(..., description="YYYY-MM-DD")
    arrival_time: str | None = Field(None, description="HH:MM or null")
    departure_time: str | None = Field(None, description="HH:MM or null")
    arrival_time_2: str | None = Field(None, description="HH:MM or null")
    departure_time_2: str | None = Field(None, description="HH:MM or null")


class OkOut(BaseModel):
    ok: bool = True


class LockMonthIn(BaseModel):
    employment_id: int = Field(..., ge=1)
    year: int = Field(..., ge=2000, le=2100)
    month: int = Field(..., ge=1, le=12)


def _month_range(year: int, month: int) -> tuple[dt.date, dt.date]:
    if month < 1 or month > 12:
        raise ValueError("month out of range")
    start = dt.date(year, month, 1)
    if month == 12:
        end = dt.date(year + 1, 1, 1)
    else:
        end = dt.date(year, month + 1, 1)
    return start, end


def _get_employment(employment_id: int, db: Session) -> Employment:
    employment = (
        db.execute(select(Employment).options(joinedload(Employment.user)).where(Employment.id == employment_id))
        .scalars()
        .first()
    )
    if employment is None:
        raise_api_error(404, "employment_not_found", "Úvazek nebyl nalezen.")
    return employment


def _employment_active_in_month(employment: Employment, start: dt.date, end: dt.date) -> bool:
    if not employment.is_active:
        return False
    month_end = end - dt.timedelta(days=1)
    return employment.start_date <= month_end and (employment.end_date is None or employment.end_date >= start)


def _ensure_month_not_locked(employment_id: int, year: int, month: int, db: Session) -> None:
    lock = db.execute(
        select(AttendanceLock).where(
            AttendanceLock.employment_id == employment_id,
            AttendanceLock.year == year,
            AttendanceLock.month == month,
        )
    ).scalar_one_or_none()
    if lock is not None:
        raise_api_error(423, "attendance_month_locked", "Docházka za zvolené období je uzamčena.")


@router.get("/api/v1/admin/attendance/month", response_model=AttendanceMatrixMonthOut)
def admin_get_attendance_matrix_month(
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    _admin=Depends(require_admin),
    db: Session = Depends(get_db),
) -> AttendanceMatrixMonthOut:
    start, end = _month_range(year, month)

    employments = (
        db.execute(select(Employment).options(joinedload(Employment.user)).order_by(Employment.id.asc()))
        .unique()
        .scalars()
        .all()
    )
    employment_ids = [employment.id for employment in employments]

    attendance_rows = db.execute(
        select(Attendance)
        .where(Attendance.employment_id.in_(employment_ids))
        .where(Attendance.date >= start)
        .where(Attendance.date < end)
        .order_by(Attendance.employment_id.asc(), Attendance.date.asc())
    ).scalars().all()
    attendance_by_key = {(row.employment_id, row.date): row for row in attendance_rows}

    plan_rows = db.execute(
        select(ShiftPlan)
        .where(ShiftPlan.employment_id.in_(employment_ids))
        .where(ShiftPlan.date >= start)
        .where(ShiftPlan.date < end)
        .order_by(ShiftPlan.employment_id.asc(), ShiftPlan.date.asc())
    ).scalars().all()
    plan_by_key = {(row.employment_id, row.date): row for row in plan_rows}

    lock_rows = db.execute(
        select(AttendanceLock).where(
            AttendanceLock.employment_id.in_(employment_ids),
            AttendanceLock.year == year,
            AttendanceLock.month == month,
        )
    ).scalars().all()
    locked_employment_ids = {row.employment_id for row in lock_rows}

    rows: list[AttendanceMatrixRowOut] = []
    for employment in employments:
        user = employment.user
        days: list[AttendanceDayOut] = []
        cur = start
        while cur < end:
            attendance = attendance_by_key.get((employment.id, cur))
            plan = plan_by_key.get((employment.id, cur))
            days.append(
                AttendanceDayOut(
                    date=cur.isoformat(),
                    arrival_time=attendance.arrival_time if attendance else None,
                    departure_time=attendance.departure_time if attendance else None,
                    arrival_time_2=attendance.arrival_time_2 if attendance else None,
                    departure_time_2=attendance.departure_time_2 if attendance else None,
                    planned_arrival_time=plan.arrival_time if plan else None,
                    planned_departure_time=plan.departure_time if plan else None,
                    planned_status=plan.status if plan else None,
                    is_within_employment_period=employment.start_date <= cur
                    and (employment.end_date is None or cur <= employment.end_date),
                )
            )
            cur = cur + dt.timedelta(days=1)

        rows.append(
            AttendanceMatrixRowOut(
                employment_id=employment.id,
                user_id=employment.user_id,
                user_name=user.name if user else "Neznámý zaměstnanec",
                employment_label=employment_label(employment, user.name if user else None),
                employment_title=employment.title,
                employment_type=employment.employment_type,
                user_is_active=bool(user.is_active) if user else False,
                employment_is_active=employment.is_active,
                start_date=employment.start_date.isoformat(),
                end_date=employment.end_date.isoformat() if employment.end_date else None,
                is_active_in_month=_employment_active_in_month(employment, start, end)
                and (bool(user.is_active) if user else False),
                locked=employment.id in locked_employment_ids,
                days=days,
            )
        )

    return AttendanceMatrixMonthOut(year=year, month=month, rows=rows)


@router.get("/api/v1/admin/attendance", response_model=AttendanceMonthOut)
def admin_get_month_attendance(
    employment_id: int = Query(..., ge=1),
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    _admin=Depends(require_admin),
    db: Session = Depends(get_db),
) -> AttendanceMonthOut:
    employment = _get_employment(employment_id, db)
    start, end = _month_range(year, month)

    rows = db.execute(
        select(Attendance)
        .where(Attendance.employment_id == employment.id)
        .where(Attendance.date >= start)
        .where(Attendance.date < end)
        .order_by(Attendance.date.asc())
    ).scalars().all()
    by_date: dict[dt.date, Attendance] = {r.date: r for r in rows}

    plan_rows = db.execute(
        select(ShiftPlan)
        .where(ShiftPlan.employment_id == employment.id)
        .where(ShiftPlan.date >= start)
        .where(ShiftPlan.date < end)
    ).scalars().all()
    plan_by_date: dict[dt.date, ShiftPlan] = {r.date: r for r in plan_rows}

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

    locked = (
        db.execute(
            select(AttendanceLock).where(
                AttendanceLock.employment_id == employment.id,
                AttendanceLock.year == year,
                AttendanceLock.month == month,
            )
        ).scalar_one_or_none()
        is not None
    )

    return AttendanceMonthOut(
        employment_id=employment.id,
        employment_label=employment_label(employment, employment.user.name if employment.user else None),
        days=days,
        locked=locked,
    )


@router.put("/api/v1/admin/attendance", response_model=OkOut)
def admin_upsert_attendance(
    body: AttendanceUpsertIn,
    _admin=Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> OkOut:
    employment = _get_employment(body.employment_id, db)

    try:
        day = parse_yyyy_mm_dd(body.date)
    except ValueError as exc:
        raise_api_error(400, "invalid_date_format", str(exc))

    if day < employment.start_date or (employment.end_date is not None and day > employment.end_date):
        raise_api_error(409, "employment_period_mismatch", "Datum neleží v období platnosti vybraného úvazku.")
    _ensure_month_not_locked(employment.id, day.year, day.month, db)
    blocked_status = get_day_status(db, employment_id=employment.id, day=day)
    if blocked_status is not None:
        raise_api_error(
            409,
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
        raise_api_error(400, "invalid_time_format", str(exc))

    existing = db.execute(
        select(Attendance).where(
            Attendance.employment_id == employment.id,
            Attendance.date == day,
        )
    ).scalar_one_or_none()

    if existing is None:
        existing = Attendance(
            employment_id=employment.id,
            instance_id=employment.user.instance_id if employment.user else None,
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

    db.commit()
    return OkOut(ok=True)


@router.post("/api/v1/admin/attendance/lock", response_model=OkOut)
def lock_month(
    body: LockMonthIn,
    admin=Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> OkOut:
    employment = _get_employment(body.employment_id, db)
    existing = db.execute(
        select(AttendanceLock).where(
            AttendanceLock.employment_id == employment.id,
            AttendanceLock.year == body.year,
            AttendanceLock.month == body.month,
        )
    ).scalar_one_or_none()
    if existing is None:
        lock = AttendanceLock(
            employment_id=employment.id,
            instance_id=employment.user.instance_id if employment.user else None,
            year=body.year,
            month=body.month,
            locked_by=admin.username or None,
        )
        db.add(lock)
        db.commit()

    return OkOut(ok=True)


@router.post("/api/v1/admin/attendance/unlock", response_model=OkOut)
def unlock_month(
    body: LockMonthIn,
    _: None = Depends(require_csrf),
    admin=Depends(require_admin),
    db: Session = Depends(get_db),
) -> OkOut:
    employment = _get_employment(body.employment_id, db)
    lock = db.execute(
        select(AttendanceLock).where(
            AttendanceLock.employment_id == employment.id,
            AttendanceLock.year == body.year,
            AttendanceLock.month == body.month,
        )
    ).scalar_one_or_none()
    if lock is None:
        return OkOut(ok=True)

    db.delete(lock)
    db.commit()
    return OkOut(ok=True)
