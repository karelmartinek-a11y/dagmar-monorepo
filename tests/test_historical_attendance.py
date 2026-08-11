from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.api.v1.admin_attendance import _load_month_employments
from app.api.v1.admin_export import _load_relevant_employments
from app.db.models import Attendance, Base, Employment, EmploymentType, PortalUser, PortalUserRole


def test_old_data_does_not_reactivate_employment_outside_selected_month() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as db:
        user = PortalUser(
            email="historical@example.test",
            name="Historický uživatel",
            role=PortalUserRole.EMPLOYEE,
        )
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
        visible = _load_month_employments(db, start=start, end=end)
        export_visible = _load_relevant_employments(db, start, end)

    assert visible == []
    assert export_visible == []
