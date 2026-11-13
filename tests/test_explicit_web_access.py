"""Explicit employment membership and separate attendance administration."""

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.deps import PortalUserAuth
from app.api.v1.attendance import _employment
from app.security.cml_assertion import AssertionDenied
from app.security.web_access import attendance_access


def claims(permissions, ids):
    return {
        "sub": "user:" + str(uuid4()),
        "role": "member",
        "grant": {
            "contract": "kajovo-web-grant/1",
            "permissions": permissions,
            "dataScope": {"kind": "employments", "employmentIds": ids},
        },
    }


def test_employee_requires_explicit_unique_employment_ids():
    assert attendance_access(claims(["attendance.self"], ["1", "7"])) == (False, frozenset({1, 7}))
    assert attendance_access(claims(["attendance.manage"], [])) == (True, frozenset())
    for value in [
        claims(["attendance.self"], []),
        claims(["attendance.self"], ["1", "1"]),
        claims(["attendance.self"], ["0"]),
        claims(["attendance.manage", "attendance.self"], ["1"]),
    ]:
        with pytest.raises(AssertionDenied):
            attendance_access(value)


def test_unassigned_own_employment_and_other_users_employment_are_denied():
    rows = {
        1: SimpleNamespace(id=1, user_id=10),
        2: SimpleNamespace(id=2, user_id=10),
        3: SimpleNamespace(id=3, user_id=20),
    }
    db = SimpleNamespace(get=lambda model, id: rows.get(id))
    auth = PortalUserAuth(
        instance=None, user=SimpleNamespace(id=10, is_active=True), employment_ids=frozenset({1, 3})
    )
    assert _employment(auth, 1, db).id == 1
    for id in (2, 3, 4):
        with pytest.raises(HTTPException) as denied:
            _employment(auth, id, db)
        assert denied.value.status_code == 404
    native = PortalUserAuth(instance=None, user=auth.user)
    assert _employment(native, 2, db).id == 2


def test_employment_creation_recovers_the_original_result_and_rejects_changed_retries():
    from sqlalchemy import create_engine, func, select
    from sqlalchemy.orm import Session
    from starlette.requests import Request

    from app.api.v1.admin_employments import EmploymentCreateIn, create_employment
    from app.db.models import Base, Employment, PortalUser, PortalUserRole

    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/admin/users/1/employments",
            "headers": [],
            "state": {"cml_web_claims": {"sub": "user:" + str(uuid4())}},
        }
    )
    payload = EmploymentCreateIn(
        operation_id=uuid4(),
        title="Synthetic employment",
        employment_type="DPP_DPC",
        start_date="2026-11-13",
    )
    try:
        with Session(engine) as db:
            user = PortalUser(
                id=1,
                email="synthetic@example.invalid",
                name="Synthetic User",
                role=PortalUserRole.EMPLOYEE,
            )
            db.add(user)
            db.commit()
            first = create_employment(1, payload, request, db=db)
            replay = create_employment(1, payload, request, db=db)
            assert first.id == replay.id
            assert db.scalar(select(func.count()).select_from(Employment)) == 1
            with pytest.raises(HTTPException) as denied:
                create_employment(
                    1, payload.model_copy(update={"title": "Changed"}), request, db=db
                )
            assert denied.value.status_code == 409
    finally:
        engine.dispose()
