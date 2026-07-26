# ruff: noqa: B008
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ...api.errors import raise_api_error
from ...db.models import Employment, EmploymentGroup, EmploymentGroupMember, ShiftPlan
from ...db.session import get_db
from ...services.day_status import (
    collect_day_status_conflicts,
    day_status_label,
    get_day_status,
    normalize_day_status,
    set_shift_plan_status,
)
from ...services.employment_access import employment_label
from ...services.locks import LockType, ensure_month_unlocked, is_month_locked
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


class GroupOptionOut(BaseModel):
    id: int
    name: str


class GroupListOut(BaseModel):
    groups: list[GroupOptionOut]


class GroupShiftPlanDayOut(BaseModel):
    date: str
    arrival_time: str | None = None
    departure_time: str | None = None
    status: str | None = None
    is_within_employment_period: bool


class GroupShiftPlanRowOut(BaseModel):
    employment_id: int
    display_label: str
    is_own_employment: bool
    shift_plan_locked: bool
    days: list[GroupShiftPlanDayOut]


class GroupShiftPlanMonthOut(BaseModel):
    group_id: int
    group_name: str
    year: int
    month: int
    rows: list[GroupShiftPlanRowOut]


def _ensure_day_in_employment_period(employment: Employment, day: dt.date) -> None:
    if day < employment.start_date or (employment.end_date is not None and day > employment.end_date):
        raise_api_error(
            status.HTTP_409_CONFLICT,
            "employment_period_mismatch",
            "Zvolené datum neleží v období platnosti vybraného úvazku.",
        )


def _month_range(year: int, month: int) -> tuple[dt.date, dt.date]:
    start = dt.date(year, month, 1)
    end = dt.date(year + 1, 1, 1) if month == 12 else dt.date(year, month + 1, 1)
    return start, end


def _accessible_group(db: Session, *, group_id: int, auth: PortalUserAuth) -> EmploymentGroup:
    group = db.execute(
        select(EmploymentGroup)
        .options(joinedload(EmploymentGroup.members).joinedload(EmploymentGroupMember.employment).joinedload(Employment.user))
        .where(EmploymentGroup.id == group_id)
    ).unique().scalars().first()
    if group is None or not any(member.employment.user_id == auth.user.id for member in group.members):
        # Deliberately indistinguishable for absent and unauthorized groups.
        raise_api_error(status.HTTP_404_NOT_FOUND, "group_not_found", "Skupina nebyla nalezena.")
    return group


@router.get("/api/v1/shift-plan/groups", response_model=GroupListOut)
def portal_list_shift_plan_groups(
    db: Session = Depends(get_db), auth: PortalUserAuth = Depends(require_portal_user_auth)
) -> GroupListOut:
    groups = db.execute(
        select(EmploymentGroup)
        .join(EmploymentGroupMember)
        .join(Employment)
        .where(Employment.user_id == auth.user.id)
        .distinct()
        .order_by(EmploymentGroup.name.asc(), EmploymentGroup.id.asc())
    ).scalars().all()
    return GroupListOut(groups=[GroupOptionOut(id=group.id, name=group.name) for group in groups])


@router.get("/api/v1/shift-plan/groups/{group_id}", response_model=GroupShiftPlanMonthOut)
def portal_get_group_shift_plan_month(
    group_id: int,
    year: int = 0,
    month: int = 0,
    db: Session = Depends(get_db),
    auth: PortalUserAuth = Depends(require_portal_user_auth),
) -> GroupShiftPlanMonthOut:
    if year < 2000 or year > 2100 or month < 1 or month > 12:
        raise_api_error(status.HTTP_400_BAD_REQUEST, "invalid_month", "Neplatný měsíc.")
    group = _accessible_group(db, group_id=group_id, auth=auth)
    start, end = _month_range(year, month)
    employment_ids = [member.employment_id for member in group.members]
    plans = db.execute(
        select(ShiftPlan).where(ShiftPlan.employment_id.in_(employment_ids), ShiftPlan.date >= start, ShiftPlan.date < end)
    ).scalars().all()
    by_key = {(plan.employment_id, plan.date): plan for plan in plans}
    days = [start + dt.timedelta(days=index) for index in range((end - start).days)]
    rows: list[GroupShiftPlanRowOut] = []
    for member in sorted(group.members, key=lambda item: (item.employment.user.name.lower(), item.employment_id)):
        employment = member.employment
        def day_out(day: dt.date, *, current_employment: Employment = employment) -> GroupShiftPlanDayOut:
            plan = by_key.get((current_employment.id, day))
            return GroupShiftPlanDayOut(
                date=day.isoformat(),
                arrival_time=plan.arrival_time if plan else None,
                departure_time=plan.departure_time if plan else None,
                status=plan.status if plan else None,
                is_within_employment_period=day >= current_employment.start_date and (current_employment.end_date is None or day <= current_employment.end_date),
            )
        rows.append(GroupShiftPlanRowOut(
            employment_id=employment.id,
            display_label=employment_label(employment, employment.user.name),
            is_own_employment=employment.user_id == auth.user.id,
            shift_plan_locked=is_month_locked(db, lock_type=LockType.SHIFT_PLAN, employment_id=employment.id, year=year, month=month),
            days=[day_out(day) for day in days],
        ))
    return GroupShiftPlanMonthOut(group_id=group.id, group_name=group.name, year=year, month=month, rows=rows)


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
