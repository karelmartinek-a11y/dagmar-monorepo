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
import pytest
from fastapi import FastAPI
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.attendance_mcp import (
    ADMIN_READ_TOOLS,
    ADMIN_WRITE_TOOLS,
    AUTH_METADATA,
    MANAGE_TOOLS,
    AttendanceMCP,
)
from app.api.v1 import admin_export
from app.db.models import (
    Attendance,
    AttendanceMCPExport,
    Base,
    Employment,
    EmploymentType,
    PortalUser,
    PortalUserRole,
    ShiftPlan,
)
from app.db.session import get_db
from app.security.attendance_oauth import (
    CML,
    ISSUER,
    MANAGE_SCOPE,
    ORIGIN,
    OWNER,
    READ_SCOPE,
    RESOURCE,
)
from app.security.cml_web import CmlWebBoundary
from app.security.rate_limit import init_rate_limiting
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
    init_rate_limiting(app)
    mcp = AttendanceMCP(factory)
    app.router.routes.extend(mcp.routes())
    app.include_router(admin_export.router)

    def db_override():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = db_override
    app.add_middleware(
        CmlWebBoundary,
        audience="dochazka",
        session_factory=factory,
        resolve_identity=resolve_identity,
        ui_root=Path(__file__).resolve().parents[1] / "app/web_ui",
        attendance_oauth=mcp.provider,
    )
    return app, mcp, key


@pytest.mark.parametrize("manage", [False, True])
def test_owner_oauth_mcp_pkce_audience_and_revocation(tmp_path, monkeypatch, manage):
    scope = f"{READ_SCOPE} {MANAGE_SCOPE}" if manage else READ_SCOPE
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
                    "scope": scope,
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
                    "scope": scope,
                    "resource": RESOURCE,
                    "code_challenge_method": "S256",
                    "code_challenge": b64(hashlib.sha256(verifier.encode()).digest()),
                },
            )
            assert started.status_code == 302
            consent_url = urlsplit(started.headers["location"])
            assert not consent_url.query
            ticket = parse_qs(consent_url.fragment)["ticket"][0]
            url = "/cml-web/oauth/consent"
            body = json.dumps({"ticket": ticket, "action": "approve"}).encode()
            owner = {"authzPolicy": "owner-no-additional-prompts/1"}
            visible = await http.get(url, headers=_signed(key, url, "GET", b"", **owner))
            assert visible.status_code == 200
            assert "Připojit KájovoDocházku" in visible.text
            check_body = json.dumps({"ticket": ticket, "action": "inspect"}).encode()
            checked = await http.post(
                url, content=check_body, headers=_signed(key, url, "POST", check_body, **owner)
            )
            assert checked.status_code == 200 and checked.json() == {"manage": manage}
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
                    assert names == ADMIN_READ_TOOLS | (
                        MANAGE_TOOLS | ADMIN_WRITE_TOOLS if manage else set()
                    ) | {
                        "attendance_employments_list",
                        "attendance_month_get",
                        "shift_groups_list",
                        "shift_group_month_get",
                    }
                    rows = await sdk.call_tool(
                        "attendance_employments_list", {"year": 2026, "month": 11}
                    )
                    assert rows.structured_content == {"items": [], "next_after": None}
                    operation = await sdk.call_tool(
                        "attendance_operation_get", {"operation_id": str(uuid.uuid4())}
                    )
                    if manage:
                        assert operation.structured_content["state"] == "not_found"
                    else:
                        assert operation.is_error
                        assert "attendance_manage_required" in operation.content[0].text
            refresh_payload = {
                "grant_type": "refresh_token",
                "client_id": client_id,
                "refresh_token": token["refresh_token"],
                "resource": RESOURCE,
            }
            if not manage:
                assert (
                    await http.post(
                        ISSUER + "/token",
                        data={**refresh_payload, "scope": f"{READ_SCOPE} {MANAGE_SCOPE}"},
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
                        visible = {tool.name for tool in (await sdk.list_tools()).tools}
                        assert not (ADMIN_READ_TOOLS | ADMIN_WRITE_TOOLS) & visible
                        group_detail = await sdk.call_tool(
                            "employment_group_get", {"group_id": group.id}
                        )
                        assert group_detail.is_error
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

                        original_id = str(uuid.uuid4())
                        args = {
                            "operation_id": original_id,
                            "employment_id": own.id,
                            "occurred_at": "2026-10-05T09:00:00+02:00",
                            "paired_occurred_at": "2026-10-05T15:00:00+02:00",
                        }
                        outside = await sdk.call_tool(
                            "attendance_event_create", {**args, "employment_id": peer.id}
                        )
                        assert outside.is_error
                        created = await sdk.call_tool("attendance_event_create", args)
                        assert not created.is_error, created.content
                        receipt = created.structured_content
                        assert receipt["state"] == "completed"
                        assert receipt["employment_id"] == own.id
                        replay = await sdk.call_tool("attendance_event_create", args)
                        assert replay.structured_content == receipt
                        altered = await sdk.call_tool(
                            "attendance_event_create",
                            {**args, "occurred_at": "2026-10-05T10:00:00+02:00"},
                        )
                        assert altered.is_error and "operation_conflict" in altered.content[0].text
                        lookup = await sdk.call_tool(
                            "attendance_operation_get", {"operation_id": original_id}
                        )
                        assert lookup.structured_content == receipt

                        day_args = {**period, "employment_id": own.id, "day": "2026-10-05"}
                        saved = await sdk.call_tool("attendance_month_get", day_args)
                        entries = saved.structured_content["days"][0]["events"]
                        assert len(entries) == 2
                        first, last = entries
                        assert receipt["event_id"] == first["id"]
                        updated = await sdk.call_tool(
                            "attendance_event_update",
                            {
                                "operation_id": str(uuid.uuid4()),
                                "employment_id": own.id,
                                "event_id": last["id"],
                                "occurred_at": "2026-10-05T16:00:00+02:00",
                            },
                        )
                        assert not updated.is_error, updated.content
                        saved = await sdk.call_tool("attendance_month_get", day_args)
                        assert saved.structured_content["days"][0]["worked_minutes"] == 420

                        delete_args = {
                            "operation_id": str(uuid.uuid4()),
                            "employment_id": own.id,
                            "event_id": first["id"],
                            "paired_event_id": last["id"],
                        }
                        deleted = await sdk.call_tool("attendance_event_delete", delete_args)
                        assert not deleted.is_error, deleted.content
                        delete_replay = await sdk.call_tool("attendance_event_delete", delete_args)
                        assert delete_replay.structured_content == deleted.structured_content
                        saved = await sdk.call_tool("attendance_month_get", day_args)
                        assert saved.structured_content["days"][0]["events"] == []

                        status = await sdk.call_tool(
                            "attendance_day_status_set",
                            {
                                "operation_id": str(uuid.uuid4()),
                                "employment_id": own.id,
                                "day": "2026-10-05",
                                "status": "SICKNESS",
                            },
                        )
                        assert not status.is_error, status.content
                        saved = await sdk.call_tool("attendance_month_get", day_args)
                        assert saved.structured_content["days"][0]["status"] == "SICKNESS"

                        shift_args = {
                            "operation_id": str(uuid.uuid4()),
                            "employment_id": own.id,
                            "day": "2026-10-06",
                            "arrival_time": "09:00",
                            "departure_time": "15:00",
                            "status": None,
                        }
                        planned = await sdk.call_tool("shift_plan_update", shift_args)
                        assert not planned.is_error, planned.content
                        planned_day = await sdk.call_tool(
                            "shift_group_month_get",
                            {**period, "group_id": group.id, "day": "2026-10-06"},
                        )
                        own_plan = next(
                            item
                            for item in planned_day.structured_content["items"]
                            if item["employment_id"] == own.id
                        )
                        assert own_plan["shifts"][0]["arrival_time"] == "09:00"

        asyncio.run(run())
    finally:
        client.close()
        db.close()


def test_signed_owner_group_administration_and_private_file_download(tmp_path, monkeypatch):
    client, db, user = _client()
    try:
        app, mcp, key = _prepare(monkeypatch, tmp_path, sessionmaker(bind=db.get_bind()))
        own = user.employments[0]

        def add_employment(title):
            row = Employment(
                user=user,
                title=title,
                employment_type=EmploymentType.WORK_CONTRACT,
                start_date=date(2026, 1, 1),
                workload_fraction=1,
                night_hours_enabled=True,
            )
            db.add(row)
            db.flush()
            return row

        second = add_employment("Fixture second")
        third = add_employment("Fixture third")
        db.commit()
        actor = {"sub": OWNER, "authzPolicy": "owner-no-additional-prompts/1"}

        class SignedOwner(httpx2.Auth):
            async def async_auth_flow(self, request):
                body = await request.aread()
                request.headers.update(
                    _signed(key, request.url.raw_path.decode(), request.method, body, **actor)
                )
                yield request

        async def run():
            async with (
                mcp.transport.router.lifespan_context(app),
                httpx2.AsyncClient(
                    transport=httpx2.ASGITransport(app),
                    auth=SignedOwner(),
                    base_url=ORIGIN,
                ) as http,
                streamable_http_client(ORIGIN + "/cml-web/mcp", http_client=http) as (
                    read,
                    write,
                    *_,
                ),
                ClientSession(read, write) as sdk,
            ):
                await sdk.initialize()

                async def result(tool, args):
                    value = await sdk.call_tool(tool, args)
                    assert not value.is_error, value.content
                    return value.structured_content

                created = await result(
                    "employment_group_create",
                    {
                        "operation_id": str(uuid.uuid4()),
                        "name": "Fixture group",
                        "employment_ids": [own.id, second.id],
                    },
                )
                group_id = created["group_id"]
                assert group_id and created["state"] == "completed"
                assert created["employment_id"] is None
                detail = await result("employment_group_get", {"group_id": group_id, "limit": 1})
                assert detail["employment_ids"] == [own.id]
                assert detail["next_after"] == own.id
                await result(
                    "employment_group_rename",
                    {
                        "operation_id": str(uuid.uuid4()),
                        "group_id": group_id,
                        "name": "New name",
                        "expected_name": detail["name"],
                    },
                )
                change = {
                    "operation_id": str(uuid.uuid4()),
                    "group_id": group_id,
                    "expected_membership_version": detail["membership_version"],
                    "employment_ids": [own.id, third.id],
                }
                changed = await result("employment_group_members_set", change)
                assert changed == await result("employment_group_members_set", change)
                final = await result("employment_group_get", {"group_id": group_id})
                assert final["name"] == "New name"
                assert final["employment_ids"] == [own.id, third.id]
                stale = await sdk.call_tool(
                    "employment_group_delete",
                    {
                        "operation_id": str(uuid.uuid4()),
                        "group_id": group_id,
                        "expected_membership_version": detail["membership_version"],
                    },
                )
                assert stale.is_error and "group_changed" in stale.content[0].text
                await result(
                    "employment_group_delete",
                    {
                        "operation_id": str(uuid.uuid4()),
                        "group_id": group_id,
                        "expected_membership_version": final["membership_version"],
                    },
                )
                missing = await sdk.call_tool("employment_group_get", {"group_id": group_id})
                assert missing.is_error and "group_not_found" in missing.content[0].text

                period = {"year": 2026, "month": 10}
                plan_args = {"employment_id": own.id, "day": "2026-10-06", "status": None}
                await result(
                    "shift_plan_update",
                    {
                        **plan_args,
                        "operation_id": str(uuid.uuid4()),
                        "arrival_time": "09:00",
                        "departure_time": "15:00",
                    },
                )
                with sessionmaker(bind=db.get_bind()).begin() as legacy:
                    mixed = (
                        legacy.query(ShiftPlan)
                        .filter_by(employment_id=own.id, date=date(2026, 10, 6))
                        .one()
                    )
                    mixed.status = "OFF"
                await result(
                    "shift_plan_day_status_set",
                    {**plan_args, "operation_id": str(uuid.uuid4())},
                )
                with sessionmaker(bind=db.get_bind())() as check:
                    row = (
                        check.query(ShiftPlan)
                        .filter_by(employment_id=own.id, date=date(2026, 10, 6))
                        .one()
                    )
                    assert row.arrival_time == "09:00" and row.departure_time == "15:00"
                    assert row.status is None

                def download_path(meta):
                    return urlsplit(meta["download_url"]).path.replace(
                        "/sections/dochazka/", "/cml-web/", 1
                    )

                csv = await result("attendance_report_export", {**period, "employment_id": own.id})
                empty = await sdk.call_tool(
                    "shift_plan_export", {**period, "employment_ids": []}
                )
                assert empty.is_error
                pdf = await result("shift_plan_export", {**period, "employment_ids": [own.id]})
                csv_path = download_path(csv)
                for info, path, signature in (
                    (csv, csv_path, b""),
                    (pdf, download_path(pdf), b"%PDF-"),
                ):
                    data = await http.get(path)
                    assert data.status_code == 200
                    assert data.content.startswith(signature)
                    assert len(data.content) == info["size_bytes"]
                    assert hashlib.sha256(data.content).hexdigest() == info["sha256"]

                async with httpx2.AsyncClient(
                    transport=httpx2.ASGITransport(app),
                    base_url=ORIGIN,
                ) as public:
                    assert (await public.get(csv_path)).status_code == 401

                with sessionmaker(bind=db.get_bind()).begin() as write:
                    csv_id = csv_path.rsplit("/", 1)[1]
                    item = write.get(AttendanceMCPExport, csv_id)
                    item.expires_at = 1
                assert (await http.get(csv_path)).status_code == 404

        asyncio.run(run())
    finally:
        client.close()
        db.close()
