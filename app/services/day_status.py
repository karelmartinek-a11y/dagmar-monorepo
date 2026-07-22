from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Attendance, Employment, ShiftPlan

DAY_STATUS_HOLIDAY = "HOLIDAY"
DAY_STATUS_OFF = "OFF"
DAY_STATUS_SICKNESS = "SICKNESS"
DAY_STATUS_PARAGRAPH = "PARAGRAPH"
DAY_STATUS_VALUES = {DAY_STATUS_HOLIDAY, DAY_STATUS_OFF, DAY_STATUS_SICKNESS, DAY_STATUS_PARAGRAPH}
VACATION_DAY_MINUTES = 8 * 60


@dataclass(frozen=True)
class DayStatusConflicts:
    attendance_exists: bool
    shift_plan_exists: bool

    @property
    def has_conflicts(self) -> bool:
        return self.attendance_exists or self.shift_plan_exists

    def to_detail(self, *, employment_id: int, day: date, next_status: str | None) -> dict[str, object]:
        params = {
            "employment_id": employment_id,
            "date": day.isoformat(),
            "next_status": next_status,
            "requires_confirmation": True,
            "attendance_exists": self.attendance_exists,
            "shift_plan_exists": self.shift_plan_exists,
        }
        return {
            "code": "day_status_conflict",
            "message": "V tomto dni už existuje plán směny nebo docházka. Potvrzením budou stávající údaje smazány.",
            "params": params,
            **params,
        }


def normalize_day_status(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip().upper()
    if normalized not in DAY_STATUS_VALUES:
        raise ValueError("invalid_day_status")
    return normalized


def get_shift_plan_day(db: Session, *, employment_id: int, day: date) -> ShiftPlan | None:
    return db.execute(
        select(ShiftPlan).where(
            ShiftPlan.employment_id == employment_id,
            ShiftPlan.date == day,
        )
    ).scalar_one_or_none()


def get_day_status(db: Session, *, employment_id: int, day: date) -> str | None:
    attendance = db.execute(
        select(Attendance).where(
            Attendance.employment_id == employment_id,
            Attendance.date == day,
        )
    ).scalar_one_or_none()
    if attendance is not None and attendance.status:
        return attendance.status
    row = get_shift_plan_day(db, employment_id=employment_id, day=day)
    if row is None:
        return None
    return row.status


def day_status_label(status: str | None) -> str | None:
    if status == DAY_STATUS_HOLIDAY:
        return "DOVOLENÁ"
    if status == DAY_STATUS_OFF:
        return "VOLNO"
    if status == DAY_STATUS_SICKNESS:
        return "NEMOC"
    if status == DAY_STATUS_PARAGRAPH:
        return "PARAGRAF"
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
        attendance_exists=attendance is not None
        and bool(attendance.arrival_time or attendance.departure_time or attendance.arrival_time_2 or attendance.departure_time_2 or attendance.status),
        shift_plan_exists=plan is not None and bool(plan.arrival_time or plan.departure_time or plan.status),
    )


def get_attendance_day(db: Session, *, employment_id: int, day: date) -> Attendance | None:
    return db.execute(
        select(Attendance).where(
            Attendance.employment_id == employment_id,
            Attendance.date == day,
        )
    ).scalar_one_or_none()


def set_shift_plan_status(
    db: Session,
    *,
    employment: Employment,
    day: date,
    status: str | None,
    confirm_reset_existing_plan: bool,
    instance_id: str | None,
) -> DayStatusConflicts:
    normalized_status = normalize_day_status(status)
    if normalized_status not in {None, DAY_STATUS_HOLIDAY, DAY_STATUS_OFF}:
        raise ValueError("invalid_shift_plan_status")

    conflicts = collect_day_status_conflicts(db, employment_id=employment.id, day=day)
    if normalized_status is not None and conflicts.shift_plan_exists and not confirm_reset_existing_plan:
        return conflicts

    plan = get_shift_plan_day(db, employment_id=employment.id, day=day)

    if normalized_status is None:
        if plan is not None and not plan.arrival_time and not plan.departure_time:
            db.delete(plan)
        elif plan is not None:
            plan.status = None
            plan.instance_id = instance_id
        return conflicts

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


def set_attendance_status(
    db: Session,
    *,
    employment: Employment,
    day: date,
    status: str | None,
    confirm_reset_existing_attendance: bool,
    instance_id: str | None,
) -> DayStatusConflicts:
    normalized_status = normalize_day_status(status)
    if normalized_status not in {None, DAY_STATUS_SICKNESS, DAY_STATUS_PARAGRAPH}:
        raise ValueError("invalid_attendance_status")

    conflicts = collect_day_status_conflicts(db, employment_id=employment.id, day=day)
    if normalized_status is not None and conflicts.attendance_exists and not confirm_reset_existing_attendance:
        return conflicts

    attendance = get_attendance_day(db, employment_id=employment.id, day=day)

    if normalized_status is None:
        if attendance is not None:
            attendance.status = None
            attendance.instance_id = instance_id
            if not any([attendance.arrival_time, attendance.departure_time, attendance.arrival_time_2, attendance.departure_time_2]):
                db.delete(attendance)
        return conflicts

    if attendance is None:
        attendance = Attendance(
            employment_id=employment.id,
            instance_id=instance_id,
            date=day,
            arrival_time=None,
            departure_time=None,
            arrival_time_2=None,
            departure_time_2=None,
            status=normalized_status,
        )
        db.add(attendance)
    else:
        attendance.instance_id = instance_id
        attendance.arrival_time = None
        attendance.departure_time = None
        attendance.arrival_time_2 = None
        attendance.departure_time_2 = None
        attendance.status = normalized_status

    return conflicts
