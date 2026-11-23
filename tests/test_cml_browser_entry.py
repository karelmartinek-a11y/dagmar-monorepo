"""First-release browser cutover preserves original instance-token clients."""

import json
import uuid
from datetime import date

import pytest
from sqlalchemy.orm import sessionmaker

from app.config import ADMIN_IDENTITY_EMAIL
from app.db.models import (
    Attendance,
    Employment,
    EmploymentType,
    PortalUser,
    PortalUserRole,
    ShiftPlan,
)
from app.security.cml_web import CmlWebBoundary
from app.security.tokens import rotate_instance_token
from app.services.employment_groups import create_group, replace_members
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
        signed = {"Origin": "https://kajovocml.hcasc.cz", "X-CML-Web-Prefix": "/sections/dochazka/", "X-CML-Web-Assertion": assertion(key, "dochazka", path=path, method="GET", body=b"", sub="user:" + str(uuid.uuid4()), nativeId=str(user.id), role="member", grant={"contract":"kajovo-web-grant/1","permissions":["attendance.self"],"dataScope":{"kind":"employments","employmentIds":[str(e.id) for e in user.employments]}})}
        assert client.get(path).status_code == 401
        result = client.get(path, headers=signed)
        assert result.status_code == 200
        assert result.json()["display_name"] == user.name
        assert client.get(path, headers=signed).status_code == 401
        assert client.get("/api/v1/portal/session", headers=signed).status_code == 403
    finally:
        client.close()
        db.close()


def test_cml_member_groups_only_share_the_plan_inside_granted_memberships(tmp_path, monkeypatch):
    monkeypatch.setenv("CML_BROWSER_ENTRY_ONLY", "1")
    key, jwks = fixture_key()
    keyfile = tmp_path / "public.json"
    keyfile.write_text(json.dumps(jwks))
    monkeypatch.setenv("CML_WEB_JWKS_PATH", str(keyfile))
    client, db, user = _client()
    engine = db.get_bind()
    monkeypatch.setattr("app.db.session.get_sessionmaker", lambda: sessionmaker(bind=engine))
    try:
        granted = user.employments[0]
        coworker = PortalUser(
            email="coworker@example.invalid",
            name="Synthetic colleague",
            role=PortalUserRole.EMPLOYEE,
            is_active=True,
        )

        def employment(owner, title, starts=date(2026, 1, 1)):
            row = Employment(
                user=owner, title=title, employment_type=EmploymentType.WORK_CONTRACT,
                start_date=starts, workload_fraction=1, night_hours_enabled=True,
            )
            db.add(row)
            return row

        ungranted = employment(user, "Own employment outside the grant")
        future = employment(user, "Future employment", date(2026, 11, 1))
        peer = employment(coworker, "Group colleague")
        outsider = employment(coworker, "Outside the group")
        db.flush()
        visible = create_group(db, name="Granted group", member_ids=[granted.id, peer.id])
        hidden = create_group(db, name="Group outside the grant", member_ids=[ungranted.id, peer.id])
        foreign = create_group(db, name="Foreign group", member_ids=[peer.id, outsider.id])
        later = create_group(db, name="Future group", member_ids=[future.id, peer.id])
        db.add_all([
            ShiftPlan(employment_id=peer.id, date=date(2026, 10, 1), arrival_time="09:00", departure_time="15:30"),
            ShiftPlan(employment_id=peer.id, date=date(2026, 10, 2), status="OFF"),
            Attendance(employment_id=peer.id, date=date(2026, 10, 3), status="SICKNESS"),
        ])
        db.commit()
        subject = "user:" + str(uuid.uuid4())

        def signed(path, method="GET", owner=False):
            headers = {"Origin": "https://kajovocml.hcasc.cz", "X-CML-Web-Prefix": "/sections/dochazka/"}
            claims = {} if owner else {
                "sub": subject, "nativeId": str(user.id), "role": "member",
                "grant": {
                    "contract": "kajovo-web-grant/1", "permissions": ["attendance.self"],
                    "dataScope": {"kind": "employments", "employmentIds": [str(granted.id), str(future.id)]},
                },
            }
            headers["X-CML-Web-Assertion"] = assertion(key, "dochazka", path=path, method=method, body=b"", **claims)
            if method != "GET":
                headers["X-CSRF-Token"] = "a" * 43
            return client.request(method, path, headers=headers)

        manifest = "/cml-web/ui-manifest.json"
        member_views = signed(manifest).json()["views"]
        assert all(not view["admin"] for view in member_views)
        assert [view["path"] for view in member_views if view["id"] == "dochazka.employee.groups"] == [
            "/sections/dochazka/?view=groups"
        ]
        admin_views = signed(manifest, owner=True).json()["views"]
        assert "dochazka.admin.groups" in {view["id"] for view in admin_views}
        assert "dochazka.employee.groups" not in {view["id"] for view in admin_views}

        prefix, period = "/cml-web/api/v1/shift-plan/groups", "?year=2026&month=10"
        assert signed(prefix + period).json()["groups"] == [{"id": visible.id, "name": visible.name}]
        detail_path = f"{prefix}/{visible.id}{period}"
        detail = signed(detail_path)
        assert detail.status_code == 200
        rows = {row["employment_id"]: row for row in detail.json()["rows"]}
        assert set(rows) == {granted.id, peer.id}
        colleague = rows[peer.id]
        assert "Synthetic colleague" in colleague["display_label"]
        assert colleague["planned_hours"] == 6.5
        assert colleague["days"][0]["arrival_time"] == "09:00"
        assert colleague["days"][0]["departure_time"] == "15:30"
        assert colleague["days"][1]["effective_status"] == "OFF"
        assert colleague["days"][2]["effective_status"] is None
        assert colleague["days"][2]["status_metrics"]["sickness"] is None
        assert colleague["status_metrics"]["sickness"] is None

        missing = signed(f"{prefix}/9999{period}")
        assert missing.status_code == 404
        missing_error = missing.json()["error"]
        for group in (hidden, foreign, later):
            denied = signed(f"{prefix}/{group.id}{period}")
            assert denied.status_code == 404
            denied_error = denied.json()["error"]
            assert denied_error["code"] == missing_error["code"]
            assert denied_error["message"] == missing_error["message"]
        assert signed(detail_path, "PUT").status_code == 401
        assert signed("/cml-web/api/v1/admin/employment-groups").status_code == 401
        assert signed(f"/cml-web/api/v1/attendance{period}&employment_id={peer.id}").status_code == 404

        replace_members(db, group_id=visible.id, member_ids=[peer.id, outsider.id])
        db.commit()
        assert signed(prefix + period).json()["groups"] == []
        assert signed(detail_path).status_code == 404
    finally:
        client.close()
        db.close()


def test_invalid_browser_cutover_flag_fails_startup(tmp_path, monkeypatch):
    from fastapi import FastAPI

    monkeypatch.setenv("CML_BROWSER_ENTRY_ONLY", "invalid")
    monkeypatch.delenv("CML_WEB_JWKS_PATH", raising=False)
    with pytest.raises(RuntimeError, match="CML_BROWSER_ENTRY_ONLY"):
        CmlWebBoundary(FastAPI(), audience="dochazka", session_factory=None, resolve_identity=None, ui_root=tmp_path)
