# ruff: noqa: B008
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.api.deps import require_admin
from app.api.errors import raise_api_error
from app.db.models import Employment
from app.db.session import get_db
from app.security.csrf import require_csrf
from app.services.employment_access import employment_overlaps_month
from app.services.locks import LockType, set_month_lock_state_bulk

router = APIRouter(tags=["admin"])


def _admin_username(admin: object) -> str | None:
    if isinstance(admin, dict):
        value = admin.get("username")
    else:
        value = getattr(admin, "username", None)
    return value if isinstance(value, str) and value else None


class LockMonthIn(BaseModel):
    year: int = Field(..., ge=2000, le=2100)
    month: int = Field(..., ge=1, le=12)


class AdminLockSetIn(BaseModel):
    lock_type: LockType
    year: int | None = Field(default=None, ge=2000, le=2100)
    month: int | None = Field(default=None, ge=1, le=12)
    months: list[LockMonthIn] = Field(default_factory=list)
    locked: bool
    employment_ids: list[int] = Field(default_factory=list)


class AdminLockSetOut(BaseModel):
    ok: bool = True
    updated_count: int = 0
    lock_type: LockType
    year: int | None = None
    month: int | None = None
    locked: bool
    month_count: int = 0
    months: list[LockMonthIn] = Field(default_factory=list)


def _normalize_months(body: AdminLockSetIn) -> list[LockMonthIn]:
    requested = body.months[:]
    if body.year is not None or body.month is not None:
        if body.year is None or body.month is None:
            raise_api_error(400, "invalid_lock_months", "Year a month musí být zadané společně.")
        requested.append(LockMonthIn(year=body.year, month=body.month))
    uniq: list[LockMonthIn] = []
    seen: set[tuple[int, int]] = set()
    for item in requested:
        key = (item.year, item.month)
        if key in seen:
            continue
        seen.add(key)
        uniq.append(item)
    if not uniq:
        raise_api_error(400, "lock_months_required", "Vyberte alespoň jeden měsíc.")
    return uniq


def _month_range(item: LockMonthIn) -> tuple[dt.date, dt.date]:
    start = dt.date(item.year, item.month, 1)
    if item.month == 12:
        end = dt.date(item.year + 1, 1, 1)
    else:
        end = dt.date(item.year, item.month + 1, 1)
    return start, end


@router.put("/api/v1/admin/locks", response_model=AdminLockSetOut)
def admin_set_locks(
    body: AdminLockSetIn,
    admin=Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> AdminLockSetOut:
    uniq_ids = list(dict.fromkeys(body.employment_ids))
    months = _normalize_months(body)
    if not uniq_ids:
        raise_api_error(400, "employment_ids_required", "Vyberte alespoň jeden úvazek.")

    employments = (
        db.execute(
            select(Employment)
            .options(joinedload(Employment.user))
            .where(Employment.id.in_(uniq_ids))
            .order_by(Employment.id.asc())
        )
        .unique()
        .scalars()
        .all()
    )
    employment_by_id = {employment.id: employment for employment in employments}
    missing_ids = [employment_id for employment_id in uniq_ids if employment_id not in employment_by_id]
    if missing_ids:
        raise_api_error(404, "employment_not_found", "Úvazek nebyl nalezen.", employment_ids=missing_ids)

    target_rows_by_month: list[tuple[LockMonthIn, list[tuple[int, str | None]]]] = []
    updated_count = 0
    for item in months:
        month_start, month_end = _month_range(item)
        month_rows = [
            (
                employment.id,
                employment.user.instance_id if employment.user is not None else None,
            )
            for employment_id in uniq_ids
            for employment in [employment_by_id[employment_id]]
            if employment_overlaps_month(employment, month_start, month_end)
        ]
        if not month_rows:
            continue
        target_rows_by_month.append((item, month_rows))
        updated_count += len(month_rows)

    if not target_rows_by_month:
        raise_api_error(
            409,
            "employment_period_mismatch",
            "Vybrané období neleží v platnosti žádného zvoleného úvazku.",
        )

    for item, rows in target_rows_by_month:
        set_month_lock_state_bulk(
            db,
            lock_type=body.lock_type,
            employment_rows=rows,
            year=item.year,
            month=item.month,
            locked=body.locked,
            locked_by=_admin_username(admin),
        )
    db.commit()
    return AdminLockSetOut(
        ok=True,
        updated_count=updated_count,
        lock_type=body.lock_type,
        year=months[0].year if len(months) == 1 else None,
        month=months[0].month if len(months) == 1 else None,
        locked=body.locked,
        month_count=len(months),
        months=months,
    )
