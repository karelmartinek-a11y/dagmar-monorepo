from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

os.environ.setdefault("DAGMAR_DATABASE_URL", "sqlite+pysqlite:///:memory:")
os.environ.setdefault("DAGMAR_SESSION_SECRET", "x" * 32)

from app.config import ADMIN_IDENTITY_EMAIL, get_settings
from app.db.models import Base
from app.db.session import get_db
from app.main import create_app
from app.security.passwords import hash_password
from app.security.rate_limit import limiter


def _admin_password() -> str:
    return "".join(("Strong", "Pass", "123"))


def _build_client() -> TestClient:
    limiter.reset()
    get_settings.cache_clear()
    settings = get_settings.__wrapped__(env_file="missing.env")
    settings.database_url = "sqlite+pysqlite:///:memory:"
    settings.session_secret = "x" * 32
    settings.admin_password_hash = hash_password(_admin_password()).value
    settings.rate_limit_enabled = False
    settings.disable_docs = True
    app = create_app(settings=settings)
    app.dependency_overrides[get_settings] = lambda: settings
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)

    def override_db():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = override_db
    return TestClient(app, base_url="https://dagmar.hcasc.cz")


def _csrf_headers(client: TestClient) -> dict[str, str]:
    csrf_response = client.get("/api/v1/admin/csrf")
    assert csrf_response.status_code == 200
    return {"X-CSRF-Token": csrf_response.json()["csrf_token"]}


def test_admin_login_accepts_json_username_payload() -> None:
    client = _build_client()
    response = client.post(
        "/api/v1/admin/login",
        json={"username": ADMIN_IDENTITY_EMAIL, "password": _admin_password()},
        headers=_csrf_headers(client),
    )
    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert response.cookies.get("dagmar_admin_session")
    me = client.get("/api/v1/admin/me")
    assert me.status_code == 200
    assert me.json() == {"authenticated": True, "username": ADMIN_IDENTITY_EMAIL}


def test_admin_login_cookie_is_scoped_to_whole_admin_app() -> None:
    client = _build_client()
    response = client.post(
        "/api/v1/admin/login",
        json={"username": ADMIN_IDENTITY_EMAIL, "password": _admin_password()},
        headers=_csrf_headers(client),
    )
    assert response.status_code == 200
    set_cookie_headers = response.headers.get_list("set-cookie")
    session_cookie = next(
        header for header in set_cookie_headers if header.startswith("dagmar_admin_session=")
    )
    assert "Path=/" in session_cookie
    assert "HttpOnly" in session_cookie
    assert "Secure" in session_cookie
    assert "SameSite=lax" in session_cookie
    assert "Max-Age=43200" in session_cookie


def test_admin_me_without_session_reports_unauthenticated() -> None:
    client = _build_client()
    response = client.get("/api/v1/admin/me")
    assert response.status_code == 200
    assert response.json() == {"authenticated": False, "username": None}


def test_admin_logout_invalidates_session() -> None:
    client = _build_client()
    login = client.post(
        "/api/v1/admin/login",
        json={"username": ADMIN_IDENTITY_EMAIL, "password": _admin_password()},
        headers=_csrf_headers(client),
    )
    assert login.status_code == 200
    assert client.get("/api/v1/admin/me").json()["authenticated"] is True

    logout = client.post("/api/v1/admin/logout", headers=_csrf_headers(client))
    assert logout.status_code == 200
    assert logout.json() == {"ok": True}
    assert client.get("/api/v1/admin/me").json() == {"authenticated": False, "username": None}


def test_admin_login_accepts_json_email_alias() -> None:
    client = _build_client()
    response = client.post(
        "/api/v1/admin/login",
        json={"email": ADMIN_IDENTITY_EMAIL, "password": _admin_password()},
        headers=_csrf_headers(client),
    )
    assert response.status_code == 200
    assert response.json()["ok"] is True


def test_admin_login_rejects_invalid_password_after_json_parse(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level("INFO", logger="dagmar.security")
    client = _build_client()
    response = client.post(
        "/api/v1/admin/login",
        json={"username": ADMIN_IDENTITY_EMAIL, "password": "invalid-password"},
        headers=_csrf_headers(client),
    )
    assert response.status_code == 401
    assert response.json()["error"] | {"request_id": None} == {
        "code": "admin_login_invalid_credentials",
        "message": "Neplatné přihlašovací údaje",
        "request_id": None,
    }
    assert response.json()["error"]["request_id"] == response.headers["x-request-id"]
    security_log = caplog.text
    assert "security_event=admin_login_failed" in security_log
    assert f"request_id={response.headers['x-request-id']}" in security_log
    assert "source_ip=testclient" in security_log
    assert "invalid-password" not in security_log
    assert client.get("/api/v1/admin/me").json() == {"authenticated": False, "username": None}


def test_admin_login_locks_after_five_failures_and_rejects_correct_password() -> None:
    client = _build_client()
    statuses = []
    for _ in range(5):
        response = client.post(
            "/api/v1/admin/login",
            json={"username": ADMIN_IDENTITY_EMAIL, "password": "wrong-password"},
            headers=_csrf_headers(client),
        )
        statuses.append(response.status_code)
    assert statuses == [401, 401, 401, 401, 423]
    locked = client.post(
        "/api/v1/admin/login",
        json={"username": ADMIN_IDENTITY_EMAIL, "password": _admin_password()},
        headers=_csrf_headers(client),
    )
    assert locked.status_code == 423
    assert locked.json()["error"]["code"] == "admin_account_locked"
    assert locked.json()["error"]["request_id"] == locked.headers["x-request-id"]


def test_successful_admin_login_clears_previous_failures() -> None:
    client = _build_client()
    for _ in range(2):
        assert (
            client.post(
                "/api/v1/admin/login",
                json={"username": ADMIN_IDENTITY_EMAIL, "password": "wrong-password"},
                headers=_csrf_headers(client),
            ).status_code
            == 401
        )

    assert (
        client.post(
            "/api/v1/admin/login",
            json={"username": ADMIN_IDENTITY_EMAIL, "password": _admin_password()},
            headers=_csrf_headers(client),
        ).status_code
        == 200
    )
    assert client.post("/api/v1/admin/logout", headers=_csrf_headers(client)).status_code == 200

    statuses = [
        client.post(
            "/api/v1/admin/login",
            json={"username": ADMIN_IDENTITY_EMAIL, "password": "wrong-password"},
            headers=_csrf_headers(client),
        ).status_code
        for _ in range(5)
    ]
    assert statuses == [401, 401, 401, 401, 423]
