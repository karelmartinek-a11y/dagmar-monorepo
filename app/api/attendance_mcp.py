"""Official Streamable HTTP transport and role-bound Docházka tools."""

from __future__ import annotations

from collections.abc import Callable
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import date
from typing import Annotated, Any, TypeVar, cast

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
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations
from pydantic import AnyHttpUrl, Field
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import FormData, Headers
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Mount, Route
from starlette.types import Receive, Scope, Send

from app.api.deps import PortalUserAuth
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
)
from app.security.sessions import AdminSession
from app.services import attendance_mcp_reads as reads

RESOURCE_METADATA = "/.well-known/oauth-protected-resource/mcp"
AUTH_METADATA = "/.well-known/oauth-authorization-server/attendance-oauth"
ISSUER_PATH = "/attendance-oauth"
READ = ToolAnnotations(
    read_only_hint=True, destructive_hint=False, open_world_hint=False, idempotent_hint=True
)
Year = Annotated[int, Field(strict=True, ge=2000, le=2100)]
Month = Annotated[int, Field(strict=True, ge=1, le=12)]
Identifier = Annotated[int, Field(strict=True, ge=1, le=2**31 - 1)]
After = Annotated[int, Field(strict=True, ge=0, le=2**31 - 1)]
PageSize = Annotated[int, Field(strict=True, ge=1, le=30)]
GroupPageSize = Annotated[int, Field(strict=True, ge=1, le=12)]
Result = TypeVar("Result")


@dataclass(frozen=True)
class Principal:
    subject: str
    manager: bool
    user_id: int | None = None
    employment_ids: frozenset[int] | None = None


principal: ContextVar[Principal | None] = ContextVar("attendance_mcp_principal", default=None)


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
        )
        self._register_read_tools()
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

    def routes(self) -> list[Route | Mount]:
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
        return [
            Route("/mcp", self, methods=["GET", "POST", "DELETE"]),
            Route(
                AUTH_METADATA,
                cors_middleware(auth_metadata, ["GET", "OPTIONS"]),
                methods=["GET", "OPTIONS"],
            ),
            *create_protected_resource_routes(
                AnyHttpUrl(RESOURCE),
                [issuer],
                scopes_supported=[READ_SCOPE],
                resource_name="KájovoDocházka",
            ),
            Mount(ISSUER_PATH, routes=oauth_routes),
        ]

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
            actor = Principal(OWNER, True)
        bound = principal.set(actor)
        try:
            await self.transport(scope, receive, send)
        finally:
            principal.reset(bound)

    def _read(self, operation: Callable[[Session, reads.AttendanceReader], Result]) -> Result:
        actor = principal.get()
        if actor is None:
            raise ToolError("attendance_scope_denied")
        with self.sessions() as db:
            if actor.manager:
                reader = reads.AttendanceReader(manager=True)
            else:
                user = db.get(PortalUser, actor.user_id) if actor.user_id is not None else None
                if (
                    user is None
                    or not user.is_active
                    or user.is_blocked
                    or user.instance is None
                    or user.instance.status != InstanceStatus.ACTIVE
                ):
                    raise ToolError("attendance_scope_denied")
                reader = reads.AttendanceReader(
                    manager=False,
                    member=PortalUserAuth(user.instance, user, actor.employment_ids),
                )
            try:
                return operation(db, reader)
            except HTTPException as error:
                detail: Any = error.detail
                message = (
                    f"{detail['code']}: {detail['message']}"
                    if isinstance(detail, dict)
                    else str(detail)
                )
                raise ToolError(message) from None

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
