# ruff: noqa: B008
from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, field_validator
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_admin
from app.api.errors import raise_api_error
from app.api.v1.attendance import AttendanceMonthOut, _build_month
from app.db.models import AttendanceEvent, AttendanceEventType, Employment
from app.db.session import get_db
from app.security.csrf import require_csrf
from app.services.attendance_events import add_event_with_breaks
from app.services.prague_time import PRAGUE_TIMEZONE, prague_now

router = APIRouter(tags=["admin-attendance"])


class AdminAttendanceEventIn(BaseModel):
    employment_id: int
    occurred_at: datetime
    event_type: AttendanceEventType

    @field_validator("occurred_at")
    @classmethod
    def timezone_required(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("Čas průchodu musí obsahovat časové pásmo.")
        return value.astimezone(PRAGUE_TIMEZONE)


class AdminAttendanceEventOut(BaseModel):
    id: int
    employment_id: int
    employment_label: str
    occurred_at: str
    event_type: AttendanceEventType


class AdminAttendanceEventListOut(BaseModel):
    data: list[AdminAttendanceEventOut]


class AdminAttendanceMonthListOut(BaseModel):
    data: list[AttendanceMonthOut]


def _out(event: AttendanceEvent) -> AdminAttendanceEventOut:
    return AdminAttendanceEventOut(id=event.id, employment_id=event.employment_id, employment_label=f"{event.employment.user.name} — {event.employment.title}", occurred_at=prague_now(event.occurred_at).isoformat(), event_type=event.event_type)


def _employment(db: Session, employment_id: int) -> Employment:
    employment = db.get(Employment, employment_id)
    if employment is None:
        raise_api_error(404, "employment_not_found", "Úvazek nebyl nalezen.")
    return employment


@router.get("/api/v1/admin/attendance/month", response_model=AdminAttendanceMonthListOut)
def list_month_sheets(
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    _admin=Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminAttendanceMonthListOut:
    start = date(year, month, 1)
    end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    range_start = datetime.combine(start, datetime.min.time(), tzinfo=PRAGUE_TIMEZONE)
    range_end = datetime.combine(end, datetime.min.time(), tzinfo=PRAGUE_TIMEZONE)
    employments = db.execute(
        select(Employment)
        .options(selectinload(Employment.user))
        .where(
            or_(
                (Employment.start_date < end) & (Employment.end_date.is_(None) | (Employment.end_date >= start)),
                Employment.id.in_(
                    select(AttendanceEvent.employment_id).where(
                        AttendanceEvent.occurred_at >= range_start,
                        AttendanceEvent.occurred_at < range_end,
                    )
                ),
            )
        )
        .order_by(Employment.user_id, Employment.start_date, Employment.id)
    ).scalars().all()
    return AdminAttendanceMonthListOut(data=[_build_month(db, employment, year, month) for employment in employments])


def _validate_alternation(db: Session, employment_id: int, event_type: AttendanceEventType, *, exclude_id: int | None = None) -> None:
    query = select(AttendanceEvent).where(AttendanceEvent.employment_id == employment_id).order_by(AttendanceEvent.occurred_at.desc(), AttendanceEvent.id.desc())
    if exclude_id is not None:
        query = query.where(AttendanceEvent.id != exclude_id)
    latest = db.execute(query).scalars().first()
    if latest is not None and latest.event_type == event_type:
        raise_api_error(409, "attendance_event_alternation_conflict", "Průchody musí střídat IN a OUT.")


@router.post("/api/v1/admin/attendance/events", response_model=AdminAttendanceEventOut)
def create_event(body: AdminAttendanceEventIn, _admin=Depends(require_admin), _: None = Depends(require_csrf), db: Session = Depends(get_db)) -> AdminAttendanceEventOut:
    _employment(db, body.employment_id)
    employment = _employment(db, body.employment_id)
    event = AttendanceEvent(employment_id=employment.id, occurred_at=body.occurred_at, event_type=body.event_type)
    try:
        add_event_with_breaks(db, employment=employment, event=event)
    except ValueError as exc:
        raise_api_error(409, "attendance_event_alternation_conflict", str(exc))
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise_api_error(409, "attendance_event_conflict", "Průchod se překrývá s existujícím průchodem.")
    db.refresh(event)
    return _out(event)


@router.get("/api/v1/admin/attendance/events", response_model=AdminAttendanceEventListOut)
def list_events(
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    employment_id: int | None = Query(None, ge=1),
    _admin=Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminAttendanceEventListOut:
    start = date(year, month, 1)
    end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    range_start = datetime.combine(start, datetime.min.time(), tzinfo=PRAGUE_TIMEZONE)
    range_end = datetime.combine(end, datetime.min.time(), tzinfo=PRAGUE_TIMEZONE)
    query = select(AttendanceEvent).options(selectinload(AttendanceEvent.employment).selectinload(Employment.user)).where(AttendanceEvent.occurred_at >= range_start, AttendanceEvent.occurred_at < range_end)
    if employment_id is not None:
        query = query.where(AttendanceEvent.employment_id == employment_id)
    events = db.execute(query.order_by(AttendanceEvent.occurred_at, AttendanceEvent.id)).scalars().all()
    return AdminAttendanceEventListOut(data=[_out(event) for event in events])


@router.put("/api/v1/admin/attendance/events/{event_id}", response_model=AdminAttendanceEventOut)
def update_event(event_id: int, body: AdminAttendanceEventIn, _admin=Depends(require_admin), _: None = Depends(require_csrf), db: Session = Depends(get_db)) -> AdminAttendanceEventOut:
    event = db.get(AttendanceEvent, event_id)
    if event is None:
        raise_api_error(404, "attendance_event_not_found", "Průchod nebyl nalezen.")
    if body.event_type != event.event_type:
        raise_api_error(400, "attendance_event_type_immutable", "Typ průchodu se mění smazáním a novým vytvořením.")
    _employment(db, body.employment_id)
    event.employment_id = body.employment_id
    event.occurred_at = body.occurred_at
    db.commit()
    db.refresh(event)
    return _out(event)


@router.delete("/api/v1/admin/attendance/events/{event_id}", response_model=dict[str, bool])
def delete_event(event_id: int, _admin=Depends(require_admin), _: None = Depends(require_csrf), db: Session = Depends(get_db)) -> dict[str, bool]:
    event = db.get(AttendanceEvent, event_id)
    if event is None:
        raise_api_error(404, "attendance_event_not_found", "Průchod nebyl nalezen.")
    db.delete(event)
    db.commit()
    return {"ok": True}
