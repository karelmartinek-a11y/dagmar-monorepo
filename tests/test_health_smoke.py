from __future__ import annotations

import os

from starlette.testclient import TestClient

os.environ.setdefault("DAGMAR_DATABASE_URL", "sqlite+pysqlite:///:memory:")
os.environ.setdefault("DAGMAR_SESSION_SECRET", "x" * 32)

from app.main import app
from app.services.readiness import ReadinessStatus


def test_health_v1_smoke() -> None:
    client = TestClient(app)
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_time_v1_smoke() -> None:
    client = TestClient(app)
    response = client.get("/api/v1/time")
    assert response.status_code == 200
    payload = response.json()
    assert payload["timezone"] == "Europe/Prague"
    assert payload["source"] == "server"
    assert "datetime" in payload


def test_readiness_returns_safe_success(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.main.check_readiness",
        lambda: ReadinessStatus(True, True, True, "head", "head"),
    )
    response = TestClient(app).get("/api/v1/readiness")
    assert response.status_code == 200
    assert response.json() == {"ok": True, "status": "ready"}


def test_readiness_returns_safe_503_for_revision_mismatch(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.main.check_readiness",
        lambda: ReadinessStatus(False, True, False, "expected-secret", "old-secret"),
    )
    response = TestClient(app).get("/api/v1/readiness")
    assert response.status_code == 503
    assert response.json() == {"ok": False, "status": "not_ready"}
    assert "expected-secret" not in response.text
    assert "old-secret" not in response.text


def test_readiness_returns_safe_503_when_database_is_unavailable(monkeypatch) -> None:
    def unavailable() -> ReadinessStatus:
        raise RuntimeError("postgresql://secret@database.internal/dagmar")

    monkeypatch.setattr("app.main.check_readiness", unavailable)
    response = TestClient(app, raise_server_exceptions=False).get("/api/v1/readiness")
    assert response.status_code == 503
    assert response.json() == {"ok": False, "status": "not_ready"}
    assert "secret" not in response.text
