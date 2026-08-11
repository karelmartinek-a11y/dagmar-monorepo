from __future__ import annotations

import hashlib
import os
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from starlette.testclient import TestClient

os.environ.setdefault("DAGMAR_DATABASE_URL", "sqlite+pysqlite:///:memory:")
os.environ.setdefault("DAGMAR_SESSION_SECRET", "x" * 32)

from app.config import get_settings
from app.db.models import (
    Base,
    ClientType,
    Employment,
    EmploymentType,
    Instance,
    InstanceStatus,
    PortalUser,
    PortalUserResetToken,
    PortalUserRole,
    ResetDeliveryState,
)
from app.db.session import get_db
from app.main import create_app
from app.security.passwords import hash_password, verify_password
from app.security.tokens import rotate_instance_token


def _portal_password() -> str:
    return "".join(("Strong", "Pass", "123"))


def _client() -> tuple[TestClient, Session, PortalUser]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    db = Session(engine)
    instance = Instance(
        id="portal-cookie-instance",
        client_type=ClientType.WEB,
        device_fingerprint="user:cookie@example.test",
        status=InstanceStatus.ACTIVE,
        display_name="Cookie employee",
    )
    user = PortalUser(
        email="cookie@example.test",
        name="Cookie employee",
        role=PortalUserRole.EMPLOYEE,
        password_hash=hash_password(_portal_password()).value,
        is_active=True,
        instance=instance,
    )
    user.employments.append(
        Employment(
            title="Cookie employment",
            employment_type=EmploymentType.WORK_CONTRACT,
            workload_fraction=1,
            total_hours_enabled=True,
            night_hours_enabled=True,
            start_date=date(2026, 1, 1),
            is_active=True,
        )
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    settings = get_settings.__wrapped__(env_file="missing.env")
    settings.database_url = "sqlite+pysqlite:///:memory:"
    settings.session_secret = "x" * 32
    settings.rate_limit_enabled = False
    app = create_app(settings=settings)
    app.dependency_overrides[get_settings] = lambda: settings

    def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    return TestClient(app, base_url="https://dagmar.hcasc.cz"), db, user


def _login(client: TestClient):
    return client.post(
        "/api/v1/portal/login",
        json={"email": "cookie@example.test", "password": _portal_password()},
    )


def test_portal_login_uses_only_hardened_http_only_cookie() -> None:
    client, _, _ = _client()
    response = _login(client)
    assert response.status_code == 200
    assert "instance_token" not in response.json()
    session_cookie = next(
        value
        for value in response.headers.get_list("set-cookie")
        if value.startswith("dagmar_portal_session=")
    )
    assert "HttpOnly" in session_cookie
    assert "Secure" in session_cookie
    assert "SameSite=lax" in session_cookie
    assert "Path=/" in session_cookie
    assert client.get("/api/v1/portal/session").status_code == 200


def test_successful_login_rehashes_legacy_password() -> None:
    client, db, user = _client()
    user.password_hash = hashlib.sha256(_portal_password().encode("utf-8")).hexdigest()
    db.add(user)
    db.commit()

    assert _login(client).status_code == 200
    db.refresh(user)
    assert user.password_hash is not None
    assert user.password_hash.startswith("$argon2")


def test_cookie_mutation_requires_portal_csrf_but_bearer_contract_does_not() -> None:
    client, db, user = _client()
    login = _login(client)
    assert user.instance is not None
    raw_token = rotate_instance_token(db, user.instance)
    db.commit()

    payload = {
        "employment_id": user.employments[0].id,
        "occurred_at": "2026-08-11T08:00:00+02:00",
        "event_type": "IN",
    }
    rejected = client.post("/api/v1/attendance/events", json=payload)
    assert rejected.status_code == 403
    assert rejected.json()["error"]["code"] == "csrf_invalid"
    assert rejected.json()["error"]["request_id"] == rejected.headers["x-request-id"]

    csrf = client.get("/api/v1/portal/csrf").json()["csrf_token"]
    accepted = client.post(
        "/api/v1/attendance/events",
        json=payload,
        headers={"X-CSRF-Token": csrf},
    )
    assert accepted.status_code != 403

    client.cookies.delete("dagmar_portal_session")
    bearer = client.post(
        "/api/v1/attendance/events",
        json={**payload, "occurred_at": "2026-08-11T09:00:00+02:00", "event_type": "OUT"},
        headers={"Authorization": f"Bearer {raw_token}"},
    )
    assert not (
        bearer.status_code == 403
        and bearer.json().get("error", {}).get("code") == "csrf_invalid"
    )
    assert login.status_code == 200


def test_password_reset_revokes_every_browser_session_and_reset_token() -> None:
    client, db, user = _client()
    assert _login(client).status_code == 200
    second_client = TestClient(client.app, base_url="https://dagmar.hcasc.cz")
    assert _login(second_client).status_code == 200
    assert client.get("/api/v1/portal/session").status_code == 200
    assert second_client.get("/api/v1/portal/session").status_code == 200
    raw_reset = "reset-cookie-auth-token"
    db.add(
        PortalUserResetToken(
            user_id=user.id,
            token_hash=hashlib.sha256(raw_reset.encode()).hexdigest(),
            expires_at=datetime.now(UTC) + timedelta(hours=1),
            delivery_state=ResetDeliveryState.SENT,
        )
    )
    db.add(
        PortalUserResetToken(
            user_id=user.id,
            token_hash="older-pending-reset-token",
            expires_at=datetime.now(UTC) + timedelta(hours=1),
            delivery_state=ResetDeliveryState.PENDING,
        )
    )
    db.commit()

    reset = client.post(
        "/api/v1/portal/reset",
        json={"token": raw_reset, "password": "DifferentPass123"},
    )
    assert reset.status_code == 200
    assert any(
        cookie.startswith("dagmar_portal_session=") and "Max-Age=0" in cookie
        for cookie in reset.headers.get_list("set-cookie")
    )
    assert client.get("/api/v1/portal/session").status_code == 401
    assert second_client.get("/api/v1/portal/session").status_code == 401
    tokens = db.execute(select(PortalUserResetToken)).scalars().all()
    assert len(tokens) == 2
    assert all(token.revoked_at is not None for token in tokens)
    assert any(token.used_at is not None for token in tokens)
    assert verify_password("DifferentPass123", user.password_hash or "") is True


def test_portal_logout_is_csrf_protected_and_clears_cookie() -> None:
    client, _, _ = _client()
    assert _login(client).status_code == 200
    assert client.post("/api/v1/portal/logout").status_code == 403
    csrf = client.get("/api/v1/portal/csrf").json()["csrf_token"]
    logout = client.post(
        "/api/v1/portal/logout",
        headers={"X-CSRF-Token": csrf},
    )
    assert logout.status_code == 200
    assert client.get("/api/v1/portal/session").status_code == 401
