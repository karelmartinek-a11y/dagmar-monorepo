from __future__ import annotations

import importlib
import os
from dataclasses import dataclass
from datetime import UTC, date, datetime

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("DAGMAR_DATABASE_URL", "sqlite+pysqlite:///:memory:")
os.environ.setdefault("DAGMAR_SESSION_SECRET", "x" * 32)

from app.api.v1.integration import INTEGRATION_SCOPE_ROUTES, router
from app.config import Settings, get_settings
from app.db.models import (
    AttendanceEvent,
    AttendanceEventType,
    Base,
    Employment,
    EmploymentType,
    IntegrationClient,
    IntegrationClientSecret,
    PortalUser,
    PortalUserRole,
)
from app.db.session import get_db
from app.main import create_app
from app.security.integration_rate_limit import reset_integration_rate_limits
from app.security.integration_tokens import build_token_record
from app.services.integration_admin import (
    DATA_SCOPE_ACTIVE_ONLY,
    DATA_SCOPE_ALL,
    DATA_SCOPE_SELECTED_EMPLOYEES,
    DATA_SCOPE_SELECTED_EMPLOYMENTS,
    PERMISSION_PROFILES,
    SCOPE_ATTENDANCE,
    SCOPE_ATTENDANCE_CREATE,
    SCOPE_ATTENDANCE_DELETE,
    SCOPE_ATTENDANCE_UPDATE,
    SCOPE_DEFINITIONS,
    SCOPE_EMPLOYMENTS,
    SCOPE_HEALTH,
    SCOPE_LOCKS,
    SCOPE_OPENAPI,
    SCOPE_PUNCHES,
    SCOPE_SHIFT_PLAN,
)


def _integration_token() -> str:
    return "".join(("dgi_", "contract", "fixture", "token", "1234567890"))


@dataclass(frozen=True)
class IntegrationFixture:
    client: TestClient
    sessions: sessionmaker[Session]
    settings: Settings
    headers: dict[str, str]
    employment_ids: dict[str, int]


@pytest.fixture
def integration_fixture(monkeypatch: pytest.MonkeyPatch) -> IntegrationFixture:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    token = _integration_token()
    record = build_token_record(token)
    with sessions.begin() as db:
        active_user = PortalUser(
            email="active@example.test",
            name="Active user",
            role=PortalUserRole.EMPLOYEE,
            is_active=True,
        )
        inactive_user = PortalUser(
            email="inactive@example.test",
            name="Inactive user",
            role=PortalUserRole.EMPLOYEE,
            is_active=False,
        )
        other_user = PortalUser(
            email="other@example.test",
            name="Other user",
            role=PortalUserRole.EMPLOYEE,
            is_active=True,
        )
        db.add_all([active_user, inactive_user, other_user])
        db.flush()
        employments = {
            "active": Employment(
                user_id=active_user.id,
                title="Active employment",
                employment_type=EmploymentType.WORK_CONTRACT,
                workload_fraction=1,
                night_hours_enabled=True,
                start_date=date(2026, 1, 1),
                is_active=True,
            ),
            "inactive_employment": Employment(
                user_id=active_user.id,
                title="Inactive employment",
                employment_type=EmploymentType.WORK_CONTRACT,
                workload_fraction=1,
                night_hours_enabled=True,
                start_date=date(2026, 1, 1),
                is_active=True,
                end_date=date(2026, 8, 31),
            ),
            "inactive_user": Employment(
                user_id=inactive_user.id,
                title="Inactive user's employment",
                employment_type=EmploymentType.WORK_CONTRACT,
                workload_fraction=1,
                night_hours_enabled=True,
                start_date=date(2026, 1, 1),
                is_active=True,
            ),
            "other": Employment(
                user_id=other_user.id,
                title="Other employment",
                employment_type=EmploymentType.WORK_CONTRACT,
                workload_fraction=1,
                night_hours_enabled=True,
                start_date=date(2026, 1, 1),
                is_active=True,
            ),
        }
        db.add_all(employments.values())
        db.flush()
        occurred_at = datetime(2026, 8, 11, 8, 0, tzinfo=UTC)
        db.add_all(
            AttendanceEvent(
                employment_id=employment.id,
                occurred_at=occurred_at,
                event_type=AttendanceEventType.IN,
            )
            for employment in employments.values()
        )
        integration = IntegrationClient(
            name="Contract fixture",
            scopes=[
                SCOPE_HEALTH,
                SCOPE_OPENAPI,
                SCOPE_EMPLOYMENTS,
                SCOPE_ATTENDANCE,
                SCOPE_ATTENDANCE_CREATE,
                SCOPE_ATTENDANCE_UPDATE,
                SCOPE_ATTENDANCE_DELETE,
                SCOPE_LOCKS,
            ],
            data_scope_mode=DATA_SCOPE_ALL,
            include_inactive_employments=True,
            status="ACTIVE",
        )
        integration.secrets.append(
            IntegrationClientSecret(
                token_hash=record.token_hash,
                token_prefix=record.token_prefix,
                token_last4=record.token_last4,
                token_fingerprint=record.token_fingerprint,
            )
        )
        db.add(integration)
        db.flush()
        employment_ids = {name: employment.id for name, employment in employments.items()}

    settings = get_settings.__wrapped__(env_file="missing.env")
    settings.database_url = "sqlite+pysqlite:///:memory:"
    settings.session_secret = "x" * 32
    settings.disable_docs = True
    settings.rate_limit_enabled = False
    app = create_app(settings=settings)

    def override_db():
        with sessions() as db:
            yield db

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_settings] = lambda: settings
    main_module = importlib.import_module("app.main")
    monkeypatch.setattr(main_module, "get_sessionmaker", lambda: sessions)
    reset_integration_rate_limits()
    return IntegrationFixture(
        client=TestClient(app, base_url="https://dagmar.hcasc.cz"),
        sessions=sessions,
        settings=settings,
        headers={"Authorization": f"Bearer {token}"},
        employment_ids=employment_ids,
    )


def _configure_scope(
    fixture: IntegrationFixture,
    *,
    mode: str,
    employee_ids: list[int] | None = None,
    employment_ids: list[int] | None = None,
    include_inactive: bool = False,
) -> None:
    with fixture.sessions.begin() as db:
        client = db.execute(select(IntegrationClient)).scalar_one()
        client.data_scope_mode = mode
        client.allowed_employee_ids = employee_ids or []
        client.allowed_employment_ids = employment_ids or []
        client.include_inactive_employments = include_inactive


def _listed_employments(fixture: IntegrationFixture) -> set[int]:
    response = fixture.client.get("/api/v1/integration/employments", headers=fixture.headers)
    assert response.status_code == 200
    return {row["employment_id"] for row in response.json()["data"]}


def test_all_four_data_scope_modes_are_enforced_deny_by_default(
    integration_fixture: IntegrationFixture,
) -> None:
    fixture = integration_fixture
    ids = fixture.employment_ids
    assert _listed_employments(fixture) == set(ids.values())

    _configure_scope(fixture, mode=DATA_SCOPE_ACTIVE_ONLY)
    assert _listed_employments(fixture) == {ids["active"], ids["other"]}

    with fixture.sessions() as db:
        active_user_id = db.execute(
            select(Employment.user_id).where(Employment.id == ids["active"])
        ).scalar_one()
    _configure_scope(
        fixture,
        mode=DATA_SCOPE_SELECTED_EMPLOYEES,
        employee_ids=[active_user_id],
    )
    assert _listed_employments(fixture) == {ids["active"]}
    _configure_scope(
        fixture,
        mode=DATA_SCOPE_SELECTED_EMPLOYEES,
        employee_ids=[active_user_id],
        include_inactive=True,
    )
    assert _listed_employments(fixture) == {ids["active"], ids["inactive_employment"]}

    _configure_scope(
        fixture,
        mode=DATA_SCOPE_SELECTED_EMPLOYMENTS,
        employment_ids=[ids["inactive_user"]],
    )
    assert _listed_employments(fixture) == {ids["inactive_user"]}

    _configure_scope(fixture, mode=DATA_SCOPE_SELECTED_EMPLOYMENTS)
    assert _listed_employments(fixture) == set()
    assert (
        fixture.client.get("/api/v1/integration/attendance-events", headers=fixture.headers).json()[
            "data"
        ]
        == []
    )
    assert (
        fixture.client.get(
            "/api/v1/integration/locks?year=2026&month=8", headers=fixture.headers
        ).json()["data"]
        == []
    )
    _configure_scope(fixture, mode="UNKNOWN_MODE", employment_ids=[ids["active"]])
    assert _listed_employments(fixture) == set()


def test_scope_is_applied_to_events_locks_and_direct_write_ids(
    integration_fixture: IntegrationFixture,
) -> None:
    fixture = integration_fixture
    ids = fixture.employment_ids
    _configure_scope(fixture, mode=DATA_SCOPE_ACTIVE_ONLY)
    events = fixture.client.get("/api/v1/integration/attendance-events", headers=fixture.headers)
    assert events.status_code == 200
    assert {row["employment_id"] for row in events.json()["data"]} == {
        ids["active"],
        ids["other"],
    }
    denied_read = fixture.client.get(
        "/api/v1/integration/attendance-events",
        params={"employment_id": ids["inactive_employment"]},
        headers=fixture.headers,
    )
    assert denied_read.status_code == 403
    assert denied_read.json()["error"]["code"] == "insufficient_scope"
    locks = fixture.client.get(
        "/api/v1/integration/locks?year=2026&month=8", headers=fixture.headers
    )
    assert locks.status_code == 200
    assert {row["employment_id"] for row in locks.json()["data"]} == {
        ids["active"],
        ids["other"],
    }

    _configure_scope(
        fixture,
        mode=DATA_SCOPE_SELECTED_EMPLOYMENTS,
        employment_ids=[ids["active"]],
    )
    denied = fixture.client.post(
        "/api/v1/integration/attendance-events",
        headers=fixture.headers,
        json={
            "employment_id": ids["other"],
            "occurred_at": "2026-08-11T10:00:00+02:00",
            "event_type": "OUT",
        },
    )
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "insufficient_scope"

    with fixture.sessions() as db:
        other_event_id = db.execute(
            select(AttendanceEvent.id).where(AttendanceEvent.employment_id == ids["other"])
        ).scalar_one()
    denied_patch = fixture.client.patch(
        f"/api/v1/integration/attendance-events/{other_event_id}",
        headers=fixture.headers,
        json={"occurred_at": "2026-08-11T10:30:00+02:00"},
    )
    assert denied_patch.status_code == 403
    assert denied_patch.json()["error"]["code"] == "insufficient_scope"
    denied_delete = fixture.client.delete(
        f"/api/v1/integration/attendance-events/{other_event_id}",
        headers=fixture.headers,
    )
    assert denied_delete.status_code == 403
    assert denied_delete.json()["error"]["code"] == "insufficient_scope"

    _configure_scope(
        fixture,
        mode=DATA_SCOPE_SELECTED_EMPLOYMENTS,
        employment_ids=[ids["inactive_employment"]],
    )
    inactive = fixture.client.post(
        "/api/v1/integration/attendance-events",
        headers=fixture.headers,
        json={
            "employment_id": ids["inactive_employment"],
            "occurred_at": "2026-08-11T10:00:00+02:00",
            "event_type": "OUT",
        },
    )
    assert inactive.status_code == 404


def test_cursor_pagination_is_stable_and_endpoint_specific(
    integration_fixture: IntegrationFixture,
) -> None:
    fixture = integration_fixture
    first = fixture.client.get("/api/v1/integration/employments?limit=2", headers=fixture.headers)
    assert first.status_code == 200
    first_payload = first.json()
    assert first_payload["pagination"]["has_more"] is True
    employment_cursor = first_payload["pagination"]["next_cursor"]
    second = fixture.client.get(
        "/api/v1/integration/employments",
        params={"limit": 2, "cursor": employment_cursor},
        headers=fixture.headers,
    )
    assert second.status_code == 200
    all_ids = [row["id"] for row in first_payload["data"] + second.json()["data"]]
    assert all_ids == sorted(fixture.employment_ids.values())
    assert len(all_ids) == len(set(all_ids))
    assert second.json()["pagination"] == {
        "limit": 2,
        "next_cursor": None,
        "has_more": False,
    }

    events_first = fixture.client.get(
        "/api/v1/integration/attendance-events?limit=2", headers=fixture.headers
    ).json()
    events_second = fixture.client.get(
        "/api/v1/integration/attendance-events",
        params={"limit": 2, "cursor": events_first["pagination"]["next_cursor"]},
        headers=fixture.headers,
    )
    assert events_second.status_code == 200
    event_ids = [row["id"] for row in events_first["data"] + events_second.json()["data"]]
    assert len(event_ids) == 4
    assert len(event_ids) == len(set(event_ids))

    malformed = fixture.client.get(
        "/api/v1/integration/employments?cursor=not-a-cursor", headers=fixture.headers
    )
    assert malformed.status_code == 400
    assert malformed.json()["error"]["code"] == "invalid_cursor"
    foreign = fixture.client.get(
        "/api/v1/integration/attendance-events",
        params={"cursor": employment_cursor},
        headers=fixture.headers,
    )
    assert foreign.status_code == 400
    assert foreign.json()["error"]["code"] == "invalid_cursor"


def test_health_data_and_openapi_have_separate_configured_rate_buckets(
    integration_fixture: IntegrationFixture,
) -> None:
    fixture = integration_fixture
    fixture.settings.rate_limit_enabled = True
    fixture.settings.rate_limit_integration_health_per_minute = 2
    fixture.settings.rate_limit_integration_data_per_minute = 2
    fixture.settings.rate_limit_integration_openapi_per_minute = 2
    reset_integration_rate_limits()

    for path in ("/health", "/openapi.json", "/employments"):
        statuses = [
            fixture.client.get(f"/api/v1/integration{path}", headers=fixture.headers).status_code
            for _ in range(3)
        ]
        assert statuses == [200, 200, 429]


def test_each_available_scope_maps_to_a_real_enforced_route() -> None:
    definitions = {definition.id: definition for definition in SCOPE_DEFINITIONS}
    assert {scope for scope, definition in definitions.items() if definition.available} == set(
        INTEGRATION_SCOPE_ROUTES
    )
    real_routes = {
        (method, route.path.removeprefix("/api/v1/integration"))
        for route in router.routes
        if isinstance(route, APIRoute)
        for method in (route.methods or set())
    }
    for scope, mappings in INTEGRATION_SCOPE_ROUTES.items():
        assert definitions[scope].available is True
        assert set(mappings) <= real_routes
    unavailable = {SCOPE_SHIFT_PLAN, SCOPE_PUNCHES}
    assert all(unavailable.isdisjoint(profile) for profile in PERMISSION_PROFILES.values())


@pytest.mark.parametrize(
    ("scope", "method", "path"),
    [
        (SCOPE_HEALTH, "GET", "/health"),
        (SCOPE_OPENAPI, "GET", "/openapi.json"),
        (SCOPE_EMPLOYMENTS, "GET", "/employments"),
        (SCOPE_ATTENDANCE, "GET", "/attendance-events"),
        (SCOPE_ATTENDANCE_CREATE, "POST", "/attendance-events"),
        (SCOPE_ATTENDANCE_UPDATE, "PATCH", "/attendance-events/{event_id}"),
        (SCOPE_ATTENDANCE_DELETE, "DELETE", "/attendance-events/{event_id}"),
        (SCOPE_LOCKS, "GET", "/locks?year=2026&month=8"),
    ],
)
def test_each_active_route_enforces_its_declared_scope(
    integration_fixture: IntegrationFixture,
    scope: str,
    method: str,
    path: str,
) -> None:
    fixture = integration_fixture
    with fixture.sessions.begin() as db:
        client = db.execute(select(IntegrationClient)).scalar_one()
        client.scopes = [item for item in client.scopes if item != scope]
        event_id = (
            db.execute(select(AttendanceEvent.id).order_by(AttendanceEvent.id)).scalars().first()
        )
    assert event_id is not None
    resolved_path = path.format(event_id=event_id)
    response = fixture.client.request(
        method,
        f"/api/v1/integration{resolved_path}",
        headers=fixture.headers,
        json=(
            {
                "employment_id": fixture.employment_ids["active"],
                "occurred_at": "2026-08-11T10:00:00+02:00",
                "event_type": "OUT",
            }
            if method == "POST"
            else {"occurred_at": "2026-08-11T10:00:00+02:00"}
            if method == "PATCH"
            else None
        ),
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "insufficient_scope"


def test_protected_openapi_exposes_exact_active_contract(
    integration_fixture: IntegrationFixture,
) -> None:
    fixture = integration_fixture
    fixture.settings.integration_contract_version = "2026-08-11"
    health = fixture.client.get("/api/v1/integration/health", headers=fixture.headers)
    assert health.status_code == 200
    assert health.json()["contract_version"] == "2026-08-11"

    response = fixture.client.get("/api/v1/integration/openapi.json", headers=fixture.headers)
    assert response.status_code == 200
    payload = response.json()
    assert payload["info"]["version"] == "2026-08-11"
    expected_paths = {
        path for mappings in INTEGRATION_SCOPE_ROUTES.values() for _method, path in mappings
    }
    assert set(payload["paths"]) == expected_paths
