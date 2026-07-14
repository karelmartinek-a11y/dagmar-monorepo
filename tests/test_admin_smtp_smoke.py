from __future__ import annotations

import smtplib

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import require_admin
from app.api.v1 import admin_smtp
from app.config import Settings
from app.db.models import AppSettings, Base
from app.security.csrf import require_csrf


def test_admin_smtp_get_never_leaks_password() -> None:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(bind=engine)

    with SessionLocal() as db:
        db.add(AppSettings(id=1, afternoon_cutoff_minutes=17 * 60, smtp_password="top-secret"))
        db.commit()

    app = FastAPI()
    app.include_router(admin_smtp.router)

    def override_db():
        db: Session = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[admin_smtp.get_db] = override_db
    app.dependency_overrides[require_admin] = lambda: {"ok": True}

    client = TestClient(app)
    response = client.get("/api/v1/admin/smtp")
    assert response.status_code == 200
    payload = response.json()
    assert payload["password_set"] is True
    assert "password" not in payload


def _build_smtp_client():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(bind=engine)

    app = FastAPI()
    app.include_router(admin_smtp.router)

    def override_db():
        db: Session = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    test_settings = Settings(
        database_url="sqlite+pysqlite:///:memory:",
        session_secret="x" * 32,
        csrf_secret="y" * 32,
        smtp_password_secret="z" * 32,
    )
    app.dependency_overrides[admin_smtp.get_db] = override_db
    app.dependency_overrides[admin_smtp.get_settings] = lambda: test_settings
    app.dependency_overrides[require_csrf] = lambda: None
    client = TestClient(app)
    return client, SessionLocal, app


def test_admin_smtp_test_returns_step_trace_on_success(monkeypatch) -> None:
    client, session_local, app = _build_smtp_client()
    app.dependency_overrides[require_admin] = lambda: {"username": "admin@example.com"}

    class FakeSmtp:
        def __init__(self, host: str, port: int, timeout: int):
            self.host = host
            self.port = port
            self.timeout = timeout

        def ehlo(self):
            return None

        def login(self, username: str, password: str):
            assert username == "mailer@example.com"
            assert password == "secret-pass"

        def send_message(self, message):
            assert message["To"] == "admin@example.com"
            assert message["From"] == "Dagmar <sender@example.com>"

        def quit(self):
            return None

    monkeypatch.setattr(admin_smtp.socket, "create_connection", lambda *args, **kwargs: _FakeSocket())
    monkeypatch.setattr(admin_smtp.smtplib, "SMTP_SSL", FakeSmtp)

    response = client.post(
        "/api/v1/admin/smtp/test",
        json={
            "host": "smtp.example.com",
            "port": 465,
            "security": "SSL",
            "username": "mailer@example.com",
            "password": "secret-pass",
            "from_email": "sender@example.com",
            "from_name": "Dagmar",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["target_email"] == "admin@example.com"
    assert [step["status"] for step in payload["steps"]] == ["success"] * 8


def test_admin_smtp_test_reports_missing_admin_email() -> None:
    client, _, app = _build_smtp_client()
    app.dependency_overrides[require_admin] = lambda: {"username": "admin-bez-mailu"}

    response = client.post(
        "/api/v1/admin/smtp/test",
        json={"host": "smtp.example.com", "port": 465, "security": "SSL", "from_email": "sender@example.com"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "admin_email_missing"
    assert "nemá nastavený e-mail" in payload["error"]["message_cs"]
    assert payload["steps"][0]["status"] == "error"


def test_admin_smtp_test_maps_authentication_failure(monkeypatch) -> None:
    client, _, app = _build_smtp_client()
    app.dependency_overrides[require_admin] = lambda: {"username": "admin@example.com"}

    class FakeSmtp:
        def __init__(self, host: str, port: int, timeout: int):
            self.host = host
            self.port = port
            self.timeout = timeout

        def ehlo(self):
            return None

        def login(self, username: str, password: str):
            raise smtplib.SMTPAuthenticationError(535, b"bad credentials")

        def quit(self):
            return None

    monkeypatch.setattr(admin_smtp.socket, "create_connection", lambda *args, **kwargs: _FakeSocket())
    monkeypatch.setattr(admin_smtp.smtplib, "SMTP_SSL", FakeSmtp)

    response = client.post(
        "/api/v1/admin/smtp/test",
        json={
            "host": "smtp.example.com",
            "port": 465,
            "security": "SSL",
            "username": "mailer@example.com",
            "password": "wrong-pass",
            "from_email": "sender@example.com",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "smtp_auth_failed"
    assert "odmítl přihlašovací údaje" in payload["error"]["message_cs"]
    assert any(step["key"] == "auth" and step["status"] == "error" for step in payload["steps"])


class _FakeSocket:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False
