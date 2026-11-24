"""Official Streamable HTTP transport and role-bound Docházka tools."""

from __future__ import annotations

from collections.abc import Callable
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import date
from typing import Annotated, Any, Literal, TypeVar, cast

from fastapi import HTTPException
from mcp.server import MCPServer
from mcp.server.auth.handlers.revoke import RevocationHandler
from mcp.server.auth.handlers.token import TokenHandler
from mcp.server.auth.middleware.client_auth import ClientAuthenticator
from mcp.server.auth.routes import (
    build_metadata,
    cors_middleware,
    create_auth_routes,
    create_protected_resource_routes,
)
from mcp.server.auth.settings import ClientRegistrationOptions, RevocationOptions
from mcp.server.context import CallNext, HandlerResult, ServerRequestContext
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations
from pydantic import UUID4, AnyHttpUrl, AwareDatetime, Field
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import FormData, Headers
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route
from starlette.types import Receive, Scope, Send

from app.api.deps import PortalUserAuth
from app.api.v1.admin_export import ShiftPlanPdfRequestIn, build_csv_or_zip, build_pdf_export
from app.db.models import InstanceStatus, PortalUser
from app.security.attendance_oauth import (
    CML,
    ISSUER,
    ORIGIN,
    OWNER,
    READ_SCOPE,
    RESOURCE,
    SCOPES,
    AttendanceOAuth,
    has_manage_access,
    manage_access_digest,
)
from app.security.sessions import AdminSession
from app.services import attendance_mcp_exports as exports
from app.services import attendance_mcp_groups as groups
from app.services import attendance_mcp_reads as reads
from app.services import attendance_mcp_writes as writes
from app.services.attendance_mcp_operations import (
    AttendanceOperationOut,
    invoke_operation,
    operation_status,
)

RESOURCE_METADATA = "/.well-known/oauth-protected-resource/mcp"
AUTH_METADATA = "/.well-known/oauth-authorization-server/attendance-oauth"
ISSUER_PATH = "/attendance-oauth"
READ = ToolAnnotations(
    read_only_hint=True, destructive_hint=False, open_world_hint=False, idempotent_hint=True
)
WRITE = ToolAnnotations(
    read_only_hint=False, destructive_hint=False, open_world_hint=False, idempotent_hint=True
)
UPDATE = ToolAnnotations(
    read_only_hint=False, destructive_hint=True, open_world_hint=False, idempotent_hint=True
)
MANAGE_TOOLS = frozenset(
    {
        "attendance_event_create",
        "attendance_event_update",
        "attendance_event_delete",
        "attendance_day_status_set",
        "shift_plan_update",
        "shift_plan_day_status_set",
        "attendance_operation_get",
    }
)
ADMIN_READ_TOOLS = frozenset(
    {"employment_group_get", "attendance_report_export", "shift_plan_export"}
)
ADMIN_WRITE_TOOLS = frozenset(
    {
        "employment_group_create",
        "employment_group_rename",
        "employment_group_members_set",
        "employment_group_delete",
    }
)
Year = Annotated[int, Field(strict=True, ge=2000, le=2100)]
Month = Annotated[int, Field(strict=True, ge=1, le=12)]
Identifier = Annotated[int, Field(strict=True, ge=1, le=2**31 - 1)]
After = Annotated[int, Field(strict=True, ge=0, le=2**31 - 1)]
PageSize = Annotated[int, Field(strict=True, ge=1, le=30)]
GroupPageSize = Annotated[int, Field(strict=True, ge=1, le=12)]
WallTime = Annotated[str, Field(pattern=r"^(?:[01][0-9]|2[0-3]):[0-5][0-9]$")]
GroupName = Annotated[str, Field(min_length=1, max_length=160)]
MembershipVersion = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
MemberIds = Annotated[list[Identifier], Field(min_length=2, max_length=2000)]
EditedMemberIds = Annotated[list[Identifier], Field(min_length=1, max_length=2000)]
Result = TypeVar("Result")


@dataclass(frozen=True)
class Principal:
    subject: str
    manager: bool
    user_id: int | None = None
    employment_ids: frozenset[int] | None = None
    writer: bool = False
    oauth_digest: str | None = None


principal: ContextVar[Principal | None] = ContextVar("attendance_mcp_principal", default=None)


def _compact_schema(value: Any) -> Any:
    if isinstance(value, list):
        return [_compact_schema(item) for item in value]
    if isinstance(value, dict):
        return {
            key: item if key in {"default", "const", "enum", "examples"} else _compact_schema(item)
            for key, item in value.items()
            if key != "title" or not isinstance(item, str)
        }
    return value


async def _scope_catalog(
    ctx: ServerRequestContext[Any, Any],
    call_next: CallNext,
) -> HandlerResult:
    result = await call_next(ctx)
    if ctx.method != "tools/list" or not isinstance(result, dict):
        return result
    actor = principal.get()
    hidden: set[str] = set()
    if actor is None or not actor.writer:
        hidden.update(MANAGE_TOOLS | ADMIN_WRITE_TOOLS)
    if actor is None or not actor.manager:
        hidden.update(ADMIN_READ_TOOLS | ADMIN_WRITE_TOOLS)
    visible = []
    for tool in result["tools"]:
        if tool["name"] in hidden:
            continue
        schemas = {
            name: _compact_schema(tool[name])
            for name in ("inputSchema", "outputSchema")
            if name in tool
        }
        visible.append({**tool, **schemas})
    return {**result, "tools": visible}


class AttendanceMCP:
    def __init__(self, sessions: Callable[[], Session]) -> None:
        self.sessions = sessions
        self.provider = AttendanceOAuth(sessions)
        self.server = MCPServer(
            "KájovoDocházka",
            version="1.0.0",
            instructions="Najdi úvazek pro měsíc. Docházka vrací souhrn a na vyžádání dny. "
            "Skupinový přehled obsahuje plán směn.",
            subscriptions=False,
            middleware=[_scope_catalog],
        )
        self._register_read_tools()
        self._register_write_tools()
        self._register_group_tools()
        self._register_export_tools()
        self.transport = self.server.streamable_http_app(
            streamable_http_path="/mcp",
            stateless_http=True,
            json_response=True,
            max_request_body_size=65_536,
            transport_security=TransportSecuritySettings(
                allowed_hosts=["dagmar.hcasc.cz", "testserver", "localhost:*", "127.0.0.1:*"],
                allowed_origins=[ORIGIN, CML, "https://chatgpt.com"],
            ),
        )

    def routes(self) -> list[Route]:
        registration = ClientRegistrationOptions(
            enabled=True, valid_scopes=list(SCOPES), default_scopes=[READ_SCOPE]
        )
        revocation = RevocationOptions(enabled=True)
        issuer = AnyHttpUrl(ISSUER)
        sdk_routes = create_auth_routes(
            self.provider,
            issuer,
            client_registration_options=registration,
            revocation_options=revocation,
        )
        authenticator = ClientAuthenticator(self.provider)
        token_handler = TokenHandler(self.provider, authenticator)
        revoke_handler = RevocationHandler(self.provider, authenticator)

        async def token(request: Request) -> Response:
            if request.method == "POST":
                resources = (await request.form()).getlist("resource")
                if resources and resources != [RESOURCE]:
                    return JSONResponse({"error": "invalid_target"}, status_code=400)
            return cast(Response, await token_handler.handle(request))

        async def revoke(request: Request) -> Response:
            form = await request.form()
            client = await self.provider.get_client(str(form.get("client_id", "")))
            # The pinned SDK uses a required nullable field. A public client has no secret.
            if (
                client is not None
                and client.token_endpoint_auth_method == "none"
                and "client_secret" not in form
            ):
                request._form = FormData([*form.multi_items(), ("client_secret", "")])
            return await revoke_handler.handle(request)

        async def auth_metadata(request: Request) -> JSONResponse:
            del request
            data = build_metadata(issuer, None, registration, revocation).model_dump(
                mode="json", exclude_none=True
            )
            data.update(
                token_endpoint_auth_methods_supported=["none"],
                revocation_endpoint_auth_methods_supported=["none"],
                authorization_response_iss_parameter_supported=True,
            )
            return JSONResponse(data, headers={"Cache-Control": "no-store"})

        oauth_routes = [
            route
            for route in sdk_routes
            if route.path not in ("/.well-known/oauth-authorization-server", "/token", "/revoke")
        ]
        oauth_routes.extend(
            [
                Route(
                    "/token",
                    cors_middleware(token, ["POST", "OPTIONS"]),
                    methods=["POST", "OPTIONS"],
                ),
                Route(
                    "/revoke",
                    cors_middleware(revoke, ["POST", "OPTIONS"]),
                    methods=["POST", "OPTIONS"],
                ),
            ]
        )
        routes = [
            Route("/mcp", self, methods=["GET", "POST", "DELETE"], name="attendance_mcp"),
            Route(
                AUTH_METADATA,
                cors_middleware(auth_metadata, ["GET", "OPTIONS"]),
                methods=["GET", "OPTIONS"],
                name="attendance_oauth_metadata",
            ),
            *create_protected_resource_routes(
                AnyHttpUrl(RESOURCE),
                [issuer],
                scopes_supported=list(SCOPES),
                resource_name="KájovoDocházka",
            ),
            *[
                Route(
                    ISSUER_PATH + route.path,
                    route.app,
                    methods=route.methods,
                    name="attendance_oauth_" + route.path.removeprefix("/"),
                )
                for route in oauth_routes
            ],
        ]
        # SlowAPI identifies handlers by name, including SDK-generated ASGI middleware.
        for route in routes:
            if not hasattr(route.endpoint, "__name__"):
                route.endpoint.__name__ = route.name
        return routes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        headers = Headers(scope=scope)
        origins = headers.getlist("origin")
        if origins and (
            len(origins) != 1 or origins[0] not in (ORIGIN, CML, "https://chatgpt.com")
        ):
            await JSONResponse({"error": "invalid_origin"}, status_code=403)(scope, receive, send)
            return
        state = scope.get("state", {})
        claims = state.get("cml_web_claims")
        if claims is not None:
            actor = Principal(
                claims["sub"],
                isinstance(state.get("cml_admin"), AdminSession),
                state.get("cml_user_id"),
                state.get("cml_employment_ids"),
                writer=True,
            )
        else:
            values = headers.getlist("authorization")
            authenticated = (
                await self.provider.load_access_token(values[0][7:])
                if len(values) == 1
                and values[0].startswith("Bearer ")
                and not scope.get("query_string")
                else None
            )
            if (
                authenticated is None
                or authenticated.resource != RESOURCE
                or authenticated.subject != OWNER
                or READ_SCOPE not in authenticated.scopes
            ):
                challenge = (
                    f'Bearer resource_metadata="{ORIGIN}{RESOURCE_METADATA}", scope="{READ_SCOPE}"'
                )
                await JSONResponse(
                    {"error": "invalid_token"},
                    status_code=401,
                    headers={
                        "WWW-Authenticate": challenge,
                        "Cache-Control": "no-store",
                    },
                )(scope, receive, send)
                return
            digest = manage_access_digest(authenticated)
            actor = Principal(OWNER, True, writer=digest is not None, oauth_digest=digest)
        bound = principal.set(actor)
        try:
            await self.transport(scope, receive, send)
        finally:
            principal.reset(bound)

    def _reader(self, db: Session, actor: Principal) -> reads.AttendanceReader:
        if actor.manager:
            return reads.AttendanceReader(manager=True)
        user = (
            db.get(PortalUser, actor.user_id, populate_existing=True)
            if actor.user_id is not None
            else None
        )
        if (
            user is None
            or not user.is_active
            or user.is_blocked
            or user.instance is None
            or user.instance.status != InstanceStatus.ACTIVE
        ):
            raise ToolError("attendance_scope_denied")
        return reads.AttendanceReader(
            manager=False,
            member=PortalUserAuth(user.instance, user, actor.employment_ids),
        )

    def _read(self, operation: Callable[[Session, reads.AttendanceReader], Result]) -> Result:
        actor = principal.get()
        if actor is None:
            raise ToolError("attendance_scope_denied")
        with self.sessions() as db:
            try:
                return operation(db, self._reader(db, actor))
            except HTTPException as error:
                detail: Any = error.detail
                message = (
                    f"{detail['code']}: {detail['message']}"
                    if isinstance(detail, dict)
                    else str(detail)
                )
                raise ToolError(message) from None

    def _writer(self) -> Principal:
        actor = principal.get()
        if actor is None or not actor.writer:
            raise ToolError("attendance_manage_required")
        return actor

    def _write(
        self,
        operation_id: UUID4,
        action: str,
        employment_id: int | None,
        arguments: dict[str, Any],
        mutate: Callable[[Session, reads.AttendanceReader, str], None],
    ) -> AttendanceOperationOut:
        actor = self._writer()
        if employment_id is None and not actor.manager:
            raise ToolError("attendance_admin_required")

        def check_authority(db: Session) -> None:
            if actor.oauth_digest is not None and not has_manage_access(db, actor.oauth_digest):
                raise ToolError("attendance_manage_required")
            if not actor.manager and employment_id is not None:
                writes.require_employment(db, self._reader(db, actor), employment_id)

        def perform(db: Session, reader: reads.AttendanceReader) -> AttendanceOperationOut:
            if employment_id is not None:
                writes.require_employment(db, reader, employment_id)
            check_authority(db)
            return invoke_operation(
                db,
                actor=actor.subject,
                operation_id=str(operation_id),
                action=action,
                arguments={"employment_id": employment_id, **arguments},
                employment_id=employment_id,
                check_authority=check_authority,
                mutate=lambda: mutate(db, reader, actor.subject),
            )

        return self._read(perform)

    def _operation_status(self, operation_id: UUID4) -> AttendanceOperationOut:
        actor = self._writer()

        def lookup(db: Session, reader: reads.AttendanceReader) -> AttendanceOperationOut:
            if actor.oauth_digest is not None and not has_manage_access(db, actor.oauth_digest):
                raise ToolError("attendance_manage_required")
            receipt = operation_status(db, actor.subject, str(operation_id))
            if receipt.group_id is not None and not actor.manager:
                raise ToolError("attendance_admin_required")
            if receipt.employment_id is not None:
                writes.require_employment(db, reader, receipt.employment_id)
            return receipt

        return self._read(lookup)

    def _read_admin(self, operation: Callable[[Session, str], Result]) -> Result:
        actor = principal.get()
        if actor is None or not actor.manager:
            raise ToolError("attendance_admin_required")
        return self._read(lambda db, _reader: operation(db, actor.subject))

    def _register_read_tools(self) -> None:
        @self.server.tool(annotations=READ)
        async def attendance_month_get(
            employment_id: Identifier,
            year: Year,
            month: Month,
            include_days: bool = False,
            day: date | None = None,
        ) -> reads.AttendanceMonth:
            """Přečti souhrn docházky. include_days přidá dny, day přidá průchody daného dne."""
            return await run_in_threadpool(
                self._read,
                lambda db, reader: reads.attendance_month(
                    db,
                    reader,
                    employment_id,
                    year,
                    month,
                    include_days=include_days,
                    day=day,
                ),
            )

        @self.server.tool(annotations=READ)
        async def attendance_employments_list(
            year: Year,
            month: Month,
            user_id: Identifier | None = None,
            after: After = 0,
            limit: PageSize = 10,
        ) -> reads.EmploymentPage:
            """Najdi povolené úvazky pro měsíc. Pro další stránku použij next_after."""
            return await run_in_threadpool(
                self._read,
                lambda db, reader: reads.employments(
                    db,
                    reader,
                    year,
                    month,
                    user_id=user_id,
                    after=after,
                    limit=limit,
                ),
            )

        @self.server.tool(annotations=READ)
        async def shift_groups_list(
            year: Year, month: Month, after: After = 0, limit: PageSize = 10
        ) -> reads.GroupPage:
            """Najdi povolené skupiny pro měsíc. Pro další stránku použij next_after."""
            return await run_in_threadpool(
                self._read,
                lambda db, reader: reads.groups(
                    db,
                    reader,
                    year,
                    month,
                    after=after,
                    limit=limit,
                ),
            )

        @self.server.tool(annotations=READ)
        async def shift_group_month_get(
            group_id: Identifier,
            year: Year,
            month: Month,
            day: date | None = None,
            after: After = 0,
            limit: GroupPageSize = 5,
        ) -> reads.GroupPlanPage:
            """Přečti plán směn skupiny. Pro další úvazky použij next_after."""
            return await run_in_threadpool(
                self._read,
                lambda db, reader: reads.group_month(
                    db,
                    reader,
                    group_id,
                    year,
                    month,
                    day=day,
                    after=after,
                    limit=limit,
                ),
            )

    def _register_write_tools(self) -> None:
        @self.server.tool(annotations=READ)
        async def attendance_operation_get(operation_id: UUID4) -> AttendanceOperationOut:
            """Ověř výsledek vlastní operace. Při opakování použij stejné operation_id."""
            return await run_in_threadpool(self._operation_status, operation_id)

        @self.server.tool(annotations=WRITE)
        async def attendance_event_create(
            operation_id: UUID4,
            employment_id: Identifier,
            occurred_at: AwareDatetime,
            paired_occurred_at: AwareDatetime | None = None,
        ) -> AttendanceOperationOut:
            """Přidej průchod nebo dvojici průchodů s časovým pásmem."""
            return await run_in_threadpool(
                self._write,
                operation_id,
                "attendance_event_create",
                employment_id,
                {
                    "occurred_at": occurred_at.isoformat(),
                    "paired_occurred_at": paired_occurred_at.isoformat()
                    if paired_occurred_at
                    else None,
                },
                lambda db, reader, subject: writes.create_event(
                    db,
                    reader,
                    subject,
                    employment_id,
                    occurred_at,
                    paired_occurred_at,
                ),
            )

        @self.server.tool(annotations=UPDATE)
        async def attendance_event_update(
            operation_id: UUID4,
            employment_id: Identifier,
            event_id: Identifier,
            occurred_at: AwareDatetime,
        ) -> AttendanceOperationOut:
            """Změň čas jednoho průchodu. Jeho ID vrať z denní docházky."""
            return await run_in_threadpool(
                self._write,
                operation_id,
                "attendance_event_update",
                employment_id,
                {"event_id": event_id, "occurred_at": occurred_at.isoformat()},
                lambda db, reader, subject: writes.update_event(
                    db,
                    reader,
                    subject,
                    employment_id,
                    event_id,
                    occurred_at,
                ),
            )

        @self.server.tool(annotations=UPDATE)
        async def attendance_event_delete(
            operation_id: UUID4,
            employment_id: Identifier,
            event_id: Identifier,
            paired_event_id: Identifier | None = None,
        ) -> AttendanceOperationOut:
            """Smaž zadaný průchod. ID páru vezmi z deletion_partner_id v denní docházce."""
            return await run_in_threadpool(
                self._write,
                operation_id,
                "attendance_event_delete",
                employment_id,
                {"event_id": event_id, "paired_event_id": paired_event_id},
                lambda db, reader, subject: writes.delete_event(
                    db,
                    reader,
                    subject,
                    employment_id,
                    event_id,
                    paired_event_id,
                ),
            )

        @self.server.tool(annotations=UPDATE)
        async def attendance_day_status_set(
            operation_id: UUID4,
            employment_id: Identifier,
            day: date,
            status: writes.DayStatus | None,
            confirm_delete_conflicts: bool = False,
        ) -> AttendanceOperationOut:
            """Nastav celodenní stav docházky. null ho smaže. Konflikty maž jen se souhlasem."""
            return await run_in_threadpool(
                self._write,
                operation_id,
                "attendance_day_status_set",
                employment_id,
                {
                    "day": day.isoformat(),
                    "status": status,
                    "confirm_delete_conflicts": confirm_delete_conflicts,
                },
                lambda db, reader, subject: writes.set_day_status(
                    db,
                    reader,
                    subject,
                    employment_id,
                    day,
                    status,
                    confirm_delete_conflicts,
                ),
            )

        @self.server.tool(annotations=UPDATE)
        async def shift_plan_update(
            operation_id: UUID4,
            employment_id: Identifier,
            day: date,
            arrival_time: WallTime | None,
            departure_time: WallTime | None,
            status: writes.PlanStatus | None,
            confirm_delete_conflicts: bool = False,
        ) -> AttendanceOperationOut:
            """Nastav plán dne v HH:MM. Tři null smažou plán. Konflikty maž jen se souhlasem."""
            return await run_in_threadpool(
                self._write,
                operation_id,
                "shift_plan_update",
                employment_id,
                {
                    "day": day.isoformat(),
                    "arrival_time": arrival_time,
                    "departure_time": departure_time,
                    "status": status,
                    "confirm_delete_conflicts": confirm_delete_conflicts,
                },
                lambda db, reader, _subject: writes.update_shift_plan(
                    db,
                    reader,
                    employment_id,
                    day,
                    arrival_time,
                    departure_time,
                    status,
                    confirm_delete_conflicts,
                ),
            )

        @self.server.tool(annotations=UPDATE)
        async def shift_plan_day_status_set(
            operation_id: UUID4,
            employment_id: Identifier,
            day: date,
            status: writes.PlanStatus | None,
            confirm_delete_conflicts: bool = False,
        ) -> AttendanceOperationOut:
            """Nastav plánované volno či dovolenou. null odvolá stav plánu. Konflikt vyžaduje souhlas."""
            return await run_in_threadpool(
                self._write,
                operation_id,
                "shift_plan_day_status_set",
                employment_id,
                {
                    "day": day.isoformat(),
                    "status": status,
                    "confirm_delete_conflicts": confirm_delete_conflicts,
                },
                lambda db, reader, _subject: writes.set_shift_plan_day_status(
                    db,
                    reader,
                    employment_id,
                    day,
                    status,
                    confirm_delete_conflicts,
                ),
            )

    def _register_group_tools(self) -> None:
        @self.server.tool(annotations=READ)
        async def employment_group_get(
            group_id: Identifier,
            after: After = 0,
            limit: PageSize = 15,
        ) -> groups.GroupDetail:
            """Načti úvazky skupiny a membership_version. Pokračuj pomocí next_after."""
            return await run_in_threadpool(
                self._read_admin,
                lambda db, _actor: groups.group_details(db, group_id, after, limit),
            )

        @self.server.tool(annotations=WRITE)
        async def employment_group_create(
            operation_id: UUID4,
            name: GroupName,
            employment_ids: MemberIds,
        ) -> AttendanceOperationOut:
            """Založ skupinu nejméně dvou různých úvazků."""
            return await run_in_threadpool(
                self._write,
                operation_id,
                "employment_group_create",
                None,
                {"name": name, "employment_ids": sorted(employment_ids)},
                lambda db, _reader, actor: groups.create(db, actor, name, employment_ids),
            )

        @self.server.tool(annotations=UPDATE)
        async def employment_group_rename(
            operation_id: UUID4,
            group_id: Identifier,
            name: GroupName,
            expected_name: GroupName,
        ) -> AttendanceOperationOut:
            """Přejmenuj skupinu. expected_name vezmi z employment_group_get."""
            return await run_in_threadpool(
                self._write,
                operation_id,
                "employment_group_rename",
                None,
                {"group_id": group_id, "name": name, "expected_name": expected_name},
                lambda db, _reader, actor: groups.rename(db, actor, group_id, name, expected_name),
            )

        @self.server.tool(annotations=UPDATE)
        async def employment_group_members_set(
            operation_id: UUID4,
            group_id: Identifier,
            employment_ids: EditedMemberIds,
            expected_membership_version: MembershipVersion,
            action: Literal["replace", "remove"] = "replace",
        ) -> AttendanceOperationOut:
            """Nahraď členství nebo odeber úvazky. Pod dvěma úvazky odebrání smaže skupinu."""
            return await run_in_threadpool(
                self._write,
                operation_id,
                "employment_group_members_set",
                None,
                {
                    "group_id": group_id,
                    "employment_ids": sorted(employment_ids),
                    "expected_membership_version": expected_membership_version,
                    "action": action,
                },
                lambda db, _reader, actor: groups.edit_members(
                    db,
                    actor,
                    group_id,
                    action,
                    expected_membership_version,
                    employment_ids,
                ),
            )

        @self.server.tool(annotations=UPDATE)
        async def employment_group_delete(
            operation_id: UUID4,
            group_id: Identifier,
            expected_membership_version: MembershipVersion,
        ) -> AttendanceOperationOut:
            """Smaž určenou skupinu. Verzi nejdřív načti přes employment_group_get."""
            return await run_in_threadpool(
                self._write,
                operation_id,
                "employment_group_delete",
                None,
                {"group_id": group_id, "expected_membership_version": expected_membership_version},
                lambda db, _reader, actor: groups.edit_members(
                    db,
                    actor,
                    group_id,
                    "delete",
                    expected_membership_version,
                    [],
                ),
            )

    def _register_export_tools(self) -> None:
        @self.server.tool(annotations=READ)
        async def attendance_report_export(
            year: Year,
            month: Month,
            employment_id: Identifier | None = None,
            all_employments: bool = False,
        ) -> exports.AttendanceExportOut:
            """Připrav CSV úvazku nebo ZIP při all_employments=true. Odkaz otevři v přihlášeném CML."""

            def export(db: Session, actor: str) -> exports.AttendanceExportOut:
                filename, media_type, content = build_csv_or_zip(
                    db,
                    f"{year:04d}-{month:02d}",
                    employment_id,
                    all_employments,
                )
                return exports.store(db, actor, filename, media_type, content)

            return await run_in_threadpool(self._read_admin, export)

        @self.server.tool(annotations=READ)
        async def shift_plan_export(
            year: Year,
            month: Month,
            employment_ids: Annotated[list[Identifier], Field(min_length=1, max_length=2000)],
            locale: Literal["cs", "en", "sk", "de"] = "cs",
        ) -> exports.AttendanceExportOut:
            """Připrav PDF plánu zadaných úvazků. Odkaz otevři v přihlášeném CML."""

            def export(db: Session, actor: str) -> exports.AttendanceExportOut:
                filename, content = build_pdf_export(
                    db,
                    ShiftPlanPdfRequestIn(
                        year=year,
                        month=month,
                        employment_ids=employment_ids,
                        locale=locale,
                    ),
                )
                return exports.store(db, actor, filename, "application/pdf", content)

            return await run_in_threadpool(self._read_admin, export)
