# ruff: noqa: B008
"""Scoped integration API backed by canonical employment and event data."""

from __future__ import annotations

from datetime import UTC, datetime, time, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.api.deps import IntegrationAuth, require_integration_auth
from app.api.integration_common import (
    decode_resource_cursor,
    encode_resource_cursor,
    get_audit_context,
    parse_iso_date,
    raise_integration_error,
    utc_isoformat,
)
from app.config import Settings, get_settings
from app.db import models
from app.db.session import get_db
from app.security.integration_rate_limit import (
    integration_data_rate_limit,
    integration_health_rate_limit,
    integration_openapi_rate_limit,
)
from app.services.attendance_events import add_closed_interval_with_breaks, add_event_with_breaks
from app.services.attendance_mutations import (
    changed_event_days,
    ensure_days_have_no_status,
    interval_signatures,
    months_for_days,
)
from app.services.daily_metrics import sync_employment_metric_months
from app.services.employment_access import (
    employment_label,
    lock_employment_for_time_mutation,
    locked_employment_has_active_user,
)
from app.services.integration_admin import (
    SCOPE_ATTENDANCE,
    SCOPE_ATTENDANCE_CREATE,
    SCOPE_ATTENDANCE_DELETE,
    SCOPE_ATTENDANCE_UPDATE,
    SCOPE_EMPLOYMENTS,
    SCOPE_HEALTH,
    SCOPE_LOCKS,
    SCOPE_OPENAPI,
)
from app.services.integration_scope import employment_scope_predicate, require_employment_access
from app.services.locks import LockType, is_month_locked
from app.services.prague_time import PRAGUE_TIMEZONE, prague_now

router = APIRouter(prefix="/api/v1/integration", tags=["integration"])
TIMEZONE = "Europe/Prague"

INTEGRATION_SCOPE_ROUTES: dict[str, tuple[tuple[str, str], ...]] = {
    SCOPE_HEALTH: (("GET", "/health"),),
    SCOPE_OPENAPI: (("GET", "/openapi.json"),),
    SCOPE_EMPLOYMENTS: (("GET", "/employments"),),
    SCOPE_ATTENDANCE: (("GET", "/attendance-events"),),
    SCOPE_ATTENDANCE_CREATE: (("POST", "/attendance-events"),),
    SCOPE_ATTENDANCE_UPDATE: (("PATCH", "/attendance-events/{event_id}"),),
    SCOPE_ATTENDANCE_DELETE: (("DELETE", "/attendance-events/{event_id}"),),
    SCOPE_LOCKS: (("GET", "/locks"),),
}


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
    paired_occurred_at: datetime | None = None

    @field_validator("occurred_at", "paired_occurred_at")
    @classmethod
    def timezone_required(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
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
        raise_integration_error(
            status.HTTP_403_FORBIDDEN, "insufficient_scope", "Klient nemá požadovaný scope."
        )


def _employment(db: Session, employment_id: int) -> models.Employment:
    employment = (
        db.execute(
            select(models.Employment)
            .options(joinedload(models.Employment.user))
            .where(models.Employment.id == employment_id)
        )
        .scalars()
        .first()
    )
    if (
        employment is None
        or not employment.is_active
        or employment.user is None
        or not employment.user.is_active
    ):
        raise_integration_error(status.HTTP_404_NOT_FOUND, "not_found", "Úvazek nebyl nalezen.")
    return employment


def _ensure_attendance_unlocked(db: Session, *, employment_id: int, occurred_at: datetime) -> None:
    local = prague_now(occurred_at)
    if is_month_locked(
        db,
        lock_type=LockType.ATTENDANCE,
        employment_id=employment_id,
        year=local.year,
        month=local.month,
    ):
        raise_integration_error(
            status.HTTP_423_LOCKED,
            "attendance_month_locked",
            "Docházka za zvolené období je uzamčena.",
        )


def _ensure_attendance_months_unlocked(
    db: Session, *, employment_id: int, months: set[tuple[int, int]]
) -> None:
    for year, month in months:
        if is_month_locked(
            db,
            lock_type=LockType.ATTENDANCE,
            employment_id=employment_id,
            year=year,
            month=month,
        ):
            raise_integration_error(
                status.HTTP_423_LOCKED,
                "attendance_month_locked",
                "Docházka za zvolené období je uzamčena.",
            )


def _page(
    rows: list[dict[str, Any]],
    *,
    limit: int,
    resource: str,
    cursor_key: object | None,
) -> ListResponse:
    has_more = len(rows) > limit
    page_rows = rows[:limit]
    return ListResponse(
        data=page_rows,
        pagination=PaginationOut(
            limit=limit,
            has_more=has_more,
            next_cursor=(
                encode_resource_cursor(resource, cursor_key) if has_more and page_rows else None
            ),
        ),
    )


def _integer_cursor(cursor: str | None, *, resource: str) -> int | None:
    key = decode_resource_cursor(cursor, resource=resource)
    if key is None:
        return None
    if isinstance(key, bool) or not isinstance(key, int) or key < 1:
        raise_integration_error(
            status.HTTP_400_BAD_REQUEST, "invalid_cursor", "Cursor není platný."
        )
    return key


def _attendance_cursor(cursor: str | None) -> tuple[datetime, int] | None:
    key = decode_resource_cursor(cursor, resource="attendance-events")
    if key is None:
        return None
    if (
        not isinstance(key, list)
        or len(key) != 2
        or not isinstance(key[0], str)
        or isinstance(key[1], bool)
        or not isinstance(key[1], int)
        or key[1] < 1
    ):
        raise_integration_error(
            status.HTTP_400_BAD_REQUEST, "invalid_cursor", "Cursor není platný."
        )
    try:
        occurred_at = datetime.fromisoformat(key[0])
    except ValueError:
        raise_integration_error(
            status.HTTP_400_BAD_REQUEST, "invalid_cursor", "Cursor není platný."
        )
    if occurred_at.tzinfo is None:
        raise_integration_error(
            status.HTTP_400_BAD_REQUEST, "invalid_cursor", "Cursor není platný."
        )
    return occurred_at.astimezone(UTC), key[1]


def _utc_cursor_value(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat()


def _employment_payload(employment: models.Employment) -> dict[str, Any]:
    return {
        "id": employment.id,
        "employment_id": employment.id,
        "employee_id": employment.user_id,
        "title": employment.title,
        "employment_type": employment.employment_type.value,
        "label": employment_label(employment),
        "start_date": employment.start_date.isoformat(),
        "end_date": employment.end_date.isoformat() if employment.end_date else None,
        "is_active": employment.is_active,
        "time_profile": {
            "total_hours_enabled": employment.total_hours_enabled,
            "automatic_breaks_enabled": employment.automatic_breaks_enabled,
            "afternoon_hours_enabled": employment.afternoon_hours_enabled,
            "afternoon_start_minutes": employment.afternoon_start_minutes,
            "night_hours_enabled": employment.night_hours_enabled,
            "weekend_hours_enabled": employment.weekend_hours_enabled,
            "public_holiday_hours_enabled": employment.public_holiday_hours_enabled,
        },
    }


def _event_payload(event: models.AttendanceEvent) -> dict[str, Any]:
    return {
        "id": event.id,
        "employment_id": event.employment_id,
        "occurred_at": prague_now(event.occurred_at).isoformat(),
        "event_type": event.event_type.value,
        "timezone": TIMEZONE,
        "last_changed_at": utc_isoformat(event.updated_at),
    }


@router.get("/health")
def integration_health(
    auth: IntegrationAuth = Depends(require_integration_auth),
    settings: Settings = Depends(get_settings),
    _limit_guard: None = Depends(integration_health_rate_limit),
) -> dict[str, Any]:
    _require_scope(auth, SCOPE_HEALTH)
    return {
        "ok": True,
        "service": "KájovoDagmar Integration API",
        "api_version": "v1",
        "contract_version": settings.integration_contract_version,
        "client_id": auth.client.id,
        "timezone": TIMEZONE,
    }


@router.get("/openapi.json")
def integration_openapi(
    auth: IntegrationAuth = Depends(require_integration_auth),
    settings: Settings = Depends(get_settings),
    _limit_guard: None = Depends(integration_openapi_rate_limit),
) -> dict[str, Any]:
    _require_scope(auth, SCOPE_OPENAPI)
    return {
        "openapi": "3.1.0",
        "info": {
            "title": "KájovoDagmar Integration API",
            "version": settings.integration_contract_version,
        },
        "servers": [{"url": "/api/v1/integration"}],
        "paths": {
            "/health": {"get": {"summary": "Check integration client health"}},
            "/openapi.json": {"get": {"summary": "Read the protected API contract"}},
            "/employments": {"get": {"summary": "List scoped employments"}},
            "/attendance-events": {
                "get": {"summary": "List events"},
                "post": {"summary": "Create event"},
            },
            "/attendance-events/{event_id}": {
                "patch": {"summary": "Update event"},
                "delete": {"summary": "Delete event"},
            },
            "/locks": {"get": {"summary": "List month locks"}},
        },
    }


@router.get("/employments", response_model=ListResponse)
def list_employments(
    limit: int = Query(100, ge=1, le=500),
    cursor: str | None = Query(default=None),
    auth: IntegrationAuth = Depends(require_integration_auth),
    _limit_guard: None = Depends(integration_data_rate_limit),
    db: Session = Depends(get_db),
) -> ListResponse:
    _require_scope(auth, SCOPE_EMPLOYMENTS)
    cursor_id = _integer_cursor(cursor, resource="employments")
    query = (
        select(models.Employment)
        .options(joinedload(models.Employment.user))
        .where(employment_scope_predicate(auth.client))
        .order_by(models.Employment.id)
        .limit(limit + 1)
    )
    if cursor_id is not None:
        query = query.where(models.Employment.id > cursor_id)
    employments = list(db.execute(query).scalars())
    rows = [_employment_payload(employment) for employment in employments]
    cursor_key = rows[min(limit, len(rows)) - 1]["id"] if rows else None
    return _page(rows, limit=limit, resource="employments", cursor_key=cursor_key)


@router.get("/attendance-events", response_model=ListResponse)
def list_attendance_events(
    employment_id: int | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    cursor: str | None = Query(default=None),
    auth: IntegrationAuth = Depends(require_integration_auth),
    _limit_guard: None = Depends(integration_data_rate_limit),
    db: Session = Depends(get_db),
) -> ListResponse:
    _require_scope(auth, SCOPE_ATTENDANCE)
    cursor_key = _attendance_cursor(cursor)
    query = (
        select(models.AttendanceEvent)
        .where(models.AttendanceEvent.employment.has(employment_scope_predicate(auth.client)))
        .order_by(models.AttendanceEvent.occurred_at, models.AttendanceEvent.id)
    )
    if employment_id is not None:
        require_employment_access(db, client=auth.client, employment_id=employment_id)
        query = query.where(models.AttendanceEvent.employment_id == employment_id)
    if date_from:
        start = parse_iso_date(date_from, field_name="date_from")
        query = query.where(
            models.AttendanceEvent.occurred_at
            >= datetime.combine(start, time.min, tzinfo=PRAGUE_TIMEZONE)
        )
    if date_to:
        end = parse_iso_date(date_to, field_name="date_to")
        query = query.where(
            models.AttendanceEvent.occurred_at
            < datetime.combine(end + timedelta(days=1), time.min, tzinfo=PRAGUE_TIMEZONE)
        )
    if cursor_key is not None:
        cursor_at, cursor_id = cursor_key
        query = query.where(
            or_(
                models.AttendanceEvent.occurred_at > cursor_at,
                and_(
                    models.AttendanceEvent.occurred_at == cursor_at,
                    models.AttendanceEvent.id > cursor_id,
                ),
            )
        )
    events = list(db.execute(query.limit(limit + 1)).scalars())
    rows = [_event_payload(event) for event in events]
    next_key = None
    if rows:
        last = events[min(limit, len(events)) - 1]
        next_key = [_utc_cursor_value(last.occurred_at), last.id]
    return _page(
        rows,
        limit=limit,
        resource="attendance-events",
        cursor_key=next_key,
    )


@router.post("/attendance-events", status_code=status.HTTP_201_CREATED)
def create_attendance_event(
    payload: IntegrationEventIn,
    request: Request,
    auth: IntegrationAuth = Depends(require_integration_auth),
    _limit_guard: None = Depends(integration_data_rate_limit),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    _require_scope(auth, SCOPE_ATTENDANCE_CREATE)
    require_employment_access(db, client=auth.client, employment_id=payload.employment_id)
    employment = _employment(db, payload.employment_id)
    employment = lock_employment_for_time_mutation(db, employment.id)
    if not locked_employment_has_active_user(db, employment):
        raise_integration_error(status.HTTP_404_NOT_FOUND, "not_found", "Úvazek nebyl nalezen.")
    local = prague_now(payload.occurred_at)
    paired_local = (
        prague_now(payload.paired_occurred_at) if payload.paired_occurred_at is not None else None
    )
    mutation_dates = [local.date()]
    if paired_local is not None:
        mutation_dates.append(paired_local.date())
    if any(
        day < employment.start_date
        or (employment.end_date is not None and day > employment.end_date)
        for day in mutation_dates
    ):
        raise_integration_error(
            status.HTTP_409_CONFLICT,
            "employment_period_mismatch",
            "Zvolené datum neleží v období platnosti vybraného úvazku.",
        )
    existing_events = list(
        db.execute(
            select(models.AttendanceEvent).where(
                models.AttendanceEvent.employment_id == employment.id
            )
        ).scalars()
    )
    before_intervals = interval_signatures(existing_events)
    event = models.AttendanceEvent(
        employment_id=employment.id, occurred_at=payload.occurred_at, event_type=payload.event_type
    )
    inserted_count = 1
    try:
        if paired_local is not None:
            if payload.event_type != models.AttendanceEventType.IN:
                raise ValueError("Párové vložení musí začínat příchodem.")
            additions = add_closed_interval_with_breaks(
                db,
                employment=employment,
                started_at=local,
                ended_at=paired_local,
            )
            event = additions[0]
            inserted_count = len(additions)
        else:
            inserted_count = len(add_event_with_breaks(db, employment=employment, event=event))
    except ValueError as exc:
        raise_integration_error(
            status.HTTP_409_CONFLICT, "attendance_event_alternation_conflict", str(exc)
        )
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise_integration_error(
            status.HTTP_409_CONFLICT,
            "attendance_event_conflict",
            "Průchod koliduje s existující historií.",
        )
    after_events = list(
        db.execute(
            select(models.AttendanceEvent).where(
                models.AttendanceEvent.employment_id == employment.id
            )
        ).scalars()
    )
    changed_days = changed_event_days(
        before_intervals,
        interval_signatures(after_events),
        timestamps=tuple(value for value in (local, paired_local) if value is not None),
    )
    try:
        ensure_days_have_no_status(db, employment_id=employment.id, days=changed_days)
    except ValueError:
        db.rollback()
        raise_integration_error(
            status.HTTP_409_CONFLICT,
            "attendance_day_status_conflict",
            "Do dne s celodenní nepřítomností nelze zapsat průchod.",
        )
    affected_months = months_for_days(changed_days)
    _ensure_attendance_months_unlocked(db, employment_id=employment.id, months=affected_months)
    sync_employment_metric_months(db, employment=employment, months=affected_months)
    db.commit()
    db.refresh(event)
    get_audit_context(request).row_count = inserted_count
    return _event_payload(event)


@router.patch("/attendance-events/{event_id}")
def update_attendance_event(
    event_id: int,
    payload: IntegrationEventPatchIn,
    request: Request,
    auth: IntegrationAuth = Depends(require_integration_auth),
    _limit_guard: None = Depends(integration_data_rate_limit),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    _require_scope(auth, SCOPE_ATTENDANCE_UPDATE)
    event = db.get(models.AttendanceEvent, event_id)
    if event is None:
        raise_integration_error(status.HTTP_404_NOT_FOUND, "not_found", "Průchod nebyl nalezen.")
    require_employment_access(db, client=auth.client, employment_id=event.employment_id)
    employment = event.employment
    employment = lock_employment_for_time_mutation(db, employment.id)
    if not locked_employment_has_active_user(db, employment):
        raise_integration_error(status.HTTP_404_NOT_FOUND, "not_found", "Úvazek nebyl nalezen.")
    event = db.execute(
        select(models.AttendanceEvent)
        .where(models.AttendanceEvent.id == event_id)
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if event is None:
        raise_integration_error(status.HTTP_404_NOT_FOUND, "not_found", "Průchod nebyl nalezen.")
    if not employment.is_active or employment.user is None or not employment.user.is_active:
        raise_integration_error(status.HTTP_404_NOT_FOUND, "not_found", "Průchod nebyl nalezen.")
    previous_occurred_at = prague_now(event.occurred_at)
    next_occurred_at = prague_now(payload.occurred_at)
    if next_occurred_at.date() < employment.start_date or (
        employment.end_date is not None and next_occurred_at.date() > employment.end_date
    ):
        raise_integration_error(
            status.HTTP_409_CONFLICT,
            "employment_period_mismatch",
            "Zvolené datum neleží v období platnosti vybraného úvazku.",
        )
    existing_events = list(
        db.execute(
            select(models.AttendanceEvent).where(
                models.AttendanceEvent.employment_id == employment.id,
                models.AttendanceEvent.id != event.id,
            )
        ).scalars()
    )
    before_intervals = interval_signatures([*existing_events, event])
    event.occurred_at = payload.occurred_at
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise_integration_error(
            status.HTTP_409_CONFLICT,
            "attendance_event_conflict",
            "Průchod koliduje s existující historií.",
        )
    after_events = [*existing_events, event]
    changed_days = changed_event_days(
        before_intervals,
        interval_signatures(after_events),
        timestamps=(previous_occurred_at, next_occurred_at),
    )
    try:
        ensure_days_have_no_status(db, employment_id=employment.id, days=changed_days)
    except ValueError:
        db.rollback()
        raise_integration_error(
            status.HTTP_409_CONFLICT,
            "attendance_day_status_conflict",
            "Do dne s celodenní nepřítomností nelze zapsat průchod.",
        )
    affected_months = months_for_days(changed_days)
    _ensure_attendance_months_unlocked(db, employment_id=employment.id, months=affected_months)
    sync_employment_metric_months(db, employment=employment, months=affected_months)
    db.commit()
    db.refresh(event)
    get_audit_context(request).row_count = 1
    return _event_payload(event)


@router.delete("/attendance-events/{event_id}")
def delete_attendance_event(
    event_id: int,
    request: Request,
    paired_event_id: int | None = None,
    auth: IntegrationAuth = Depends(require_integration_auth),
    _limit_guard: None = Depends(integration_data_rate_limit),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    _require_scope(auth, SCOPE_ATTENDANCE_DELETE)
    event = db.get(models.AttendanceEvent, event_id)
    if event is None:
        raise_integration_error(status.HTTP_404_NOT_FOUND, "not_found", "Průchod nebyl nalezen.")
    require_employment_access(db, client=auth.client, employment_id=event.employment_id)
    employment = event.employment
    employment = lock_employment_for_time_mutation(db, employment.id)
    if not locked_employment_has_active_user(db, employment):
        raise_integration_error(status.HTTP_404_NOT_FOUND, "not_found", "Úvazek nebyl nalezen.")
    event = db.execute(
        select(models.AttendanceEvent)
        .where(models.AttendanceEvent.id == event_id)
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if event is None:
        raise_integration_error(status.HTTP_404_NOT_FOUND, "not_found", "Průchod nebyl nalezen.")
    if not employment.is_active or employment.user is None or not employment.user.is_active:
        raise_integration_error(status.HTTP_404_NOT_FOUND, "not_found", "Průchod nebyl nalezen.")
    events = list(
        db.execute(
            select(models.AttendanceEvent).where(
                models.AttendanceEvent.employment_id == employment.id
            )
        ).scalars()
    )
    before_intervals = interval_signatures(events)
    deleted_ids = {event.id}
    timestamps = [prague_now(event.occurred_at)]
    if paired_event_id is not None:
        paired = next((item for item in events if item.id == paired_event_id), None)
        if paired is None or paired.employment_id != employment.id or paired.id == event.id:
            raise_integration_error(
                status.HTTP_404_NOT_FOUND, "not_found", "Párový průchod nebyl nalezen."
            )
        deleted_ids.add(paired.id)
        timestamps.append(prague_now(paired.occurred_at))
    remaining_events = [item for item in events if item.id not in deleted_ids]
    changed_days = changed_event_days(
        before_intervals,
        interval_signatures(remaining_events),
        timestamps=tuple(timestamps),
    )
    affected_months = months_for_days(changed_days)
    _ensure_attendance_months_unlocked(db, employment_id=employment.id, months=affected_months)
    payload = _event_payload(event)
    for item in events:
        if item.id in deleted_ids:
            db.delete(item)
    db.flush()
    sync_employment_metric_months(db, employment=employment, months=affected_months)
    db.commit()
    payload["deleted"] = True
    get_audit_context(request).row_count = len(deleted_ids)
    return payload


@router.get("/locks", response_model=ListResponse)
def list_locks(
    year: int,
    month: int,
    limit: int = Query(100, ge=1, le=500),
    cursor: str | None = Query(default=None),
    auth: IntegrationAuth = Depends(require_integration_auth),
    _limit_guard: None = Depends(integration_data_rate_limit),
    db: Session = Depends(get_db),
) -> ListResponse:
    _require_scope(auth, SCOPE_LOCKS)
    cursor_id = _integer_cursor(cursor, resource="locks")
    query = (
        select(models.Employment)
        .where(employment_scope_predicate(auth.client))
        .order_by(models.Employment.id)
        .limit(limit + 1)
    )
    if cursor_id is not None:
        query = query.where(models.Employment.id > cursor_id)
    employments = list(db.execute(query).scalars())
    rows = [
        {
            "employment_id": employment.id,
            "attendance_locked": is_month_locked(
                db,
                lock_type=LockType.ATTENDANCE,
                employment_id=employment.id,
                year=year,
                month=month,
            ),
            "shift_plan_locked": is_month_locked(
                db,
                lock_type=LockType.SHIFT_PLAN,
                employment_id=employment.id,
                year=year,
                month=month,
            ),
        }
        for employment in employments
    ]
    cursor_key = rows[min(limit, len(rows)) - 1]["employment_id"] if rows else None
    return _page(rows, limit=limit, resource="locks", cursor_key=cursor_key)
