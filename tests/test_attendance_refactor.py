import sys
from contextlib import contextmanager
from datetime import date, datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.requests import Request

from app.api.deps import IntegrationAuth, PortalUserAuth
from app.api.integration_common import get_audit_context
from app.api.v1.admin_attendance import (
    AddBreaksIn,
    AdminAttendanceEventIn,
    add_missing_breaks,
)
from app.api.v1.admin_attendance import (
    create_event as admin_create_event,
)
from app.api.v1.admin_attendance import (
    delete_event as admin_delete_event,
)
from app.api.v1.admin_employments import (
    EmploymentDeleteIn,
    EmploymentUpdateIn,
    delete_employment,
    update_employment,
)
from app.api.v1.admin_export import _csv_for_employment
from app.api.v1.admin_shift_plan import (
    DayStatusUpsertIn,
    ShiftPlanSelectionIn,
    ShiftPlanUpsertIn,
    _admin_get_shift_plan_month_impl,
    _admin_set_shift_plan_selection_impl,
    _admin_upsert_shift_plan_impl,
    admin_upsert_day_status,
)
from app.api.v1.attendance import (
    AttendanceEventIn,
    AttendanceEventOut,
    AttendanceStatusUpsertIn,
    _build_month,
    create_attendance_event,
    delete_attendance_event,
    get_month_employments,
    update_attendance_event,
    upsert_attendance_status,
)
from app.api.v1.integration import IntegrationEventIn
from app.api.v1.integration import create_attendance_event as integration_create_event
from app.api.v1.integration import delete_attendance_event as integration_delete_event
from app.api.v1.shift_plan import (
    PortalDayStatusUpsertIn,
    PortalShiftPlanUpsertIn,
    portal_get_group_shift_plan_month,
    portal_list_shift_plan_groups,
    portal_upsert_day_status,
    portal_upsert_shift_plan,
)
from app.db.models import (
    Attendance,
    AttendanceEvent,
    AttendanceLock,
    Base,
    DailyMetricSource,
    Employment,
    EmploymentDailyTimeMetric,
    EmploymentGroup,
    EmploymentGroupMember,
    EmploymentType,
    IntegrationClient,
    IntegrationClientSecret,
    PortalUser,
    PortalUserRole,
    ShiftPlan,
    ShiftPlanLock,
    ShiftPlanMonthInstance,
)
from app.services.attendance_events import add_event_with_breaks
from app.services.daily_metrics import (
    CALCULATION_REVISION,
    sync_employment_metric_months,
    sync_employment_metrics,
)
from app.services.day_status import replace_day_status
from app.services.employment_access import (
    lock_employment_for_time_mutation,
    locked_employment_has_active_user,
)
from app.services.prague_time import PRAGUE_TIMEZONE
from app.services.shift_plan_reports import (
    _metric_cell_label,
    build_shift_plan_report,
    report_to_payload,
)
from scripts import rebuild_daily_time_metrics


def _employment(
    db: Session, employment_type: EmploymentType = EmploymentType.WORK_CONTRACT
) -> Employment:
    user = PortalUser(
        email=f"{employment_type.value.lower()}@example.test",
        name="Regresní uživatel",
        role=PortalUserRole.EMPLOYEE,
        is_active=True,
    )
    db.add(user)
    db.flush()
    employment = Employment(
        user_id=user.id,
        title="Regresní úvazek",
        employment_type=employment_type,
        workload_fraction=1 if employment_type == EmploymentType.WORK_CONTRACT else None,
        total_hours_enabled=employment_type != EmploymentType.TASK_SHIFT_BASED,
        automatic_breaks_enabled=False,
        afternoon_hours_enabled=False,
        night_hours_enabled=employment_type == EmploymentType.WORK_CONTRACT,
        weekend_hours_enabled=False,
        public_holiday_hours_enabled=False,
        start_date=date(2026, 6, 1),
        is_active=True,
    )
    db.add(employment)
    db.flush()
    return employment


def _event(employment_id: int, value: datetime) -> AttendanceEvent:
    return AttendanceEvent(
        employment_id=employment_id,
        occurred_at=value.replace(tzinfo=PRAGUE_TIMEZONE),
    )


def test_three_month_event_contract_and_retroactive_metric_visibility() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db)
        db.add_all(
            [
                _event(employment.id, datetime(2026, 6, 10, 8)),
                _event(employment.id, datetime(2026, 6, 10, 16, 3)),
                _event(employment.id, datetime(2026, 7, 31, 22)),
                _event(employment.id, datetime(2026, 8, 1, 2)),
                _event(employment.id, datetime(2026, 8, 4, 8)),
                _event(employment.id, datetime(2026, 8, 4, 12)),
                _event(employment.id, datetime(2026, 8, 4, 13)),
                ShiftPlan(
                    employment_id=employment.id,
                    date=date(2026, 7, 31),
                    arrival_time="22:00",
                    departure_time="02:00",
                ),
                ShiftPlan(
                    employment_id=employment.id,
                    date=date(2026, 8, 3),
                    arrival_time="09:00",
                    departure_time="17:00",
                ),
            ]
        )
        db.flush()
        sync_employment_metrics(db, employment=employment)
        db.commit()

        june = _build_month(db, employment, 2026, 6)
        july = _build_month(db, employment, 2026, 7)
        august = _build_month(db, employment, 2026, 8)

        assert june.days[9].worked is not None
        assert june.days[9].worked["total"] is not None
        assert june.days[9].worked["total"].hours == 8.1
        assert june.worked is not None and june.worked["total"] is not None
        assert june.worked["total"].hours == 8.1
        assert august.days[3].worked_state == "incomplete"
        assert july.days[30].worked is not None and july.days[30].worked["total"] is not None
        assert july.days[30].worked["total"].hours == 0.0
        assert august.days[0].worked is not None and august.days[0].worked["total"] is not None
        assert august.days[0].worked["total"].hours == 0.0
        assert july.days[30].worked_state == "incomplete"
        assert august.days[0].worked_state == "incomplete"
        assert august.days[2].planned_arrival_time == "09:00"
        assert august.days[2].planned_departure_time == "17:00"
        assert august.days[2].planned is not None and august.days[2].planned["total"] is not None
        assert august.days[2].planned["total"].hours == 8.0
        assert july.days[30].planned is not None and july.days[30].planned["total"] is not None
        assert july.days[30].planned["total"].hours == 0.0
        assert august.days[0].planned is not None and august.days[0].planned["total"] is not None
        assert august.days[0].planned["total"].hours == 0.0
        assert august.days[0].planned_departure_time is None
        assert august.planned is not None and august.planned["total"] is not None
        assert august.planned["total"].hours == 8.0
        assert july.days[4].calendar_tone == "holiday"
        assert july.days[4].public_holiday_label == "Den slovanských věrozvěstů Cyrila a Metoděje"
        assert june.display_metrics == ["total", "night"]

        employment.afternoon_hours_enabled = True
        employment.afternoon_start_minutes = 18 * 60
        employment.weekend_hours_enabled = True
        sync_employment_metrics(db, employment=employment)
        db.commit()
        retroactive_june = _build_month(db, employment, 2026, 6)
        assert retroactive_june.display_metrics == ["total", "afternoon", "night", "weekend"]

        stored = list(
            db.execute(
                select(EmploymentDailyTimeMetric).where(
                    EmploymentDailyTimeMetric.employment_id == employment.id
                )
            ).scalars()
        )
        assert stored
        assert {row.calculation_revision for row in stored} == {CALCULATION_REVISION}
        assert {row.source for row in stored} == {
            DailyMetricSource.ATTENDANCE,
            DailyMetricSource.SHIFT_PLAN,
        }


def test_empty_hourly_month_preserves_backend_zero_visual_contract() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.WORK_CONTRACT)
        db.commit()

        month = _build_month(db, employment, 2026, 8)

        assert month.worked is not None and month.worked["total"] is not None
        assert month.worked["total"].hours == 0.0
        assert month.worked["night"] is not None
        assert month.worked["night"].hours == 0.0
        assert month.planned is not None and month.planned["total"] is not None
        assert month.planned["total"].hours == 0.0
        assert month.days[0].worked is not None
        assert month.days[0].worked["total"] is not None
        assert month.days[0].worked["total"].hours == 0.0


def test_month_summary_exposes_hours_for_full_day_statuses() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.WORK_CONTRACT)
        db.add_all(
            [
                ShiftPlan(employment_id=employment.id, date=date(2026, 8, 4), status="HOLIDAY"),
                Attendance(employment_id=employment.id, date=date(2026, 8, 5), status="SICKNESS"),
                Attendance(employment_id=employment.id, date=date(2026, 8, 6), status="PARAGRAPH"),
                ShiftPlan(employment_id=employment.id, date=date(2026, 8, 7), status="OFF"),
            ]
        )
        db.commit()

        month = _build_month(db, employment, 2026, 8)

        assert month.status_metrics["holiday"] is not None
        assert month.status_metrics["holiday"].hours == 8.0
        assert month.status_metrics["sickness"] is not None
        assert month.status_metrics["sickness"].hours == 8.0
        assert month.status_metrics["paragraph"] is not None
        assert month.status_metrics["paragraph"].hours == 8.0
        assert month.days[3].status_metrics["holiday"] is not None
        assert month.days[4].status_metrics["sickness"] is not None
        assert month.days[5].status_metrics["paragraph"] is not None
        assert month.days[6].status_metrics == {
            "holiday": None,
            "sickness": None,
            "paragraph": None,
        }


def test_employment_mutation_lock_refreshes_an_existing_identity() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        original_title = employment.title
        db.flush()
        db.execute(
            update(Employment)
            .where(Employment.id == employment.id)
            .values(title="Aktuální název")
            .execution_options(synchronize_session=False)
        )
        assert employment.title == original_title

        locked = lock_employment_for_time_mutation(db, employment.id)

        assert locked is employment
        assert locked.title == "Aktuální název"


def test_locked_time_mutation_rechecks_employment_and_user_activity() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        employment.is_active = False
        db.flush()
        db.execute(
            update(Employment)
            .where(Employment.id == employment.id)
            .values(end_date=date(2026, 8, 31))
            .execution_options(synchronize_session=False)
        )

        locked = lock_employment_for_time_mutation(db, employment.id)

        assert not locked_employment_has_active_user(db, locked)

        db.execute(
            update(Employment)
            .where(Employment.id == employment.id)
            .values(end_date=None)
            .execution_options(synchronize_session=False)
        )
        locked = lock_employment_for_time_mutation(db, employment.id)
        assert locked_employment_has_active_user(db, locked)
        db.execute(
            update(PortalUser)
            .where(PortalUser.id == employment.user_id)
            .values(is_active=False)
            .execution_options(synchronize_session=False)
        )

        assert not locked_employment_has_active_user(db, locked)


def test_optional_total_and_confirmed_all_day_absence() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.EXTERNAL_HOURLY)
        employment.total_hours_enabled = False
        db.add_all(
            [
                _event(employment.id, datetime(2026, 8, 4, 8)),
                _event(employment.id, datetime(2026, 8, 4, 16)),
                ShiftPlan(
                    employment_id=employment.id,
                    date=date(2026, 8, 4),
                    arrival_time="08:00",
                    departure_time="16:00",
                ),
            ]
        )
        db.flush()
        conflicts = replace_day_status(
            db,
            employment=employment,
            day=date(2026, 8, 4),
            status="SICKNESS",
            confirm_delete_conflicts=True,
            instance_id=None,
        )
        db.flush()
        sync_employment_metrics(db, employment=employment)
        db.commit()

        month = _build_month(db, employment, 2026, 8)
        assert conflicts.attendance_exists and conflicts.shift_plan_exists
        assert month.display_metrics == []
        assert month.days[3].attendance_status == "SICKNESS"
        assert month.days[3].events == []
        assert month.days[3].planned_arrival_time is None


def test_metric_sync_does_not_count_cross_boundary_times() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        db.add_all(
            [
                _event(employment.id, datetime(2026, 6, 30, 22)),
                _event(employment.id, datetime(2026, 7, 1, 2)),
            ]
        )
        db.flush()
        sync_employment_metrics(db, employment=employment)
        db.flush()

        july_rows = (
            db.execute(
                select(EmploymentDailyTimeMetric).where(
                    EmploymentDailyTimeMetric.employment_id == employment.id,
                    EmploymentDailyTimeMetric.metric_date >= date(2026, 7, 1),
                    EmploymentDailyTimeMetric.metric_date < date(2026, 8, 1),
                    EmploymentDailyTimeMetric.source == DailyMetricSource.ATTENDANCE,
                )
            )
            .scalars()
            .all()
        )
        assert len(july_rows) == 31
        assert sum(row.total_tenths for row in july_rows) == 0


def test_all_day_absence_removes_only_times_from_the_selected_day() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.EXTERNAL_HOURLY)
        db.add_all(
            [
                _event(employment.id, datetime(2026, 8, 3, 22)),
                _event(employment.id, datetime(2026, 8, 4, 2)),
            ]
        )
        db.flush()

        conflicts = replace_day_status(
            db,
            employment=employment,
            day=date(2026, 8, 4),
            status="SICKNESS",
            confirm_delete_conflicts=True,
            instance_id=None,
        )
        db.flush()

        remaining = (
            db.execute(
                select(AttendanceEvent).where(AttendanceEvent.employment_id == employment.id)
            )
            .scalars()
            .all()
        )
        assert conflicts.attendance_exists
        assert len(remaining) == 1
        assert remaining[0].occurred_at.date() == date(2026, 8, 3)


def test_month_employment_options_require_active_overlap() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        current = _employment(db, EmploymentType.DPP_DPC)
        current.end_date = date(2026, 8, 31)
        hidden = Employment(
            user_id=current.user_id,
            title="Mimo měsíc",
            employment_type=EmploymentType.DPP_DPC,
            total_hours_enabled=True,
            start_date=date(2026, 9, 1),
            is_active=True,
        )
        inactive = Employment(
            user_id=current.user_id,
            title="Neaktivní",
            employment_type=EmploymentType.DPP_DPC,
            total_hours_enabled=True,
            start_date=date(2026, 8, 1),
            is_active=True,
            end_date=date(2026, 7, 31),
        )
        db.add_all([hidden, inactive])
        db.commit()

        result = get_month_employments(
            year=2026, month=8, db=db, auth=PortalUserAuth(instance=None, user=current.user)
        )  # type: ignore[arg-type]
        assert [item.id for item in result] == [current.id]


def test_event_creation_validates_period_and_chronological_neighbors() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        auth = PortalUserAuth(instance=None, user=employment.user)  # type: ignore[arg-type]

        with pytest.raises(HTTPException) as period_error:
            create_attendance_event(
                AttendanceEventIn(
                    employment_id=employment.id,
                    occurred_at=datetime(2026, 5, 31, 8, tzinfo=PRAGUE_TIMEZONE),
                ),
                db=db,
                auth=auth,
            )
        assert period_error.value.status_code == 409

        db.add_all(
            [
                _event(employment.id, datetime(2026, 8, 1, 8)),
                _event(employment.id, datetime(2026, 8, 1, 16)),
            ]
        )
        db.flush()
        inserted_between = _event(
            employment.id,
            datetime(2026, 8, 1, 12),
        )
        add_event_with_breaks(db, employment=employment, event=inserted_between)

        same_timestamp = _event(
            employment.id,
            datetime(2026, 8, 1, 8),
        )
        add_event_with_breaks(db, employment=employment, event=same_timestamp)


def test_event_creation_uses_only_the_chronological_day_slot() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        db.add_all(
            [
                _event(employment.id, datetime(2026, 8, 1, 8)),
                _event(employment.id, datetime(2026, 8, 1, 16)),
            ]
        )
        db.flush()
        inserted = _event(
            employment.id,
            datetime(2026, 8, 2, 8),
        )

        add_event_with_breaks(db, employment=employment, event=inserted)

        assert inserted.occurred_at.hour == 8


def test_event_endpoint_closes_karel_day_without_direction_metadata() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        db.add_all(
            [
                _event(employment.id, datetime(2026, 8, 10, 6)),
            ]
        )
        db.flush()
        db.commit()
        auth = PortalUserAuth(instance=None, user=employment.user)  # type: ignore[arg-type]

        create_attendance_event(
            AttendanceEventIn(
                employment_id=employment.id,
                occurred_at=datetime(2026, 8, 10, 22, tzinfo=PRAGUE_TIMEZONE),
            ),
            db=db,
            auth=auth,
        )
        events = list(
            db.execute(
                select(AttendanceEvent)
                .where(AttendanceEvent.employment_id == employment.id)
                .order_by(AttendanceEvent.occurred_at)
            ).scalars()
        )
        assert [(event.occurred_at.hour, event.occurred_at.minute) for event in events] == [
            (6, 0),
            (22, 0),
        ]
        month = _build_month(db, employment, 2026, 8)
        assert month.days[9].worked is not None
        assert month.days[9].worked["total"] is not None
        assert month.days[9].worked["total"].minutes == 960


def test_event_creation_accepts_any_prior_chronological_history() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        db.add_all(
            [
                _event(employment.id, datetime(2026, 7, 1, 8)),
                _event(employment.id, datetime(2026, 7, 2, 8)),
                _event(employment.id, datetime(2026, 7, 2, 16)),
            ]
        )
        db.flush()

        add_event_with_breaks(
            db,
            employment=employment,
            event=_event(
                employment.id,
                datetime(2026, 7, 3, 8),
            ),
        )


def test_group_plan_contains_only_active_overlapping_employments() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        current = _employment(db, EmploymentType.DPP_DPC)
        future = Employment(
            user_id=current.user_id,
            title="Budoucí člen",
            employment_type=EmploymentType.DPP_DPC,
            total_hours_enabled=True,
            start_date=date(2026, 9, 1),
            is_active=True,
        )
        inactive_user = PortalUser(
            email="inactive-group@example.test",
            name="Neaktivní člen",
            role=PortalUserRole.EMPLOYEE,
            is_active=True,
        )
        db.add_all([future, inactive_user])
        db.flush()
        inactive_member = Employment(
            user_id=inactive_user.id,
            title="Neaktivní člen",
            employment_type=EmploymentType.DPP_DPC,
            total_hours_enabled=True,
            start_date=date(2026, 6, 1),
            is_active=True,
            end_date=date(2026, 7, 31),
        )
        group = EmploymentGroup(name="Aktivní skupina")
        db.add_all([inactive_member, group])
        db.flush()
        db.add_all(
            [
                EmploymentGroupMember(group_id=group.id, employment_id=current.id),
                EmploymentGroupMember(group_id=group.id, employment_id=future.id),
                EmploymentGroupMember(group_id=group.id, employment_id=inactive_member.id),
            ]
        )
        db.commit()

        result = portal_get_group_shift_plan_month(
            group_id=group.id,
            year=2026,
            month=8,
            db=db,
            auth=PortalUserAuth(instance=None, user=current.user),  # type: ignore[arg-type]
        )
        assert [row.employment_id for row in result.rows] == [current.id]
        assert result.rows[0].display_metrics == ["total"]
        with pytest.raises(HTTPException) as inactive_error:
            portal_get_group_shift_plan_month(
                group_id=group.id,
                year=2026,
                month=8,
                db=db,
                auth=PortalUserAuth(instance=None, user=inactive_user),  # type: ignore[arg-type]
            )
        assert inactive_error.value.status_code == 404

        august_groups = portal_list_shift_plan_groups(
            year=2026,
            month=8,
            db=db,
            auth=PortalUserAuth(instance=None, user=current.user),  # type: ignore[arg-type]
        )
        assert [listed.id for listed in august_groups.groups] == [group.id]

        current.end_date = date(2026, 7, 31)
        db.commit()
        august_groups = portal_list_shift_plan_groups(
            year=2026,
            month=8,
            db=db,
            auth=PortalUserAuth(instance=None, user=current.user),  # type: ignore[arg-type]
        )
        september_groups = portal_list_shift_plan_groups(
            year=2026,
            month=9,
            db=db,
            auth=PortalUserAuth(instance=None, user=current.user),  # type: ignore[arg-type]
        )
        assert august_groups.groups == []
        assert [listed.id for listed in september_groups.groups] == [group.id]


def test_admin_plan_uses_backend_display_metrics_and_planned_values() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.EXTERNAL_HOURLY)
        employment.total_hours_enabled = False
        employment.night_hours_enabled = True
        _admin_upsert_shift_plan_impl(
            db,
            ShiftPlanUpsertIn(
                employment_id=employment.id,
                date="2026-07-31",
                arrival_time="22:00",
                departure_time="23:00",
            ),
        )

        result = _admin_get_shift_plan_month_impl(db, year=2026, month=7)

        assert len(result.rows) == 1
        row = result.rows[0]
        assert row.display_metrics == ["night"]
        assert row.days[30].planned is not None
        assert row.days[30].planned["night"] is not None
        assert row.days[30].planned["night"].hours == 1.0
        assert row.summary.planned is not None
        assert row.summary.planned["night"] is not None
        assert row.summary.planned["night"].hours == 1.0


def test_admin_break_backfill_is_physical_and_idempotent() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        db.add_all(
            [
                _event(employment.id, datetime(2026, 8, 5, 8)),
                _event(employment.id, datetime(2026, 8, 5, 15)),
            ]
        )
        db.commit()

        first = add_missing_breaks(
            AddBreaksIn(employment_id=employment.id, year=2026, month=8, confirmed=True),
            _admin={"username": "admin"},
            _=None,
            db=db,
        )
        second = add_missing_breaks(
            AddBreaksIn(employment_id=employment.id, year=2026, month=8, confirmed=True),
            _admin={"username": "admin"},
            _=None,
            db=db,
        )

        events = list(
            db.execute(
                select(AttendanceEvent)
                .where(AttendanceEvent.employment_id == employment.id)
                .order_by(AttendanceEvent.occurred_at)
            ).scalars()
        )
        assert first.inserted_pairs == 1 and first.inserted_events == 2
        assert second.inserted_pairs == 0 and second.inserted_events == 0
        assert [event.occurred_at.strftime("%H:%M") for event in events] == [
            "08:00",
            "14:00",
            "14:30",
            "15:00",
        ]


def test_admin_break_backfill_anchors_malformed_history_per_day() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        db.add_all(
            [
                _event(employment.id, datetime(2026, 8, 4, 8)),
                _event(employment.id, datetime(2026, 8, 5, 8)),
                _event(employment.id, datetime(2026, 8, 5, 16)),
            ]
        )
        db.commit()

        add_missing_breaks(
            AddBreaksIn(
                employment_id=employment.id,
                year=2026,
                month=8,
                confirmed=True,
            ),
            _admin={"username": "admin"},
            _=None,
            db=db,
        )
        assert (
            len(
                db.execute(
                    select(AttendanceEvent).where(AttendanceEvent.employment_id == employment.id)
                )
                .scalars()
                .all()
            )
            == 5
        )


def test_admin_break_backfill_credits_existing_short_manual_pause() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        db.add_all(
            [
                _event(employment.id, datetime(2026, 8, 5, 8)),
                _event(employment.id, datetime(2026, 8, 5, 12)),
                _event(employment.id, datetime(2026, 8, 5, 12, 1)),
                _event(employment.id, datetime(2026, 8, 5, 16)),
            ]
        )
        db.commit()

        result = add_missing_breaks(
            AddBreaksIn(employment_id=employment.id, year=2026, month=8, confirmed=True),
            _admin={"username": "admin"},
            _=None,
            db=db,
        )
        events = list(
            db.execute(
                select(AttendanceEvent)
                .where(AttendanceEvent.employment_id == employment.id)
                .order_by(AttendanceEvent.occurred_at)
            ).scalars()
        )
        pauses = [
            int((events[index + 1].occurred_at - events[index].occurred_at).total_seconds() // 60)
            for index in range(1, len(events) - 1, 2)
        ]
        assert result.inserted_pairs == 1
        assert sum(pauses) == 30
        assert len({event.occurred_at for event in events}) == len(events)


def test_admin_break_backfill_avoids_existing_interval_boundaries() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        db.add_all(
            [
                _event(employment.id, datetime(2026, 8, 5, 0)),
                _event(employment.id, datetime(2026, 8, 5, 6)),
                _event(employment.id, datetime(2026, 8, 5, 6, 15)),
                _event(employment.id, datetime(2026, 8, 5, 12)),
            ]
        )
        db.commit()

        result = add_missing_breaks(
            AddBreaksIn(employment_id=employment.id, year=2026, month=8, confirmed=True),
            _admin={"username": "admin"},
            _=None,
            db=db,
        )
        events = list(
            db.execute(
                select(AttendanceEvent)
                .where(AttendanceEvent.employment_id == employment.id)
                .order_by(AttendanceEvent.occurred_at)
            ).scalars()
        )
        pauses = [
            int((events[index + 1].occurred_at - events[index].occurred_at).total_seconds() // 60)
            for index in range(1, len(events) - 1, 2)
        ]
        assert result.inserted_pairs == 1
        assert sum(pauses) == 30
        assert len({event.occurred_at for event in events}) == len(events)


def test_admin_break_backfill_translates_historical_status_conflict() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        db.add_all(
            [
                _event(employment.id, datetime(2026, 8, 5, 8)),
                _event(employment.id, datetime(2026, 8, 5, 16)),
                Attendance(
                    employment_id=employment.id,
                    date=date(2026, 8, 5),
                    status="SICKNESS",
                ),
            ]
        )
        db.commit()

        with pytest.raises(HTTPException) as error:
            add_missing_breaks(
                AddBreaksIn(
                    employment_id=employment.id,
                    year=2026,
                    month=8,
                    confirmed=True,
                ),
                _admin={"username": "admin"},
                _=None,
                db=db,
            )

        assert error.value.status_code == 409
        assert error.value.detail["code"] == "attendance_day_status_conflict"


def test_admin_plan_falls_back_when_saved_selection_is_inactive() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        active = _employment(db, EmploymentType.DPP_DPC)
        inactive = Employment(
            user_id=active.user_id,
            title="Neaktivní výběr",
            employment_type=EmploymentType.DPP_DPC,
            total_hours_enabled=True,
            start_date=date(2026, 6, 1),
            is_active=True,
            end_date=date(2026, 7, 31),
        )
        db.add(inactive)
        db.flush()
        db.add(
            ShiftPlanMonthInstance(
                year=2026,
                month=8,
                employment_id=inactive.id,
            )
        )
        db.commit()

        result = _admin_get_shift_plan_month_impl(db, year=2026, month=8)

        assert result.selected_employment_ids == [active.id]
        assert [row.employment_id for row in result.rows] == [active.id]


def test_admin_plan_rejects_inactive_saved_selection() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        active = _employment(db, EmploymentType.DPP_DPC)
        future = Employment(
            user_id=active.user_id,
            title="Budoucí výběr",
            employment_type=EmploymentType.DPP_DPC,
            total_hours_enabled=True,
            start_date=date(2026, 9, 1),
            is_active=True,
        )
        db.add(future)
        db.commit()

        with pytest.raises(HTTPException) as error:
            _admin_set_shift_plan_selection_impl(
                db,
                ShiftPlanSelectionIn(
                    year=2026,
                    month=8,
                    employment_ids=[future.id],
                ),
            )

        assert error.value.status_code == 409
        assert db.execute(select(ShiftPlanMonthInstance)).scalars().all() == []


def test_task_employment_database_constraint_rejects_total_metric() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        user = PortalUser(
            email="task-constraint@example.test",
            name="Úkolový profil",
            role=PortalUserRole.EMPLOYEE,
            is_active=True,
        )
        db.add(user)
        db.flush()
        db.add(
            Employment(
                user_id=user.id,
                title="Neplatný úkolový profil",
                employment_type=EmploymentType.TASK_SHIFT_BASED,
                total_hours_enabled=True,
                start_date=date(2026, 8, 1),
                is_active=True,
            )
        )

        with pytest.raises(IntegrityError):
            db.commit()


def test_plan_mutation_rejects_overnight_shift() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        with pytest.raises(HTTPException) as error:
            _admin_upsert_shift_plan_impl(
                db,
                ShiftPlanUpsertIn(
                    employment_id=employment.id,
                    date="2026-07-31",
                    arrival_time="22:00",
                    departure_time="02:00",
                ),
            )
        assert error.value.status_code == 409

        rows = (
            db.execute(
                select(EmploymentDailyTimeMetric)
                .where(
                    EmploymentDailyTimeMetric.employment_id == employment.id,
                    EmploymentDailyTimeMetric.source == DailyMetricSource.SHIFT_PLAN,
                )
                .order_by(EmploymentDailyTimeMetric.metric_date)
            )
            .scalars()
            .all()
        )
        assert rows == []


def test_admin_mutations_respect_independent_month_locks() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        db.add_all(
            [
                AttendanceLock(employment_id=employment.id, year=2026, month=8, locked_by="admin"),
                ShiftPlanLock(employment_id=employment.id, year=2026, month=8, locked_by="admin"),
                _event(employment.id, datetime(2026, 8, 5, 8)),
                _event(employment.id, datetime(2026, 8, 5, 15)),
            ]
        )
        db.commit()

        with pytest.raises(HTTPException) as attendance_error:
            add_missing_breaks(
                AddBreaksIn(employment_id=employment.id, year=2026, month=8, confirmed=True),
                _admin={"username": "admin"},
                _=None,
                db=db,
            )
        assert attendance_error.value.status_code == 423

        with pytest.raises(HTTPException) as plan_error:
            _admin_upsert_shift_plan_impl(
                db,
                ShiftPlanUpsertIn(
                    employment_id=employment.id,
                    date="2026-08-06",
                    arrival_time="08:00",
                    departure_time="16:00",
                ),
            )
        assert plan_error.value.status_code == 423

        with pytest.raises(HTTPException) as status_error:
            admin_upsert_day_status(
                DayStatusUpsertIn(
                    employment_id=employment.id,
                    date="2026-08-06",
                    status="SICKNESS",
                    confirm_delete_conflicts=True,
                ),
                _admin={"username": "admin"},
                _=None,
                db=db,
            )
        assert status_error.value.status_code == 423


def test_admin_can_store_attendance_all_day_status() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        admin_upsert_day_status(
            DayStatusUpsertIn(
                employment_id=employment.id,
                date="2026-08-06",
                status="PARAGRAPH",
                confirm_delete_conflicts=True,
            ),
            _admin={"username": "admin"},
            _=None,
            db=db,
        )

        row = db.execute(
            select(Attendance).where(
                Attendance.employment_id == employment.id,
                Attendance.date == date(2026, 8, 6),
            )
        ).scalar_one()
        assert row.status == "PARAGRAPH"


def test_daily_metric_rebuild_cli_passes_apply_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[bool] = []
    monkeypatch.setattr(
        rebuild_daily_time_metrics,
        "rebuild",
        lambda *, apply: calls.append(apply) or 0,
    )
    monkeypatch.setattr(sys, "argv", ["rebuild_daily_time_metrics.py", "--apply"])

    assert rebuild_daily_time_metrics.main() == 0
    assert calls == [True]


def test_new_day_event_never_mutates_the_locked_previous_month() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        db.add(
            _event(
                employment.id,
                datetime(2026, 6, 30, 22),
            )
        )
        db.add(
            AttendanceLock(
                employment_id=employment.id,
                year=2026,
                month=6,
                locked_by="admin",
            )
        )
        db.commit()

        create_attendance_event(
            AttendanceEventIn(
                employment_id=employment.id,
                occurred_at=datetime(
                    2026,
                    7,
                    1,
                    2,
                    tzinfo=PRAGUE_TIMEZONE,
                ),
            ),
            db=db,
            auth=PortalUserAuth(instance=None, user=employment.user),  # type: ignore[arg-type]
        )

        assert db.query(AttendanceEvent).count() == 2


def test_event_mutations_reject_day_status_and_inactive_employment() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        db.add(
            Attendance(
                employment_id=employment.id,
                date=date(2026, 7, 5),
                status="SICKNESS",
            )
        )
        db.commit()
        auth = PortalUserAuth(instance=None, user=employment.user)  # type: ignore[arg-type]

        with pytest.raises(HTTPException) as status_error:
            create_attendance_event(
                AttendanceEventIn(
                    employment_id=employment.id,
                    occurred_at=datetime(
                        2026,
                        7,
                        5,
                        8,
                        tzinfo=PRAGUE_TIMEZONE,
                    ),
                ),
                db=db,
                auth=auth,
            )
        assert status_error.value.status_code == 409

        event = _event(
            employment.id,
            datetime(2026, 7, 6, 8),
        )
        db.add(event)
        db.commit()
        employment.end_date = date(2026, 7, 5)
        db.commit()

        body = AttendanceEventIn(
            employment_id=employment.id,
            occurred_at=datetime(2026, 7, 6, 9, tzinfo=PRAGUE_TIMEZONE),
        )
        with pytest.raises(HTTPException) as update_error:
            update_attendance_event(event.id, body, db=db, auth=auth)
        with pytest.raises(HTTPException) as delete_error:
            delete_attendance_event(event.id, db=db, auth=auth)
        assert update_error.value.status_code == 409
        assert delete_error.value.status_code == 409


def test_day_status_requires_period_and_both_conflicting_domains_unlocked() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        auth = PortalUserAuth(instance=None, user=employment.user)  # type: ignore[arg-type]
        with pytest.raises(HTTPException) as period_error:
            upsert_attendance_status(
                AttendanceStatusUpsertIn(
                    employment_id=employment.id,
                    date="2026-05-31",
                    status="SICKNESS",
                    confirm_delete_conflicts=True,
                ),
                db=db,
                auth=auth,
            )
        assert period_error.value.status_code == 409

        db.add_all(
            [
                _event(
                    employment.id,
                    datetime(2026, 8, 7, 8),
                ),
                _event(
                    employment.id,
                    datetime(2026, 8, 7, 16),
                ),
                AttendanceLock(
                    employment_id=employment.id,
                    year=2026,
                    month=8,
                    locked_by="admin",
                ),
            ]
        )
        db.commit()
        with pytest.raises(HTTPException) as lock_error:
            upsert_attendance_status(
                AttendanceStatusUpsertIn(
                    employment_id=employment.id,
                    date="2026-08-07",
                    status="HOLIDAY",
                    confirm_delete_conflicts=True,
                ),
                db=db,
                auth=auth,
            )
        assert lock_error.value.status_code == 423
        with pytest.raises(HTTPException) as admin_lock_error:
            admin_upsert_day_status(
                DayStatusUpsertIn(
                    employment_id=employment.id,
                    date="2026-08-07",
                    status="HOLIDAY",
                    confirm_delete_conflicts=True,
                ),
                _admin={"username": "admin"},
                _=None,
                db=db,
            )
        assert admin_lock_error.value.status_code == 423

        other = _employment(db, EmploymentType.EXTERNAL_HOURLY)
        db.add_all(
            [
                ShiftPlan(
                    employment_id=other.id,
                    date=date(2026, 8, 8),
                    arrival_time="08:00",
                    departure_time="16:00",
                ),
                ShiftPlanLock(
                    employment_id=other.id,
                    year=2026,
                    month=8,
                    locked_by="admin",
                ),
            ]
        )
        db.commit()
        with pytest.raises(HTTPException) as plan_lock_error:
            upsert_attendance_status(
                AttendanceStatusUpsertIn(
                    employment_id=other.id,
                    date="2026-08-08",
                    status="SICKNESS",
                    confirm_delete_conflicts=True,
                ),
                db=db,
                auth=PortalUserAuth(instance=None, user=other.user),  # type: ignore[arg-type]
            )
        assert plan_lock_error.value.status_code == 423
        with pytest.raises(HTTPException) as admin_plan_lock_error:
            admin_upsert_day_status(
                DayStatusUpsertIn(
                    employment_id=other.id,
                    date="2026-08-08",
                    status="SICKNESS",
                    confirm_delete_conflicts=True,
                ),
                _admin={"username": "admin"},
                _=None,
                db=db,
            )
        assert admin_plan_lock_error.value.status_code == 423


def test_shift_plan_report_exports_only_enabled_backend_metrics() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.EXTERNAL_HOURLY)
        employment.total_hours_enabled = False
        employment.night_hours_enabled = True
        db.add_all(
            [
                ShiftPlan(
                    employment_id=employment.id,
                    date=date(2026, 8, 3),
                    arrival_time="22:00",
                    departure_time="23:00",
                ),
                ShiftPlan(
                    employment_id=employment.id,
                    date=date(2026, 8, 4),
                    arrival_time="08:00",
                    departure_time="16:00",
                ),
                Attendance(
                    employment_id=employment.id,
                    date=date(2026, 8, 5),
                    status="SICKNESS",
                ),
            ]
        )
        sync_employment_metrics(db, employment=employment)
        db.commit()

        payload = report_to_payload(
            build_shift_plan_report(
                db,
                year=2026,
                month=8,
                employment_ids=[employment.id],
            )
        )
        report_employment = payload["pages"][0]["employments"][0]  # type: ignore[index]
        assert report_employment["display_metrics"] == ["night"]
        assert report_employment["planned_metrics"]["night"]["hours"] == 1.0
        assert "planned_hours" not in report_employment
        assert report_employment["cells"][2]["planned_metrics"]["night"]["hours"] == 1.0
        assert report_employment["cells"][3]["interval_label"] == "08:00; 16:00"
        assert "carryover_departure_time" not in report_employment["cells"][3]
        assert report_employment["cells"][3]["planned_metrics"]["night"]["hours"] == 0.0
        assert report_employment["cells"][4]["status"] == "SICKNESS"
        assert report_employment["cells"][4]["status_label"] == "Nemoc"
        assert report_employment["status_metrics"]["sickness"]["hours"] == 8.0
        assert report_employment["cells"][4]["status_metrics"]["sickness"]["hours"] == 8.0
        assert report_employment["cells"][4]["interval_label"] == ""
        csv_text = _csv_for_employment(
            db=db,
            employment=employment,
            start=date(2026, 8, 1),
            end=date(2026, 9, 1),
        ).decode("utf-8")
        assert "PLÁN – PRŮCHOD 1" in csv_text
        assert "nemoc_h" in csv_text and "8.0" in csv_text
        assert "2026-08-04" in csv_text and "08:00" in csv_text


def test_csv_keeps_days_inside_cross_month_interval() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        db.add_all(
            [
                _event(
                    employment.id,
                    datetime(2026, 6, 30, 22),
                ),
                _event(
                    employment.id,
                    datetime(2026, 7, 1, 2),
                ),
            ]
        )
        sync_employment_metrics(db, employment=employment)
        db.commit()

        csv_text = _csv_for_employment(
            db=db,
            employment=employment,
            start=date(2026, 7, 1),
            end=date(2026, 8, 1),
        ).decode("utf-8")

        assert len(csv_text.strip().splitlines()) == 2
        assert "2026-07-01" in csv_text


def test_outputs_recompute_from_raw_facts_and_sync_rebuilds_persisted_rows() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        db.add_all(
            [
                _event(employment.id, datetime(2026, 8, 5, 8)),
                _event(employment.id, datetime(2026, 8, 5, 16)),
                ShiftPlan(
                    employment_id=employment.id,
                    date=date(2026, 8, 5),
                    arrival_time="09:00",
                    departure_time="17:00",
                ),
            ]
        )
        db.flush()
        sync_employment_metrics(db, employment=employment)
        db.flush()
        worked = db.get(
            EmploymentDailyTimeMetric,
            (employment.id, date(2026, 8, 5), DailyMetricSource.ATTENDANCE),
        )
        planned = db.get(
            EmploymentDailyTimeMetric,
            (employment.id, date(2026, 8, 5), DailyMetricSource.SHIFT_PLAN),
        )
        assert worked is not None and planned is not None
        worked.total_minutes, worked.total_tenths = 101, 17
        planned.total_minutes, planned.total_tenths = 137, 23
        db.commit()

        month = _build_month(db, employment, 2026, 8)
        assert month.days[4].worked is not None
        assert month.days[4].worked["total"] is not None
        assert month.days[4].worked["total"].hours == 8.0
        report = report_to_payload(
            build_shift_plan_report(db, year=2026, month=8, employment_ids=[employment.id])
        )
        report_employment = report["pages"][0]["employments"][0]  # type: ignore[index]
        assert report_employment["planned_metrics"]["total"]["hours"] == 8.0
        csv_text = _csv_for_employment(
            db=db,
            employment=employment,
            start=date(2026, 8, 1),
            end=date(2026, 9, 1),
        ).decode("utf-8")
        assert "2026-08-05" in csv_text and ",8.0" in csv_text

        sync_employment_metrics(db, employment=employment)
        db.flush()
        rebuilt_worked = db.get(
            EmploymentDailyTimeMetric,
            (employment.id, date(2026, 8, 5), DailyMetricSource.ATTENDANCE),
            populate_existing=True,
        )
        rebuilt_planned = db.get(
            EmploymentDailyTimeMetric,
            (employment.id, date(2026, 8, 5), DailyMetricSource.SHIFT_PLAN),
            populate_existing=True,
        )
        assert rebuilt_worked is not None and rebuilt_worked.total_tenths == 80
        assert rebuilt_planned is not None and rebuilt_planned.total_tenths == 80


def test_event_write_rebuilds_only_affected_months() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        historical = EmploymentDailyTimeMetric(
            employment_id=employment.id,
            metric_date=date(2026, 6, 1),
            source=DailyMetricSource.ATTENDANCE,
            total_minutes=60,
            total_tenths=10,
            calculation_revision=1,
        )
        db.add(historical)
        db.commit()

        create_attendance_event(
            AttendanceEventIn(
                employment_id=employment.id,
                occurred_at=datetime(2026, 7, 10, 8, tzinfo=PRAGUE_TIMEZONE),
            ),
            db=db,
            auth=PortalUserAuth(instance=SimpleNamespace(id=None), user=employment.user),  # type: ignore[arg-type]
        )

        db.refresh(historical)
        assert historical.calculation_revision == 1
        assert historical.total_minutes == 60


def test_employment_metadata_update_preserves_historical_metrics() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        historical = EmploymentDailyTimeMetric(
            employment_id=employment.id,
            metric_date=date(2026, 6, 1),
            source=DailyMetricSource.ATTENDANCE,
            total_minutes=60,
            total_tenths=10,
            calculation_revision=1,
        )
        db.add(historical)
        db.commit()

        update_employment(
            employment.id,
            EmploymentUpdateIn(title="Přejmenovaný úvazek"),
            _admin={"username": "admin"},
            _=None,
            db=db,
        )

        db.refresh(historical)
        assert historical.calculation_revision == 1
        assert historical.total_minutes == 60


def test_employment_period_change_rebuilds_metrics_after_confirmed_cleanup() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        db.add_all(
            [
                ShiftPlan(
                    employment_id=employment.id,
                    date=date(2026, 8, 10),
                    arrival_time="08:00",
                    departure_time="16:00",
                ),
                ShiftPlan(
                    employment_id=employment.id,
                    date=date(2026, 7, 31),
                    arrival_time="22:00",
                    departure_time="02:00",
                ),
                _event(
                    employment.id,
                    datetime(2026, 8, 1, 8),
                ),
                _event(
                    employment.id,
                    datetime(2026, 8, 1, 9),
                ),
            ]
        )
        db.flush()
        sync_employment_metrics(db, employment=employment)
        db.commit()
        assert db.execute(
            select(EmploymentDailyTimeMetric).where(
                EmploymentDailyTimeMetric.employment_id == employment.id,
                EmploymentDailyTimeMetric.metric_date == date(2026, 8, 10),
            )
        ).first()

        with pytest.raises(HTTPException) as conflict:
            update_employment(
                employment.id,
                EmploymentUpdateIn(end_date="2026-07-31"),
                _admin={"username": "admin"},
                _=None,
                db=db,
            )
        assert conflict.value.status_code == 409

        update_employment(
            employment.id,
            EmploymentUpdateIn(
                end_date="2026-07-31",
                confirm_delete_out_of_range=True,
            ),
            _admin={"username": "admin"},
            _=None,
            db=db,
        )

        rebuilt = list(
            db.execute(
                select(EmploymentDailyTimeMetric).where(
                    EmploymentDailyTimeMetric.employment_id == employment.id,
                    EmploymentDailyTimeMetric.metric_date == date(2026, 8, 10),
                )
            ).scalars()
        )
        assert all(row.total_tenths == 0 for row in rebuilt)
        assert (
            db.execute(
                select(AttendanceEvent).where(AttendanceEvent.employment_id == employment.id)
            ).first()
            is None
        )
        remaining_plan = db.execute(
            select(ShiftPlan).where(ShiftPlan.employment_id == employment.id)
        ).scalar_one()
        assert remaining_plan.date == date(2026, 7, 31)


def test_employment_delete_confirms_plan_locks_and_reports_event_rows() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        db.add_all(
            [
                _event(employment.id, datetime(2026, 8, 5, 8)),
                _event(employment.id, datetime(2026, 8, 5, 16)),
                ShiftPlanLock(
                    employment_id=employment.id,
                    year=2026,
                    month=8,
                    locked_by="admin",
                ),
            ]
        )
        db.commit()

        with pytest.raises(HTTPException) as conflict:
            delete_employment(
                employment.id,
                EmploymentDeleteIn(confirm_delete_related=False),
                _admin={"username": "admin"},
                _=None,
                db=db,
            )
        assert conflict.value.status_code == 409

        deleted = delete_employment(
            employment.id,
            EmploymentDeleteIn(confirm_delete_related=True),
            _admin={"username": "admin"},
            _=None,
            db=db,
        )
        assert deleted.deleted_attendance_count == 2
        assert deleted.deleted_shift_plan_lock_count == 1


def test_plan_status_sync_does_not_rebuild_unrelated_next_month() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        august = EmploymentDailyTimeMetric(
            employment_id=employment.id,
            metric_date=date(2026, 8, 15),
            source=DailyMetricSource.SHIFT_PLAN,
            total_minutes=60,
            total_tenths=10,
            calculation_revision=1,
        )
        db.add(august)
        db.commit()

        portal_upsert_day_status(
            body=PortalDayStatusUpsertIn(
                employment_id=employment.id,
                date="2026-07-31",
                status="HOLIDAY",
                confirm_delete_conflicts=True,
            ),
            db=db,
            auth=PortalUserAuth(instance=SimpleNamespace(id=None), user=employment.user),  # type: ignore[arg-type]
        )

        db.refresh(august)
        assert august.calculation_revision == 1
        assert august.total_minutes == 60


def test_shift_plan_status_rejects_conflicting_attendance_for_admin_and_user() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        db.add_all(
            [
                _event(
                    employment.id,
                    datetime(2026, 7, 10, 8),
                ),
                _event(
                    employment.id,
                    datetime(2026, 7, 10, 16),
                ),
            ]
        )
        db.commit()

        with pytest.raises(HTTPException) as admin_error:
            _admin_upsert_shift_plan_impl(
                db,
                ShiftPlanUpsertIn(
                    employment_id=employment.id,
                    date="2026-07-10",
                    status="HOLIDAY",
                ),
            )
        with pytest.raises(HTTPException) as portal_error:
            portal_upsert_shift_plan(
                PortalShiftPlanUpsertIn(
                    employment_id=employment.id,
                    date="2026-07-10",
                    status="HOLIDAY",
                ),
                db=db,
                auth=PortalUserAuth(instance=None, user=employment.user),  # type: ignore[arg-type]
            )
        assert admin_error.value.status_code == 409
        assert portal_error.value.status_code == 409


def test_shift_plan_rejects_overnight_times_for_admin_and_user() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        db.commit()
        body = ShiftPlanUpsertIn(
            employment_id=employment.id,
            date="2026-07-31",
            arrival_time="22:00",
            departure_time="02:00",
        )

        with pytest.raises(HTTPException) as admin_error:
            _admin_upsert_shift_plan_impl(db, body)
        with pytest.raises(HTTPException) as portal_error:
            portal_upsert_shift_plan(
                PortalShiftPlanUpsertIn(**body.model_dump()),
                db=db,
                auth=PortalUserAuth(instance=None, user=employment.user),  # type: ignore[arg-type]
            )
        assert admin_error.value.status_code == 409
        assert portal_error.value.status_code == 409
        assert db.execute(select(ShiftPlan)).scalars().all() == []


def test_shift_plan_dtos_contain_only_same_day_boundaries() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        group = EmploymentGroup(name="Noční skupina")
        db.add(group)
        db.flush()
        db.add_all(
            [
                EmploymentGroupMember(group_id=group.id, employment_id=employment.id),
                ShiftPlan(
                    employment_id=employment.id,
                    date=date(2026, 8, 1),
                    arrival_time="08:00",
                    departure_time="16:00",
                ),
            ]
        )
        db.commit()

        attendance = _build_month(db, employment, 2026, 8)
        admin = _admin_get_shift_plan_month_impl(db, year=2026, month=8)
        grouped = portal_get_group_shift_plan_month(
            group_id=group.id,
            year=2026,
            month=8,
            db=db,
            auth=PortalUserAuth(instance=None, user=employment.user),  # type: ignore[arg-type]
        )
        assert attendance.days[0].planned_arrival_time == "08:00"
        assert set(AttendanceEventOut.model_fields) == {
            "id",
            "employment_id",
            "occurred_at",
            "deletion_partner_id",
        }
        assert "planned_is_carryover" not in attendance.days[0].model_dump()
        assert "planned_carryover_departure_time" not in attendance.days[0].model_dump()
        assert admin.rows[0].days[0].arrival_time == "08:00"
        assert "is_carryover" not in admin.rows[0].days[0].model_dump()
        assert "carryover_departure_time" not in admin.rows[0].days[0].model_dump()
        assert admin.rows[0].summary.scheduled_days == 1
        assert grouped.rows[0].days[0].arrival_time == "08:00"
        assert "is_carryover" not in grouped.rows[0].days[0].model_dump()
        assert "carryover_departure_time" not in grouped.rows[0].days[0].model_dump()


def test_direct_plan_status_requires_confirmation() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        db.add(
            ShiftPlan(
                employment_id=employment.id,
                date=date(2026, 8, 2),
                arrival_time="08:00",
                departure_time="16:00",
            )
        )
        db.commit()
        with pytest.raises(HTTPException) as confirmation_error:
            _admin_upsert_shift_plan_impl(
                db,
                ShiftPlanUpsertIn(
                    employment_id=employment.id,
                    date="2026-08-02",
                    status="HOLIDAY",
                ),
            )
        assert confirmation_error.value.status_code == 409
        db.rollback()
        _admin_upsert_shift_plan_impl(
            db,
            ShiftPlanUpsertIn(
                employment_id=employment.id,
                date="2026-08-02",
                status="HOLIDAY",
                confirm_delete_conflicts=True,
            ),
        )
        row = db.execute(select(ShiftPlan)).scalar_one()
        assert row.status == "HOLIDAY" and row.arrival_time is None


def test_event_edit_cannot_move_first_in_after_out_for_admin_and_user() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        first = _event(employment.id, datetime(2026, 7, 5, 8))
        db.add_all(
            [first, _event(employment.id, datetime(2026, 7, 5, 16))]
        )
        db.commit()

        body = AttendanceEventIn(
            employment_id=employment.id,
            occurred_at=datetime(2026, 7, 5, 17, tzinfo=PRAGUE_TIMEZONE),
        )
        update_attendance_event(
            first.id,
            body,
            db=db,
            auth=PortalUserAuth(instance=None, user=employment.user),  # type: ignore[arg-type]
        )
        assert first.occurred_at.hour == 17


def test_event_delete_allows_any_sequence_for_all_api_surfaces() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        first = _event(employment.id, datetime(2026, 7, 5, 8))
        db.add_all(
            [first, _event(employment.id, datetime(2026, 7, 5, 16))]
        )
        db.commit()
        first_id = first.id

        assert delete_attendance_event(
            first_id,
            db=db,
            auth=PortalUserAuth(instance=None, user=employment.user),  # type: ignore[arg-type]
        ) == {"ok": True}


def test_event_pair_can_be_inserted_and_removed_in_middle_on_all_api_surfaces() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employments = [
            _employment(db, EmploymentType.DPP_DPC),
            _employment(db, EmploymentType.EXTERNAL_HOURLY),
            _employment(db, EmploymentType.WORK_CONTRACT),
        ]
        for employment in employments:
            db.add_all(
                [
                    _event(employment.id, datetime(2026, 6, 1, 8)),
                    _event(employment.id, datetime(2026, 6, 1, 16)),
                    _event(employment.id, datetime(2026, 6, 3, 8)),
                    _event(employment.id, datetime(2026, 6, 3, 16)),
                ]
            )
        client = IntegrationClient(
            name="Párová integrace",
            scopes=["attendance:create", "attendance:delete"],
            allowed_employment_ids=[employment.id for employment in employments],
        )
        secret = IntegrationClientSecret(
            client=client,
            token_hash="test",
            token_prefix="dgi_test",
            token_last4="test",
            token_fingerprint="test",
        )
        db.add(client)
        db.commit()

        portal = create_attendance_event(
            AttendanceEventIn(
                employment_id=employments[0].id,
                occurred_at=datetime(2026, 6, 2, 8, tzinfo=PRAGUE_TIMEZONE),
                paired_occurred_at=datetime(2026, 6, 2, 16, tzinfo=PRAGUE_TIMEZONE),
            ),
            db=db,
            auth=PortalUserAuth(instance=None, user=employments[0].user),  # type: ignore[arg-type]
        )
        admin = admin_create_event(
            AdminAttendanceEventIn(
                employment_id=employments[1].id,
                occurred_at=datetime(2026, 6, 2, 8, tzinfo=PRAGUE_TIMEZONE),
                paired_occurred_at=datetime(2026, 6, 2, 16, tzinfo=PRAGUE_TIMEZONE),
            ),
            _admin={"username": "admin"},
            _=None,
            db=db,
        )
        request = Request({"type": "http", "method": "POST", "path": "/", "headers": []})
        integration = integration_create_event(
            IntegrationEventIn(
                employment_id=employments[2].id,
                occurred_at=datetime(2026, 6, 2, 8, tzinfo=PRAGUE_TIMEZONE),
                paired_occurred_at=datetime(2026, 6, 2, 16, tzinfo=PRAGUE_TIMEZONE),
            ),
            request=request,
            auth=IntegrationAuth(client=client, secret=secret),
            _limit_guard=None,
            db=db,
        )

        first_ids = [portal.id, admin.id, int(integration["id"])]
        for employment, first_id in zip(employments, first_ids, strict=True):
            ordered = list(
                db.execute(
                    select(AttendanceEvent)
                    .where(AttendanceEvent.employment_id == employment.id)
                    .order_by(AttendanceEvent.occurred_at)
                ).scalars()
            )
            assert len(ordered) == 6
            day_pair = [event for event in ordered if event.occurred_at.date() == date(2026, 6, 2)]
            pair_end = day_pair[-1]
            if employment.id == employments[0].id:
                delete_attendance_event(
                    first_id,
                    paired_event_id=pair_end.id,
                    db=db,
                    auth=PortalUserAuth(instance=None, user=employment.user),  # type: ignore[arg-type]
                )
            elif employment.id == employments[1].id:
                admin_delete_event(
                    first_id,
                    paired_event_id=pair_end.id,
                    _admin={"username": "admin"},
                    _=None,
                    db=db,
                )
            else:
                integration_delete_event(
                    first_id,
                    request=Request(
                        {"type": "http", "method": "DELETE", "path": "/", "headers": []}
                    ),
                    paired_event_id=pair_end.id,
                    auth=IntegrationAuth(client=client, secret=secret),
                    db=db,
                )
            remaining = list(
                db.execute(
                    select(AttendanceEvent)
                    .where(AttendanceEvent.employment_id == employment.id)
                    .order_by(AttendanceEvent.occurred_at)
                ).scalars()
            )
            assert len(remaining) == 4


def test_integration_audit_counts_automatic_break_events() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        employment.automatic_breaks_enabled = True
        db.add(_event(employment.id, datetime(2026, 6, 1, 8)))
        client = IntegrationClient(
            name="Audit pauz",
            scopes=["attendance:create"],
            allowed_employment_ids=[employment.id],
        )
        secret = IntegrationClientSecret(
            client=client,
            token_hash="test",
            token_prefix="dgi_test",
            token_last4="test",
            token_fingerprint="test",
        )
        db.add(client)
        db.commit()
        request = Request({"type": "http", "method": "POST", "path": "/", "headers": []})

        integration_create_event(
            IntegrationEventIn(
                employment_id=employment.id,
                occurred_at=datetime(2026, 6, 1, 15, tzinfo=PRAGUE_TIMEZONE),
            ),
            request=request,
            auth=IntegrationAuth(client=client, secret=secret),
            _limit_guard=None,
            db=db,
        )

        assert get_audit_context(request).row_count == 3


def test_month_dto_never_pairs_deletion_partners_across_days() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        overnight_in = _event(employment.id, datetime(2026, 7, 31, 22))
        overnight_out = _event(employment.id, datetime(2026, 8, 1, 2))
        next_in = _event(employment.id, datetime(2026, 8, 3, 8))
        next_out = _event(employment.id, datetime(2026, 8, 3, 16))
        db.add_all([overnight_in, overnight_out, next_in, next_out])
        db.commit()

        july = _build_month(db, employment, 2026, 7)
        august = _build_month(db, employment, 2026, 8)

        july_event = july.days[30].events[0]
        august_out = august.days[0].events[0]
        august_in = august.days[2].events[0]
        assert july_event.deletion_partner_id is None
        assert august_out.deletion_partner_id is None
        assert august_in.deletion_partner_id == next_out.id


def test_month_dto_anchors_daily_totals_after_historical_orphan() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        db.add_all(
            [
                _event(employment.id, datetime(2026, 7, 30, 12)),
                _event(employment.id, datetime(2026, 8, 1, 6)),
                _event(employment.id, datetime(2026, 8, 1, 22)),
                _event(employment.id, datetime(2026, 8, 2, 7)),
                _event(employment.id, datetime(2026, 8, 2, 20)),
            ]
        )
        db.commit()

        august = _build_month(db, employment, 2026, 8)

        assert august.days[0].worked is not None
        assert august.days[0].worked["total"] is not None
        assert august.days[0].worked["total"].hours == 16.0
        assert august.days[0].worked_state == "complete"
        assert august.days[1].worked is not None
        assert august.days[1].worked["total"] is not None
        assert august.days[1].worked["total"].hours == 13.0
        assert august.days[1].worked_state == "complete"
        assert august.worked is not None
        assert august.worked["total"] is not None
        assert august.worked["total"].hours == 29.0


def test_month_dto_leaves_migrated_orphan_in_available_for_single_delete() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        orphan = _event(employment.id, datetime(2026, 7, 1, 8))
        db.add_all(
            [
                orphan,
                _event(employment.id, datetime(2026, 7, 2, 8)),
                _event(employment.id, datetime(2026, 7, 2, 16)),
            ]
        )
        db.commit()

        month = _build_month(db, employment, 2026, 7)

        assert month.days[0].events[0].deletion_partner_id is None
        delete_attendance_event(
            orphan.id,
            db=db,
            auth=PortalUserAuth(instance=None, user=employment.user),  # type: ignore[arg-type]
        )
        remaining = list(
            db.execute(
                select(AttendanceEvent)
                .where(AttendanceEvent.employment_id == employment.id)
                .order_by(AttendanceEvent.occurred_at)
            ).scalars()
        )
        assert [event.occurred_at.hour for event in remaining] == [8, 16]


def test_day_status_does_not_touch_previous_day_plan() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        db.add_all(
            [
                ShiftPlan(
                    employment_id=employment.id,
                    date=date(2026, 7, 31),
                    arrival_time="22:00",
                    departure_time="02:00",
                ),
                AttendanceLock(
                    employment_id=employment.id,
                    year=2026,
                    month=7,
                    locked_by="admin",
                ),
            ]
        )
        db.commit()

        upsert_attendance_status(
            AttendanceStatusUpsertIn(
                employment_id=employment.id,
                date="2026-08-01",
                status="SICKNESS",
                confirm_delete_conflicts=True,
            ),
            db=db,
            auth=PortalUserAuth(instance=None, user=employment.user),  # type: ignore[arg-type]
        )

        assert db.execute(
            select(ShiftPlan).where(ShiftPlan.employment_id == employment.id)
        ).scalar_one_or_none() is not None
        august = _build_month(db, employment, 2026, 8)
        assert august.days[0].attendance_status == "SICKNESS"
        assert august.days[0].planned is not None
        assert august.days[0].planned["total"] is not None
        assert august.days[0].planned["total"].tenths == 0


def test_pdf_cell_metric_labels_are_compact_and_bounded() -> None:
    label = _metric_cell_label(
        {
            "total": {"hours": 8.0},
            "afternoon": {"hours": 2.0},
            "night": {"hours": 1.0},
            "weekend": {"hours": 8.0},
            "public_holiday": {"hours": 8.0},
        }
    )
    lines = label.splitlines()
    assert len(lines) == 5
    assert all(len(line) <= 6 for line in lines)


def test_csv_empty_month_contains_only_header() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        db.commit()

        csv_text = _csv_for_employment(
            db=db,
            employment=employment,
            start=date(2026, 6, 1),
            end=date(2026, 7, 1),
        ).decode("utf-8")

        assert len(csv_text.strip().splitlines()) == 1


def test_metric_rebuild_removes_orphans_without_source_facts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        stale = EmploymentDailyTimeMetric(
            employment_id=employment.id,
            metric_date=date(2026, 6, 1),
            source=DailyMetricSource.ATTENDANCE,
            total_minutes=60,
            total_tenths=10,
            calculation_revision=1,
        )
        db.add(stale)
        db.commit()

        @contextmanager
        def local_scope():
            yield db
            db.commit()

        monkeypatch.setattr(rebuild_daily_time_metrics, "session_scope", local_scope)
        assert rebuild_daily_time_metrics.rebuild(apply=False) == 1
        assert rebuild_daily_time_metrics.rebuild(apply=True) == 1
        assert (
            db.get(
                EmploymentDailyTimeMetric,
                (employment.id, date(2026, 6, 1), DailyMetricSource.ATTENDANCE),
            )
            is None
        )


def test_full_metric_sync_removes_months_without_source_facts() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        stale = EmploymentDailyTimeMetric(
            employment_id=employment.id,
            metric_date=date(2026, 6, 1),
            source=DailyMetricSource.ATTENDANCE,
            total_minutes=60,
            total_tenths=10,
            calculation_revision=1,
        )
        db.add(stale)
        db.flush()

        sync_employment_metrics(db, employment=employment)
        db.flush()

        assert (
            db.get(
                EmploymentDailyTimeMetric,
                (employment.id, date(2026, 6, 1), DailyMetricSource.ATTENDANCE),
            )
            is None
        )


def test_month_sync_removes_zero_rows_after_last_source_fact() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        events = [
            _event(employment.id, datetime(2026, 8, 5, 8)),
            _event(employment.id, datetime(2026, 8, 5, 16)),
        ]
        db.add_all(events)
        db.flush()
        sync_employment_metric_months(db, employment=employment, months={(2026, 8)})
        db.flush()
        assert (
            db.execute(
                select(EmploymentDailyTimeMetric).where(
                    EmploymentDailyTimeMetric.employment_id == employment.id
                )
            )
            .scalars()
            .first()
            is not None
        )

        for event in events:
            db.delete(event)
        db.flush()
        sync_employment_metric_months(db, employment=employment, months={(2026, 8)})
        db.flush()

        assert (
            db.execute(
                select(EmploymentDailyTimeMetric).where(
                    EmploymentDailyTimeMetric.employment_id == employment.id
                )
            )
            .scalars()
            .all()
            == []
        )


def test_metric_rebuild_includes_months_with_only_all_day_status(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        employment = _employment(db, EmploymentType.DPP_DPC)
        db.add(
            Attendance(
                employment_id=employment.id,
                date=date(2026, 8, 10),
                status="SICKNESS",
            )
        )
        db.commit()

        @contextmanager
        def local_scope():
            yield db
            db.commit()

        monkeypatch.setattr(rebuild_daily_time_metrics, "session_scope", local_scope)
        assert rebuild_daily_time_metrics.rebuild(apply=False) > 0
        assert rebuild_daily_time_metrics.rebuild(apply=True) > 0
        assert rebuild_daily_time_metrics.rebuild(apply=False) == 0
        row = db.get(
            EmploymentDailyTimeMetric,
            (employment.id, date(2026, 8, 10), DailyMetricSource.ATTENDANCE),
        )
        assert row is not None
        assert row.total_tenths == 0


def test_deploy_stops_backend_before_migration_and_metric_backfill() -> None:
    workflow = Path(".github/workflows/ci-cd.yml").read_text(encoding="utf-8")
    stop = workflow.index("systemctl stop dagmar-backend")
    migration = workflow.index('alembic.ini" upgrade head', stop)
    apply = workflow.index('rebuild_daily_time_metrics.py" --apply')
    check = workflow.index('rebuild_daily_time_metrics.py" --check')
    restart = workflow.index("systemctl restart dagmar-backend", check)
    version_check = workflow.index("backend_deploy_tag", restart)
    release_trap = workflow.index("trap - EXIT", version_check)
    assert stop < migration < apply < check < restart
    assert restart < version_check < release_trap
    assert "BACKEND_STOPPED=true" in workflow[stop:migration]
    assert "SCHEMA_CHANGE_STARTED=true" in workflow[stop:migration]
    rollback_guard = workflow.index('if [ "$SCHEMA_AFTER" = "$SCHEMA_BEFORE" ]')
    rollback_switch = workflow.index('switch_link "$PREV_BACK"', rollback_guard)
    rollback_stop = workflow.index("systemctl stop dagmar-backend", rollback_switch)
    assert rollback_guard < rollback_switch < rollback_stop
    assert "else systemctl stop dagmar-backend" in workflow
