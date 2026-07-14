from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Attendance, Employment, ShiftPlan

DAY_STATUS_HOLIDAY = "HOLIDAY"
DAY_STATUS_OFF = "OFF"
DAY_STATUS_VALUES = {DAY_STATUS_HOLIDAY, DAY_STATUS_OFF}
VACATION_DAY_MINUTES = 8 * 60


@dataclass(frozen=True)
class DayStatusConflicts:
    attendance_exists: bool
    shift_plan_exists: bool

    @property
    def has_conflicts(self) -> bool:
        return self.attendance_exists or self.shift_plan_exists

    def to_detail(self, *, employment_id: int, day: date, next_status: str | None) -> dict[str, object]:
        return {
            "code": "day_status_conflict",
            "message": "V tomto dni už existuje plán směny nebo docházka. Potvrzením budou stávající údaje smazány.",
            "employment_id": employment_id,
            "date": day.isoformat(),
            "next_status": next_status,
            "requires_confirmation": True,
            "attendance_exists": self.attendance_exists,
            "shift_plan_exists": self.shift_plan_exists,
        }


def normalize_day_status(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip().upper()
    if normalized not in DAY_STATUS_VALUES:
        raise ValueError("Neplatný stav dne.")
    return normalized


def get_shift_plan_day(db: Session, *, employment_id: int, day: date) -> ShiftPlan | None:
    return db.execute(
        select(ShiftPlan).where(
            ShiftPlan.employment_id == employment_id,
            ShiftPlan.date == day,
        )
    ).scalar_one_or_none()


def get_day_status(db: Session, *, employment_id: int, day: date) -> str | None:
    row = get_shift_plan_day(db, employment_id=employment_id, day=day)
    if row is None:
        return None
    return row.status


def day_status_label(status: str | None) -> str | None:
    if status == DAY_STATUS_HOLIDAY:
        return "DOVOLENÁ"
    if status == DAY_STATUS_OFF:
        return "VOLNO"
    return None


def collect_day_status_conflicts(db: Session, *, employment_id: int, day: date) -> DayStatusConflicts:
    plan = get_shift_plan_day(db, employment_id=employment_id, day=day)
    attendance = db.execute(
        select(Attendance).where(
            Attendance.employment_id == employment_id,
            Attendance.date == day,
        )
    ).scalar_one_or_none()
    return DayStatusConflicts(
        attendance_exists=attendance is not None and bool(attendance.arrival_time or attendance.departure_time),
        shift_plan_exists=plan is not None and bool(plan.arrival_time or plan.departure_time),
    )


def set_day_status(
    db: Session,
    *,
    employment: Employment,
    day: date,
    status: str | None,
    confirm_delete_conflicts: bool,
    instance_id: str | None,
) -> DayStatusConflicts:
    normalized_status = normalize_day_status(status)
    conflicts = collect_day_status_conflicts(db, employment_id=employment.id, day=day)
    if normalized_status is not None and conflicts.has_conflicts and not confirm_delete_conflicts:
        return conflicts

    plan = get_shift_plan_day(db, employment_id=employment.id, day=day)
    attendance = db.execute(
        select(Attendance).where(
            Attendance.employment_id == employment.id,
            Attendance.date == day,
        )
    ).scalar_one_or_none()

    if normalized_status is None:
        if plan is not None and not plan.arrival_time and not plan.departure_time:
            db.delete(plan)
        elif plan is not None:
            plan.status = None
            plan.instance_id = instance_id
        return conflicts

    if attendance is not None:
        db.delete(attendance)

    if plan is None:
        plan = ShiftPlan(
            employment_id=employment.id,
            instance_id=instance_id,
            date=day,
            arrival_time=None,
            departure_time=None,
            status=normalized_status,
        )
        db.add(plan)
    else:
        plan.instance_id = instance_id
        plan.arrival_time = None
        plan.departure_time = None
        plan.status = normalized_status

    return conflicts
