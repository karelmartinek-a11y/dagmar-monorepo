# ruff: noqa: B008
from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import PortalUserAuth, require_portal_user_auth
from app.api.errors import raise_api_error
from app.db.models import Attendance, AttendanceEvent, AttendanceEventType, Employment, ShiftPlan
from app.db.session import get_db
from app.services.attendance_events import add_event_with_breaks
from app.services.day_status import DAY_STATUS_PARAGRAPH, DAY_STATUS_SICKNESS, set_attendance_status
from app.services.employment_access import employment_label
from app.services.locks import LockType, ensure_month_unlocked, is_month_locked
from app.services.prague_time import PRAGUE_TIMEZONE, prague_now, prague_today
from app.services.time_intervals import WorkInterval, pair_events
from app.services.time_metrics import DailyMetrics, MetricValue, calculate_daily_metrics

router = APIRouter(tags=["attendance"])


class AttendanceEventIn(BaseModel):
    employment_id: int = Field(..., ge=1)
    occurred_at: datetime
    event_type: AttendanceEventType

    @field_validator("occurred_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("Čas průchodu musí obsahovat časové pásmo.")
        return value.astimezone(PRAGUE_TIMEZONE)


class AttendanceEventOut(BaseModel):
    id: int
    employment_id: int
    occurred_at: str
    event_type: AttendanceEventType


class MetricOut(BaseModel):
    minutes: int
    tenths: int
    hours: float


class AttendanceDayOut(BaseModel):
    date: str
    events: list[AttendanceEventOut]
    attendance_status: str | None = None
    effective_status: str | None = None
    is_within_employment_period: bool
    worked: dict[str, MetricOut | None] | None
    planned: dict[str, MetricOut | None] | None
    worked_state: str = "empty"
    planned_state: str = "empty"


class AttendanceMonthOut(BaseModel):
    employment_id: int
    employment_label: str
    days: list[AttendanceDayOut]
    worked: dict[str, MetricOut | None] | None
    planned: dict[str, MetricOut | None] | None
    attendance_locked: bool = False
    shift_plan_locked: bool = False


class AttendanceStatusUpsertIn(BaseModel):
    employment_id: int = Field(..., ge=1)
    date: str
    status: str | None = Field(None, pattern="^(SICKNESS|PARAGRAPH)?$")
    confirm_delete_conflicts: bool = False


def _metric_out(value: MetricValue | None) -> MetricOut | None:
    return None if value is None else MetricOut(minutes=value.minutes, tenths=value.tenths, hours=value.hours)


def _metrics_out(metrics: DailyMetrics | None) -> dict[str, MetricOut | None] | None:
    if metrics is None:
        return None
    return {key: _metric_out(getattr(metrics, key)) for key in ("total", "afternoon", "night", "weekend", "public_holiday")}


def _employment(auth: PortalUserAuth, employment_id: int, db: Session) -> Employment:
    employment = db.get(Employment, employment_id)
    if employment is None or employment.user_id != auth.user.id:
        raise_api_error(404, "employment_not_found", "Úvazek nebyl nalezen.")
    return employment


def _require_accessible_employment(employment_id: int, auth: PortalUserAuth, db: Session) -> Employment:
    return _employment(auth, employment_id, db)


def _month_range(year: int, month: int) -> tuple[date, date]:
    start = date(year, month, 1)
    end = date(year + (month == 12), 1 if month == 12 else month + 1, 1)
    return start, end


def _day_events(db: Session, employment_id: int, start: date, end: date) -> list[AttendanceEvent]:
    return list(db.execute(select(AttendanceEvent).where(AttendanceEvent.employment_id == employment_id).order_by(AttendanceEvent.occurred_at, AttendanceEvent.id)).scalars())


def _plan_interval(day: date, plan: ShiftPlan | None) -> list[WorkInterval]:
    if plan is None or not plan.arrival_time or not plan.departure_time:
        return []
    h1, m1 = (int(value) for value in plan.arrival_time.split(":"))
    h2, m2 = (int(value) for value in plan.departure_time.split(":"))
    start = datetime.combine(day, datetime.min.time(), tzinfo=PRAGUE_TIMEZONE) + timedelta(hours=h1, minutes=m1)
    end = datetime.combine(day, datetime.min.time(), tzinfo=PRAGUE_TIMEZONE) + timedelta(hours=h2, minutes=m2)
    if end <= start:
        end += timedelta(days=1)
    return [WorkInterval(start, end)]


def _build_month(db: Session, employment: Employment, year: int, month: int) -> AttendanceMonthOut:
    start, end = _month_range(year, month)
    events = _day_events(db, employment.id, start, end)
    intervals = pair_events(events) if events else []
    plans = {item.date: item for item in db.execute(select(ShiftPlan).where(ShiftPlan.employment_id == employment.id, ShiftPlan.date >= start, ShiftPlan.date < end)).scalars()}
    days: list[AttendanceDayOut] = []
    worked_values: list[DailyMetrics] = []
    planned_values: list[DailyMetrics] = []
    for offset in range((end - start).days):
        day = start + timedelta(days=offset)
        day_events = [event for event in events if prague_now(event.occurred_at).date() == day]
        attendance = db.execute(select(Attendance).where(Attendance.employment_id == employment.id, Attendance.date == day)).scalar_one_or_none()
        worked_metrics = calculate_daily_metrics(employment, day, intervals)
        planned_metrics = calculate_daily_metrics(employment, day, _plan_interval(day, plans.get(day)))
        if worked_metrics is not None:
            worked_values.append(worked_metrics)
        if planned_metrics is not None:
            planned_values.append(planned_metrics)
        status_value = attendance.status if attendance else None
        plan_for_day = plans.get(day)
        effective_status = status_value or (plan_for_day.status if plan_for_day is not None else None)
        worked_state = "complete" if any(event.event_type == AttendanceEventType.OUT for event in day_events) else "incomplete" if day_events else "empty"
        days.append(AttendanceDayOut(date=day.isoformat(), events=[AttendanceEventOut(id=event.id, employment_id=event.employment_id, occurred_at=prague_now(event.occurred_at).isoformat(), event_type=event.event_type) for event in day_events], attendance_status=status_value, effective_status=effective_status, is_within_employment_period=employment.start_date <= day and (employment.end_date is None or day <= employment.end_date), worked=_metrics_out(worked_metrics), planned=_metrics_out(planned_metrics), worked_state=worked_state, planned_state="complete" if planned_metrics and planned_metrics.total.minutes else "empty"))
    return AttendanceMonthOut(employment_id=employment.id, employment_label=employment_label(employment), days=days, worked={key: _metric_out(_sum_metric(worked_values, key)) for key in ("total", "afternoon", "night", "weekend", "public_holiday")} if worked_values else None, planned={key: _metric_out(_sum_metric(planned_values, key)) for key in ("total", "afternoon", "night", "weekend", "public_holiday")} if planned_values else None, attendance_locked=is_month_locked(db, lock_type=LockType.ATTENDANCE, employment_id=employment.id, year=year, month=month), shift_plan_locked=is_month_locked(db, lock_type=LockType.SHIFT_PLAN, employment_id=employment.id, year=year, month=month))


def _sum_metric(values: list[DailyMetrics], key: str) -> MetricValue | None:
    items = [getattr(value, key) for value in values if getattr(value, key) is not None]
    if not items:
        return None
    return MetricValue(sum(item.minutes for item in items), sum(item.tenths for item in items))


@router.get("/api/v1/attendance", response_model=AttendanceMonthOut)
def get_month_attendance(employment_id: int = Query(..., ge=1), year: int = Query(..., ge=2000, le=2100), month: int = Query(..., ge=1, le=12), db: Session = Depends(get_db), auth: PortalUserAuth = Depends(require_portal_user_auth)) -> AttendanceMonthOut:
    return _build_month(db, _employment(auth, employment_id, db), year, month)


@router.post("/api/v1/attendance/events", response_model=AttendanceEventOut)
def create_attendance_event(body: AttendanceEventIn, db: Session = Depends(get_db), auth: PortalUserAuth = Depends(require_portal_user_auth)) -> AttendanceEventOut:
    employment = _employment(auth, body.employment_id, db)
    occurred_at = body.occurred_at
    if occurred_at.date() > prague_today():
        raise_api_error(400, "attendance_future_entry_forbidden", "Budoucí průchod uživatel nesmí zadat.")
    ensure_month_unlocked(db, lock_type=LockType.ATTENDANCE, employment_id=employment.id, year=occurred_at.year, month=occurred_at.month)
    event = AttendanceEvent(employment_id=employment.id, occurred_at=occurred_at, event_type=body.event_type)
    try:
        add_event_with_breaks(db, employment=employment, event=event)
    except ValueError as exc:
        raise_api_error(409, "attendance_event_alternation_conflict", str(exc))
    try:
        db.flush()
        db.commit()
    except Exception:
        db.rollback()
        raise_api_error(409, "attendance_event_conflict", "Průchod se překrývá s existujícím průchodem.")
    db.refresh(event)
    return AttendanceEventOut(id=event.id, employment_id=event.employment_id, occurred_at=prague_now(event.occurred_at).isoformat(), event_type=event.event_type)


@router.delete("/api/v1/attendance/events/{event_id}", response_model=dict[str, bool])
def delete_attendance_event(event_id: int, db: Session = Depends(get_db), auth: PortalUserAuth = Depends(require_portal_user_auth)) -> dict[str, bool]:
    event = db.get(AttendanceEvent, event_id)
    if event is None or event.employment.user_id != auth.user.id:
        raise_api_error(404, "attendance_event_not_found", "Průchod nebyl nalezen.")
    ensure_month_unlocked(db, lock_type=LockType.ATTENDANCE, employment_id=event.employment_id, year=prague_now(event.occurred_at).year, month=prague_now(event.occurred_at).month)
    db.delete(event)
    db.commit()
    return {"ok": True}


@router.put("/api/v1/attendance/day-status", response_model=dict[str, bool])
def upsert_attendance_status(body: AttendanceStatusUpsertIn, db: Session = Depends(get_db), auth: PortalUserAuth = Depends(require_portal_user_auth)) -> dict[str, bool]:
    employment = _employment(auth, body.employment_id, db)
    try:
        day = date.fromisoformat(body.date)
    except ValueError:
        raise_api_error(400, "invalid_date_format", "Neplatný formát data.")
    if body.status not in (None, DAY_STATUS_SICKNESS, DAY_STATUS_PARAGRAPH):
        raise_api_error(400, "invalid_day_status", "Neplatný stav dne.")
    ensure_month_unlocked(db, lock_type=LockType.ATTENDANCE, employment_id=employment.id, year=day.year, month=day.month)
    set_attendance_status(db, employment=employment, day=day, status=body.status, confirm_reset_existing_attendance=body.confirm_delete_conflicts, instance_id=auth.instance.id)
    db.commit()
    return {"ok": True}
