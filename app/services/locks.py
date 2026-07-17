from __future__ import annotations

from enum import StrEnum

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.errors import raise_api_error
from app.db.models import AttendanceLock, ShiftPlanLock


class LockType(StrEnum):
    ATTENDANCE = "attendance"
    SHIFT_PLAN = "shift_plan"


LOCK_MODEL_BY_TYPE = {
    LockType.ATTENDANCE: AttendanceLock,
    LockType.SHIFT_PLAN: ShiftPlanLock,
}

LOCK_ERROR_BY_TYPE = {
    LockType.ATTENDANCE: ("attendance_month_locked", "Docházka za zvolené období je uzamčena."),
    LockType.SHIFT_PLAN: ("shift_plan_month_locked", "Plán služeb za zvolené období je uzamčen."),
}


def get_lock_model(lock_type: LockType):
    return LOCK_MODEL_BY_TYPE[lock_type]


def is_month_locked(db: Session, *, lock_type: LockType, employment_id: int, year: int, month: int) -> bool:
    model = get_lock_model(lock_type)
    row = db.execute(
        select(model).where(
            model.employment_id == employment_id,
            model.year == year,
            model.month == month,
        )
    ).scalar_one_or_none()
    return row is not None


def ensure_month_unlocked(db: Session, *, lock_type: LockType, employment_id: int, year: int, month: int) -> None:
    if not is_month_locked(db, lock_type=lock_type, employment_id=employment_id, year=year, month=month):
        return
    code, message = LOCK_ERROR_BY_TYPE[lock_type]
    raise_api_error(423, code, message)


def load_locked_employment_ids(
    db: Session,
    *,
    lock_type: LockType,
    employment_ids: list[int],
    year: int,
    month: int,
) -> set[int]:
    if not employment_ids:
        return set()
    model = get_lock_model(lock_type)
    rows = db.execute(
        select(model.employment_id).where(
            model.employment_id.in_(employment_ids),
            model.year == year,
            model.month == month,
        )
    ).all()
    return {int(row[0]) for row in rows}


def set_month_lock_state(
    db: Session,
    *,
    lock_type: LockType,
    employment_id: int,
    instance_id: str | None,
    year: int,
    month: int,
    locked: bool,
    locked_by: str | None,
) -> None:
    model = get_lock_model(lock_type)
    existing = db.execute(
        select(model).where(
            model.employment_id == employment_id,
            model.year == year,
            model.month == month,
        )
    ).scalar_one_or_none()
    if locked:
        if existing is None:
            db.add(
                model(
                    employment_id=employment_id,
                    instance_id=instance_id,
                    year=year,
                    month=month,
                    locked_by=locked_by,
                )
            )
        else:
            existing.instance_id = instance_id
            existing.locked_by = locked_by
        return
    if existing is not None:
        db.delete(existing)


def set_month_lock_state_bulk(
    db: Session,
    *,
    lock_type: LockType,
    employment_rows: list[tuple[int, str | None]],
    year: int,
    month: int,
    locked: bool,
    locked_by: str | None,
) -> None:
    employment_ids = [employment_id for employment_id, _ in employment_rows]
    if not employment_ids:
        return
    model = get_lock_model(lock_type)
    existing_rows = db.execute(
        select(model).where(
            model.employment_id.in_(employment_ids),
            model.year == year,
            model.month == month,
        )
    ).scalars().all()
    existing_by_employment_id = {row.employment_id: row for row in existing_rows}
    if locked:
        for employment_id, instance_id in employment_rows:
            existing = existing_by_employment_id.get(employment_id)
            if existing is None:
                db.add(
                    model(
                        employment_id=employment_id,
                        instance_id=instance_id,
                        year=year,
                        month=month,
                        locked_by=locked_by,
                    )
                )
            else:
                existing.instance_id = instance_id
                existing.locked_by = locked_by
        return
    db.execute(
        delete(model).where(
            model.employment_id.in_(employment_ids),
            model.year == year,
            model.month == month,
        )
    )
