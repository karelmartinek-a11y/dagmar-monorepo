# ruff: noqa: B008
"""Scoped integration API backed by canonical employment and event data."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.api.deps import IntegrationAuth, require_integration_auth
from app.api.integration_common import (
    get_audit_context,
    parse_iso_date,
    raise_integration_error,
    utc_isoformat,
)
from app.db import models
from app.db.session import get_db
from app.security.integration_rate_limit import rate_limit_dependency
from app.services.attendance_events import add_event_with_breaks
from app.services.employment_access import employment_label
from app.services.locks import LockType, is_month_locked
from app.services.prague_time import PRAGUE_TIMEZONE, prague_now

router = APIRouter(prefix="/api/v1/integration", tags=["integration"])
TIMEZONE = "Europe/Prague"


class PaginationOut(BaseModel):
    limit: int
    next_cursor: str | None = None
    has_more: bool = False


class ListResponse(BaseModel):
    data: list[dict[str, Any]]
    pagination: PaginationOut


class IntegrationEventIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    employment_id: int = Field(..., ge=1)
    occurred_at: datetime
    event_type: models.AttendanceEventType

    @field_validator("occurred_at")
    @classmethod
    def timezone_required(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("occurred_at musí obsahovat časové pásmo.")
        return value.astimezone(PRAGUE_TIMEZONE)


class IntegrationEventPatchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    occurred_at: datetime

    @field_validator("occurred_at")
    @classmethod
    def timezone_required(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("occurred_at musí obsahovat časové pásmo.")
        return value.astimezone(PRAGUE_TIMEZONE)


def _require_scope(auth: IntegrationAuth, scope: str) -> None:
    if scope not in set(auth.client.scopes or []):
        raise_integration_error(status.HTTP_403_FORBIDDEN, "insufficient_scope", "Klient nemá požadovaný scope.")


def _allowed(auth: IntegrationAuth, employment_id: int) -> bool:
    allowed = {int(item) for item in (auth.client.allowed_employment_ids or [])}
    return not allowed or employment_id in allowed


def _employment(db: Session, employment_id: int) -> models.Employment:
    employment = db.execute(select(models.Employment).options(joinedload(models.Employment.user)).where(models.Employment.id == employment_id)).scalars().first()
    if employment is None:
        raise_integration_error(status.HTTP_404_NOT_FOUND, "not_found", "Úvazek nebyl nalezen.")
    assert employment is not None
    return employment


def _page(rows: list[dict[str, Any]], limit: int) -> ListResponse:
    return ListResponse(data=rows[:limit], pagination=PaginationOut(limit=limit, has_more=len(rows) > limit))


def _event_payload(event: models.AttendanceEvent) -> dict[str, Any]:
    return {"id": event.id, "employment_id": event.employment_id, "occurred_at": prague_now(event.occurred_at).isoformat(), "event_type": event.event_type.value, "timezone": TIMEZONE, "last_changed_at": utc_isoformat(event.updated_at)}


@router.get("/health")
def integration_health(auth: IntegrationAuth = Depends(require_integration_auth)) -> dict[str, Any]:
    return {"ok": True, "client_id": auth.client.id, "timezone": TIMEZONE}


@router.get("/openapi.json")
def integration_openapi(auth: IntegrationAuth = Depends(require_integration_auth)) -> dict[str, Any]:
    _require_scope(auth, "employments:read")
    return {
        "openapi": "3.1.0",
        "info": {"title": "KájovoDagmar Integration API", "version": "1"},
        "servers": [{"url": "/api/v1/integration"}],
        "paths": {
            "/employments": {"get": {"summary": "List scoped employments"}},
            "/attendance-events": {"get": {"summary": "List events"}, "post": {"summary": "Create event"}},
            "/attendance-events/{event_id}": {"patch": {"summary": "Update event"}, "delete": {"summary": "Delete event"}},
            "/locks": {"get": {"summary": "List month locks"}},
        },
    }


@router.get("/employments", response_model=ListResponse)
def list_employments(limit: int = Query(100, ge=1, le=500), auth: IntegrationAuth = Depends(require_integration_auth), db: Session = Depends(get_db)) -> ListResponse:
    _require_scope(auth, "employments:read")
    rows = []
    for employment in db.execute(select(models.Employment).options(joinedload(models.Employment.user)).order_by(models.Employment.id)).scalars():
        if _allowed(auth, employment.id):
            rows.append({"id": employment.id, "employment_id": employment.id, "employee_id": employment.user_id, "title": employment.title, "employment_type": employment.employment_type.value, "label": employment_label(employment), "start_date": employment.start_date.isoformat(), "end_date": employment.end_date.isoformat() if employment.end_date else None, "is_active": employment.is_active, "time_profile": {"automatic_breaks_enabled": employment.automatic_breaks_enabled, "afternoon_hours_enabled": employment.afternoon_hours_enabled, "afternoon_start_minutes": employment.afternoon_start_minutes, "night_hours_enabled": employment.night_hours_enabled, "weekend_hours_enabled": employment.weekend_hours_enabled, "public_holiday_hours_enabled": employment.public_holiday_hours_enabled}})
    return _page(rows, limit)


@router.get("/attendance-events", response_model=ListResponse)
def list_attendance_events(employment_id: int | None = None, date_from: str | None = None, date_to: str | None = None, limit: int = Query(100, ge=1, le=500), auth: IntegrationAuth = Depends(require_integration_auth), db: Session = Depends(get_db)) -> ListResponse:
    _require_scope(auth, "attendance:read")
    query = select(models.AttendanceEvent).order_by(models.AttendanceEvent.occurred_at, models.AttendanceEvent.id)
    if employment_id is not None:
        if not _allowed(auth, employment_id):
            raise_integration_error(status.HTTP_403_FORBIDDEN, "insufficient_scope", "Úvazek není v rozsahu klienta.")
        query = query.where(models.AttendanceEvent.employment_id == employment_id)
    rows = [_event_payload(event) for event in db.execute(query).scalars() if _allowed(auth, event.employment_id)]
    if date_from:
        start = parse_iso_date(date_from, field_name="date_from")
        rows = [row for row in rows if prague_now(datetime.fromisoformat(row["occurred_at"])).date() >= start]
    if date_to:
        end = parse_iso_date(date_to, field_name="date_to")
        rows = [row for row in rows if prague_now(datetime.fromisoformat(row["occurred_at"])).date() <= end]
    return _page(rows, limit)


@router.post("/attendance-events", status_code=status.HTTP_201_CREATED)
def create_attendance_event(payload: IntegrationEventIn, request: Request, auth: IntegrationAuth = Depends(require_integration_auth), _limit_guard: None = Depends(rate_limit_dependency("integration-data", 120)), db: Session = Depends(get_db)) -> dict[str, Any]:
    _require_scope(auth, "attendance:create")
    if not _allowed(auth, payload.employment_id):
        raise_integration_error(status.HTTP_403_FORBIDDEN, "insufficient_scope", "Úvazek není v rozsahu klienta.")
    employment = _employment(db, payload.employment_id)
    event = models.AttendanceEvent(employment_id=employment.id, occurred_at=payload.occurred_at, event_type=payload.event_type)
    try:
        add_event_with_breaks(db, employment=employment, event=event)
    except ValueError as exc:
        raise_integration_error(status.HTTP_409_CONFLICT, "attendance_event_alternation_conflict", str(exc))
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise_integration_error(status.HTTP_409_CONFLICT, "attendance_event_conflict", "Průchod koliduje s existující historií.")
    db.refresh(event)
    get_audit_context(request).row_count = 1
    return _event_payload(event)


@router.patch("/attendance-events/{event_id}")
def update_attendance_event(event_id: int, payload: IntegrationEventPatchIn, request: Request, auth: IntegrationAuth = Depends(require_integration_auth), db: Session = Depends(get_db)) -> dict[str, Any]:
    _require_scope(auth, "attendance:update")
    event = db.get(models.AttendanceEvent, event_id)
    if event is None or not _allowed(auth, event.employment_id):
        raise_integration_error(status.HTTP_404_NOT_FOUND, "not_found", "Průchod nebyl nalezen.")
    assert event is not None
    event.occurred_at = payload.occurred_at
    db.commit()
    db.refresh(event)
    get_audit_context(request).row_count = 1
    return _event_payload(event)


@router.delete("/attendance-events/{event_id}")
def delete_attendance_event(event_id: int, request: Request, auth: IntegrationAuth = Depends(require_integration_auth), db: Session = Depends(get_db)) -> dict[str, Any]:
    _require_scope(auth, "attendance:delete")
    event = db.get(models.AttendanceEvent, event_id)
    if event is None or not _allowed(auth, event.employment_id):
        raise_integration_error(status.HTTP_404_NOT_FOUND, "not_found", "Průchod nebyl nalezen.")
    assert event is not None
    payload = _event_payload(event)
    db.delete(event)
    db.commit()
    payload["deleted"] = True
    get_audit_context(request).row_count = 1
    return payload


@router.get("/locks", response_model=ListResponse)
def list_locks(year: int, month: int, auth: IntegrationAuth = Depends(require_integration_auth), db: Session = Depends(get_db)) -> ListResponse:
    _require_scope(auth, "locks:read")
    rows = [{"employment_id": employment.id, "attendance_locked": is_month_locked(db, lock_type=LockType.ATTENDANCE, employment_id=employment.id, year=year, month=month), "shift_plan_locked": is_month_locked(db, lock_type=LockType.SHIFT_PLAN, employment_id=employment.id, year=year, month=month)} for employment in db.execute(select(models.Employment)).scalars() if _allowed(auth, employment.id)]
    return _page(rows, len(rows) or 1)
