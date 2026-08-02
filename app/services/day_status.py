from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Attendance, AttendanceEvent, Employment, ShiftPlan
from app.services.prague_time import PRAGUE_TIMEZONE, prague_now
from app.services.time_intervals import pair_event_rows, shift_plan_interval, shift_plan_months

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

    def to_detail(
        self, *, employment_id: int, day: date, next_status: str | None
    ) -> dict[str, object]:
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


def collect_day_status_conflicts(
    db: Session, *, employment_id: int, day: date
) -> DayStatusConflicts:
    plans = _conflicting_shift_plans(db, employment_id=employment_id, day=day)
    attendance = db.execute(
        select(Attendance).where(
            Attendance.employment_id == employment_id,
            Attendance.date == day,
        )
    ).scalar_one_or_none()
    return DayStatusConflicts(
        attendance_exists=attendance is not None
        and bool(attendance.status)
        or bool(_conflicting_attendance_events(db, employment_id=employment_id, day=day)),
        shift_plan_exists=bool(plans),
    )


def _conflicting_shift_plans(db: Session, *, employment_id: int, day: date) -> list[ShiftPlan]:
    day_start = datetime.combine(day, time.min, tzinfo=PRAGUE_TIMEZONE)
    day_end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=PRAGUE_TIMEZONE)
    rows = list(
        db.execute(
            select(ShiftPlan).where(
                ShiftPlan.employment_id == employment_id,
                ShiftPlan.date >= day - timedelta(days=1),
                ShiftPlan.date <= day,
            )
        ).scalars()
    )
    result: list[ShiftPlan] = []
    for row in rows:
        if row.date == day and (row.arrival_time or row.departure_time or row.status):
            result.append(row)
            continue
        interval = shift_plan_interval(row)
        if interval is not None and interval.start < day_end and interval.end > day_start:
            result.append(row)
    return result


def conflicting_shift_plan_months(
    db: Session, *, employment_id: int, day: date
) -> set[tuple[int, int]]:
    months: set[tuple[int, int]] = set()
    for plan in _conflicting_shift_plans(db, employment_id=employment_id, day=day):
        months.update(shift_plan_months(plan))
    return months


def has_shift_plan_carryover(db: Session, *, employment_id: int, day: date) -> bool:
    return any(
        plan.date < day
        for plan in _conflicting_shift_plans(db, employment_id=employment_id, day=day)
    )


def _conflicting_attendance_events(
    db: Session, *, employment_id: int, day: date
) -> list[AttendanceEvent]:
    """Return event facts whose interval or timestamp overlaps one calendar day."""
    day_start = datetime.combine(day, time.min, tzinfo=PRAGUE_TIMEZONE)
    day_end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=PRAGUE_TIMEZONE)
    events = list(
        db.execute(
            select(AttendanceEvent)
            .where(AttendanceEvent.employment_id == employment_id)
            .order_by(AttendanceEvent.occurred_at, AttendanceEvent.id)
        ).scalars()
    )
    conflicting = {
        event.id: event for event in events if day_start <= prague_now(event.occurred_at) < day_end
    }
    for start_event, end_event in pair_event_rows(events):
        interval_start = prague_now(start_event.occurred_at)
        interval_end = prague_now(end_event.occurred_at)
        if interval_start < day_end and interval_end > day_start:
            conflicting[start_event.id] = start_event
            conflicting[end_event.id] = end_event
    return list(conflicting.values())


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
    if (
        normalized_status is not None
        and conflicts.shift_plan_exists
        and not confirm_reset_existing_plan
    ):
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
    if (
        normalized_status is not None
        and conflicts.attendance_exists
        and not confirm_reset_existing_attendance
    ):
        return conflicts

    attendance = get_attendance_day(db, employment_id=employment.id, day=day)

    if normalized_status is None:
        if attendance is not None:
            attendance.status = None
            attendance.instance_id = instance_id
            if not db.execute(
                select(AttendanceEvent.id).where(
                    AttendanceEvent.employment_id == employment.id,
                    AttendanceEvent.occurred_at
                    >= datetime.combine(day, time.min, tzinfo=PRAGUE_TIMEZONE),
                    AttendanceEvent.occurred_at
                    < datetime.combine(day + timedelta(days=1), time.min, tzinfo=PRAGUE_TIMEZONE),
                )
            ).first():
                db.delete(attendance)
        return conflicts

    if attendance is None:
        attendance = Attendance(
            employment_id=employment.id,
            instance_id=instance_id,
            date=day,
            status=normalized_status,
        )
        db.add(attendance)
    else:
        attendance.instance_id = instance_id
        attendance.status = normalized_status

    return conflicts


def replace_day_status(
    db: Session,
    *,
    employment: Employment,
    day: date,
    status: str | None,
    confirm_delete_conflicts: bool,
    instance_id: str | None,
) -> DayStatusConflicts:
    """Set any supported all-day status and remove confirmed conflicting facts."""
    normalized_status = normalize_day_status(status)
    conflicts = collect_day_status_conflicts(db, employment_id=employment.id, day=day)
    current_status = get_day_status(db, employment_id=employment.id, day=day)
    changing_status = normalized_status != current_status
    if (
        normalized_status is not None
        and changing_status
        and conflicts.has_conflicts
        and not confirm_delete_conflicts
    ):
        return conflicts

    attendance = get_attendance_day(db, employment_id=employment.id, day=day)
    plan = get_shift_plan_day(db, employment_id=employment.id, day=day)
    conflicting_plans = _conflicting_shift_plans(
        db,
        employment_id=employment.id,
        day=day,
    )
    if normalized_status is None:
        set_attendance_status(
            db,
            employment=employment,
            day=day,
            status=None,
            confirm_reset_existing_attendance=True,
            instance_id=instance_id,
        )
        set_shift_plan_status(
            db,
            employment=employment,
            day=day,
            status=None,
            confirm_reset_existing_plan=True,
            instance_id=instance_id,
        )
        return conflicts

    for event in _conflicting_attendance_events(db, employment_id=employment.id, day=day):
        db.delete(event)
    for conflicting_plan in conflicting_plans:
        if conflicting_plan.date != day or normalized_status in {
            DAY_STATUS_SICKNESS,
            DAY_STATUS_PARAGRAPH,
        }:
            db.delete(conflicting_plan)

    if normalized_status in {DAY_STATUS_HOLIDAY, DAY_STATUS_OFF}:
        if attendance is not None:
            db.delete(attendance)
        set_shift_plan_status(
            db,
            employment=employment,
            day=day,
            status=normalized_status,
            confirm_reset_existing_plan=True,
            instance_id=instance_id,
        )
    else:
        if plan is not None and plan not in conflicting_plans:
            db.delete(plan)
        set_attendance_status(
            db,
            employment=employment,
            day=day,
            status=normalized_status,
            confirm_reset_existing_attendance=True,
            instance_id=instance_id,
        )
    return conflicts
