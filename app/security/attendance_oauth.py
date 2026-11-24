"""OAuth for the dedicated attendance MCP resource. CML authorizes the owner."""

from __future__ import annotations

import hashlib
import re
import secrets
import time
from collections.abc import Callable
from typing import Any
from urllib.parse import urlencode, urlsplit

from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    AuthorizationParams,
    AuthorizeError,
    OAuthAuthorizationServerProvider,
    RefreshToken,
    RegistrationError,
    TokenError,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.db.models import AttendanceOAuthClient, AttendanceOAuthGrant

ORIGIN = "https://dagmar.hcasc.cz"
ISSUER = ORIGIN + "/attendance-oauth"
RESOURCE = ORIGIN + "/mcp"
CML = "https://kajovocml.hcasc.cz"
OWNER = "KRMAR78"
READ_SCOPE = "attendance:read"
MANAGE_SCOPE = "attendance:manage"
SCOPES = (READ_SCOPE, MANAGE_SCOPE)


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _callback(value: str) -> bool:
    url = urlsplit(value)
    return (
        url.scheme == "https"
        and url.netloc == "chatgpt.com"
        and not url.query
        and not url.fragment
        and (
            url.path == "/connector_platform_oauth_redirect"
            or re.fullmatch(r"/connector/oauth/[A-Za-z0-9_-]+", url.path) is not None
        )
    )


def _put(db: Session, kind: str, family: str, ttl: int, payload: dict[str, Any]) -> str:
    value = secrets.token_urlsafe(32)
    db.add(
        AttendanceOAuthGrant(
            digest=_digest(value),
            kind=kind,
            family=family,
            expires_at=int(time.time()) + ttl,
            payload=payload,
        )
    )
    return value


def _grant(
    db: Session, kind: str, value: str, *, lock: bool = False
) -> AttendanceOAuthGrant | None:
    statement = select(AttendanceOAuthGrant).where(
        AttendanceOAuthGrant.digest == _digest(value),
        AttendanceOAuthGrant.kind == kind,
        AttendanceOAuthGrant.expires_at > int(time.time()),
    )
    return db.scalar(statement.with_for_update() if lock else statement)


def manage_access_digest(token: AccessToken) -> str | None:
    return _digest(token.token) if MANAGE_SCOPE in token.scopes else None


def has_manage_access(db: Session, digest: str) -> bool:
    row = db.scalar(
        select(AttendanceOAuthGrant)
        .where(
            AttendanceOAuthGrant.digest == digest,
            AttendanceOAuthGrant.kind == "access",
            AttendanceOAuthGrant.expires_at > int(time.time()),
        )
        .with_for_update()
    )
    return bool(
        row is not None
        and row.expires_at > int(time.time())
        and row.payload["resource"] == RESOURCE
        and row.payload["subject"] == OWNER
        and MANAGE_SCOPE in row.payload["scopes"]
    )


def _lock_client(db: Session, client_id: str) -> bool:
    return (
        db.scalar(
            select(AttendanceOAuthClient.id)
            .where(AttendanceOAuthClient.id == client_id)
            .with_for_update()
        )
        is not None
    )


class AttendanceOAuth(
    OAuthAuthorizationServerProvider[AuthorizationCode, RefreshToken, AccessToken]
):
    def __init__(self, sessions: Callable[[], Session]) -> None:
        self.sessions = sessions

    def _client(self, client_id: str) -> OAuthClientInformationFull | None:
        with self.sessions() as db:
            row = db.get(AttendanceOAuthClient, client_id)
            return OAuthClientInformationFull.model_validate(row.payload) if row else None

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        return await run_in_threadpool(self._client, client_id)

    def _register(self, client: OAuthClientInformationFull) -> None:
        if (
            not client.client_id
            or client.token_endpoint_auth_method != "none"
            or not client.redirect_uris
            or len(client.redirect_uris) > 4
            or not all(_callback(str(uri)) for uri in client.redirect_uris)
            or not set((client.scope or READ_SCOPE).split()) <= set(SCOPES)
        ):
            raise RegistrationError("invalid_client_metadata")
        with self.sessions() as db, db.begin():
            count = db.scalar(select(func.count()).select_from(AttendanceOAuthClient)) or 0
            if count >= 500:
                raise RegistrationError("invalid_client_metadata", "Limit registrací byl dosažen.")
            db.add(
                AttendanceOAuthClient(id=client.client_id, payload=client.model_dump(mode="json"))
            )

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        await run_in_threadpool(self._register, client_info)

    def _authorize(self, client: OAuthClientInformationFull, params: AuthorizationParams) -> str:
        scopes = set(params.scopes or [READ_SCOPE])
        if (
            not _callback(str(params.redirect_uri))
            or params.resource not in (None, RESOURCE)
            or READ_SCOPE not in scopes
            or not scopes <= set(SCOPES)
            or not re.fullmatch(r"[A-Za-z0-9_-]{43}", params.code_challenge)
        ):
            raise AuthorizeError("invalid_request", "Neplatný cíl, rozsah nebo PKCE.")
        with self.sessions() as db, db.begin():
            db.execute(
                delete(AttendanceOAuthGrant).where(
                    AttendanceOAuthGrant.expires_at <= int(time.time())
                )
            )
            ticket = _put(
                db,
                "pending",
                secrets.token_hex(24),
                600,
                {
                    "client_id": client.client_id,
                    "params": params.model_dump(mode="json"),
                },
            )
        return CML + "/sections/dochazka/oauth/consent#" + urlencode({"ticket": ticket})

    async def authorize(
        self, client: OAuthClientInformationFull, params: AuthorizationParams
    ) -> str:
        return await run_in_threadpool(self._authorize, client, params)

    def approve(self, ticket: str, subject: str) -> str:
        if subject != OWNER or not re.fullmatch(r"[A-Za-z0-9_-]{43}", ticket):
            raise PermissionError("Připojení vyžaduje ověřeného vlastníka.")
        with self.sessions() as db, db.begin():
            row = _grant(db, "pending", ticket, lock=True)
            if row is None:
                raise PermissionError("Připojení vypršelo.")
            params = AuthorizationParams.model_validate(row.payload["params"])
            code = _put(
                db,
                "code",
                row.family,
                90,
                {
                    "client_id": row.payload["client_id"],
                    "scopes": params.scopes or [READ_SCOPE],
                    "resource": RESOURCE,
                    "subject": OWNER,
                    "code_challenge": params.code_challenge,
                    "redirect_uri": str(params.redirect_uri),
                    "redirect_uri_provided_explicitly": params.redirect_uri_provided_explicitly,
                },
            )
            db.delete(row)
        query = {"code": code, "iss": ISSUER}
        if params.state is not None:
            query["state"] = params.state
        return str(params.redirect_uri) + "?" + urlencode(query)

    def pending_scopes(self, ticket: str) -> list[str]:
        with self.sessions() as db:
            row = _grant(db, "pending", ticket)
            if row is None:
                raise PermissionError("Připojení vypršelo.")
            params = AuthorizationParams.model_validate(row.payload["params"])
            return params.scopes or [READ_SCOPE]

    def _load(self, kind: str, value: str) -> dict[str, Any] | None:
        with self.sessions() as db:
            row = _grant(db, kind, value)
            return {**row.payload, "expires_at": row.expires_at} if row else None

    async def load_authorization_code(
        self,
        client: OAuthClientInformationFull,
        authorization_code: str,
    ) -> AuthorizationCode | None:
        values = await run_in_threadpool(self._load, "code", authorization_code)
        if values is None or values["client_id"] != client.client_id:
            return None
        return AuthorizationCode.model_validate({**values, "code": authorization_code})

    async def load_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: str
    ) -> RefreshToken | None:
        values = await run_in_threadpool(self._load, "refresh", refresh_token)
        if values is None or values["client_id"] != client.client_id:
            return None
        return RefreshToken.model_validate({**values, "token": refresh_token})

    async def load_access_token(self, token: str) -> AccessToken | None:
        values = await run_in_threadpool(self._load, "access", token)
        return (
            AccessToken.model_validate({**values, "token": token}) if values is not None else None
        )

    def _exchange(self, client_id: str, kind: str, value: str, scopes: list[str]) -> OAuthToken:
        with self.sessions() as db, db.begin():
            if not _lock_client(db, client_id):
                raise TokenError("invalid_grant")
            row = _grant(db, kind, value, lock=True)
            if (
                row is None
                or row.payload["client_id"] != client_id
                or READ_SCOPE not in scopes
                or not set(scopes) <= set(row.payload["scopes"])
            ):
                raise TokenError("invalid_grant")
            family = row.family
            if kind == "code":
                db.delete(row)
            else:
                # Retain inactive digests so a concurrent revocation can find its family.
                for active in ("access", "refresh"):
                    db.execute(
                        update(AttendanceOAuthGrant)
                        .where(
                            AttendanceOAuthGrant.family == family,
                            AttendanceOAuthGrant.kind == active,
                        )
                        .values(kind="old_" + active)
                    )
            base = {
                "client_id": client_id,
                "scopes": scopes,
                "resource": RESOURCE,
                "subject": OWNER,
            }
            access = _put(db, "access", family, 3600, base)
            refresh = _put(db, "refresh", family, 30 * 86400, base)
        return OAuthToken(
            access_token=access,
            refresh_token=refresh,
            token_type="Bearer",
            expires_in=3600,
            scope=" ".join(scopes),
        )

    async def exchange_authorization_code(
        self,
        client: OAuthClientInformationFull,
        authorization_code: AuthorizationCode,
    ) -> OAuthToken:
        return await run_in_threadpool(
            self._exchange,
            client.client_id,
            "code",
            authorization_code.code,
            authorization_code.scopes,
        )

    async def exchange_refresh_token(
        self,
        client: OAuthClientInformationFull,
        refresh_token: RefreshToken,
        scopes: list[str],
    ) -> OAuthToken:
        return await run_in_threadpool(
            self._exchange, client.client_id, "refresh", refresh_token.token, scopes
        )

    def _revoke(self, token: RefreshToken | AccessToken) -> None:
        kind = "refresh" if isinstance(token, RefreshToken) else "access"
        with self.sessions() as db, db.begin():
            if not _lock_client(db, token.client_id):
                return
            row = _grant(db, kind, token.token, lock=True) or _grant(
                db, "old_" + kind, token.token, lock=True
            )
            if row is not None and row.payload["client_id"] == token.client_id:
                db.execute(
                    delete(AttendanceOAuthGrant).where(AttendanceOAuthGrant.family == row.family)
                )

    async def revoke_token(self, token: RefreshToken | AccessToken) -> None:
        await run_in_threadpool(self._revoke, token)
