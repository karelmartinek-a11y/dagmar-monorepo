# ruff: noqa: B008
from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_admin
from app.api.errors import raise_api_error
from app.api.v1.attendance import AttendanceMonthOut, _build_month
from app.db.models import AttendanceEvent, AttendanceEventType, Employment
from app.db.session import get_db
from app.security.csrf import require_csrf
from app.services.attendance_events import add_closed_interval_with_breaks, add_event_with_breaks
from app.services.attendance_mutations import (
    changed_event_days,
    ensure_days_have_no_status,
    has_strict_event_sequence,
    interval_signatures,
    months_for_days,
)
from app.services.daily_metrics import sync_employment_metric_months
from app.services.employment_access import (
    employment_overlaps_month,
    lock_employment_for_time_mutation,
    locked_employment_has_active_user,
)
from app.services.locks import LockType, ensure_month_unlocked
from app.services.prague_time import PRAGUE_TIMEZONE, prague_now
from app.services.time_intervals import missing_break_event_groups, pair_events

router = APIRouter(tags=["admin-attendance"])


def _require_locked_active_employment(db: Session, employment: Employment) -> None:
    if not locked_employment_has_active_user(db, employment):
        raise_api_error(
            409, "employment_not_active", "Vybraný úvazek nebo jeho uživatel už není aktivní."
        )


class AdminAttendanceEventIn(BaseModel):
    employment_id: int
    occurred_at: datetime
    event_type: AttendanceEventType
    paired_occurred_at: datetime | None = None

    @field_validator("occurred_at", "paired_occurred_at")
    @classmethod
    def timezone_required(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=PRAGUE_TIMEZONE)
        return value.astimezone(PRAGUE_TIMEZONE)


class AdminAttendanceEventOut(BaseModel):
    id: int
    employment_id: int
    employment_label: str
    occurred_at: str
    event_type: AttendanceEventType


class AdminAttendanceEventListOut(BaseModel):
    data: list[AdminAttendanceEventOut]


class AdminAttendanceSheetOut(AttendanceMonthOut):
    user_id: int
    user_name: str
    employment_title: str
    employment_type: str
    start_date: str
    end_date: str | None = None
    is_active_in_month: bool


class AdminAttendanceMonthListOut(BaseModel):
    data: list[AdminAttendanceSheetOut]


class AddBreaksIn(BaseModel):
    employment_id: int = Field(..., ge=1)
    year: int = Field(..., ge=2000, le=2100)
    month: int = Field(..., ge=1, le=12)
    confirmed: bool = False


class AddBreaksOut(BaseModel):
    ok: bool = True
    affected_intervals: int
    inserted_pairs: int
    inserted_events: int


def _out(event: AttendanceEvent) -> AdminAttendanceEventOut:
    return AdminAttendanceEventOut(
        id=event.id,
        employment_id=event.employment_id,
        employment_label=f"{event.employment.user.name} — {event.employment.title}",
        occurred_at=prague_now(event.occurred_at).isoformat(),
        event_type=event.event_type,
    )


def _employment(db: Session, employment_id: int) -> Employment:
    employment = db.get(Employment, employment_id)
    if (
        employment is None
        or not employment.is_active
        or employment.user is None
        or not employment.user.is_active
    ):
        raise_api_error(404, "employment_not_found", "Úvazek nebyl nalezen.")
    return employment


def _load_month_employments(db: Session, *, start: date, end: date) -> list[Employment]:
    return list(
        db.execute(
            select(Employment)
            .options(selectinload(Employment.user))
            .where(Employment.is_active.is_(True))
            .where(Employment.start_date < end)
            .where(Employment.end_date.is_(None) | (Employment.end_date >= start))
            .order_by(Employment.user_id, Employment.start_date, Employment.id)
        )
        .scalars()
        .all()
    )


@router.get("/api/v1/admin/attendance/month", response_model=AdminAttendanceMonthListOut)
def list_month_sheets(
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    _admin=Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminAttendanceMonthListOut:
    start = date(year, month, 1)
    end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    employments = _load_month_employments(db, start=start, end=end)
    sheets: list[AdminAttendanceSheetOut] = []
    for employment in employments:
        if employment.user is None or not employment.user.is_active:
            continue
        month_data = _build_month(db, employment, year, month)
        sheets.append(
            AdminAttendanceSheetOut(
                **month_data.model_dump(),
                user_id=employment.user_id,
                user_name=employment.user.name,
                employment_title=employment.title,
                employment_type=str(
                    getattr(employment.employment_type, "value", employment.employment_type)
                ),
                start_date=employment.start_date.isoformat(),
                end_date=employment.end_date.isoformat() if employment.end_date else None,
                is_active_in_month=employment_overlaps_month(employment, start, end),
            )
        )
    return AdminAttendanceMonthListOut(data=sheets)


@router.post("/api/v1/admin/attendance/breaks", response_model=AddBreaksOut)
def add_missing_breaks(
    body: AddBreaksIn,
    _admin=Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> AddBreaksOut:
    if not body.confirmed:
        raise_api_error(
            409,
            "attendance_breaks_confirmation_required",
            "Doplnění pauz vyžaduje potvrzení administrátora.",
        )
    employment = _employment(db, body.employment_id)
    employment = lock_employment_for_time_mutation(db, employment.id)
    _require_locked_active_employment(db, employment)
    start = date(body.year, body.month, 1)
    end = date(body.year + (body.month == 12), 1 if body.month == 12 else body.month + 1, 1)
    range_start = datetime.combine(start, datetime.min.time(), tzinfo=PRAGUE_TIMEZONE)
    range_end = datetime.combine(end, datetime.min.time(), tzinfo=PRAGUE_TIMEZONE)
    ensure_month_unlocked(
        db,
        lock_type=LockType.ATTENDANCE,
        employment_id=employment.id,
        year=body.year,
        month=body.month,
    )
    events = list(
        db.execute(
            select(AttendanceEvent)
            .where(AttendanceEvent.employment_id == employment.id)
            .order_by(AttendanceEvent.occurred_at, AttendanceEvent.id)
        ).scalars()
    )
    if not has_strict_event_sequence(events):
        raise_api_error(
            409,
            "attendance_event_alternation_conflict",
            "Pauzy nelze doplnit, dokud průchody netvoří platnou posloupnost IN a OUT.",
        )
    before_intervals = interval_signatures(events)
    existing_times = {prague_now(event.occurred_at) for event in events}
    inserted_pairs = 0
    inserted_events = 0
    affected_intervals = 0
    for additions in missing_break_event_groups(
        pair_events(events), range_start=range_start, range_end=range_end
    ):
        pairs = [
            additions[index : index + 2]
            for index in range(0, len(additions), 2)
            if len(additions[index : index + 2]) == 2
        ]
        pairs = [
            pair
            for pair in pairs
            if all(occurred_at not in existing_times for occurred_at, _event_type in pair)
        ]
        if not pairs:
            continue
        affected_intervals += 1
        inserted_pairs += len(pairs)
        for pair in pairs:
            for occurred_at, event_type in pair:
                ensure_month_unlocked(
                    db,
                    lock_type=LockType.ATTENDANCE,
                    employment_id=employment.id,
                    year=occurred_at.year,
                    month=occurred_at.month,
                )
                db.add(
                    AttendanceEvent(
                        employment_id=employment.id,
                        occurred_at=occurred_at,
                        event_type=AttendanceEventType(event_type),
                    )
                )
                existing_times.add(occurred_at)
                inserted_events += 1
    db.flush()
    after_events = list(
        db.execute(
            select(AttendanceEvent).where(AttendanceEvent.employment_id == employment.id)
        ).scalars()
    )
    changed_days = changed_event_days(before_intervals, interval_signatures(after_events))
    try:
        ensure_days_have_no_status(db, employment_id=employment.id, days=changed_days)
    except ValueError:
        db.rollback()
        raise_api_error(
            409,
            "attendance_day_status_conflict",
            "Pauzu nelze vložit do dne s celodenní nepřítomností.",
        )
    affected_months = months_for_days(changed_days)
    for year, month in affected_months:
        ensure_month_unlocked(
            db, lock_type=LockType.ATTENDANCE, employment_id=employment.id, year=year, month=month
        )
    sync_employment_metric_months(db, employment=employment, months=affected_months)
    db.commit()
    return AddBreaksOut(
        affected_intervals=affected_intervals,
        inserted_pairs=inserted_pairs,
        inserted_events=inserted_events,
    )


def _validate_alternation(
    db: Session,
    employment_id: int,
    event_type: AttendanceEventType,
    *,
    exclude_id: int | None = None,
) -> None:
    query = (
        select(AttendanceEvent)
        .where(AttendanceEvent.employment_id == employment_id)
        .order_by(AttendanceEvent.occurred_at.desc(), AttendanceEvent.id.desc())
    )
    if exclude_id is not None:
        query = query.where(AttendanceEvent.id != exclude_id)
    latest = db.execute(query).scalars().first()
    if latest is not None and latest.event_type == event_type:
        raise_api_error(
            409, "attendance_event_alternation_conflict", "Průchody musí střídat IN a OUT."
        )


@router.post("/api/v1/admin/attendance/events", response_model=AdminAttendanceEventOut)
def create_event(
    body: AdminAttendanceEventIn,
    _admin=Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> AdminAttendanceEventOut:
    employment = _employment(db, body.employment_id)
    employment = lock_employment_for_time_mutation(db, employment.id)
    _require_locked_active_employment(db, employment)
    occurred_at = prague_now(body.occurred_at)
    paired_occurred_at = (
        prague_now(body.paired_occurred_at) if body.paired_occurred_at is not None else None
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
        employment_id=employment.id, occurred_at=body.occurred_at, event_type=body.event_type
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
    except Exception:
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
        timestamps=tuple(
            value for value in (occurred_at, paired_occurred_at) if value is not None
        ),
    )
    try:
        ensure_days_have_no_status(db, employment_id=employment.id, days=changed_days)
    except ValueError:
        db.rollback()
        raise_api_error(
            409,
            "attendance_day_status_conflict",
            "Do dne s celodenní nepřítomností nelze zapsat průchod.",
        )
    affected_months = months_for_days(changed_days)
    for year, month in affected_months:
        ensure_month_unlocked(
            db, lock_type=LockType.ATTENDANCE, employment_id=employment.id, year=year, month=month
        )
    sync_employment_metric_months(db, employment=employment, months=affected_months)
    db.commit()
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
    query = (
        select(AttendanceEvent)
        .options(selectinload(AttendanceEvent.employment).selectinload(Employment.user))
        .where(AttendanceEvent.occurred_at >= range_start, AttendanceEvent.occurred_at < range_end)
    )
    if employment_id is not None:
        query = query.where(AttendanceEvent.employment_id == employment_id)
    events = (
        db.execute(query.order_by(AttendanceEvent.occurred_at, AttendanceEvent.id)).scalars().all()
    )
    return AdminAttendanceEventListOut(data=[_out(event) for event in events])


@router.put("/api/v1/admin/attendance/events/{event_id}", response_model=AdminAttendanceEventOut)
def update_event(
    event_id: int,
    body: AdminAttendanceEventIn,
    _admin=Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> AdminAttendanceEventOut:
    if body.paired_occurred_at is not None:
        raise_api_error(400, "attendance_event_pair_update_forbidden", "Pár lze měnit po jednom průchodu.")
    event = db.get(AttendanceEvent, event_id)
    if event is None:
        raise_api_error(404, "attendance_event_not_found", "Průchod nebyl nalezen.")
    if body.event_type != event.event_type:
        raise_api_error(
            400,
            "attendance_event_type_immutable",
            "Typ průchodu se mění smazáním a novým vytvořením.",
        )
    if body.employment_id != event.employment_id:
        raise_api_error(
            400, "attendance_event_employment_immutable", "Průchod nelze přesunout na jiný úvazek."
        )
    employment = event.employment
    employment = lock_employment_for_time_mutation(db, employment.id)
    _require_locked_active_employment(db, employment)
    event = db.execute(
        select(AttendanceEvent)
        .where(AttendanceEvent.id == event_id)
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if event is None:
        raise_api_error(404, "attendance_event_not_found", "Průchod nebyl nalezen.")
    if not employment.is_active or employment.user is None or not employment.user.is_active:
        raise_api_error(404, "employment_not_found", "Úvazek nebyl nalezen.")
    previous_occurred_at = prague_now(event.occurred_at)
    next_occurred_at = prague_now(body.occurred_at)
    if next_occurred_at.date() < employment.start_date or (
        employment.end_date is not None and next_occurred_at.date() > employment.end_date
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
    event.occurred_at = body.occurred_at
    ordered = sorted([*events, event], key=lambda item: (prague_now(item.occurred_at), item.id))
    if not has_strict_event_sequence(ordered):
        raise_api_error(
            409, "attendance_event_alternation_conflict", "Průchody musí střídat IN a OUT."
        )
    try:
        db.flush()
    except Exception:
        db.rollback()
        raise_api_error(
            409, "attendance_event_conflict", "Průchod se překrývá s existujícím průchodem."
        )
    changed_days = changed_event_days(
        before_intervals,
        interval_signatures(ordered),
        timestamps=(previous_occurred_at, next_occurred_at),
    )
    try:
        ensure_days_have_no_status(db, employment_id=employment.id, days=changed_days)
    except ValueError:
        db.rollback()
        raise_api_error(
            409,
            "attendance_day_status_conflict",
            "Do dne s celodenní nepřítomností nelze zapsat průchod.",
        )
    affected_months = months_for_days(changed_days)
    for year, month in affected_months:
        ensure_month_unlocked(
            db, lock_type=LockType.ATTENDANCE, employment_id=employment.id, year=year, month=month
        )
    sync_employment_metric_months(db, employment=employment, months=affected_months)
    db.commit()
    db.refresh(event)
    return _out(event)


@router.delete("/api/v1/admin/attendance/events/{event_id}", response_model=dict[str, bool])
def delete_event(
    event_id: int,
    paired_event_id: int | None = None,
    _admin=Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    event = db.get(AttendanceEvent, event_id)
    if event is None:
        raise_api_error(404, "attendance_event_not_found", "Průchod nebyl nalezen.")
    employment = event.employment
    employment = lock_employment_for_time_mutation(db, employment.id)
    _require_locked_active_employment(db, employment)
    event = db.execute(
        select(AttendanceEvent)
        .where(AttendanceEvent.id == event_id)
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if event is None:
        raise_api_error(404, "attendance_event_not_found", "Průchod nebyl nalezen.")
    if not employment.is_active or employment.user is None or not employment.user.is_active:
        raise_api_error(404, "employment_not_found", "Úvazek nebyl nalezen.")
    occurred_at = prague_now(event.occurred_at)
    events = list(
        db.execute(
            select(AttendanceEvent).where(AttendanceEvent.employment_id == employment.id)
        ).scalars()
    )
    before_intervals = interval_signatures(events)
    deleted_ids = {event.id}
    timestamps = [occurred_at]
    if paired_event_id is not None:
        paired = next((item for item in events if item.id == paired_event_id), None)
        if paired is None or paired.employment_id != employment.id or paired.id == event.id:
            raise_api_error(404, "attendance_event_not_found", "Párový průchod nebyl nalezen.")
        deleted_ids.add(paired.id)
        timestamps.append(prague_now(paired.occurred_at))
    remaining_events = [item for item in events if item.id not in deleted_ids]
    if not has_strict_event_sequence(remaining_events):
        raise_api_error(
            409,
            "attendance_event_alternation_conflict",
            "Samostatný průchod nelze odstranit, protože by se porušilo pořadí IN a OUT.",
        )
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
