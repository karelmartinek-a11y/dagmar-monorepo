"""Actual native ORM and signed boundary; no mail/provider calls."""
import json
import time
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, delete, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from test_cml_web import assertion, fixture_key

from app.db.models import Base, CmlProfileProvision, PortalUser
from app.security.cml_web import CmlWebBoundary
from app.services.cml_profiles import ProfileFault, ProfileProvisioner

SOURCE = "dochazka"


@pytest.fixture
def profiles():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    names = ["portal_users", "cml_profile_provision", "cml_web_nonce"]
    names += ["portal_user_roles"] if SOURCE == "hotel" else ["instances"]
    Base.metadata.create_all(engine, tables=[Base.metadata.tables[name] for name in names])
    factory = sessionmaker(bind=engine)
    yield factory, ProfileProvisioner(factory)
    engine.dispose()


def payload():
    profile = {"first_name": "Testovací", "last_name": "Profil", "email": "new-profile@example.invalid", "roles": ["recepce"]} if SOURCE == "hotel" else {"name": "Testovací Profil", "email": "new-profile@example.invalid", "role": "employee"}
    return {"operation_id": str(uuid4()), "central_user_id": str(uuid4()), "profile": profile}


def create(service, value):
    return service.create(json.dumps(value).encode())


def counts(factory):
    with factory() as db:
        result = [db.scalar(select(func.count()).select_from(model)) for model in (PortalUser, CmlProfileProvision)]
        if SOURCE != "hotel":
            from app.db.models import Instance
            result.append(db.scalar(select(func.count()).select_from(Instance)))
        return result


def test_profile_and_receipt_are_atomic_and_recovery_never_adopts_email(profiles, monkeypatch):
    factory, service = profiles
    value = payload()
    # Native onboarding helpers are intentionally outside this DB-only contract.
    if SOURCE == "hotel":
        monkeypatch.setattr("app.api.routes.users.send_portal_onboarding", lambda **_: pytest.fail("Native mail must not run"))
    first = create(service, value)
    assert first["state"] == "confirmed"
    assert first["native_id"].isdigit()
    assert "password" not in json.dumps(first)
    assert service.read(value["operation_id"]) == first
    assert create(service, value) == first
    assert counts(factory) == ([1, 1] if SOURCE == "hotel" else [1, 1, 1])
    value["profile"]["email"] = "changed@example.invalid"
    with pytest.raises(ProfileFault, match="PROFILE_OPERATION_CONFLICT"):
        create(service, value)
    conflicting = payload()
    with pytest.raises(ProfileFault, match="PROFILE_EMAIL_EXISTS"):
        create(service, conflicting)
    assert counts(factory) == ([1, 1] if SOURCE == "hotel" else [1, 1, 1])
    with factory() as db:
        user = db.get(PortalUser, int(first["native_id"]))
        assert bool(user.password_hash) == (SOURCE == "hotel")
        if SOURCE == "dochazka":
            assert user.instance.client_type.value == "WEB"
            assert first["profile"]["instance_active"]


def test_receipt_survives_profile_removal_without_recreation(profiles):
    factory, service = profiles
    value = payload()
    first = create(service, value)
    with factory() as db:
        db.execute(delete(PortalUser).where(PortalUser.id == int(first["native_id"])))
        db.commit()
    # No FK/cascade can remove the creation identity. No automatic new profile.
    assert create(service, value)["state"] == "unavailable"
    assert service.read(value["operation_id"])["profile"] is None
    assert counts(factory)[:2] == [0, 1]


@pytest.mark.parametrize("patch", [{"password": "not-accepted"}, {"native_id": "1"}, {"is_active": False}, {"role": "invented"}])
def test_invalid_profile_has_no_effect(profiles, patch):
    factory, service = profiles
    value = payload()
    value["profile"].update(patch)
    with pytest.raises(ProfileFault, match="PROFILE_INPUT_INVALID"):
        create(service, value)
    assert not any(counts(factory))


def test_failure_before_receipt_commit_leaves_no_partial_profile(profiles, monkeypatch):
    factory, service = profiles
    original = service._result
    monkeypatch.setattr(service, "_result", lambda *_: (_ for _ in ()).throw(RuntimeError("Synthetic DB result failure")))
    with pytest.raises(RuntimeError):
        create(service, payload())
    assert not any(counts(factory))
    monkeypatch.setattr(service, "_result", original)


def test_signed_profile_routes_reject_member_stale_auth_csrf_and_replay(profiles, tmp_path, monkeypatch):
    factory, _ = profiles
    key, jwks = fixture_key()
    keyfile = tmp_path / "jwks.json"
    keyfile.write_text(json.dumps(jwks))
    monkeypatch.setenv("CML_WEB_JWKS_PATH", str(keyfile))
    boundary = CmlWebBoundary(FastAPI(), audience=SOURCE, session_factory=factory,
        resolve_identity=lambda *_: {"public": {"admin": True}}, ui_root=tmp_path)
    value = payload()
    body = json.dumps(value).encode()
    path = "/cml-web/api/profiles"
    def headers(**patch):
        return {"Origin": "https://kajovocml.hcasc.cz", "X-CML-Web-Prefix": "/sections/" + SOURCE + "/",
            "X-CSRF-Token": "a" * 43, "Content-Type": "application/json",
            "X-CML-Web-Assertion": assertion(key, SOURCE, path=path, body=body,
                reauthUntil=int(time.time()) + 60, **patch)}
    with TestClient(boundary) as client:
        assert client.post(path, headers=headers(sub="user:" + str(uuid4()), nativeId="1", role="member"), content=body).status_code == 401
        expired = headers()
        expired["X-CML-Web-Assertion"] = assertion(key, SOURCE, path=path, body=body, reauthUntil=int(time.time()) - 1)
        assert client.post(path, headers=expired, content=body).status_code == 403
        assert client.post(path, headers={**headers(), "X-CSRF-Token": "wrong"}, content=body).status_code == 401
        assert not any(counts(factory))
        signed = headers()
        response = client.post(path, headers=signed, content=body)
        assert response.status_code == 200, response.text
        assert client.post(path, headers=signed, content=body).status_code == 401
        readpath = path + "/" + value["operation_id"]
        readheaders = headers()
        readheaders["X-CML-Web-Assertion"] = assertion(key, SOURCE, path=readpath, method="GET", body=b"")
        read = client.get(readpath, headers=readheaders)
        assert read.status_code == 200
        assert read.json() == response.json()
        assert read.headers["cache-control"] == "no-store"
        assert counts(factory)[:2] == [1, 1]


def test_actual_postgres_two_workers_leave_one_profile_and_receipt():
    import os
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from sqlalchemy import text
    from sqlalchemy.engine import make_url

    raw = os.getenv("CML_PROFILE_TEST_DATABASE_URL")
    if not raw:
        pytest.skip("Explicit local PostgreSQL profile test database required")
    url = make_url(raw)
    assert url.drivername.startswith("postgresql") and url.host in {"127.0.0.1", "localhost"}
    assert url.database and url.database.endswith("_test")
    schema = "profiles_" + uuid4().hex
    admin = create_engine(url, isolation_level="AUTOCOMMIT")
    with admin.connect() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    try:
        names = ["portal_users", "cml_profile_provision", "portal_user_roles"] if SOURCE == "hotel" else ["instances", "portal_users", "cml_profile_provision"]
        Base.metadata.create_all(engine, tables=[Base.metadata.tables[name] for name in names])
        factory = sessionmaker(bind=engine)
        barrier = Barrier(2)
        value = payload()
        def worker():
            service = ProfileProvisioner(factory)
            barrier.wait(timeout=10)
            return create(service, value)
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: worker(), range(2)))
        assert results[0] == results[1]
        assert counts(factory) == ([1, 1] if SOURCE == "hotel" else [1, 1, 1])
    finally:
        engine.dispose()
        with admin.connect() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()
