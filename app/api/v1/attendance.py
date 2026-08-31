# ruff: noqa: B008
from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.deps import PortalUserAuth, require_portal_user_auth
from app.api.errors import raise_api_error
from app.db.models import AttendanceEvent, AttendanceEventType, Employment, ShiftPlan
from app.db.session import get_db
from app.services.attendance_events import add_closed_interval_with_breaks, add_event_with_breaks
from app.services.attendance_mutations import (
    changed_event_days,
    ensure_days_have_no_status,
    interval_signatures,
    months_for_days,
)
from app.services.czech_holidays import czech_public_holiday_label
from app.services.daily_metrics import sync_employment_metric_months
from app.services.day_status import (
    DAY_STATUS_HOLIDAY,
    DAY_STATUS_OFF,
    DAY_STATUS_PARAGRAPH,
    DAY_STATUS_SICKNESS,
    collect_day_status_conflicts,
    conflicting_shift_plan_months,
    get_day_status,
    replace_day_status,
)
from app.services.employment_access import (
    display_metrics_for_employment,
    employment_label,
    lock_employment_for_time_mutation,
    locked_employment_has_active_user,
)
from app.services.locks import LockType, ensure_month_unlocked, is_month_locked
from app.services.month_summary import build_month_summary
from app.services.prague_time import PRAGUE_TIMEZONE, prague_now
from app.services.time_intervals import (
    shift_plan_carryover,
)
from app.services.time_metrics import DailyMetrics, MetricValue

router = APIRouter(tags=["attendance"])


def _require_locked_active_employment(
    db: Session, employment: Employment, auth: PortalUserAuth
) -> None:
    if employment.user_id != auth.user.id or not locked_employment_has_active_user(db, employment):
        raise_api_error(
            409,
            "employment_not_active",
            "Vybraný úvazek nebo jeho uživatel už není aktivní.",
        )


class AttendanceEventIn(BaseModel):
    employment_id: int = Field(..., ge=1)
    occurred_at: datetime
    event_type: AttendanceEventType
    paired_occurred_at: datetime | None = None

    @field_validator("occurred_at", "paired_occurred_at")
    @classmethod
    def require_timezone(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=PRAGUE_TIMEZONE)
        return value.astimezone(PRAGUE_TIMEZONE)


class AttendanceEventOut(BaseModel):
    id: int
    employment_id: int
    occurred_at: str
    event_type: AttendanceEventType
    deletion_partner_id: int | None = None


class MetricOut(BaseModel):
    minutes: int
    tenths: int
    hours: float
    clock: str


class AttendanceDayOut(BaseModel):
    date: str
    events: list[AttendanceEventOut]
    attendance_status: str | None = None
    effective_status: str | None = None
    planned_arrival_time: str | None = None
    planned_departure_time: str | None = None
    planned_status: str | None = None
    planned_is_carryover: bool = False
    planned_carryover_departure_time: str | None = None
    next_event_type: AttendanceEventType
    calendar_tone: str
    public_holiday_label: str | None = None
    is_within_employment_period: bool
    worked: dict[str, MetricOut | None] | None
    planned: dict[str, MetricOut | None] | None
    worked_state: str = "empty"
    planned_state: str = "empty"


class AttendanceMonthOut(BaseModel):
    employment_id: int
    employment_label: str
    display_metrics: list[str]
    days: list[AttendanceDayOut]
    worked: dict[str, MetricOut | None] | None
    planned: dict[str, MetricOut | None] | None
    attendance_locked: bool = False
    shift_plan_locked: bool = False


class AvailableEmploymentOut(BaseModel):
    id: int
    user_id: int
    title: str
    employment_type: str
    start_date: str
    end_date: str | None
    is_active: bool
    is_current: bool
    label: str


class AttendanceStatusUpsertIn(BaseModel):
    employment_id: int = Field(..., ge=1)
    date: str
    status: str | None = Field(None, pattern="^(HOLIDAY|OFF|SICKNESS|PARAGRAPH)?$")
    confirm_delete_conflicts: bool = False


def _metric_out(value: MetricValue | None) -> MetricOut | None:
    return (
        None
        if value is None
        else MetricOut(
            minutes=value.minutes,
            tenths=value.tenths,
            hours=value.hours,
            clock=f"{value.minutes // 60}:{value.minutes % 60:02d}",
        )
    )


def _metrics_out(metrics: DailyMetrics | None) -> dict[str, MetricOut | None] | None:
    if metrics is None:
        return None
    return {
        key: _metric_out(getattr(metrics, key))
        for key in ("total", "afternoon", "night", "weekend", "public_holiday")
    }


def _employment(auth: PortalUserAuth, employment_id: int, db: Session) -> Employment:
    employment = db.get(Employment, employment_id)
    if (
        employment is None
        or employment.user_id != auth.user.id
        or not employment.is_active
        or not auth.user.is_active
    ):
        raise_api_error(404, "employment_not_found", "Úvazek nebyl nalezen.")
    return employment


def _require_accessible_employment(
    employment_id: int, auth: PortalUserAuth, db: Session
) -> Employment:
    return _employment(auth, employment_id, db)


def _month_range(year: int, month: int) -> tuple[date, date]:
    start = date(year, month, 1)
    end = date(year + (month == 12), 1 if month == 12 else month + 1, 1)
    return start, end


def _day_events(db: Session, employment_id: int, start: date, end: date) -> list[AttendanceEvent]:
    range_start = datetime.combine(start, datetime.min.time(), tzinfo=PRAGUE_TIMEZONE)
    range_end = datetime.combine(end, datetime.min.time(), tzinfo=PRAGUE_TIMEZONE)
    previous = db.execute(
        select(AttendanceEvent)
        .where(
            AttendanceEvent.employment_id == employment_id,
            AttendanceEvent.occurred_at < range_start,
        )
        .order_by(AttendanceEvent.occurred_at.desc(), AttendanceEvent.id.desc())
        .limit(1)
    ).scalar_one_or_none()
    current = list(
        db.execute(
            select(AttendanceEvent)
            .where(
                AttendanceEvent.employment_id == employment_id,
                AttendanceEvent.occurred_at >= range_start,
                AttendanceEvent.occurred_at < range_end,
            )
            .order_by(AttendanceEvent.occurred_at, AttendanceEvent.id)
        ).scalars()
    )
    following = db.execute(
        select(AttendanceEvent)
        .where(
            AttendanceEvent.employment_id == employment_id, AttendanceEvent.occurred_at >= range_end
        )
        .order_by(AttendanceEvent.occurred_at, AttendanceEvent.id)
        .limit(1)
    ).scalar_one_or_none()
    return [*([previous] if previous else []), *current, *([following] if following else [])]


def _build_month(db: Session, employment: Employment, year: int, month: int) -> AttendanceMonthOut:
    start, end = _month_range(year, month)
    events = _day_events(db, employment.id, start, end)
    plan_rows = list(
        db.execute(
            select(ShiftPlan).where(
                ShiftPlan.employment_id == employment.id,
                ShiftPlan.date >= start - timedelta(days=1),
                ShiftPlan.date < end,
            )
        ).scalars()
    )
    plans = {item.date: item for item in plan_rows if item.date >= start}
    summary = build_month_summary(db, employment=employment, year=year, month=month)
    summary_days = {item.date: item for item in summary.day_summaries}
    ordered_events = sorted(events, key=lambda item: (prague_now(item.occurred_at), item.id))
    deletion_partners: dict[int, int] = {}
    for index, event in enumerate(ordered_events[:-1]):
        following = ordered_events[index + 1]
        if (
            event.event_type == AttendanceEventType.IN
            and following.event_type == AttendanceEventType.OUT
        ):
            deletion_partners[event.id] = following.id
        elif (
            event.event_type == AttendanceEventType.OUT
            and following.event_type == AttendanceEventType.IN
            and prague_now(event.occurred_at).date() == prague_now(following.occurred_at).date()
        ):
            # OUT+IN is removable as one physical pause only inside the same local day.
            deletion_partners[event.id] = following.id
    days: list[AttendanceDayOut] = []
    for offset in range((end - start).days):
        day = start + timedelta(days=offset)
        day_events = [event for event in events if prague_now(event.occurred_at).date() == day]
        events_through_day = [
            event for event in events if prague_now(event.occurred_at).date() <= day
        ]
        next_event_type = AttendanceEventType.IN
        if events_through_day and events_through_day[-1].event_type == AttendanceEventType.IN:
            next_event_type = AttendanceEventType.OUT
        day_summary = summary_days[day]
        attendance = day_summary.attendance
        worked_metrics = day_summary.worked
        planned_metrics = day_summary.planned
        status_value = attendance.status if attendance else None
        plan_for_day = plans.get(day)
        carryover_plan = shift_plan_carryover(plan_rows, day)
        holiday_label = czech_public_holiday_label(day)
        calendar_tone = "holiday" if holiday_label else "weekend" if day.weekday() >= 5 else "work"
        effective_status = status_value or (
            plan_for_day.status if plan_for_day is not None else None
        )
        days.append(
            AttendanceDayOut(
                date=day.isoformat(),
                events=[
                    AttendanceEventOut(
                        id=event.id,
                        employment_id=event.employment_id,
                        occurred_at=prague_now(event.occurred_at).isoformat(),
                        event_type=event.event_type,
                        deletion_partner_id=deletion_partners.get(event.id),
                    )
                    for event in day_events
                ],
                attendance_status=status_value,
                effective_status=effective_status,
                planned_arrival_time=plan_for_day.arrival_time if plan_for_day else None,
                planned_departure_time=plan_for_day.departure_time
                if plan_for_day
                else carryover_plan.departure_time
                if carryover_plan
                else None,
                planned_status=plan_for_day.status if plan_for_day else None,
                planned_is_carryover=plan_for_day is None and carryover_plan is not None,
                planned_carryover_departure_time=(
                    carryover_plan.departure_time if carryover_plan else None
                ),
                next_event_type=next_event_type,
                calendar_tone=calendar_tone,
                public_holiday_label=holiday_label,
                is_within_employment_period=employment.start_date <= day
                and (employment.end_date is None or day <= employment.end_date),
                worked=_metrics_out(worked_metrics),
                planned=_metrics_out(planned_metrics),
                worked_state=day_summary.worked_state,
                planned_state=day_summary.planned_state,
            )
        )
    return AttendanceMonthOut(
        employment_id=employment.id,
        employment_label=employment_label(employment),
        display_metrics=display_metrics_for_employment(employment),
        days=days,
        worked={key: _metric_out(value) for key, value in summary.worked.items()}
        if summary.worked
        else None,
        planned={key: _metric_out(value) for key, value in summary.planned.items()}
        if summary.planned
        else None,
        attendance_locked=is_month_locked(
            db, lock_type=LockType.ATTENDANCE, employment_id=employment.id, year=year, month=month
        ),
        shift_plan_locked=is_month_locked(
            db, lock_type=LockType.SHIFT_PLAN, employment_id=employment.id, year=year, month=month
        ),
    )


@router.get("/api/v1/attendance", response_model=AttendanceMonthOut)
def get_month_attendance(
    employment_id: int = Query(..., ge=1),
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    db: Session = Depends(get_db),
    auth: PortalUserAuth = Depends(require_portal_user_auth),
) -> AttendanceMonthOut:
    employment = _employment(auth, employment_id, db)
    start, end = _month_range(year, month)
    if employment.start_date >= end or (
        employment.end_date is not None and employment.end_date < start
    ):
        raise_api_error(
            404, "employment_not_active_in_month", "Úvazek není ve zvoleném měsíci aktivní."
        )
    return _build_month(db, employment, year, month)


@router.get("/api/v1/attendance/employments", response_model=list[AvailableEmploymentOut])
def get_month_employments(
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    db: Session = Depends(get_db),
    auth: PortalUserAuth = Depends(require_portal_user_auth),
) -> list[AvailableEmploymentOut]:
    start, end = _month_range(year, month)
    employments = list(
        db.execute(
            select(Employment)
            .where(
                Employment.user_id == auth.user.id,
                Employment.is_active.is_(True),
                Employment.start_date < end,
                (Employment.end_date.is_(None) | (Employment.end_date >= start)),
            )
            .order_by(Employment.start_date, Employment.id)
        ).scalars()
    )
    return [
        AvailableEmploymentOut(
            id=item.id,
            user_id=item.user_id,
            title=item.title,
            employment_type=str(getattr(item.employment_type, "value", item.employment_type)),
            start_date=item.start_date.isoformat(),
            end_date=item.end_date.isoformat() if item.end_date else None,
            is_active=True,
            is_current=True,
            label=employment_label(item),
        )
        for item in employments
    ]


@router.post("/api/v1/attendance/events", response_model=AttendanceEventOut)
def create_attendance_event(
    body: AttendanceEventIn,
    db: Session = Depends(get_db),
    auth: PortalUserAuth = Depends(require_portal_user_auth),
) -> AttendanceEventOut:
    employment = _employment(auth, body.employment_id, db)
    employment = lock_employment_for_time_mutation(db, employment.id)
    _require_locked_active_employment(db, employment, auth)
    occurred_at = body.occurred_at
    paired_occurred_at = body.paired_occurred_at
    if occurred_at > datetime.now(PRAGUE_TIMEZONE):
        raise_api_error(
            400, "attendance_future_entry_forbidden", "Budoucí průchod uživatel nesmí zadat."
        )
    if paired_occurred_at is not None and paired_occurred_at > datetime.now(PRAGUE_TIMEZONE):
        raise_api_error(
            400, "attendance_future_entry_forbidden", "Budoucí průchod uživatel nesmí zadat."
        )
    mutation_dates = [occurred_at.date()]
    if paired_occurred_at is not None:
        mutation_dates.append(paired_occurred_at.date())
    if any(
        day < employment.start_date
        or (employment.end_date is not None and day > employment.end_date)
        for day in mutation_dates
    ):
        raise_api_error(
            409,
            "employment_period_mismatch",
            "Zvolené datum neleží v období platnosti vybraného úvazku.",
        )
    existing_events = list(
        db.execute(
            select(AttendanceEvent).where(AttendanceEvent.employment_id == employment.id)
        ).scalars()
    )
    before_intervals = interval_signatures(existing_events)
    event = AttendanceEvent(
        employment_id=employment.id, occurred_at=occurred_at, event_type=body.event_type
    )
    try:
        if paired_occurred_at is not None:
            if body.event_type != AttendanceEventType.IN:
                raise ValueError("Párové vložení musí začínat příchodem.")
            additions = add_closed_interval_with_breaks(
                db,
                employment=employment,
                started_at=occurred_at,
                ended_at=paired_occurred_at,
            )
            event = additions[0]
        else:
            add_event_with_breaks(db, employment=employment, event=event)
    except ValueError as exc:
        raise_api_error(409, "attendance_event_alternation_conflict", str(exc))
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise_api_error(
            409, "attendance_event_conflict", "Průchod se překrývá s existujícím průchodem."
        )
    after_events = list(
        db.execute(
            select(AttendanceEvent).where(AttendanceEvent.employment_id == employment.id)
        ).scalars()
    )
    changed_days = changed_event_days(
        before_intervals,
        interval_signatures(after_events),
        timestamps=tuple(value for value in (occurred_at, paired_occurred_at) if value is not None),
    )
    try:
        ensure_days_have_no_status(db, employment_id=employment.id, days=changed_days)
        affected_months = months_for_days(changed_days)
        for year, month in affected_months:
            ensure_month_unlocked(
                db,
                lock_type=LockType.ATTENDANCE,
                employment_id=employment.id,
                year=year,
                month=month,
            )
    except ValueError as exc:
        db.rollback()
        if str(exc) == "attendance_day_status_conflict":
            raise_api_error(
                409,
                "attendance_day_status_conflict",
                "Do dne s celodenní nepřítomností nelze zapsat průchod.",
            )
        raise
    except SQLAlchemyError:
        db.rollback()
        raise
    sync_employment_metric_months(db, employment=employment, months=affected_months)
    db.commit()
    db.refresh(event)
    return AttendanceEventOut(
        id=event.id,
        employment_id=event.employment_id,
        occurred_at=prague_now(event.occurred_at).isoformat(),
        event_type=event.event_type,
    )


@router.put("/api/v1/attendance/events/{event_id}", response_model=AttendanceEventOut)
def update_attendance_event(
    event_id: int,
    body: AttendanceEventIn,
    db: Session = Depends(get_db),
    auth: PortalUserAuth = Depends(require_portal_user_auth),
) -> AttendanceEventOut:
    if body.paired_occurred_at is not None:
        raise_api_error(
            400, "attendance_event_pair_update_forbidden", "Pár lze měnit po jednom průchodu."
        )
    event = db.get(AttendanceEvent, event_id)
    if event is None:
        raise_api_error(404, "attendance_event_not_found", "Průchod nebyl nalezen.")
    employment = _employment(auth, event.employment_id, db)
    employment = lock_employment_for_time_mutation(db, employment.id)
    _require_locked_active_employment(db, employment, auth)
    event = db.execute(
        select(AttendanceEvent)
        .where(AttendanceEvent.id == event_id)
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if event is None:
        raise_api_error(404, "attendance_event_not_found", "Průchod nebyl nalezen.")
    if body.employment_id != event.employment_id:
        raise_api_error(
            400, "attendance_event_employment_immutable", "Průchod nelze přesunout na jiný úvazek."
        )
    if body.event_type != event.event_type:
        raise_api_error(
            400,
            "attendance_event_type_immutable",
            "Typ průchodu se mění smazáním a novým vytvořením.",
        )
    previous_occurred_at = prague_now(event.occurred_at)
    occurred_at = body.occurred_at
    if occurred_at > datetime.now(PRAGUE_TIMEZONE):
        raise_api_error(
            400, "attendance_future_entry_forbidden", "Budoucí průchod uživatel nesmí zadat."
        )
    if occurred_at.date() < employment.start_date or (
        employment.end_date is not None and occurred_at.date() > employment.end_date
    ):
        raise_api_error(
            409,
            "employment_period_mismatch",
            "Zvolené datum neleží v období platnosti vybraného úvazku.",
        )
    events = list(
        db.execute(
            select(AttendanceEvent)
            .where(AttendanceEvent.employment_id == employment.id, AttendanceEvent.id != event.id)
            .order_by(AttendanceEvent.occurred_at, AttendanceEvent.id)
        ).scalars()
    )
    before_intervals = interval_signatures([*events, event])
    event.occurred_at = occurred_at
    ordered = sorted([*events, event], key=lambda item: (prague_now(item.occurred_at), item.id))
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise_api_error(
            409, "attendance_event_conflict", "Průchod se překrývá s existujícím průchodem."
        )
    changed_days = changed_event_days(
        before_intervals,
        interval_signatures(ordered),
        timestamps=(previous_occurred_at, occurred_at),
    )
    try:
        ensure_days_have_no_status(db, employment_id=employment.id, days=changed_days)
        affected_months = months_for_days(changed_days)
        for year, month in affected_months:
            ensure_month_unlocked(
                db,
                lock_type=LockType.ATTENDANCE,
                employment_id=employment.id,
                year=year,
                month=month,
            )
    except ValueError as exc:
        db.rollback()
        if str(exc) == "attendance_day_status_conflict":
            raise_api_error(
                409,
                "attendance_day_status_conflict",
                "Do dne s celodenní nepřítomností nelze zapsat průchod.",
            )
        raise
    except SQLAlchemyError:
        db.rollback()
        raise
    sync_employment_metric_months(db, employment=employment, months=affected_months)
    db.commit()
    db.refresh(event)
    return AttendanceEventOut(
        id=event.id,
        employment_id=event.employment_id,
        occurred_at=prague_now(event.occurred_at).isoformat(),
        event_type=event.event_type,
    )


@router.delete("/api/v1/attendance/events/{event_id}", response_model=dict[str, bool])
def delete_attendance_event(
    event_id: int,
    paired_event_id: int | None = None,
    db: Session = Depends(get_db),
    auth: PortalUserAuth = Depends(require_portal_user_auth),
) -> dict[str, bool]:
    event = db.get(AttendanceEvent, event_id)
    if event is None:
        raise_api_error(404, "attendance_event_not_found", "Průchod nebyl nalezen.")
    employment = _employment(auth, event.employment_id, db)
    employment = lock_employment_for_time_mutation(db, employment.id)
    _require_locked_active_employment(db, employment, auth)
    event = db.execute(
        select(AttendanceEvent)
        .where(AttendanceEvent.id == event_id)
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if event is None:
        raise_api_error(404, "attendance_event_not_found", "Průchod nebyl nalezen.")
    events = list(
        db.execute(
            select(AttendanceEvent).where(AttendanceEvent.employment_id == employment.id)
        ).scalars()
    )
    before_intervals = interval_signatures(events)
    occurred_at = prague_now(event.occurred_at)
    deleted_ids = {event.id}
    timestamps = [occurred_at]
    if paired_event_id is not None:
        paired = next((item for item in events if item.id == paired_event_id), None)
        if paired is None or paired.employment_id != employment.id or paired.id == event.id:
            raise_api_error(404, "attendance_event_not_found", "Párový průchod nebyl nalezen.")
        deleted_ids.add(paired.id)
        timestamps.append(prague_now(paired.occurred_at))
    remaining_events = [item for item in events if item.id not in deleted_ids]
    changed_days = changed_event_days(
        before_intervals, interval_signatures(remaining_events), timestamps=tuple(timestamps)
    )
    affected_months = months_for_days(changed_days)
    for year, month in affected_months:
        ensure_month_unlocked(
            db, lock_type=LockType.ATTENDANCE, employment_id=employment.id, year=year, month=month
        )
    for item in events:
        if item.id in deleted_ids:
            db.delete(item)
    db.flush()
    sync_employment_metric_months(db, employment=employment, months=affected_months)
    db.commit()
    return {"ok": True}


@router.put("/api/v1/attendance/day-status", response_model=dict[str, bool])
def upsert_attendance_status(
    body: AttendanceStatusUpsertIn,
    db: Session = Depends(get_db),
    auth: PortalUserAuth = Depends(require_portal_user_auth),
) -> dict[str, bool]:
    employment = _employment(auth, body.employment_id, db)
    employment = lock_employment_for_time_mutation(db, employment.id)
    _require_locked_active_employment(db, employment, auth)
    try:
        day = date.fromisoformat(body.date)
    except ValueError:
        raise_api_error(400, "invalid_date_format", "Neplatný formát data.")
    if body.status not in (
        None,
        DAY_STATUS_HOLIDAY,
        DAY_STATUS_OFF,
        DAY_STATUS_SICKNESS,
        DAY_STATUS_PARAGRAPH,
    ):
        raise_api_error(400, "invalid_day_status", "Neplatný stav dne.")
    if day < employment.start_date or (
        employment.end_date is not None and day > employment.end_date
    ):
        raise_api_error(
            409,
            "employment_period_mismatch",
            "Zvolené datum neleží v období platnosti vybraného úvazku.",
        )
    current_status = get_day_status(db, employment_id=employment.id, day=day)
    conflicts = collect_day_status_conflicts(db, employment_id=employment.id, day=day)
    conflict_plan_months = conflicting_shift_plan_months(db, employment_id=employment.id, day=day)
    lock_types = set()
    if body.status in {DAY_STATUS_HOLIDAY, DAY_STATUS_OFF} or current_status in {
        DAY_STATUS_HOLIDAY,
        DAY_STATUS_OFF,
    }:
        lock_types.add(LockType.SHIFT_PLAN)
    if body.status in {DAY_STATUS_SICKNESS, DAY_STATUS_PARAGRAPH} or current_status in {
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
        status=body.status,
        confirm_delete_conflicts=body.confirm_delete_conflicts,
        instance_id=auth.instance.id if auth.instance is not None else employment.user.instance_id,
    )
    if body.status is not None and conflicts.has_conflicts and not body.confirm_delete_conflicts:
        raise_api_error(
            409,
            "day_status_conflict",
            "V tomto dni už existuje plán směny nebo docházka. Potvrzením budou stávající údaje smazány.",
        )
    db.flush()
    after_events = list(
        db.execute(
            select(AttendanceEvent).where(AttendanceEvent.employment_id == employment.id)
        ).scalars()
    )
    changed_days = changed_event_days(
        before_intervals, interval_signatures(after_events), timestamps=()
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
    return {"ok": True}
