from __future__ import annotations

import os

from fastapi.testclient import TestClient

os.environ.setdefault("DAGMAR_DATABASE_URL", "sqlite+pysqlite:///:memory:")
os.environ.setdefault("DAGMAR_SESSION_SECRET", "x" * 32)
os.environ.setdefault("DAGMAR_CSRF_SECRET", "y" * 32)

from app.config import ADMIN_IDENTITY_EMAIL, get_settings
from app.main import create_app
from app.security.passwords import hash_password


def _build_client() -> TestClient:
    get_settings.cache_clear()
    settings = get_settings.__wrapped__(env_file="missing.env")
    settings.database_url = "sqlite+pysqlite:///:memory:"
    settings.session_secret = "x" * 32
    settings.csrf_secret = "y" * 32
    settings.admin_password_hash = hash_password("StrongPass123").value
    settings.rate_limit_enabled = False
    settings.disable_docs = True
    app = create_app(settings=settings)
    app.dependency_overrides[get_settings] = lambda: settings
    return TestClient(app, base_url="https://dagmar.hcasc.cz")


def _csrf_headers(client: TestClient) -> dict[str, str]:
    csrf_response = client.get("/api/v1/admin/csrf")
    assert csrf_response.status_code == 200
    return {"X-CSRF-Token": csrf_response.json()["csrf_token"]}


def test_admin_login_accepts_json_username_payload() -> None:
    client = _build_client()
    response = client.post(
        "/api/v1/admin/login",
        json={"username": ADMIN_IDENTITY_EMAIL, "password": "StrongPass123"},
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
        json={"username": ADMIN_IDENTITY_EMAIL, "password": "StrongPass123"},
        headers=_csrf_headers(client),
    )
    assert response.status_code == 200
    set_cookie_headers = response.headers.get_list("set-cookie")
    session_cookie = next(header for header in set_cookie_headers if header.startswith("dagmar_admin_session="))
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
        json={"username": ADMIN_IDENTITY_EMAIL, "password": "StrongPass123"},
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
        json={"email": ADMIN_IDENTITY_EMAIL, "password": "StrongPass123"},
        headers=_csrf_headers(client),
    )
    assert response.status_code == 200
    assert response.json()["ok"] is True


def test_admin_login_rejects_invalid_password_after_json_parse() -> None:
    client = _build_client()
    response = client.post(
        "/api/v1/admin/login",
        json={"username": ADMIN_IDENTITY_EMAIL, "password": "invalid-password"},
        headers=_csrf_headers(client),
    )
    assert response.status_code == 401
    assert response.json()["detail"] == {
        "code": "admin_login_invalid_credentials",
        "message": "Neplatné přihlašovací údaje",
    }
    assert client.get("/api/v1/admin/me").json() == {"authenticated": False, "username": None}
