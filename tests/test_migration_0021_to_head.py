from __future__ import annotations

import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
import sqlalchemy as sa
from alembic.config import Config
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from alembic import command
from app.api.v1 import admin_users
from app.api.v1.admin_users import send_reset_link
from scripts.create_e2e_schema_baseline import main as create_e2e_schema_baseline

ROOT = Path(__file__).resolve().parents[1]


def _postgres_url() -> sa.URL | None:
    raw = os.getenv("DAGMAR_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not raw:
        return None
    url = make_url(raw)
    return url if url.get_backend_name() == "postgresql" else None


POSTGRES_URL = _postgres_url()


@pytest.mark.skipif(POSTGRES_URL is None, reason="Migration upgrade regression requires PostgreSQL.")
def test_revision_0021_data_survives_event_migration_to_head(monkeypatch: pytest.MonkeyPatch) -> None:
    source_url = POSTGRES_URL
    assert source_url is not None
    database_name = f"dagmar_e2e_migration_{uuid.uuid4().hex[:12]}"
    admin_url = source_url.set(database="postgres")
    temp_url = source_url.set(database=database_name)
    admin_engine = sa.create_engine(admin_url, isolation_level="AUTOCOMMIT")
    with admin_engine.connect() as connection:
        connection.exec_driver_sql(f'CREATE DATABASE "{database_name}"')
        connection.exec_driver_sql(
            f'ALTER DATABASE "{database_name}" SET timezone TO \'UTC\''
        )
    try:
        monkeypatch.setenv("DAGMAR_DATABASE_URL", temp_url.render_as_string(hide_password=False))
        monkeypatch.setenv("DATABASE_URL", temp_url.render_as_string(hide_password=False))
        monkeypatch.setenv("DAGMAR_E2E_SEED", "1")
        create_e2e_schema_baseline()
        cfg = Config(str(ROOT / "alembic.ini"))
        cfg.set_main_option("script_location", str(ROOT / "alembic"))
        cfg.set_main_option("sqlalchemy.url", temp_url.render_as_string(hide_password=False))
        command.upgrade(cfg, "2026_07_26_0021")
        engine = sa.create_engine(temp_url)
        with engine.begin() as connection:
            connection.execute(sa.text("INSERT INTO portal_users (id, email, name, role, is_active) VALUES (1, 'migration@example.test', 'Migrační uživatel', 'EMPLOYEE', true)"))
            connection.execute(sa.text("INSERT INTO employments (id, user_id, title, employment_type, start_date, is_active) VALUES (10, 1, 'Pracovní smlouva', 'HPP', '2026-01-01', true), (11, 1, 'DPP', 'DPP_DPC', '2026-01-01', true)"))
            connection.execute(sa.text("INSERT INTO attendance (employment_id, date, arrival_time, departure_time, arrival_time_2, departure_time_2, status) VALUES (10, '2026-06-08', '08:00', '12:00', '12:30', '16:00', NULL), (10, '2026-07-31', '22:00', '02:00', NULL, NULL, NULL), (11, '2026-07-15', '08:00', NULL, NULL, NULL, NULL), (11, '2026-07-16', NULL, NULL, NULL, NULL, 'SICKNESS')"))
            connection.execute(sa.text("INSERT INTO shift_plan (employment_id, date, arrival_time, departure_time, status) VALUES (10, '2026-07-31', '22:00', '02:00', NULL), (11, '2026-07-16', NULL, NULL, 'HOLIDAY')"))
            connection.execute(sa.text("INSERT INTO attendance_locks (employment_id, year, month, locked_by) VALUES (10, 2026, 6, 'migration')"))
            connection.execute(sa.text("INSERT INTO shift_plan_locks (employment_id, year, month, locked_by) VALUES (10, 2026, 7, 'migration')"))
            connection.execute(sa.text("INSERT INTO shift_plan_month_instances (year, month, employment_id) VALUES (2026, 7, 10), (2026, 7, 11)"))
            connection.execute(sa.text("INSERT INTO employment_groups (id, name) VALUES (20, 'Migrační skupina')"))
            connection.execute(sa.text("INSERT INTO employment_group_members (group_id, employment_id) VALUES (20, 10), (20, 11)"))
        engine.dispose()

        command.upgrade(cfg, "2026_07_31_0022")
        engine = sa.create_engine(temp_url)
        with engine.connect() as connection:
            first_event = connection.execute(
                sa.text("SELECT occurred_at FROM attendance_events ORDER BY id LIMIT 1")
            ).scalar_one()
        assert first_event.astimezone(ZoneInfo("Europe/Prague")).hour == 8
        with engine.begin() as connection:
            connection.execute(
                sa.text(
                    "INSERT INTO portal_user_reset_tokens "
                    "(user_id, token_hash, expires_at) VALUES "
                    "(1, 'legacy-reset-token', CURRENT_TIMESTAMP + interval '1 day')"
                )
            )
            connection.execute(
                sa.text(
                    "INSERT INTO instances "
                    "(id, client_type, device_fingerprint, status) VALUES "
                    "('orphan-web-instance', 'WEB', 'user:deleted@example.test', 'ACTIVE'), "
                    "('linked-web-instance', 'WEB', 'user:migration@example.test', 'ACTIVE')"
                )
            )
            connection.execute(
                sa.text(
                    "UPDATE portal_users SET instance_id = 'linked-web-instance' WHERE id = 1"
                )
            )
            connection.execute(
                sa.text("CREATE TABLE admin_users (id integer PRIMARY KEY, username text, password_hash text)")
            )
            connection.execute(
                sa.text("CREATE TABLE admin_sessions (id integer PRIMARY KEY, session_id_hash text)")
            )
        engine.dispose()

        command.upgrade(cfg, "head")
        engine = sa.create_engine(temp_url)

        monkeypatch.setattr(admin_users, "_send_reset_email", lambda **_kwargs: None)
        start = threading.Barrier(2)

        def issue_reset(request_id: str) -> None:
            with Session(engine) as session:
                start.wait(timeout=5)
                send_reset_link(
                    1,
                    SimpleNamespace(state=SimpleNamespace(request_id=request_id)),
                    object(),
                    None,
                    session,
                    SimpleNamespace(public_base_url="https://dagmar.hcasc.cz"),
                )

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(issue_reset, f"race-{index}") for index in range(2)]
            for future in futures:
                future.result(timeout=10)

        with engine.connect() as connection:
            active_reset_count = connection.execute(
                sa.text(
                    "SELECT count(*) FROM portal_user_reset_tokens "
                    "WHERE delivery_state = 'SENT' AND used_at IS NULL AND revoked_at IS NULL"
                )
            ).scalar_one()
        assert active_reset_count == 1

        with engine.begin() as connection:
            connection.execute(
                sa.text(
                    "INSERT INTO portal_users (id, email, name, role, is_active) VALUES "
                    "(2, 'old-backend@example.test', 'Starší backend', 'EMPLOYEE', true)"
                )
            )
        with pytest.raises(sa.exc.IntegrityError):
            with engine.begin() as connection:
                connection.execute(
                    sa.text(
                        "INSERT INTO employments "
                        "(id, user_id, title, employment_type, start_date, is_active) VALUES "
                        "(12, 2, 'Úkolová odměna', 'TASK_SHIFT_BASED', '2026-08-01', true)"
                    )
                )
        with engine.begin() as connection:
            connection.execute(
                sa.text(
                    "INSERT INTO employments "
                    "(id, user_id, title, employment_type, total_hours_enabled, start_date, is_active) VALUES "
                    "(12, 2, 'Úkolová odměna', 'TASK_SHIFT_BASED', false, '2026-08-01', true)"
                )
            )
        with engine.connect() as connection:
            employments = connection.execute(sa.text("SELECT id, employment_type::text, total_hours_enabled, night_hours_enabled FROM employments WHERE id IN (10, 11) ORDER BY id")).all()
            compatibility_profiles = connection.execute(sa.text("SELECT id, total_hours_enabled FROM employments WHERE id = 12")).all()
            events = connection.execute(sa.text("SELECT employment_id, occurred_at, event_type::text FROM attendance_events ORDER BY employment_id, occurred_at")).all()
            status = connection.execute(sa.text("SELECT status FROM attendance WHERE employment_id = 11 AND date = '2026-07-16'")).scalar_one()
            plan = connection.execute(sa.text("SELECT arrival_time, departure_time FROM shift_plan WHERE employment_id = 10 AND date = '2026-07-31'")).one()
            group_members = connection.execute(sa.text("SELECT employment_id FROM employment_group_members WHERE group_id = 20 ORDER BY employment_id")).scalars().all()
            attendance_lock = connection.execute(sa.text("SELECT count(*) FROM attendance_locks WHERE employment_id = 10 AND year = 2026 AND month = 6")).scalar_one()
            plan_lock = connection.execute(sa.text("SELECT count(*) FROM shift_plan_locks WHERE employment_id = 10 AND year = 2026 AND month = 7")).scalar_one()
            selections = connection.execute(sa.text("SELECT employment_id FROM shift_plan_month_instances WHERE year = 2026 AND month = 7 ORDER BY employment_id")).scalars().all()
            reset_lifecycle = connection.execute(
                sa.text(
                    "SELECT delivery_state::text, revoked_at IS NOT NULL "
                    "FROM portal_user_reset_tokens WHERE token_hash = 'legacy-reset-token'"
                )
            ).one()
            web_instances = connection.execute(
                sa.text("SELECT id FROM instances WHERE id IN ('orphan-web-instance', 'linked-web-instance') ORDER BY id")
            ).scalars().all()
            inactive_admin_tables = {
                name
                for name in ("admin_sessions", "admin_users")
                if sa.inspect(connection).has_table(name)
            }
        engine.dispose()

        assert employments == [(10, "WORK_CONTRACT", True, True), (11, "DPP_DPC", True, True)]
        assert compatibility_profiles == [(12, False)]
        assert [(row[0], row[2]) for row in events] == [
            (10, "IN"), (10, "OUT"), (10, "IN"), (10, "OUT"), (10, "IN"), (10, "OUT"), (11, "IN")
        ]
        assert events[5][1].date().isoformat() == "2026-08-01"
        local_times = [row[1].astimezone(ZoneInfo("Europe/Prague")) for row in events]
        assert (local_times[0].hour, local_times[0].minute) == (8, 0)
        assert (local_times[1].hour, local_times[1].minute) == (12, 0)
        assert (local_times[4].hour, local_times[4].minute) == (22, 0)
        assert (local_times[5].hour, local_times[5].minute) == (2, 0)
        assert status == "SICKNESS"
        assert plan == ("22:00", "02:00")
        assert group_members == [10, 11]
        assert attendance_lock == plan_lock == 1
        assert selections == [10, 11]
        assert reset_lifecycle == ("FAILED", True)
        assert web_instances == ["linked-web-instance"]
        assert inactive_admin_tables == set()

        engine = sa.create_engine(temp_url)
        with engine.begin() as connection:
            connection.execute(
                sa.text(
                    "UPDATE employments SET weekend_hours_enabled = false, "
                    "public_holiday_hours_enabled = false WHERE id = 10"
                )
            )
        engine.dispose()
        command.downgrade(cfg, "2026_07_31_0022")
        engine = sa.create_engine(temp_url)
        with engine.connect() as connection:
            restored_profile = connection.execute(
                sa.text(
                    "SELECT weekend_hours_enabled, public_holiday_hours_enabled "
                    "FROM employments WHERE id = 10"
                )
            ).one()
        engine.dispose()
        assert restored_profile == (True, True)
    finally:
        with admin_engine.connect() as connection:
            connection.execute(sa.text("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = :name"), {"name": database_name})
            connection.exec_driver_sql(f'DROP DATABASE IF EXISTS "{database_name}"')
        admin_engine.dispose()
