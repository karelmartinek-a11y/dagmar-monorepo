"""Bounded MCP projections over the same authorization and calculations as Docházka."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import PortalUserAuth
from app.api.errors import raise_api_error
from app.api.v1.admin_attendance import _employment as admin_employment
from app.api.v1.attendance import (
    AttendanceEventOut,
    MetricOut,
    _build_month,
    get_month_attendance,
    get_month_employments,
)
from app.api.v1.shift_plan import (
    GroupOptionOut,
    _accessible_group,
    _month_range,
    build_group_shift_plan_month,
    portal_list_shift_plan_groups,
)
from app.db.models import Employment, PortalUser
from app.services.employment_access import employment_overlaps_month
from app.services.employment_groups import get_group, list_groups


@dataclass(frozen=True)
class AttendanceReader:
    manager: bool
    member: PortalUserAuth | None = None

    def require_member(self) -> PortalUserAuth:
        if self.member is None:
            raise_api_error(403, "attendance_scope_denied", "Přístup k docházce nebyl ověřen.")
        return self.member


class EmploymentChoice(BaseModel):
    id: int
    user_id: int
    label: str
    employment_type: str


class EmploymentPage(BaseModel):
    items: list[EmploymentChoice]
    next_after: int | None = None


class AttendanceDay(BaseModel):
    date: str
    worked_minutes: int | None
    status: str | None
    event_count: int
    events: list[AttendanceEventOut] | None = None


class AttendanceMonth(BaseModel):
    employment_id: int
    employment_label: str
    year: int
    month: int
    worked_minutes: int | None
    planned_hours: float
    attendance_locked: bool
    shift_plan_locked: bool
    days: list[AttendanceDay] | None = None


class GroupPage(BaseModel):
    groups: list[GroupOptionOut]
    next_after: int | None = None


class GroupShift(BaseModel):
    date: str
    arrival_time: str | None
    departure_time: str | None
    planned_status: str | None


class GroupMemberPlan(BaseModel):
    employment_id: int
    label: str
    planned_minutes: int
    locked: bool
    shifts: list[GroupShift]


class GroupPlanPage(BaseModel):
    group_id: int
    name: str
    year: int
    month: int
    items: list[GroupMemberPlan]
    next_after: int | None = None


def _minutes(metrics: dict[str, MetricOut | None] | None) -> int | None:
    total = metrics.get("total") if metrics else None
    return total.minutes if total is not None else None


def _check_day(day: date | None, year: int, month: int) -> None:
    if day is not None and (day.year, day.month) != (year, month):
        raise_api_error(400, "day_outside_month", "Datum musí patřit do vybraného měsíce.")


def attendance_month(
    db: Session,
    reader: AttendanceReader,
    employment_id: int,
    year: int,
    month: int,
    *,
    include_days: bool,
    day: date | None,
) -> AttendanceMonth:
    _check_day(day, year, month)
    if reader.manager:
        employment = admin_employment(db, employment_id)
        start, end = _month_range(year, month)
        if not employment_overlaps_month(employment, start, end):
            raise_api_error(404, "employment_not_active_in_month", "Úvazek není v měsíci aktivní.")
        report = _build_month(db, employment, year, month)
    else:
        report = get_month_attendance(employment_id, year, month, db, reader.require_member())
    days = None
    if include_days or day is not None:
        days = [
            AttendanceDay(
                date=entry.date,
                worked_minutes=_minutes(entry.worked),
                status=entry.effective_status,
                event_count=len(entry.events),
                events=entry.events if day is not None else None,
            )
            for entry in report.days
            if day is None or entry.date == day.isoformat()
        ]
    return AttendanceMonth(
        employment_id=report.employment_id,
        employment_label=report.employment_label,
        year=year,
        month=month,
        worked_minutes=_minutes(report.worked),
        planned_hours=report.planned_hours,
        attendance_locked=report.attendance_locked,
        shift_plan_locked=report.shift_plan_locked,
        days=days,
    )


def employments(
    db: Session,
    reader: AttendanceReader,
    year: int,
    month: int,
    *,
    user_id: int | None,
    after: int,
    limit: int,
) -> EmploymentPage:
    if reader.manager:
        start, end = _month_range(year, month)
        statement = (
            select(Employment, PortalUser.name)
            .join(PortalUser)
            .where(
                PortalUser.is_active.is_(True),
                Employment.id > after,
                Employment.start_date < end,
                Employment.end_date.is_(None) | (Employment.end_date >= start),
            )
            .order_by(Employment.id)
            .limit(limit + 1)
        )
        if user_id is not None:
            statement = statement.where(Employment.user_id == user_id)
        choices = [
            EmploymentChoice(
                id=item.id,
                user_id=item.user_id,
                label=f"{name} — {item.title}",
                employment_type=item.employment_type.value,
            )
            for item, name in db.execute(statement)
        ]
    else:
        member = reader.require_member()
        if user_id is not None and member.user.id != user_id:
            raise_api_error(403, "attendance_scope_denied", "Žádaný účet není ve tvém rozsahu.")
        choices = [
            EmploymentChoice(
                id=item.id,
                user_id=item.user_id,
                label=item.label,
                employment_type=item.employment_type,
            )
            for item in get_month_employments(year, month, db, member)
            if item.id > after
        ]
        choices.sort(key=lambda item: item.id)
    return EmploymentPage(
        items=choices[:limit], next_after=choices[limit - 1].id if len(choices) > limit else None
    )


def groups(
    db: Session, reader: AttendanceReader, year: int, month: int, *, after: int, limit: int
) -> GroupPage:
    if reader.manager:
        choices = [GroupOptionOut(id=group.id, name=group.name) for group in list_groups(db)]
    else:
        choices = portal_list_shift_plan_groups(year, month, db, reader.require_member()).groups
    page = sorted((group for group in choices if group.id > after), key=lambda group: group.id)
    return GroupPage(
        groups=page[:limit], next_after=page[limit - 1].id if len(page) > limit else None
    )


def group_month(
    db: Session,
    reader: AttendanceReader,
    group_id: int,
    year: int,
    month: int,
    *,
    day: date | None,
    after: int,
    limit: int,
) -> GroupPlanPage:
    _check_day(day, year, month)
    if reader.manager:
        group = get_group(db, group_id)
        if group is None:
            raise_api_error(404, "group_not_found", "Skupina nebyla nalezena.")
    else:
        start, end = _month_range(year, month)
        group = _accessible_group(
            db, group_id=group_id, auth=reader.require_member(), month_start=start, month_end=end
        )
    plan = build_group_shift_plan_month(db, group, year, month)
    rows = sorted(
        (row for row in plan.rows if row.employment_id > after), key=lambda row: row.employment_id
    )
    items = [
        GroupMemberPlan(
            employment_id=row.employment_id,
            label=row.display_label,
            planned_minutes=row.planned_minutes,
            locked=row.shift_plan_locked,
            shifts=[
                GroupShift(
                    date=entry.date,
                    arrival_time=entry.arrival_time,
                    departure_time=entry.departure_time,
                    planned_status=entry.status,
                )
                for entry in row.days
                if (day is None or entry.date == day.isoformat())
                and (
                    entry.arrival_time is not None
                    or entry.departure_time is not None
                    or entry.status is not None
                )
            ],
        )
        for row in rows[:limit]
    ]
    return GroupPlanPage(
        group_id=plan.group_id,
        name=plan.group_name,
        year=year,
        month=month,
        items=items,
        next_after=rows[limit - 1].employment_id if len(rows) > limit else None,
    )
