"""MCP calls the same attendance mutations that serve the CML screens."""

from datetime import date, datetime
from typing import Literal

from sqlalchemy.orm import Session

from app.api.errors import raise_api_error
from app.api.v1 import admin_attendance, admin_shift_plan, attendance, shift_plan
from app.db.models import AttendanceEvent
from app.security.sessions import AdminSession
from app.services.attendance_mcp_reads import AttendanceReader

DayStatus = Literal["HOLIDAY", "OFF", "SICKNESS", "PARAGRAPH"]
PlanStatus = Literal["HOLIDAY", "OFF"]


def require_employment(db: Session, reader: AttendanceReader, employment_id: int) -> None:
    if reader.manager:
        admin_attendance._employment(db, employment_id)
    else:
        attendance._require_accessible_employment(employment_id, reader.require_member(), db)


def _require_event(db: Session, event_id: int, employment_id: int) -> None:
    event = db.get(AttendanceEvent, event_id)
    if event is None or event.employment_id != employment_id:
        raise_api_error(404, "attendance_event_not_found", "Průchod nebyl nalezen.")


def create_event(
    db: Session,
    reader: AttendanceReader,
    subject: str,
    employment_id: int,
    occurred_at: datetime,
    paired_occurred_at: datetime | None,
) -> None:
    if reader.manager:
        admin_attendance.create_event(
            admin_attendance.AdminAttendanceEventIn(
                employment_id=employment_id,
                occurred_at=occurred_at,
                paired_occurred_at=paired_occurred_at,
            ),
            _admin=AdminSession(subject, 0),
            _=None,
            db=db,
            activity_actor=subject,
        )
    else:
        attendance.create_attendance_event(
            attendance.AttendanceEventIn(
                employment_id=employment_id,
                occurred_at=occurred_at,
                paired_occurred_at=paired_occurred_at,
            ),
            db,
            reader.require_member(),
            subject,
        )


def update_event(
    db: Session,
    reader: AttendanceReader,
    subject: str,
    employment_id: int,
    event_id: int,
    occurred_at: datetime,
) -> None:
    _require_event(db, event_id, employment_id)
    if reader.manager:
        admin_attendance.update_event(
            event_id,
            admin_attendance.AdminAttendanceEventIn(
                employment_id=employment_id,
                occurred_at=occurred_at,
            ),
            _admin=AdminSession(subject, 0),
            _=None,
            db=db,
            activity_actor=subject,
        )
    else:
        attendance.update_attendance_event(
            event_id,
            attendance.AttendanceEventIn(employment_id=employment_id, occurred_at=occurred_at),
            db,
            reader.require_member(),
            subject,
        )


def delete_event(
    db: Session,
    reader: AttendanceReader,
    subject: str,
    employment_id: int,
    event_id: int,
    paired_event_id: int | None,
) -> None:
    _require_event(db, event_id, employment_id)
    if reader.manager:
        admin_attendance.delete_event(
            event_id,
            paired_event_id,
            _admin=AdminSession(subject, 0),
            _=None,
            db=db,
            activity_actor=subject,
        )
    else:
        attendance.delete_attendance_event(
            event_id,
            paired_event_id,
            db,
            reader.require_member(),
            subject,
        )


def set_day_status(
    db: Session,
    reader: AttendanceReader,
    subject: str,
    employment_id: int,
    day: date,
    status: DayStatus | None,
    confirm_delete_conflicts: bool,
) -> None:
    if reader.manager:
        admin_shift_plan.admin_upsert_day_status(
            admin_shift_plan.DayStatusUpsertIn(
                employment_id=employment_id,
                date=day.isoformat(),
                status=status,
                confirm_delete_conflicts=confirm_delete_conflicts,
            ),
            _admin=AdminSession(subject, 0),
            _=None,
            db=db,
        )
    else:
        attendance.upsert_attendance_status(
            attendance.AttendanceStatusUpsertIn(
                employment_id=employment_id,
                date=day.isoformat(),
                status=status,
                confirm_delete_conflicts=confirm_delete_conflicts,
            ),
            db,
            reader.require_member(),
            subject,
        )


def update_shift_plan(
    db: Session,
    reader: AttendanceReader,
    employment_id: int,
    day: date,
    arrival_time: str | None,
    departure_time: str | None,
    status: PlanStatus | None,
    confirm_delete_conflicts: bool,
) -> None:
    if reader.manager:
        admin_shift_plan._admin_upsert_shift_plan_impl(
            db,
            admin_shift_plan.ShiftPlanUpsertIn(
                employment_id=employment_id,
                date=day.isoformat(),
                arrival_time=arrival_time,
                departure_time=departure_time,
                status=status,
                confirm_delete_conflicts=confirm_delete_conflicts,
            ),
        )
    else:
        shift_plan.portal_upsert_shift_plan(
            shift_plan.PortalShiftPlanUpsertIn(
                employment_id=employment_id,
                date=day.isoformat(),
                arrival_time=arrival_time,
                departure_time=departure_time,
                status=status,
                confirm_delete_conflicts=confirm_delete_conflicts,
            ),
            db,
            reader.require_member(),
        )


def set_shift_plan_day_status(
    db: Session,
    reader: AttendanceReader,
    employment_id: int,
    day: date,
    status: PlanStatus | None,
    confirm_delete_conflicts: bool,
) -> None:
    if reader.manager:
        admin_shift_plan._admin_upsert_shift_plan_impl(
            db,
            admin_shift_plan.ShiftPlanUpsertIn(
                employment_id=employment_id,
                date=day.isoformat(),
                arrival_time=None,
                departure_time=None,
                status=status,
                confirm_delete_conflicts=confirm_delete_conflicts,
            ),
            clear_status_only=status is None,
        )
    else:
        shift_plan.portal_upsert_day_status(
            shift_plan.PortalDayStatusUpsertIn(
                employment_id=employment_id,
                date=day.isoformat(),
                status=status,
                confirm_delete_conflicts=confirm_delete_conflicts,
            ),
            db,
            reader.require_member(),
        )
