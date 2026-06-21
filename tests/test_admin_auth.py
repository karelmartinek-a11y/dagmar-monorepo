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
    return TestClient(app)


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
    assert response.json()["detail"] == "Neplatné přihlašovací údaje"
