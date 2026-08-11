# ruff: noqa: B008
from __future__ import annotations

import datetime as dt
from types import SimpleNamespace
from typing import cast

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, joinedload

from app.api.deps import require_admin
from app.api.errors import raise_api_error
from app.api.v1.attendance import MetricOut, _metric_out, _metrics_out
from app.db.models import (
    AttendanceEvent,
    Employment,
    ShiftPlan,
    ShiftPlanMonthInstance,
)
from app.db.session import get_db
from app.security.csrf import require_csrf
from app.services.attendance_mutations import (
    changed_event_days,
    interval_signatures,
    months_for_days,
)
from app.services.daily_metrics import sync_employment_metric_months
from app.services.day_status import (
    DAY_STATUS_HOLIDAY,
    DAY_STATUS_OFF,
    DAY_STATUS_PARAGRAPH,
    DAY_STATUS_SICKNESS,
    collect_day_status_conflicts,
    conflicting_shift_plan_months,
    day_status_label,
    get_day_status,
    has_shift_plan_carryover,
    normalize_day_status,
    replace_day_status,
)
from app.services.employment_access import (
    display_metrics_for_employment,
    employment_label,
    employment_overlaps_month,
    lock_employment_for_time_mutation,
    locked_employment_has_active_user,
)
from app.services.locks import (
    LockType,
    ensure_month_unlocked,
    load_locked_employment_ids,
)
from app.services.month_summary import build_month_summaries
from app.services.time_intervals import (
    shift_plan_carryover,
    shift_plan_days,
    shift_plan_months,
    shift_plans_overlap,
)
from app.utils.timeparse import parse_hhmm_or_none, parse_yyyy_mm_dd

router = APIRouter(tags=["admin"])


class ActiveEmploymentOut(BaseModel):
    id: int
    user_id: int
    user_name: str
    title: str
    employment_type: str
    display_label: str
    start_date: str
    end_date: str | None = None
    is_active: bool
    user_is_active: bool
    is_active_in_month: bool


class ShiftPlanDayOut(BaseModel):
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


class ShiftPlanSummaryOut(BaseModel):
    planned_minutes: int
    planned_hours: float
    scheduled_days: int
    holiday_days: int
    off_days: int
    planned: dict[str, MetricOut | None] | None


class ShiftPlanRowOut(BaseModel):
    employment_id: int
    user_id: int
    user_name: str
    title: str
    employment_type: str
    display_label: str
    start_date: str
    end_date: str | None = None
    is_active_in_month: bool
    shift_plan_locked: bool = False
    attendance_locked: bool = False
    display_metrics: list[str]
    days: list[ShiftPlanDayOut]
    summary: ShiftPlanSummaryOut


class ShiftPlanMonthOut(BaseModel):
    year: int
    month: int
    selected_employment_ids: list[int] = []
    available_employments: list[ActiveEmploymentOut] = []
    rows: list[ShiftPlanRowOut] = []


class ShiftPlanSelectionIn(BaseModel):
    year: int = Field(..., ge=2000, le=2100)
    month: int = Field(..., ge=1, le=12)
    employment_ids: list[int] = Field(default_factory=list)


class ShiftPlanUpsertIn(BaseModel):
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


class DayStatusUpsertIn(BaseModel):
    employment_id: int = Field(..., ge=1)
    date: str = Field(..., description="YYYY-MM-DD")
    status: str | None = Field(
        None,
        description="HOLIDAY | OFF | SICKNESS | PARAGRAPH | null",
        pattern="^(HOLIDAY|OFF|SICKNESS|PARAGRAPH)?$",
        examples=["HOLIDAY", "SICKNESS"],
    )
    confirm_delete_conflicts: bool = False


class OkOut(BaseModel):
    ok: bool = True


def _admin_username(admin: object) -> str | None:
    if isinstance(admin, dict):
        value = admin.get("username")
    else:
        value = getattr(admin, "username", None)
    return value if isinstance(value, str) and value else None


def _month_range(year: int, month: int) -> tuple[dt.date, dt.date]:
    if month < 1 or month > 12:
        raise ValueError("month out of range")
    start = dt.date(year, month, 1)
    if month == 12:
        end = dt.date(year + 1, 1, 1)
    else:
        end = dt.date(year, month + 1, 1)
    return start, end


def _employment_is_active_in_month(
    employment: Employment, month_start: dt.date, month_end: dt.date
) -> bool:
    user_is_active = bool(employment.user.is_active) if employment.user is not None else False
    return user_is_active and employment_overlaps_month(employment, month_start, month_end)


def _to_active_employment_out(
    employment: Employment, month_start: dt.date, month_end: dt.date
) -> ActiveEmploymentOut:
    user_name = employment.user.name if employment.user else f"Uživatel {employment.user_id}"
    return ActiveEmploymentOut(
        id=employment.id,
        user_id=employment.user_id,
        user_name=user_name,
        title=employment.title,
        employment_type=employment.employment_type,
        display_label=employment_label(employment, user_name),
        start_date=employment.start_date.isoformat(),
        end_date=employment.end_date.isoformat() if employment.end_date is not None else None,
        is_active=employment.is_active,
        user_is_active=bool(employment.user.is_active) if employment.user is not None else False,
        is_active_in_month=_employment_is_active_in_month(employment, month_start, month_end),
    )


def _get_employment(employment_id: int, db: Session) -> Employment:
    employment = (
        db.execute(
            select(Employment)
            .options(joinedload(Employment.user))
            .where(Employment.id == employment_id)
        )
        .scalars()
        .first()
    )
    if employment is None:
        raise HTTPException(status_code=404, detail="Uvazek nenalezen.")
    return employment


def _load_available_employment_rows(db: Session, start: dt.date, end: dt.date) -> list[Employment]:
    return list(
        db.execute(
            select(Employment)
            .options(joinedload(Employment.user))
            .where(Employment.is_active.is_(True))
            .where(Employment.start_date < end)
            .where(Employment.end_date.is_(None) | (Employment.end_date >= start))
            .order_by(Employment.start_date.asc(), Employment.id.asc())
        )
        .unique()
        .scalars()
        .all()
    )


@router.get("/api/v1/admin/shift-plan", response_model=ShiftPlanMonthOut)
def admin_get_shift_plan_month(
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    _admin=Depends(require_admin),
    db: Session = Depends(get_db),
) -> ShiftPlanMonthOut:
    return _admin_get_shift_plan_month_impl(db=db, year=year, month=month)


def _admin_get_shift_plan_month_impl(db: Session, *, year: int, month: int) -> ShiftPlanMonthOut:
    start, end = _month_range(year, month)
    available_employments = [
        item
        for item in _load_available_employment_rows(db, start, end)
        if item.user is not None and item.user.is_active
    ]
    available_out = [_to_active_employment_out(item, start, end) for item in available_employments]
    active_default_ids = [
        item.id
        for item in available_employments
        if _employment_is_active_in_month(item, start, end)
    ]

    try:
        selected = (
            db.execute(
                select(ShiftPlanMonthInstance)
                .where(ShiftPlanMonthInstance.year == year)
                .where(ShiftPlanMonthInstance.month == month)
                .order_by(ShiftPlanMonthInstance.id.asc())
            )
            .scalars()
            .all()
        )
        selected_ids = [row.employment_id for row in selected]
    except SQLAlchemyError:
        # Na starších produkčních datech může selhat pouze tabulka výběru měsíce.
        # Pro samotné zobrazení plánu je bezpečné spadnout zpět na všechny dostupné úvazky.
        selected_ids = []
    if not selected_ids:
        selected_ids = active_default_ids
    selected_ids = [
        employment_id for employment_id in selected_ids if employment_id in active_default_ids
    ]
    if not selected_ids:
        selected_ids = active_default_ids
    if not selected_ids:
        return ShiftPlanMonthOut(
            year=year,
            month=month,
            selected_employment_ids=[],
            available_employments=available_out,
            rows=[],
        )

    shift_plan_table = ShiftPlan.__table__
    plan_rows = (
        db.execute(
            select(
                shift_plan_table.c.employment_id,
                shift_plan_table.c.date,
                shift_plan_table.c.arrival_time,
                shift_plan_table.c.departure_time,
                shift_plan_table.c.status,
            )
            .where(shift_plan_table.c.employment_id.in_(selected_ids))
            .where(shift_plan_table.c.date >= start - dt.timedelta(days=1))
            .where(shift_plan_table.c.date < end)
            .order_by(shift_plan_table.c.date.asc())
        )
        .mappings()
        .all()
    )
    plan_map: dict[tuple[int, dt.date], SimpleNamespace] = {
        (int(row["employment_id"]), row["date"]): SimpleNamespace(
            employment_id=int(row["employment_id"]),
            date=row["date"],
            arrival_time=row["arrival_time"],
            departure_time=row["departure_time"],
            status=row["status"],
        )
        for row in plan_rows
    }
    shift_plan_locked_ids = load_locked_employment_ids(
        db,
        lock_type=LockType.SHIFT_PLAN,
        employment_ids=selected_ids,
        year=year,
        month=month,
    )
    attendance_locked_ids = load_locked_employment_ids(
        db,
        lock_type=LockType.ATTENDANCE,
        employment_ids=selected_ids,
        year=year,
        month=month,
    )
    selected_employments = [item for item in available_employments if item.id in selected_ids]
    summaries = build_month_summaries(db, employments=selected_employments, year=year, month=month)
    rows: list[ShiftPlanRowOut] = []
    for employment in selected_employments:
        employment_id = employment.id
        summary = summaries[employment_id]
        day_summaries = {item.date: item for item in summary.day_summaries}
        cur = start
        days: list[ShiftPlanDayOut] = []
        planned_minutes = 0
        scheduled_days = 0
        holiday_days = 0
        off_days = 0
        while cur < end:
            direct_row = plan_map.get((employment_id, cur))
            employment_plans = [
                row
                for (row_employment_id, _date), row in plan_map.items()
                if row_employment_id == employment_id
            ]
            carryover = shift_plan_carryover(cast(list[ShiftPlan], employment_plans), cur)
            day_summary = day_summaries[cur]
            day_planned_minutes = day_summary.planned_minutes
            planned_minutes += day_planned_minutes
            scheduled_days += int(
                direct_row is not None
                and direct_row.arrival_time is not None
                and direct_row.departure_time is not None
            )
            holiday_days += int(direct_row is not None and direct_row.status == DAY_STATUS_HOLIDAY)
            off_days += int(direct_row is not None and direct_row.status == DAY_STATUS_OFF)
            days.append(
                ShiftPlanDayOut(
                    date=cur.isoformat(),
                    arrival_time=direct_row.arrival_time if direct_row else None,
                    departure_time=(
                        direct_row.departure_time
                        if direct_row
                        else carryover.departure_time
                        if carryover
                        else None
                    ),
                    status=direct_row.status if direct_row else None,
                    effective_status=day_summary.effective_status,
                    is_carryover=direct_row is None and carryover is not None,
                    carryover_departure_time=carryover.departure_time if carryover else None,
                    is_within_employment_period=employment.start_date <= cur
                    and (employment.end_date is None or cur <= employment.end_date),
                    planned_minutes=day_planned_minutes,
                    planned_hours=day_summary.planned_hours,
                    planned_state=day_summary.planned_state,
                    planned=_metrics_out(day_summary.planned),
                )
            )
            cur = cur + dt.timedelta(days=1)
        user_name = employment.user.name if employment.user else f"Uživatel {employment.user_id}"
        rows.append(
            ShiftPlanRowOut(
                employment_id=employment.id,
                user_id=employment.user_id,
                user_name=user_name,
                title=employment.title,
                employment_type=employment.employment_type,
                display_label=employment_label(employment, user_name),
                start_date=employment.start_date.isoformat(),
                end_date=employment.end_date.isoformat()
                if employment.end_date is not None
                else None,
                is_active_in_month=_employment_is_active_in_month(employment, start, end),
                shift_plan_locked=employment.id in shift_plan_locked_ids,
                attendance_locked=employment.id in attendance_locked_ids,
                display_metrics=display_metrics_for_employment(employment),
                days=days,
                summary=ShiftPlanSummaryOut(
                    planned_minutes=planned_minutes,
                    planned_hours=summary.planned_hours,
                    scheduled_days=scheduled_days,
                    holiday_days=holiday_days,
                    off_days=off_days,
                    planned={
                        key: _metric_out(value) for key, value in (summary.planned or {}).items()
                    }
                    if summary.planned
                    else None,
                ),
            )
        )

    return ShiftPlanMonthOut(
        year=year,
        month=month,
        selected_employment_ids=selected_ids,
        available_employments=available_out,
        rows=rows,
    )


@router.put("/api/v1/admin/shift-plan", response_model=OkOut)
def admin_upsert_shift_plan(
    body: ShiftPlanUpsertIn,
    _admin=Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> OkOut:
    return _admin_upsert_shift_plan_impl(db=db, body=body)


def _admin_upsert_shift_plan_impl(db: Session, body: ShiftPlanUpsertIn) -> OkOut:
    employment = _get_employment(body.employment_id, db)
    employment = lock_employment_for_time_mutation(db, employment.id)
    if not locked_employment_has_active_user(db, employment):
        raise_api_error(
            409, "employment_not_active", "Vybraný úvazek nebo jeho uživatel už není aktivní."
        )

    try:
        day = parse_yyyy_mm_dd(body.date)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if day < employment.start_date or (
        employment.end_date is not None and day > employment.end_date
    ):
        raise_api_error(
            409, "employment_period_mismatch", "Datum nelezi v obdobi platnosti vybraneho uvazku."
        )
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
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if body.status not in (None, DAY_STATUS_HOLIDAY, DAY_STATUS_OFF):
        raise_api_error(
            400, "invalid_day_status", "Invalid status, expected HOLIDAY or OFF or null"
        )
    blocked_status = get_day_status(db, employment_id=employment.id, day=day)
    if (
        blocked_status is not None
        and body.status is None
        and (arrival is not None or departure is not None)
    ):
        raise_api_error(
            409,
            "shift_plan_blocked_by_day_status",
            f"Do dne označeného jako {day_status_label(blocked_status)} nelze zapisovat plán směny.",
            blocked_status=blocked_status,
        )
    if body.status is not None:
        conflicts = collect_day_status_conflicts(db, employment_id=employment.id, day=day)
        if conflicts.attendance_exists:
            raise_api_error(
                409,
                "shift_plan_status_conflicts_with_attendance",
                "Celodenní stav plánu nelze nastavit přes existující docházku.",
            )
        if has_shift_plan_carryover(db, employment_id=employment.id, day=day):
            raise_api_error(
                409,
                "shift_plan_status_conflicts_with_carryover",
                "Stav dne nastavte přes potvrzovaný editor nepřítomnosti.",
            )
        if conflicts.shift_plan_exists and not body.confirm_delete_conflicts:
            raise_api_error(
                409,
                "shift_plan_status_confirmation_required",
                "Nahrazení existující směny celodenním stavem vyžaduje potvrzení.",
            )
        arrival = None
        departure = None

    existing = db.execute(
        select(ShiftPlan).where(
            ShiftPlan.employment_id == employment.id,
            ShiftPlan.date == day,
        )
    ).scalar_one_or_none()
    candidate = (
        None
        if arrival is None and departure is None and body.status is None
        else ShiftPlan(
            employment_id=employment.id,
            date=day,
            arrival_time=arrival,
            departure_time=departure,
            status=body.status,
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
            409,
            "shift_plan_overlap",
            "Plánovaná směna se překrývá s jinou směnou tohoto úvazku.",
        )
    for candidate_day in shift_plan_days(candidate):
        if candidate_day < employment.start_date or (
            employment.end_date is not None and candidate_day > employment.end_date
        ):
            raise_api_error(
                409,
                "employment_period_mismatch",
                "Přeshraniční směna zasahuje mimo období platnosti úvazku.",
            )
        if (
            candidate_day != day
            and get_day_status(db, employment_id=employment.id, day=candidate_day) is not None
        ):
            raise_api_error(
                409,
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

    if arrival is None and departure is None and body.status is None:
        if existing is not None:
            db.delete(existing)
            db.flush()
            sync_employment_metric_months(db, employment=employment, months=affected_months)
            db.commit()
        return OkOut(ok=True)

    if existing is None:
        existing = ShiftPlan(
            employment_id=employment.id,
            instance_id=employment.user.instance_id if employment.user else None,
            date=day,
            arrival_time=arrival,
            departure_time=departure,
            status=body.status,
        )
        db.add(existing)
    else:
        existing.arrival_time = arrival
        existing.departure_time = departure
        existing.status = body.status

    db.flush()
    sync_employment_metric_months(db, employment=employment, months=affected_months)
    db.commit()
    return OkOut(ok=True)


@router.put("/api/v1/admin/day-status", response_model=OkOut)
def admin_upsert_day_status(
    body: DayStatusUpsertIn,
    _admin=Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> OkOut:
    employment = _get_employment(body.employment_id, db)
    employment = lock_employment_for_time_mutation(db, employment.id)
    if not locked_employment_has_active_user(db, employment):
        raise_api_error(
            409, "employment_not_active", "Vybraný úvazek nebo jeho uživatel už není aktivní."
        )

    try:
        day = parse_yyyy_mm_dd(body.date)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if day < employment.start_date or (
        employment.end_date is not None and day > employment.end_date
    ):
        raise_api_error(
            409, "employment_period_mismatch", "Datum nelezi v obdobi platnosti vybraneho uvazku."
        )
    try:
        status = normalize_day_status(body.status)
    except ValueError as exc:
        if str(exc) == "invalid_day_status":
            raise_api_error(400, "invalid_day_status", "Neplatný stav dne.")
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    current_status = get_day_status(db, employment_id=employment.id, day=day)
    conflicts = collect_day_status_conflicts(db, employment_id=employment.id, day=day)
    conflict_plan_months = conflicting_shift_plan_months(db, employment_id=employment.id, day=day)
    lock_types: set[LockType] = set()
    if status in {DAY_STATUS_HOLIDAY, DAY_STATUS_OFF} or current_status in {
        DAY_STATUS_HOLIDAY,
        DAY_STATUS_OFF,
    }:
        lock_types.add(LockType.SHIFT_PLAN)
    if status in {DAY_STATUS_SICKNESS, DAY_STATUS_PARAGRAPH} or current_status in {
        DAY_STATUS_SICKNESS,
        DAY_STATUS_PARAGRAPH,
    }:
        lock_types.add(LockType.ATTENDANCE)
    if conflicts.attendance_exists:
        lock_types.add(LockType.ATTENDANCE)
    if conflicts.shift_plan_exists:
        lock_types.add(LockType.SHIFT_PLAN)
    for lock_type in lock_types or {LockType.ATTENDANCE, LockType.SHIFT_PLAN}:
        months = (
            {(day.year, day.month)} | conflict_plan_months
            if lock_type == LockType.SHIFT_PLAN
            else {(day.year, day.month)}
        )
        for year, month in months:
            ensure_month_unlocked(
                db,
                lock_type=lock_type,
                employment_id=employment.id,
                year=year,
                month=month,
            )

    before_events = list(
        db.execute(
            select(AttendanceEvent).where(AttendanceEvent.employment_id == employment.id)
        ).scalars()
    )
    before_intervals = interval_signatures(before_events)
    conflicts = replace_day_status(
        db,
        employment=employment,
        day=day,
        status=status,
        confirm_delete_conflicts=body.confirm_delete_conflicts,
        instance_id=employment.user.instance_id if employment.user else None,
    )
    if status is not None and conflicts.has_conflicts and not body.confirm_delete_conflicts:
        raise HTTPException(
            status_code=409,
            detail=conflicts.to_detail(employment_id=employment.id, day=day, next_status=status),
        )

    db.flush()
    after_events = list(
        db.execute(
            select(AttendanceEvent).where(AttendanceEvent.employment_id == employment.id)
        ).scalars()
    )
    changed_days = changed_event_days(
        before_intervals,
        interval_signatures(after_events),
    ) | {day}
    attendance_affected_months = months_for_days(changed_days)
    affected_months = attendance_affected_months | conflict_plan_months
    if LockType.ATTENDANCE in lock_types:
        for year, month in attendance_affected_months:
            ensure_month_unlocked(
                db,
                lock_type=LockType.ATTENDANCE,
                employment_id=employment.id,
                year=year,
                month=month,
            )
    sync_employment_metric_months(db, employment=employment, months=affected_months)
    db.commit()
    return OkOut(ok=True)


@router.put("/api/v1/admin/shift-plan/selection", response_model=OkOut)
def admin_set_shift_plan_selection(
    body: ShiftPlanSelectionIn,
    _admin=Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> OkOut:
    return _admin_set_shift_plan_selection_impl(db=db, body=body)


def _admin_set_shift_plan_selection_impl(db: Session, body: ShiftPlanSelectionIn) -> OkOut:
    month_start, month_end = _month_range(body.year, body.month)
    uniq: list[int] = []
    seen: set[int] = set()
    for employment_id in body.employment_ids:
        if employment_id in seen:
            continue
        employment = _get_employment(employment_id, db)
        if not _employment_is_active_in_month(employment, month_start, month_end):
            raise_api_error(
                409,
                "employment_not_active_in_month",
                "Úvazek není ve zvoleném měsíci aktivní.",
            )
        seen.add(employment_id)
        uniq.append(employment_id)

    db.execute(
        delete(ShiftPlanMonthInstance).where(
            ShiftPlanMonthInstance.year == body.year,
            ShiftPlanMonthInstance.month == body.month,
        )
    )
    for employment_id in uniq:
        db.add(
            ShiftPlanMonthInstance(year=body.year, month=body.month, employment_id=employment_id)
        )
    db.commit()
    return OkOut(ok=True)
