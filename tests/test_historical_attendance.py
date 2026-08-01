from datetime import date, datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.api.v1.admin_attendance import _load_month_employments
from app.api.v1.admin_export import _load_relevant_employments
from app.api.v1.attendance import _build_month
from app.db.models import Attendance, Base, Employment, EmploymentType, PortalUser, PortalUserRole
from app.services.prague_time import PRAGUE_TIMEZONE


def test_admin_month_builder_keeps_pre_migration_day_status() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as db:
        user = PortalUser(email="historical@example.test", name="Historický uživatel", role=PortalUserRole.EMPLOYEE)
        db.add(user)
        db.flush()
        employment = Employment(
            user_id=user.id,
            title="Původní úvazek",
            employment_type=EmploymentType.DPP_DPC,
            start_date=date(2026, 8, 1),
            automatic_breaks_enabled=False,
            afternoon_hours_enabled=False,
            night_hours_enabled=False,
            weekend_hours_enabled=False,
            public_holiday_hours_enabled=False,
        )
        db.add(employment)
        db.flush()
        db.add(Attendance(employment_id=employment.id, date=date(2026, 7, 15), status="SICKNESS"))
        db.commit()

        start = date(2026, 7, 1)
        end = date(2026, 8, 1)
        range_start = datetime.combine(start, datetime.min.time(), tzinfo=PRAGUE_TIMEZONE)
        range_end = datetime.combine(end, datetime.min.time(), tzinfo=PRAGUE_TIMEZONE)
        visible = _load_month_employments(db, start=start, end=end, range_start=range_start, range_end=range_end)
        export_visible = _load_relevant_employments(db, start, end)
        month = _build_month(db, visible[0], 2026, 7)

    assert [item.id for item in visible] == [employment.id]
    assert [item.id for item in export_visible] == [employment.id]
    assert month.employment_id == employment.id
    assert month.days[14].attendance_status == "SICKNESS"
