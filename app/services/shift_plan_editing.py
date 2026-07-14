from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import ShiftPlanEmploymentEditPermission, ShiftPlanMonthEditPolicy


def get_month_employee_edit_default(db: Session, *, year: int, month: int) -> bool:
    value = db.execute(
        select(ShiftPlanMonthEditPolicy.allow_employee_edits).where(
            ShiftPlanMonthEditPolicy.year == year,
            ShiftPlanMonthEditPolicy.month == month,
        )
    ).scalar_one_or_none()
    return bool(value) if value is not None else False


def get_employment_edit_overrides(db: Session, *, year: int, month: int) -> dict[int, bool]:
    rows = db.execute(
        select(
            ShiftPlanEmploymentEditPermission.employment_id,
            ShiftPlanEmploymentEditPermission.allow_employee_edits,
        )
        .where(ShiftPlanEmploymentEditPermission.year == year)
        .where(ShiftPlanEmploymentEditPermission.month == month)
    ).all()
    return {int(employment_id): bool(allowed) for employment_id, allowed in rows}


def can_employee_edit_shift_plan(db: Session, *, employment_id: int, year: int, month: int) -> bool:
    override = db.execute(
        select(ShiftPlanEmploymentEditPermission.allow_employee_edits).where(
            ShiftPlanEmploymentEditPermission.employment_id == employment_id,
            ShiftPlanEmploymentEditPermission.year == year,
            ShiftPlanEmploymentEditPermission.month == month,
        )
    ).scalar_one_or_none()
    if override is not None:
        return bool(override)
    return get_month_employee_edit_default(db, year=year, month=month)
