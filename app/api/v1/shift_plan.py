# ruff: noqa: B008
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ...api.errors import raise_api_error
from ...db.models import Employment, ShiftPlan
from ...db.session import get_db
from ...services.day_status import (
    collect_day_status_conflicts,
    day_status_label,
    get_day_status,
    normalize_day_status,
    set_shift_plan_status,
)
from ...services.locks import LockType, ensure_month_unlocked
from ...utils.timeparse import parse_hhmm_or_none, parse_yyyy_mm_dd
from ..deps import PortalUserAuth, require_portal_user_auth
from .attendance import _require_accessible_employment

router = APIRouter(tags=["shift-plan"])


class PortalDayStatusUpsertIn(BaseModel):
    employment_id: int = Field(..., ge=1)
    date: str = Field(..., description="YYYY-MM-DD")
    status: str | None = Field(
        None,
        description="HOLIDAY | OFF | null",
        pattern="^(HOLIDAY|OFF)?$",
        examples=["HOLIDAY", "OFF"],
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
        raise_api_error(
            status.HTTP_409_CONFLICT,
            "employment_period_mismatch",
            "Zvolené datum neleží v období platnosti vybraného úvazku.",
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
    except ValueError:
        raise_api_error(status.HTTP_400_BAD_REQUEST, "invalid_date_format", "Neplatný formát data.")

    _ensure_day_in_employment_period(employment, day)
    ensure_month_unlocked(db, lock_type=LockType.SHIFT_PLAN, employment_id=employment.id, year=day.year, month=day.month)

    try:
        arrival = parse_hhmm_or_none(body.arrival_time)
        departure = parse_hhmm_or_none(body.departure_time)
    except ValueError:
        raise_api_error(status.HTTP_400_BAD_REQUEST, "invalid_time_format", "Neplatný formát času.")
    try:
        status_value = normalize_day_status(body.status)
    except ValueError:
        raise_api_error(status.HTTP_400_BAD_REQUEST, "invalid_day_status", "Neplatný stav dne.")

    blocked_status = get_day_status(db, employment_id=employment.id, day=day)
    if blocked_status is not None and status_value is None and (arrival is not None or departure is not None):
        raise_api_error(
            status.HTTP_409_CONFLICT,
            "shift_plan_blocked_by_day_status",
            f"Do dne označeného jako {day_status_label(blocked_status)} nelze zapisovat plán směny.",
            day_status=blocked_status,
        )
    if status_value is not None:
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
    except ValueError:
        raise_api_error(status.HTTP_400_BAD_REQUEST, "invalid_date_format", "Neplatný formát data.")

    _ensure_day_in_employment_period(employment, day)
    ensure_month_unlocked(db, lock_type=LockType.SHIFT_PLAN, employment_id=employment.id, year=day.year, month=day.month)

    try:
        status_value = normalize_day_status(body.status)
    except ValueError:
        raise_api_error(status.HTTP_400_BAD_REQUEST, "invalid_day_status", "Neplatný stav dne.")

    conflicts = collect_day_status_conflicts(db, employment_id=employment.id, day=day)
    if status_value is not None and conflicts.attendance_exists:
        raise_api_error(
            status.HTTP_409_CONFLICT,
            "shift_plan_status_conflicts_with_attendance",
            "Nejprve odstraňte docházková data nebo celodenní docházkový stav pro tento den.",
        )

    if status_value is None:
        conflicts = set_shift_plan_status(
            db,
            employment=employment,
            day=day,
            status=None,
            confirm_reset_existing_plan=body.confirm_delete_conflicts,
            instance_id=auth.instance.id,
        )
    else:
        conflicts = set_shift_plan_status(
            db,
            employment=employment,
            day=day,
            status=status_value,
            confirm_reset_existing_plan=body.confirm_delete_conflicts,
            instance_id=auth.instance.id,
        )
    if status_value is not None and conflicts.shift_plan_exists and not body.confirm_delete_conflicts:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=conflicts.to_detail(employment_id=employment.id, day=day, next_status=status_value),
        )

    db.commit()
    return OkOut(ok=True)
