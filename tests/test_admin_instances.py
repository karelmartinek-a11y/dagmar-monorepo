from __future__ import annotations

import os

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


def _client() -> TestClient:
    limiter.reset()
    get_settings.cache_clear()
    settings = get_settings.__wrapped__(env_file="missing.env")
    settings.database_url = "sqlite+pysqlite:///:memory:"
    settings.session_secret = "x" * 32
    settings.admin_password_hash = hash_password(_admin_password()).value
    settings.rate_limit_enabled = False
    settings.disable_docs = True
    app = create_app(settings=settings)
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
    app.dependency_overrides[get_settings] = lambda: settings
    return TestClient(app, base_url="https://dagmar.hcasc.cz")


def _csrf(client: TestClient) -> str:
    return client.get("/api/v1/admin/csrf").json()["csrf_token"]


def _login(client: TestClient) -> None:
    response = client.post(
        "/api/v1/admin/login",
        json={"username": ADMIN_IDENTITY_EMAIL, "password": _admin_password()},
        headers={"X-CSRF-Token": _csrf(client)},
    )
    assert response.status_code == 200


def test_admin_can_list_and_activate_pending_instance_without_exposing_credentials() -> None:
    client = _client()
    registered = client.post(
        "/api/v1/instances/register",
        json={
            "client_type": "ANDROID",
            "device_fingerprint": "device-1",
            "display_name": "Telefon",
        },
    )
    instance_id = registered.json()["instance_id"]
    _login(client)

    pending = client.get("/api/v1/admin/instances", params={"status": "PENDING"})
    assert pending.status_code == 200
    assert pending.json()["data"] == [
        {
            "id": instance_id,
            "client_type": "ANDROID",
            "status": "PENDING",
            "display_name": "Telefon",
            "created_at": pending.json()["data"][0]["created_at"],
            "last_seen_at": pending.json()["data"][0]["last_seen_at"],
        }
    ]
    assert "token" not in str(pending.json()).lower()

    missing_csrf = client.post(f"/api/v1/admin/instances/{instance_id}/activate", json={})
    assert missing_csrf.status_code == 403
    activated = client.post(
        f"/api/v1/admin/instances/{instance_id}/activate",
        json={"display_name": "  Služební telefon  "},
        headers={"X-CSRF-Token": _csrf(client)},
    )
    assert activated.status_code == 200
    assert activated.json()["status"] == "ACTIVE"
    assert activated.json()["display_name"] == "Služební telefon"
    assert "token" not in str(activated.json()).lower()

    claimed = client.post(f"/api/v1/instances/{instance_id}/claim-token")
    assert claimed.status_code == 200
    assert claimed.json()["instance_token"]

    conflict = client.post(
        f"/api/v1/admin/instances/{instance_id}/activate",
        json={},
        headers={"X-CSRF-Token": _csrf(client)},
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "instance_activation_conflict"

    claimed_again = client.post(f"/api/v1/instances/{instance_id}/claim-token")
    assert claimed_again.status_code == 200
    assert claimed_again.json()["instance_token"] != claimed.json()["instance_token"]
