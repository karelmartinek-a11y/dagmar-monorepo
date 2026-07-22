from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.db.models import Employment, ShiftPlanAutoLockRun
from app.services.employment_access import employment_overlaps_month
from app.services.locks import LockType, set_month_lock_state_bulk
from app.services.prague_time import prague_now

AUTO_LOCKED_BY = "system:shift-plan-month-autolock"


@dataclass(frozen=True)
class ShiftPlanAutoLockResult:
    year: int
    month: int
    already_processed: bool
    locked_count: int


def auto_lock_current_shift_plan_month(
    db: Session,
    *,
    now: datetime | None = None,
) -> ShiftPlanAutoLockResult:
    current = prague_now(now)
    year = current.year
    month = current.month

    existing_run = db.execute(
        select(ShiftPlanAutoLockRun).where(
            ShiftPlanAutoLockRun.year == year,
            ShiftPlanAutoLockRun.month == month,
        )
    ).scalar_one_or_none()
    if existing_run is not None:
        return ShiftPlanAutoLockResult(
            year=year,
            month=month,
            already_processed=True,
            locked_count=existing_run.locked_count,
        )

    month_start = current.date().replace(day=1)
    if month == 12:
        month_end_exclusive = month_start.replace(year=year + 1, month=1)
    else:
        month_end_exclusive = month_start.replace(month=month + 1)

    employments = (
        db.execute(
            select(Employment)
            .options(joinedload(Employment.user))
            .order_by(Employment.id.asc())
        )
        .unique()
        .scalars()
        .all()
    )
    active_rows = [
        (
            employment.id,
            employment.user.instance_id if employment.user is not None else None,
        )
        for employment in employments
        if employment.is_active
        and employment.user is not None
        and employment.user.is_active
        and employment_overlaps_month(employment, month_start, month_end_exclusive)
    ]

    set_month_lock_state_bulk(
        db,
        lock_type=LockType.SHIFT_PLAN,
        employment_rows=active_rows,
        year=year,
        month=month,
        locked=True,
        locked_by=AUTO_LOCKED_BY,
    )
    db.add(
        ShiftPlanAutoLockRun(
            year=year,
            month=month,
            locked_count=len(active_rows),
        )
    )
    db.commit()
    return ShiftPlanAutoLockResult(
        year=year,
        month=month,
        already_processed=False,
        locked_count=len(active_rows),
    )
