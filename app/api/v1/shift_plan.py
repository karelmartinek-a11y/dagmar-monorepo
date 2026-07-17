# ruff: noqa: B008
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...api.errors import raise_api_error
from ...db.models import Attendance, Employment, ShiftPlan
from ...db.session import get_db
from ...services.day_status import (
    DAY_STATUS_HOLIDAY,
    DAY_STATUS_OFF,
    DAY_STATUS_PARAGRAPH,
    DAY_STATUS_SICKNESS,
    collect_day_status_conflicts,
    day_status_label,
    get_day_status,
    get_shift_plan_day,
    normalize_day_status,
    set_day_status,
)
from ...services.locks import LockType, ensure_month_unlocked, is_month_locked
from ...services.shift_plan_editing import can_employee_edit_shift_plan
from ...utils.timeparse import parse_hhmm_or_none, parse_yyyy_mm_dd
from ..deps import PortalUserAuth, require_portal_user_auth
from .attendance import _require_accessible_employment

router = APIRouter(tags=["shift-plan"])


class PortalDayStatusUpsertIn(BaseModel):
    employment_id: int = Field(..., ge=1)
    date: str = Field(..., description="YYYY-MM-DD")
    status: str | None = Field(
        None,
        description="HOLIDAY | OFF | SICKNESS | PARAGRAPH | null",
        pattern="^(HOLIDAY|OFF|SICKNESS|PARAGRAPH)?$",
        examples=["HOLIDAY", "SICKNESS"],
    )
    confirm_delete_conflicts: bool = False


class PortalShiftPlanUpsertIn(BaseModel):
    employment_id: int = Field(..., ge=1)
    date: str = Field(..., description="YYYY-MM-DD")
    arrival_time: str | None = Field(None, description="HH:MM or null")
    departure_time: str | None = Field(None, description="HH:MM or null")
    status: str | None = Field(
        None, description="HOLIDAY | OFF | null", pattern="^(HOLIDAY|OFF)?$", examples=["HOLIDAY", "OFF"]
    )


class OkOut(BaseModel):
    ok: bool = True


def _ensure_day_in_employment_period(employment: Employment, day: dt.date) -> None:
    if day < employment.start_date or (employment.end_date is not None and day > employment.end_date):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Zvolené datum neleží v období platnosti vybraného úvazku.",
        )


@router.put("/api/v1/shift-plan", response_model=OkOut)
def portal_upsert_shift_plan(
    body: PortalShiftPlanUpsertIn,
    db: Session = Depends(get_db),
    auth: PortalUserAuth = Depends(require_portal_user_auth),
) -> OkOut:
    employment = _require_accessible_employment(body.employment_id, auth, db)

    try:
        day = parse_yyyy_mm_dd(body.date)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    _ensure_day_in_employment_period(employment, day)
    ensure_month_unlocked(db, lock_type=LockType.SHIFT_PLAN, employment_id=employment.id, year=day.year, month=day.month)
    if not can_employee_edit_shift_plan(db, employment_id=employment.id, year=day.year, month=day.month):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Zadávání plánu služeb není pro tento úvazek a měsíc povoleno.",
        )

    try:
        arrival = parse_hhmm_or_none(body.arrival_time)
        departure = parse_hhmm_or_none(body.departure_time)
        status_value = normalize_day_status(body.status)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    blocked_status = get_day_status(db, employment_id=employment.id, day=day)
    if blocked_status is not None and status_value is None and (arrival is not None or departure is not None):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Do dne označeného jako {day_status_label(blocked_status)} nelze zapisovat plán směny.",
        )
    if status_value is not None:
        if status_value in {DAY_STATUS_SICKNESS, DAY_STATUS_PARAGRAPH}:
            raise_api_error(
                status.HTTP_400_BAD_REQUEST,
                "shift_plan_status_forbidden",
                "NEMOC a PARAGRAF lze evidovat pouze v docházce.",
            )
        arrival = None
        departure = None

    existing = db.query(ShiftPlan).filter(ShiftPlan.employment_id == employment.id, ShiftPlan.date == day).one_or_none()
    if arrival is None and departure is None and status_value is None:
        if existing is not None:
            db.delete(existing)
            db.commit()
        return OkOut(ok=True)

    if existing is None:
        existing = ShiftPlan(
            employment_id=employment.id,
            instance_id=auth.instance.id,
            date=day,
            arrival_time=arrival,
            departure_time=departure,
            status=status_value,
        )
        db.add(existing)
    else:
        existing.arrival_time = arrival
        existing.departure_time = departure
        existing.status = status_value
        existing.instance_id = auth.instance.id
    db.commit()
    return OkOut(ok=True)


@router.put("/api/v1/shift-plan/day-status", response_model=OkOut)
def portal_upsert_day_status(
    body: PortalDayStatusUpsertIn,
    db: Session = Depends(get_db),
    auth: PortalUserAuth = Depends(require_portal_user_auth),
) -> OkOut:
    employment = _require_accessible_employment(body.employment_id, auth, db)

    try:
        day = parse_yyyy_mm_dd(body.date)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    _ensure_day_in_employment_period(employment, day)
    ensure_month_unlocked(db, lock_type=LockType.SHIFT_PLAN, employment_id=employment.id, year=day.year, month=day.month)

    try:
        status_value = normalize_day_status(body.status)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    attendance = db.execute(
        select(Attendance).where(
            Attendance.employment_id == employment.id,
            Attendance.date == day,
        )
    ).scalar_one_or_none()
    conflicts = collect_day_status_conflicts(db, employment_id=employment.id, day=day)
    if status_value is not None and conflicts.attendance_exists and is_month_locked(
        db,
        lock_type=LockType.ATTENDANCE,
        employment_id=employment.id,
        year=day.year,
        month=day.month,
    ):
        raise_api_error(status.HTTP_423_LOCKED, "attendance_month_locked", "Docházka za zvolené období je uzamčena.")

    if status_value is None:
        if attendance is not None and attendance.status:
            attendance.status = None
            attendance.instance_id = auth.instance.id
            if not any([attendance.arrival_time, attendance.departure_time, attendance.arrival_time_2, attendance.departure_time_2]):
                db.delete(attendance)
        conflicts = set_day_status(
            db,
            employment=employment,
            day=day,
            status=None,
            confirm_delete_conflicts=body.confirm_delete_conflicts,
            instance_id=auth.instance.id,
        )
    elif status_value in {DAY_STATUS_SICKNESS, DAY_STATUS_PARAGRAPH}:
        plan = get_shift_plan_day(db, employment_id=employment.id, day=day)
        has_conflicts = bool(
            (attendance and (attendance.arrival_time or attendance.departure_time or attendance.arrival_time_2 or attendance.departure_time_2))
            or (plan and (plan.arrival_time or plan.departure_time or plan.status in {DAY_STATUS_HOLIDAY, DAY_STATUS_OFF}))
        )
        if has_conflicts and not body.confirm_delete_conflicts:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=conflicts.to_detail(employment_id=employment.id, day=day, next_status=status_value),
            )
        if plan is not None:
            db.delete(plan)
        if attendance is None:
            attendance = Attendance(
                employment_id=employment.id,
                instance_id=auth.instance.id,
                date=day,
                status=status_value,
            )
            db.add(attendance)
        else:
            attendance.instance_id = auth.instance.id
            attendance.arrival_time = None
            attendance.departure_time = None
            attendance.arrival_time_2 = None
            attendance.departure_time_2 = None
            attendance.status = status_value
    else:
        if attendance is not None and attendance.status:
            if not body.confirm_delete_conflicts:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=conflicts.to_detail(employment_id=employment.id, day=day, next_status=status_value),
                )
            attendance.status = None
            if not any([attendance.arrival_time, attendance.departure_time, attendance.arrival_time_2, attendance.departure_time_2]):
                db.delete(attendance)
        conflicts = set_day_status(
            db,
            employment=employment,
            day=day,
            status=status_value,
            confirm_delete_conflicts=body.confirm_delete_conflicts,
            instance_id=auth.instance.id,
        )
    if status_value is not None and conflicts.has_conflicts and not body.confirm_delete_conflicts:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=conflicts.to_detail(employment_id=employment.id, day=day, next_status=status_value),
        )

    db.commit()
    return OkOut(ok=True)
