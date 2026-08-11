from __future__ import annotations

import os

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

os.environ.setdefault("DAGMAR_DATABASE_URL", "sqlite+pysqlite:///:memory:")
os.environ.setdefault("DAGMAR_SESSION_SECRET", "x" * 32)

from app.config import get_settings
from app.db.models import Base
from app.db.session import get_db
from app.main import create_app


def _client() -> TestClient:
    get_settings.cache_clear()
    settings = get_settings.__wrapped__(env_file="missing.env")
    settings.database_url = "sqlite+pysqlite:///:memory:"
    settings.session_secret = "x" * 32
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
    return TestClient(app, raise_server_exceptions=False)


def _assert_envelope(response, status_code: int, code: str) -> None:
    assert response.status_code == status_code
    assert set(response.json()) == {"error"}
    error = response.json()["error"]
    assert error["code"] == code
    assert isinstance(error["message"], str) and error["message"]
    assert error["request_id"] == response.headers["x-request-id"]


def test_validation_not_found_and_auth_errors_share_one_envelope() -> None:
    client = _client()
    validation = client.post("/api/v1/instances/register", json={})
    _assert_envelope(validation, 400, "invalid_request")
    assert validation.json()["error"]["details"]

    _assert_envelope(client.get("/api/v1/does-not-exist"), 404, "not_found")
    _assert_envelope(client.get("/api/v1/admin/users"), 401, "not_authenticated")


def test_unhandled_api_exception_is_redacted_and_has_request_id() -> None:
    app = _client().app

    def explode() -> None:
        raise RuntimeError("sensitive internal value")

    app.add_api_route("/api/v1/test-internal-error", explode)
    response = TestClient(app, raise_server_exceptions=False).get("/api/v1/test-internal-error")
    _assert_envelope(response, 500, "internal_error")
    assert "sensitive" not in str(response.json())
