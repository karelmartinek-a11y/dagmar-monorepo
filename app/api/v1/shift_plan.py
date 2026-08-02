# ruff: noqa: B008
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ...api.errors import raise_api_error
from ...db.models import Employment, EmploymentGroup, EmploymentGroupMember, PortalUser, ShiftPlan
from ...db.session import get_db
from ...services.daily_metrics import sync_employment_metric_months
from ...services.day_status import (
    collect_day_status_conflicts,
    conflicting_shift_plan_months,
    day_status_label,
    get_day_status,
    has_shift_plan_carryover,
    normalize_day_status,
    replace_day_status,
    set_shift_plan_status,
)
from ...services.employment_access import (
    display_metrics_for_employment,
    employment_label,
    employment_overlaps_month,
    lock_employment_for_time_mutation,
    locked_employment_has_active_user,
)
from ...services.locks import LockType, ensure_month_unlocked, is_month_locked
from ...services.month_summary import build_month_summaries
from ...services.time_intervals import (
    shift_plan_carryover,
    shift_plan_days,
    shift_plan_months,
    shift_plans_overlap,
)
from ...utils.timeparse import parse_hhmm_or_none, parse_yyyy_mm_dd
from ..deps import PortalUserAuth, require_portal_user_auth
from .attendance import MetricOut, _metric_out, _metrics_out, _require_accessible_employment

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
        None,
        description="HOLIDAY | OFF | null",
        pattern="^(HOLIDAY|OFF)?$",
        examples=["HOLIDAY", "OFF"],
    )
    confirm_delete_conflicts: bool = False


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
    effective_status: str | None = None
    is_carryover: bool = False
    carryover_departure_time: str | None = None
    is_within_employment_period: bool
    planned_minutes: int
    planned_hours: float
    planned_state: str
    planned: dict[str, MetricOut | None] | None


class GroupShiftPlanRowOut(BaseModel):
    employment_id: int
    display_label: str
    is_own_employment: bool
    shift_plan_locked: bool
    display_metrics: list[str]
    days: list[GroupShiftPlanDayOut]
    planned_minutes: int
    planned_hours: float
    planned: dict[str, MetricOut | None] | None


class GroupShiftPlanMonthOut(BaseModel):
    group_id: int
    group_name: str
    year: int
    month: int
    rows: list[GroupShiftPlanRowOut]


def _ensure_day_in_employment_period(employment: Employment, day: dt.date) -> None:
    if day < employment.start_date or (
        employment.end_date is not None and day > employment.end_date
    ):
        raise_api_error(
            status.HTTP_409_CONFLICT,
            "employment_period_mismatch",
            "Zvolené datum neleží v období platnosti vybraného úvazku.",
        )


def _require_active_employment_for_edit(db: Session, employment: Employment) -> None:
    if not locked_employment_has_active_user(db, employment):
        raise_api_error(
            status.HTTP_409_CONFLICT,
            "employment_not_active",
            "Vybraný úvazek nebo jeho uživatel už není aktivní a plán směn nelze měnit.",
        )


def _month_range(year: int, month: int) -> tuple[dt.date, dt.date]:
    start = dt.date(year, month, 1)
    end = dt.date(year + 1, 1, 1) if month == 12 else dt.date(year, month + 1, 1)
    return start, end


def _accessible_group(
    db: Session,
    *,
    group_id: int,
    auth: PortalUserAuth,
    month_start: dt.date,
    month_end: dt.date,
) -> EmploymentGroup:
    group = (
        db.execute(
            select(EmploymentGroup)
            .options(
                joinedload(EmploymentGroup.members)
                .joinedload(EmploymentGroupMember.employment)
                .joinedload(Employment.user)
            )
            .where(EmploymentGroup.id == group_id)
        )
        .unique()
        .scalars()
        .first()
    )
    if group is None or not auth.user.is_active or not any(
        member.employment.user_id == auth.user.id
        and member.employment.is_active
        and member.employment.user is not None
        and member.employment.user.is_active
        and employment_overlaps_month(member.employment, month_start, month_end)
        for member in group.members
    ):
        # Deliberately indistinguishable for absent and unauthorized groups.
        raise_api_error(status.HTTP_404_NOT_FOUND, "group_not_found", "Skupina nebyla nalezena.")
    return group


@router.get("/api/v1/shift-plan/groups", response_model=GroupListOut)
def portal_list_shift_plan_groups(
    year: int,
    month: int,
    db: Session = Depends(get_db),
    auth: PortalUserAuth = Depends(require_portal_user_auth),
) -> GroupListOut:
    if year < 2000 or year > 2100 or month < 1 or month > 12:
        raise_api_error(status.HTTP_400_BAD_REQUEST, "invalid_month", "Neplatný měsíc.")
    start, end = _month_range(year, month)
    groups = (
        db.execute(
            select(EmploymentGroup)
            .join(EmploymentGroupMember)
            .join(Employment)
            .join(PortalUser, PortalUser.id == Employment.user_id)
            .where(
                Employment.user_id == auth.user.id,
                Employment.is_active.is_(True),
                PortalUser.is_active.is_(True),
                Employment.start_date < end,
                Employment.end_date.is_(None) | (Employment.end_date >= start),
            )
            .distinct()
            .order_by(EmploymentGroup.name.asc(), EmploymentGroup.id.asc())
        )
        .scalars()
        .all()
    )
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
    start, end = _month_range(year, month)
    group = _accessible_group(
        db, group_id=group_id, auth=auth, month_start=start, month_end=end
    )
    active_members = [
        member
        for member in group.members
        if member.employment.is_active
        and member.employment.user is not None
        and member.employment.user.is_active
        and employment_overlaps_month(member.employment, start, end)
    ]
    employment_ids = [member.employment_id for member in active_members]
    plans = (
        db.execute(
            select(ShiftPlan).where(
                ShiftPlan.employment_id.in_(employment_ids),
                ShiftPlan.date >= start - dt.timedelta(days=1),
                ShiftPlan.date < end,
            )
        )
        .scalars()
        .all()
    )
    by_key = {(plan.employment_id, plan.date): plan for plan in plans}
    days = [start + dt.timedelta(days=index) for index in range((end - start).days)]
    member_employments = [member.employment for member in active_members]
    summaries = build_month_summaries(db, employments=member_employments, year=year, month=month)
    rows: list[GroupShiftPlanRowOut] = []
    for member in sorted(
        active_members, key=lambda item: (item.employment.user.name.lower(), item.employment_id)
    ):
        employment = member.employment
        summary = summaries[employment.id]
        day_summaries = {item.date: item for item in summary.day_summaries}

        def day_out(
            day: dt.date,
            *,
            current_employment: Employment = employment,
            current_day_summaries=day_summaries,
        ) -> GroupShiftPlanDayOut:
            direct_plan = by_key.get((current_employment.id, day))
            employment_plans = [
                plan for (employment_id, _date), plan in by_key.items()
                if employment_id == current_employment.id
            ]
            carryover = shift_plan_carryover(employment_plans, day)
            day_summary = current_day_summaries[day]
            return GroupShiftPlanDayOut(
                date=day.isoformat(),
                arrival_time=direct_plan.arrival_time if direct_plan else None,
                departure_time=(
                    direct_plan.departure_time
                    if direct_plan
                    else carryover.departure_time
                    if carryover
                    else None
                ),
                status=direct_plan.status if direct_plan else None,
                effective_status=day_summary.effective_status,
                is_carryover=direct_plan is None and carryover is not None,
                carryover_departure_time=carryover.departure_time if carryover else None,
                is_within_employment_period=day >= current_employment.start_date
                and (current_employment.end_date is None or day <= current_employment.end_date),
                planned_minutes=day_summary.planned_minutes,
                planned_hours=day_summary.planned_hours,
                planned_state=day_summary.planned_state,
                planned=_metrics_out(day_summary.planned),
            )

        rows.append(
            GroupShiftPlanRowOut(
                employment_id=employment.id,
                display_label=employment_label(employment, employment.user.name),
                is_own_employment=employment.user_id == auth.user.id,
                shift_plan_locked=is_month_locked(
                    db,
                    lock_type=LockType.SHIFT_PLAN,
                    employment_id=employment.id,
                    year=year,
                    month=month,
                ),
                display_metrics=display_metrics_for_employment(employment),
                days=[day_out(day) for day in days],
                planned_minutes=summary.planned_minutes,
                planned_hours=summary.planned_hours,
                planned={key: _metric_out(value) for key, value in (summary.planned or {}).items()}
                if summary.planned
                else None,
            )
        )
    return GroupShiftPlanMonthOut(
        group_id=group.id, group_name=group.name, year=year, month=month, rows=rows
    )


@router.put("/api/v1/shift-plan", response_model=OkOut)
def portal_upsert_shift_plan(
    body: PortalShiftPlanUpsertIn,
    db: Session = Depends(get_db),
    auth: PortalUserAuth = Depends(require_portal_user_auth),
) -> OkOut:
    employment = _require_accessible_employment(body.employment_id, auth, db)
    employment = lock_employment_for_time_mutation(db, employment.id)
    _require_active_employment_for_edit(db, employment)

    try:
        day = parse_yyyy_mm_dd(body.date)
    except ValueError:
        raise_api_error(status.HTTP_400_BAD_REQUEST, "invalid_date_format", "Neplatný formát data.")

    _ensure_day_in_employment_period(employment, day)
    ensure_month_unlocked(
        db,
        lock_type=LockType.SHIFT_PLAN,
        employment_id=employment.id,
        year=day.year,
        month=day.month,
    )
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
    if (
        blocked_status is not None
        and status_value is None
        and (arrival is not None or departure is not None)
    ):
        raise_api_error(
            status.HTTP_409_CONFLICT,
            "shift_plan_blocked_by_day_status",
            f"Do dne označeného jako {day_status_label(blocked_status)} nelze zapisovat plán směny.",
            day_status=blocked_status,
        )
    if status_value is not None:
        conflicts = collect_day_status_conflicts(db, employment_id=employment.id, day=day)
        if conflicts.attendance_exists:
            raise_api_error(
                status.HTTP_409_CONFLICT,
                "shift_plan_status_conflicts_with_attendance",
                "Celodenní stav plánu nelze nastavit přes existující docházku.",
            )
        if has_shift_plan_carryover(db, employment_id=employment.id, day=day):
            raise_api_error(
                status.HTTP_409_CONFLICT,
                "shift_plan_status_conflicts_with_carryover",
                "Stav dne nastavte přes potvrzovaný editor nepřítomnosti.",
            )
        if conflicts.shift_plan_exists and not body.confirm_delete_conflicts:
            raise_api_error(
                status.HTTP_409_CONFLICT,
                "shift_plan_status_confirmation_required",
                "Nahrazení existující směny celodenním stavem vyžaduje potvrzení.",
            )
        arrival = None
        departure = None

    existing = (
        db.query(ShiftPlan)
        .filter(ShiftPlan.employment_id == employment.id, ShiftPlan.date == day)
        .one_or_none()
    )
    candidate = (
        None
        if arrival is None and departure is None and status_value is None
        else ShiftPlan(
            employment_id=employment.id,
            date=day,
            arrival_time=arrival,
            departure_time=departure,
            status=status_value,
        )
    )
    other_plans_query = select(ShiftPlan).where(ShiftPlan.employment_id == employment.id)
    if existing is not None:
        other_plans_query = other_plans_query.where(ShiftPlan.id != existing.id)
    other_plans = list(db.execute(other_plans_query).scalars())
    if candidate is not None and any(
        shift_plans_overlap(candidate, other) for other in other_plans
    ):
        raise_api_error(
            status.HTTP_409_CONFLICT,
            "shift_plan_overlap",
            "Plánovaná směna se překrývá s jinou směnou tohoto úvazku.",
        )
    for candidate_day in shift_plan_days(candidate):
        _ensure_day_in_employment_period(employment, candidate_day)
        if candidate_day != day and get_day_status(
            db, employment_id=employment.id, day=candidate_day
        ) is not None:
            raise_api_error(
                status.HTTP_409_CONFLICT,
                "shift_plan_blocked_by_day_status",
                "Přeshraniční směna zasahuje do dne s celodenním stavem.",
            )
    affected_months = shift_plan_months(existing) | shift_plan_months(candidate)
    for year, month in affected_months:
        ensure_month_unlocked(
            db,
            lock_type=LockType.SHIFT_PLAN,
            employment_id=employment.id,
            year=year,
            month=month,
        )
    if arrival is None and departure is None and status_value is None:
        if existing is not None:
            db.delete(existing)
            db.flush()
            sync_employment_metric_months(db, employment=employment, months=affected_months)
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
    db.flush()
    sync_employment_metric_months(db, employment=employment, months=affected_months)
    db.commit()
    return OkOut(ok=True)


@router.put("/api/v1/shift-plan/day-status", response_model=OkOut)
def portal_upsert_day_status(
    body: PortalDayStatusUpsertIn,
    db: Session = Depends(get_db),
    auth: PortalUserAuth = Depends(require_portal_user_auth),
) -> OkOut:
    employment = _require_accessible_employment(body.employment_id, auth, db)
    employment = lock_employment_for_time_mutation(db, employment.id)
    _require_active_employment_for_edit(db, employment)

    try:
        day = parse_yyyy_mm_dd(body.date)
    except ValueError:
        raise_api_error(status.HTTP_400_BAD_REQUEST, "invalid_date_format", "Neplatný formát data.")

    _ensure_day_in_employment_period(employment, day)
    ensure_month_unlocked(
        db,
        lock_type=LockType.SHIFT_PLAN,
        employment_id=employment.id,
        year=day.year,
        month=day.month,
    )
    try:
        status_value = normalize_day_status(body.status)
    except ValueError:
        raise_api_error(status.HTTP_400_BAD_REQUEST, "invalid_day_status", "Neplatný stav dne.")

    conflicts = collect_day_status_conflicts(db, employment_id=employment.id, day=day)
    conflict_plan_months = conflicting_shift_plan_months(db, employment_id=employment.id, day=day)
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
        if conflicts.shift_plan_exists:
            for year, month in conflict_plan_months:
                ensure_month_unlocked(
                    db,
                    lock_type=LockType.SHIFT_PLAN,
                    employment_id=employment.id,
                    year=year,
                    month=month,
                )
        conflicts = replace_day_status(
            db,
            employment=employment,
            day=day,
            status=status_value,
            confirm_delete_conflicts=body.confirm_delete_conflicts,
            instance_id=auth.instance.id,
        )
    if (
        status_value is not None
        and conflicts.shift_plan_exists
        and not body.confirm_delete_conflicts
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=conflicts.to_detail(
                employment_id=employment.id, day=day, next_status=status_value
            ),
        )

    db.flush()
    affected_months = {(day.year, day.month)}
    if status_value is not None and conflicts.shift_plan_exists:
        affected_months.update(conflict_plan_months)
    sync_employment_metric_months(
        db,
        employment=employment,
        months=affected_months,
    )
    db.commit()
    return OkOut(ok=True)
