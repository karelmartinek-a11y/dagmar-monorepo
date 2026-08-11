from __future__ import annotations

import logging
import os
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient

os.environ.setdefault("DAGMAR_DATABASE_URL", "sqlite+pysqlite:///:memory:")
os.environ.setdefault("DAGMAR_SESSION_SECRET", "x" * 32)

from app.main import _deployed_backend_tag, app
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


def test_deploy_tag_fallback_logs_path_and_error_type_without_file_content(
    monkeypatch, caplog
) -> None:
    monkeypatch.setattr(
        Path,
        "read_text",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError("secret-content")),
    )
    caplog.set_level(logging.WARNING, logger="app.main")
    assert _deployed_backend_tag(SimpleNamespace(deploy_tag="fallback")) == "fallback"
    assert "backend-version.json" in caplog.text
    assert "OSError" in caplog.text
    assert "secret-content" not in caplog.text
