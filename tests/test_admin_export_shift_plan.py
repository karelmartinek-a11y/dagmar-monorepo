from __future__ import annotations

import os
from datetime import UTC, date, datetime
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import ADMIN_IDENTITY_EMAIL, Settings, get_settings
from app.db.models import Base, Employment, PortalUser, PortalUserRole, ShiftPlan
from app.security.passwords import hash_password
from app.security.rate_limit import limiter


def _build_client(tmp_path: Path) -> tuple[TestClient, sessionmaker[Session]]:
    database_url = f"sqlite:///{(tmp_path / 'admin-shift-plan-export.db').as_posix()}"
    get_settings.cache_clear()
    os.environ["DAGMAR_DATABASE_URL"] = database_url
    os.environ["DAGMAR_SESSION_SECRET"] = "x" * 32
    os.environ["DAGMAR_CSRF_SECRET"] = "y" * 32
    settings = Settings(
        database_url=database_url,
        session_secret="x" * 32,
        csrf_secret="y" * 32,
        admin_password_hash=hash_password("StrongPass123").value,
        rate_limit_enabled=False,
        disable_docs=True,
    )

    import app.db.session as db_session_module

    db_session_module._engine = None
    db_session_module._SessionLocal = None
    limiter.reset()

    from app.main import create_app

    app = create_app(settings=settings)
    app.dependency_overrides[get_settings] = lambda: settings

    engine = create_engine(database_url)
    Base.metadata.create_all(bind=engine)
    testing_session_local = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    return TestClient(app, base_url="https://dagmar.hcasc.cz"), testing_session_local


def _csrf_headers(client: TestClient) -> dict[str, str]:
    csrf_response = client.get("/api/v1/admin/csrf")
    assert csrf_response.status_code == 200
    return {"X-CSRF-Token": csrf_response.json()["csrf_token"]}


def _login_admin(client: TestClient) -> dict[str, str]:
    headers = _csrf_headers(client)
    response = client.post(
        "/api/v1/admin/login",
        json={"username": ADMIN_IDENTITY_EMAIL, "password": "StrongPass123"},
        headers=headers,
    )
    assert response.status_code == 200
    return headers


def _seed_shift_plan_rows(db: Session, *, count: int) -> list[int]:
    employment_ids: list[int] = []
    for index in range(count):
        user = PortalUser(
            email=f"employee{index}@example.cz",
            name=f"Zaměstnanec {index + 1}",
            role=PortalUserRole.EMPLOYEE,
            password_hash="hash",
            is_active=True,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        db.add(user)
        db.flush()
        employment = Employment(
            user_id=user.id,
            title=f"Úvazek {index + 1}",
            employment_type="HPP" if index % 2 == 0 else "DPP_DPC",
            start_date=date(2026, 1, 1),
            end_date=None,
            is_active=True,
        )
        db.add(employment)
        db.flush()
        db.add_all(
            [
                ShiftPlan(
                    employment_id=employment.id,
                    instance_id=None,
                    date=date(2026, 7, 1),
                    arrival_time="08:00",
                    departure_time="16:00",
                    status=None,
                ),
                ShiftPlan(
                    employment_id=employment.id,
                    instance_id=None,
                    date=date(2026, 7, 2),
                    arrival_time=None,
                    departure_time=None,
                    status="OFF" if index % 2 == 0 else "HOLIDAY",
                ),
            ]
        )
        employment_ids.append(employment.id)
    db.commit()
    return employment_ids


def test_shift_plan_report_requires_admin_session(tmp_path: Path) -> None:
    client, session_local = _build_client(tmp_path)
    with session_local() as db:
        employment_ids = _seed_shift_plan_rows(db, count=1)

    response = client.post(
        "/api/v1/admin/export/shift-plan/report",
        json={"year": 2026, "month": 7, "employment_ids": employment_ids},
    )
    assert response.status_code == 401


def test_shift_plan_report_rejects_missing_csrf_and_empty_selection(tmp_path: Path) -> None:
    client, session_local = _build_client(tmp_path)
    with session_local() as db:
        _seed_shift_plan_rows(db, count=1)

    _login_admin(client)
    missing_csrf = client.post(
        "/api/v1/admin/export/shift-plan/report",
        json={"year": 2026, "month": 7, "employment_ids": [1]},
        headers={"X-CSRF-Token": "neplatny-token"},
    )
    assert missing_csrf.status_code == 403

    headers = _csrf_headers(client)
    empty = client.post(
        "/api/v1/admin/export/shift-plan/report",
        json={"year": 2026, "month": 7, "employment_ids": []},
        headers=headers,
    )
    assert empty.status_code == 400
    assert "alespoň jeden úvazek" in empty.json()["detail"]


def test_shift_plan_report_paginates_after_five_employments(tmp_path: Path) -> None:
    client, session_local = _build_client(tmp_path)
    with session_local() as db:
        employment_ids = _seed_shift_plan_rows(db, count=6)

    headers = _login_admin(client)
    response = client.post(
        "/api/v1/admin/export/shift-plan/report",
        json={"year": 2026, "month": 7, "employment_ids": employment_ids},
        headers=headers,
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["page_count"] == 2
    assert len(payload["pages"][0]["employments"]) == 5
    assert len(payload["pages"][1]["employments"]) == 1
    assert len(payload["day_headers"]) == 31
    assert payload["pages"][0]["employments"][0]["employment_id"] == employment_ids[0]
    assert payload["pages"][1]["employments"][0]["employment_id"] == employment_ids[5]
    assert payload["pages"][0]["employments"][0]["cells"][1]["status"] in {"OFF", "HOLIDAY"}


def test_shift_plan_pdf_returns_real_pdf_bytes(tmp_path: Path) -> None:
    client, session_local = _build_client(tmp_path)
    with session_local() as db:
        employment_ids = _seed_shift_plan_rows(db, count=6)

    headers = _login_admin(client)
    response = client.post(
        "/api/v1/admin/export/shift-plan/pdf",
        json={"year": 2026, "month": 7, "employment_ids": employment_ids},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/pdf")
    assert 'filename="plan_smen_2026-07.pdf"' in response.headers["content-disposition"]
    assert response.content.startswith(b"%PDF")
    assert len(response.content) > 20_000
