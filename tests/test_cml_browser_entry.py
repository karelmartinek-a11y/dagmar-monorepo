"""First-release browser cutover preserves original instance-token clients."""

import json
import uuid

import pytest
from sqlalchemy.orm import sessionmaker

from app.config import ADMIN_IDENTITY_EMAIL
from app.security.cml_web import CmlWebBoundary
from app.security.tokens import rotate_instance_token
from tests.test_admin_auth import _admin_password, _build_client, _csrf_headers
from tests.test_cml_web import assertion, fixture_key
from tests.test_portal_cookie_auth import _client, _login


def test_original_admin_cookie_cannot_bypass_cml_business_access(monkeypatch):
    monkeypatch.setenv("CML_BROWSER_ENTRY_ONLY", "1")
    client = _build_client()
    try:
        headers = _csrf_headers(client)
        assert client.post("/api/v1/admin/login", json={"username": ADMIN_IDENTITY_EMAIL, "password": _admin_password()}, headers=headers).status_code == 200
        assert client.get("/api/v1/admin/users").status_code == 403
        assert client.post("/api/v1/admin/users", json={}, headers=headers).status_code == 403
        assert client.get("/api/v1/admin/users", headers={"X-CML-Web-Assertion": "not-a-verified-server-state"}).status_code == 403
    finally:
        client.close()


@pytest.mark.parametrize("browser_headers", [{"Sec-Fetch-Site": "same-origin"}, {"Sec-Fetch-Mode": "cors"}, {"Sec-Fetch-Dest": "empty"}, {"Origin": "https://dagmar.hcasc.cz"}, {"User-Agent": "Mozilla/5.0 Safari/605.1"}])
def test_browser_cookie_and_bearer_cannot_bypass_current_cml_grants(monkeypatch, browser_headers):
    monkeypatch.setenv("CML_BROWSER_ENTRY_ONLY", "1")
    client, db, user = _client()
    try:
        assert _login(client).status_code == 200
        assert client.get("/api/v1/portal/session").status_code == 403
        token = rotate_instance_token(db, user.instance)
        db.commit()
        native = client.get("/api/v1/portal/session", headers={"Authorization": "Bearer " + token, "User-Agent": "KajovoAttendanceNative/1"})
        assert native.status_code == 200
        assert client.get("/api/v1/portal/session", headers={"Authorization": "Bearer " + token, **browser_headers}).status_code == 403
        assert client.get("/api/v1/portal/session", headers={"X-CML-Web-Assertion": "forged", **browser_headers}).status_code == 403
    finally:
        client.close()
        db.close()


def test_signed_cml_uses_original_identity_and_data_after_browser_cutover(tmp_path, monkeypatch):
    monkeypatch.setenv("CML_BROWSER_ENTRY_ONLY", "1")
    key, jwks = fixture_key()
    keyfile = tmp_path / "public.json"
    keyfile.write_text(json.dumps(jwks))
    monkeypatch.setenv("CML_WEB_JWKS_PATH", str(keyfile))
    client, db, user = _client()
    engine = db.get_bind()
    monkeypatch.setattr("app.db.session.get_sessionmaker", lambda: sessionmaker(bind=engine))
    try:
        path = "/cml-web/api/v1/portal/session"
        signed = {"Origin": "https://kajovocml.hcasc.cz", "X-CML-Web-Prefix": "/sections/dochazka/", "X-CML-Web-Assertion": assertion(key, "dochazka", path=path, method="GET", body=b"", sub="user:" + str(uuid.uuid4()), nativeId=str(user.id), role="member")}
        assert client.get(path).status_code == 401
        result = client.get(path, headers=signed)
        assert result.status_code == 200
        assert result.json()["display_name"] == user.name
        assert client.get(path, headers=signed).status_code == 401
        assert client.get("/api/v1/portal/session", headers=signed).status_code == 403
    finally:
        client.close()
        db.close()


def test_invalid_browser_cutover_flag_fails_startup(tmp_path, monkeypatch):
    from fastapi import FastAPI

    monkeypatch.setenv("CML_BROWSER_ENTRY_ONLY", "invalid")
    monkeypatch.delenv("CML_WEB_JWKS_PATH", raising=False)
    with pytest.raises(RuntimeError, match="CML_BROWSER_ENTRY_ONLY"):
        CmlWebBoundary(FastAPI(), audience="dochazka", session_factory=None, resolve_identity=None, ui_root=tmp_path)
