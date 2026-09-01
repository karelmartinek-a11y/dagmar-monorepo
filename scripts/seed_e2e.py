"""Seed the isolated PostgreSQL database used by browser integration tests."""

from __future__ import annotations

import os
import uuid
from datetime import UTC, date, datetime

from sqlalchemy import delete, select
from sqlalchemy.engine import make_url

from app.db.models import (
    Attendance,
    AttendanceEvent,
    AttendanceLock,
    ClientType,
    Employment,
    EmploymentDailyTimeMetric,
    EmploymentGroup,
    EmploymentGroupMember,
    EmploymentType,
    Instance,
    InstanceStatus,
    PortalUser,
    PortalUserRole,
    ShiftPlan,
    ShiftPlanLock,
    ShiftPlanMonthInstance,
)
from app.db.session import get_sessionmaker
from app.security.passwords import hash_password
from app.services.daily_metrics import sync_employment_metrics
from app.services.prague_time import PRAGUE_TIMEZONE

E2E_START = date(2026, 1, 1)


def _event(
    employment_id: int,
    year: int,
    month: int,
    day: int,
    hour: int,
    minute: int,
) -> AttendanceEvent:
    return AttendanceEvent(
        employment_id=employment_id,
        occurred_at=datetime(year, month, day, hour, minute, tzinfo=PRAGUE_TIMEZONE),
    )


def _ensure_user(
    db, *, email: str, name: str, password: str | None = None, instance: Instance | None = None
) -> PortalUser:
    user = db.execute(select(PortalUser).where(PortalUser.email == email)).scalar_one_or_none()
    if user is None:
        user = PortalUser(
            email=email,
            name=name,
            role=PortalUserRole.EMPLOYEE,
            password_hash=hash_password(password).value if password else None,
            is_active=True,
            instance=instance,
        )
        db.add(user)
        db.flush()
    return user


def _ensure_employment(
    db, *, user: PortalUser, title: str, employment_type: EmploymentType, **profile
) -> Employment:
    employment = db.execute(
        select(Employment).where(Employment.user_id == user.id, Employment.title == title)
    ).scalar_one_or_none()
    values = {
        "employment_type": employment_type,
        "workload_fraction": 1 if employment_type == EmploymentType.WORK_CONTRACT else None,
        "total_hours_enabled": employment_type != EmploymentType.TASK_SHIFT_BASED,
        "automatic_breaks_enabled": False,
        "afternoon_hours_enabled": False,
        "afternoon_start_minutes": None,
        "night_hours_enabled": employment_type == EmploymentType.WORK_CONTRACT,
        "weekend_hours_enabled": False,
        "public_holiday_hours_enabled": False,
        "start_date": E2E_START,
        "end_date": None,
        "is_active": True,
        **profile,
    }
    if employment is None:
        employment = Employment(user_id=user.id, title=title, **values)
        db.add(employment)
        db.flush()
    else:
        for key, value in values.items():
            setattr(employment, key, value)
    return employment


def main() -> None:
    database_url = os.environ["DAGMAR_DATABASE_URL"]
    url = make_url(database_url)
    if (
        os.getenv("DAGMAR_E2E_SEED") != "1"
        or url.host not in {"127.0.0.1", "localhost"}
        or "e2e" not in (url.database or "")
    ):
        raise SystemExit("Refusing to seed a database that is not an explicit local E2E target.")

    email = os.getenv("DAGMAR_E2E_USER_EMAIL", "employee.e2e@example.test")
    password = os.getenv("DAGMAR_E2E_USER_PASSWORD", "EmployeeE2E-Strong-123")
    with get_sessionmaker()() as db:
        instance = Instance(
            id=str(uuid.uuid4()),
            client_type=ClientType.WEB,
            device_fingerprint="dagmar-e2e-browser",
            status=InstanceStatus.ACTIVE,
            display_name="E2E prohlížeč",
            activated_at=datetime.now(UTC),
        )
        user = _ensure_user(
            db, email=email, name="Testovací zaměstnanec", password=password, instance=instance
        )
        own = _ensure_employment(
            db,
            user=user,
            title="E2E provozní úvazek",
            employment_type=EmploymentType.DPP_DPC,
            total_hours_enabled=True,
            afternoon_hours_enabled=True,
            afternoon_start_minutes=18 * 60,
            weekend_hours_enabled=True,
        )
        colleague_user = _ensure_user(db, email="colleague.e2e@example.test", name="Kolega E2E")
        colleague = _ensure_employment(
            db,
            user=colleague_user,
            title="E2E pracovní smlouva",
            employment_type=EmploymentType.WORK_CONTRACT,
            public_holiday_hours_enabled=True,
        )
        external_user = _ensure_user(db, email="external.e2e@example.test", name="Externista E2E")
        external = _ensure_employment(
            db,
            user=external_user,
            title="E2E externí fakturace",
            employment_type=EmploymentType.EXTERNAL_HOURLY,
            total_hours_enabled=False,
            night_hours_enabled=True,
        )
        task_user = _ensure_user(db, email="task.e2e@example.test", name="Úkolový E2E")
        task = _ensure_employment(
            db,
            user=task_user,
            title="E2E úkolová odměna",
            employment_type=EmploymentType.TASK_SHIFT_BASED,
        )
        inactive_user = _ensure_user(db, email="inactive.e2e@example.test", name="Neaktivní E2E")
        inactive_user.is_active = False
        inactive = _ensure_employment(
            db,
            user=inactive_user,
            title="E2E skrytý úvazek",
            employment_type=EmploymentType.DPP_DPC,
        )
        inactive.is_active = False
        db.flush()

        employment_ids = [own.id, colleague.id, external.id, task.id, inactive.id]
        for model in (
            EmploymentDailyTimeMetric,
            AttendanceEvent,
            Attendance,
            ShiftPlan,
            AttendanceLock,
            ShiftPlanLock,
            ShiftPlanMonthInstance,
        ):
            db.execute(delete(model).where(model.employment_id.in_(employment_ids)))
        db.flush()

        db.add_all(
            [
                _event(own.id, 2026, 6, 8, 8, 0),
                _event(own.id, 2026, 6, 8, 16, 3),
                _event(own.id, 2026, 7, 1, 8, 0),
                _event(own.id, 2026, 7, 1, 12, 0),
                _event(own.id, 2026, 7, 1, 12, 30),
                _event(own.id, 2026, 7, 1, 17, 0),
                _event(own.id, 2026, 7, 31, 14, 0),
                _event(own.id, 2026, 7, 31, 22, 0),
                _event(own.id, 2026, 8, 3, 8, 0),
                _event(own.id, 2026, 8, 3, 16, 0),
                _event(own.id, 2026, 8, 4, 8, 0),
                _event(own.id, 2026, 8, 4, 15, 0),
                Attendance(
                    employment_id=own.id,
                    instance_id=user.instance_id,
                    date=date(2026, 6, 15),
                    status="SICKNESS",
                ),
                Attendance(
                    employment_id=own.id,
                    instance_id=user.instance_id,
                    date=date(2026, 8, 11),
                    status="PARAGRAPH",
                ),
                ShiftPlan(
                    employment_id=own.id,
                    instance_id=user.instance_id,
                    date=date(2026, 6, 8),
                    arrival_time="08:00",
                    departure_time="16:00",
                ),
                ShiftPlan(
                    employment_id=own.id,
                    instance_id=user.instance_id,
                    date=date(2026, 7, 6),
                    status="HOLIDAY",
                ),
                ShiftPlan(
                    employment_id=own.id,
                    instance_id=user.instance_id,
                    date=date(2026, 7, 31),
                    arrival_time="14:00",
                    departure_time="22:00",
                ),
                ShiftPlan(
                    employment_id=own.id,
                    instance_id=user.instance_id,
                    date=date(2026, 8, 3),
                    arrival_time="08:30",
                    departure_time="16:30",
                ),
                ShiftPlan(
                    employment_id=own.id,
                    instance_id=user.instance_id,
                    date=date(2026, 8, 10),
                    status="OFF",
                ),
                ShiftPlan(
                    employment_id=colleague.id,
                    date=date(2026, 8, 3),
                    arrival_time="07:00",
                    departure_time="15:00",
                ),
                ShiftPlan(
                    employment_id=external.id,
                    date=date(2026, 8, 3),
                    arrival_time="18:00",
                    departure_time="23:00",
                ),
                AttendanceLock(
                    employment_id=own.id,
                    instance_id=user.instance_id,
                    year=2026,
                    month=6,
                    locked_by="e2e",
                ),
                ShiftPlanLock(
                    employment_id=own.id,
                    instance_id=user.instance_id,
                    year=2026,
                    month=7,
                    locked_by="e2e",
                ),
            ]
        )
        for year, month in ((2026, 6), (2026, 7), (2026, 8)):
            for employment in (own, colleague, external, task):
                db.add(ShiftPlanMonthInstance(year=year, month=month, employment_id=employment.id))

        group = db.execute(
            select(EmploymentGroup).where(EmploymentGroup.name == "E2E skupina")
        ).scalar_one_or_none()
        if group is None:
            group = EmploymentGroup(name="E2E skupina")
            db.add(group)
            db.flush()
        existing_members = set(
            db.execute(
                select(EmploymentGroupMember.employment_id).where(
                    EmploymentGroupMember.group_id == group.id
                )
            ).scalars()
        )
        for employment in (own, colleague, external):
            if employment.id not in existing_members:
                db.add(EmploymentGroupMember(group_id=group.id, employment_id=employment.id))
        db.flush()
        for employment in (own, colleague, external, task):
            sync_employment_metrics(db, employment=employment)
        db.commit()


if __name__ == "__main__":
    main()
