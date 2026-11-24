"""SDK requests through the public and signed CML paths of Docházka."""

from __future__ import annotations

import asyncio
import hashlib
import json
import uuid
from datetime import date
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import httpx2
from fastapi import FastAPI
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.attendance_mcp import AUTH_METADATA, AttendanceMCP
from app.db.models import (
    Attendance,
    Base,
    Employment,
    EmploymentType,
    PortalUser,
    PortalUserRole,
    ShiftPlan,
)
from app.security.attendance_oauth import CML, ISSUER, ORIGIN, READ_SCOPE, RESOURCE
from app.security.cml_web import CmlWebBoundary
from app.services.cml_identity import resolve_identity
from app.services.employment_groups import create_group
from tests.test_cml_browser_entry import _client
from tests.test_cml_web import assertion, b64, fixture_key


def _signed(key, path, method, body, **claims):
    return {
        "Origin": CML,
        "Content-Type": "application/json",
        "X-CML-Web-Prefix": "/sections/dochazka/",
        "X-CML-Web-Assertion": assertion(
            key, "dochazka", path=path, method=method, body=body, **claims
        ),
        "X-CSRF-Token": "a" * 43,
    }


def _prepare(monkeypatch, tmp_path, factory):
    key, jwks = fixture_key()
    keyfile = tmp_path / "cml-mcp-jwks.json"
    keyfile.write_text(json.dumps(jwks))
    monkeypatch.setenv("CML_WEB_JWKS_PATH", str(keyfile))
    app = FastAPI()
    mcp = AttendanceMCP(factory)
    app.router.routes.extend(mcp.routes())
    app.add_middleware(
        CmlWebBoundary,
        audience="dochazka",
        session_factory=factory,
        resolve_identity=resolve_identity,
        ui_root=Path(__file__).resolve().parents[1] / "app/web_ui",
        attendance_oauth=mcp.provider,
    )
    return app, mcp, key


def test_owner_oauth_mcp_pkce_audience_and_revocation(tmp_path, monkeypatch):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    app, mcp, key = _prepare(monkeypatch, tmp_path, sessionmaker(bind=engine))
    callback = "https://chatgpt.com/connector/oauth/attendance-test"

    async def run():
        async with (
            mcp.transport.router.lifespan_context(app),
            httpx2.AsyncClient(
                transport=httpx2.ASGITransport(app),
                base_url=ORIGIN,
            ) as http,
        ):
            unauth = await http.post("/mcp", json={})
            assert unauth.status_code == 401
            assert RESOURCE.removesuffix("/mcp") in unauth.headers["www-authenticate"]
            assert (await http.get(AUTH_METADATA)).json()[
                "authorization_endpoint"
            ] == ISSUER + "/authorize"
            registration = await http.post(
                ISSUER + "/register",
                json={
                    "redirect_uris": [callback],
                    "token_endpoint_auth_method": "none",
                    "grant_types": ["authorization_code", "refresh_token"],
                    "response_types": ["code"],
                    "scope": READ_SCOPE,
                },
            )
            assert registration.status_code == 201
            client_id = registration.json()["client_id"]
            verifier = "v" * 50
            started = await http.get(
                ISSUER + "/authorize",
                params={
                    "client_id": client_id,
                    "response_type": "code",
                    "redirect_uri": callback,
                    "scope": READ_SCOPE,
                    "resource": RESOURCE,
                    "code_challenge_method": "S256",
                    "code_challenge": b64(hashlib.sha256(verifier.encode()).digest()),
                },
            )
            assert started.status_code == 302
            ticket = parse_qs(urlsplit(started.headers["location"]).query)["ticket"][0]
            url = "/cml-web/oauth/consent"
            body = json.dumps({"ticket": ticket}).encode()
            owner = {"authzPolicy": "owner-no-additional-prompts/1"}
            visible = await http.get(
                url + "?ticket=" + ticket,
                headers=_signed(
                    key,
                    url + "?ticket=" + ticket,
                    "GET",
                    b"",
                    **owner,
                ),
            )
            assert visible.status_code == 200 and "čtení docházky" in visible.text
            approved = await http.post(
                url, content=body, headers=_signed(key, url, "POST", body, **owner)
            )
            assert approved.status_code == 200
            code = parse_qs(urlsplit(approved.json()["redirect"]).query)["code"][0]
            denied = await http.post(
                url, content=body, headers=_signed(key, url, "POST", body, **owner)
            )
            assert denied.status_code == 400
            payload = {
                "grant_type": "authorization_code",
                "client_id": client_id,
                "code": code,
                "redirect_uri": callback,
                "code_verifier": verifier,
                "resource": RESOURCE,
            }
            assert (
                await http.post(ISSUER + "/token", data={**payload, "resource": ORIGIN})
            ).status_code == 400
            exchange = await http.post(ISSUER + "/token", data=payload)
            assert exchange.status_code == 200
            token = exchange.json()
            assert (await http.post(ISSUER + "/token", data=payload)).status_code == 400
            http.headers["Authorization"] = "Bearer " + token["access_token"]
            async with streamable_http_client(RESOURCE, http_client=http) as (reader, writer, *_):
                async with ClientSession(reader, writer) as sdk:
                    await sdk.initialize()
                    names = {tool.name for tool in (await sdk.list_tools()).tools}
                    assert names == {
                        "attendance_employments_list",
                        "attendance_month_get",
                        "shift_groups_list",
                        "shift_group_month_get",
                    }
                    rows = await sdk.call_tool(
                        "attendance_employments_list", {"year": 2026, "month": 11}
                    )
                    assert rows.structured_content == {"items": [], "next_after": None}
            refresh_payload = {
                "grant_type": "refresh_token",
                "client_id": client_id,
                "refresh_token": token["refresh_token"],
                "resource": RESOURCE,
            }
            assert (
                await http.post(
                    ISSUER + "/token", data={**refresh_payload, "scope": "attendance:manage"}
                )
            ).status_code == 400
            refreshed = await http.post(ISSUER + "/token", data=refresh_payload)
            assert refreshed.status_code == 200
            assert (await http.post("/mcp", json={})).status_code == 401
            token = refreshed.json()
            http.headers["Authorization"] = "Bearer " + token["access_token"]
            revoked = await http.post(
                ISSUER + "/revoke",
                data={
                    "client_id": client_id,
                    "token": token["refresh_token"],
                    "token_type_hint": "refresh_token",
                },
            )
            assert revoked.status_code == 200
            assert (await http.post("/mcp", json={})).status_code == 401

    asyncio.run(run())


def test_signed_member_mcp_only_sees_granted_attendance_and_planned_group_data(
    tmp_path, monkeypatch
):
    client, db, user = _client()
    try:
        factory = sessionmaker(bind=db.get_bind())
        app, mcp, key = _prepare(monkeypatch, tmp_path, factory)
        own = user.employments[0]
        colleague = PortalUser(
            email="colleague@example.invalid",
            name="Fixture colleague",
            role=PortalUserRole.EMPLOYEE,
            is_active=True,
        )
        peer = Employment(
            user=colleague,
            title="Peer",
            employment_type=EmploymentType.WORK_CONTRACT,
            start_date=date(2026, 1, 1),
            workload_fraction=1,
            night_hours_enabled=True,
        )
        db.add(peer)
        db.flush()
        group = create_group(db, name="Fixture plan", member_ids=[own.id, peer.id])
        db.add_all(
            [
                ShiftPlan(
                    employment_id=peer.id,
                    date=date(2026, 10, 1),
                    arrival_time="09:00",
                    departure_time="15:30",
                ),
                Attendance(employment_id=peer.id, date=date(2026, 10, 2), status="SICKNESS"),
            ]
        )
        db.commit()
        claims = {
            "sub": "user:" + str(uuid.uuid4()),
            "nativeId": str(user.id),
            "role": "member",
            "grant": {
                "contract": "kajovo-web-grant/1",
                "permissions": ["attendance.self"],
                "dataScope": {"kind": "employments", "employmentIds": [str(own.id)]},
            },
        }

        class Signed(httpx2.Auth):
            async def async_auth_flow(self, request):
                body = await request.aread()
                request.headers.update(
                    _signed(key, request.url.raw_path.decode(), request.method, body, **claims)
                )
                yield request

        async def run():
            async with (
                mcp.transport.router.lifespan_context(app),
                httpx2.AsyncClient(
                    transport=httpx2.ASGITransport(app),
                    auth=Signed(),
                    base_url=ORIGIN,
                ) as http,
            ):
                async with streamable_http_client(ORIGIN + "/cml-web/mcp", http_client=http) as (
                    read,
                    write,
                    *_,
                ):
                    async with ClientSession(read, write) as sdk:
                        await sdk.initialize()
                        period = {"year": 2026, "month": 10}
                        choices = await sdk.call_tool("attendance_employments_list", period)
                        assert [row["id"] for row in choices.structured_content["items"]] == [
                            own.id
                        ]
                        allowed = await sdk.call_tool(
                            "attendance_month_get", {**period, "employment_id": own.id}
                        )
                        assert not allowed.is_error and allowed.structured_content["days"] is None
                        denied = await sdk.call_tool(
                            "attendance_month_get", {**period, "employment_id": peer.id}
                        )
                        assert denied.is_error
                        plans = await sdk.call_tool(
                            "shift_group_month_get", {**period, "group_id": group.id}
                        )
                        assert not plans.is_error
                        colleague_plan = next(
                            r
                            for r in plans.structured_content["items"]
                            if r["employment_id"] == peer.id
                        )
                        assert colleague_plan["shifts"] == [
                            {
                                "date": "2026-10-01",
                                "arrival_time": "09:00",
                                "departure_time": "15:30",
                                "planned_status": None,
                            }
                        ]
                        assert "SICKNESS" not in json.dumps(plans.structured_content)

        asyncio.run(run())
    finally:
        client.close()
        db.close()
