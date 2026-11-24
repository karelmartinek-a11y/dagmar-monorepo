"""The PostgreSQL receipt and its effect have one transaction and one winner."""

import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app.db.models import AttendanceMCPOperation, Base, EmploymentGroup
from app.services.attendance_mcp_operations import (
    commit_attendance_mutation,
    invoke_operation,
    operation_status,
)


def test_postgres_receipt_serializes_retries_and_rolls_back_failed_mutation():
    raw = os.getenv("CML_PROFILE_TEST_DATABASE_URL")
    if not raw:
        pytest.skip("Explicit local PostgreSQL profile test database required")
    url = make_url(raw)
    assert url.get_backend_name() == "postgresql"
    assert url.host in {"127.0.0.1", "localhost"}
    assert url.database and url.database.endswith("_test")
    schema = "attendance_receipt_" + uuid4().hex
    admin = create_engine(url, isolation_level="AUTOCOMMIT")
    with admin.connect() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    try:
        tables = [
            Base.metadata.tables[name] for name in ("attendance_mcp_operation", "employment_groups")
        ]
        Base.metadata.create_all(engine, tables=tables)
        sessions = sessionmaker(bind=engine)
        operation_id = str(uuid4())
        barrier = Barrier(2)

        def worker():
            with sessions() as db:
                barrier.wait(timeout=10)

                def write() -> None:
                    group = EmploymentGroup(name="Synthetic group")
                    db.add(group)
                    db.flush()
                    commit_attendance_mutation(db, event_id=group.id)

                return invoke_operation(
                    db,
                    actor="synthetic:actor",
                    operation_id=operation_id,
                    action="test",
                    arguments={"name": "Synthetic group"},
                    employment_id=1,
                    check_authority=lambda _db: None,
                    mutate=write,
                )

        with ThreadPoolExecutor(max_workers=2) as executor:
            first = executor.submit(worker)
            second = executor.submit(worker)
            assert first.result(timeout=15) == second.result(timeout=15)

        failed_id = str(uuid4())
        with pytest.raises(RuntimeError, match="simulated failure"), sessions() as db:

            def fail() -> None:
                db.add(EmploymentGroup(name="Rolled back group"))
                db.flush()
                raise RuntimeError("simulated failure")

            invoke_operation(
                db,
                actor="synthetic:actor",
                operation_id=failed_id,
                action="test",
                arguments={"name": "Rolled back group"},
                employment_id=1,
                check_authority=lambda _db: None,
                mutate=fail,
            )

        with sessions() as db:
            assert db.scalar(select(func.count()).select_from(EmploymentGroup)) == 1
            assert db.scalar(select(func.count()).select_from(AttendanceMCPOperation)) == 1
            assert operation_status(db, "synthetic:actor", failed_id).state == "not_found"
            assert operation_status(db, "synthetic:other", operation_id).state == "not_found"
    finally:
        engine.dispose()
        with admin.connect() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()
