# ruff: noqa: B008
from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import raise_enveloped_api_error
from app.api.integration_common import (
    IntegrationError,
    get_audit_context,
    get_source_ip,
    init_integration_request,
)
from app.config import Settings, get_settings
from app.db import models
from app.db.session import get_db
from app.security.csrf import require_csrf_header
from app.security.integration_tokens import (
    IntegrationTokenError,
    touch_client_last_used,
    verify_integration_token,
)
from app.security.sessions import (
    get_admin_session,
    get_portal_session,
    portal_session_matches_password,
)
from app.security.tokens import verify_instance_token


@dataclass(frozen=True)
class InstanceAuth:
    instance: models.Instance
    browser_cookie: bool = False


@dataclass(frozen=True)
class PortalUserAuth:
    instance: models.Instance
    user: models.PortalUser


@dataclass(frozen=True)
class IntegrationAuth:
    client: models.IntegrationClient
    secret: models.IntegrationClientSecret


def _bearer_from_auth_header(authorization: str | None) -> str | None:
    if not authorization:
        return None
    parts = authorization.split(" ", 1)
    if len(parts) != 2:
        return None
    scheme, token = parts[0].strip(), parts[1].strip()
    if scheme.lower() != "bearer":
        return None
    return token or None


def require_admin(request: Request):
    sess = get_admin_session(request)
    if not sess or not sess.is_authenticated:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return sess


def require_instance_auth(
    request: Request,
    db: Session = Depends(get_db),
    authorization: str | None = Header(default=None),
) -> InstanceAuth:
    token = _bearer_from_auth_header(authorization)
    if not token:
        raise_enveloped_api_error(
            status.HTTP_401_UNAUTHORIZED,
            "portal_session_missing",
            "Přihlášení chybí.",
        )

    instance = verify_instance_token(db=db, raw_token=token)
    if instance is None:
        raise_enveloped_api_error(
            status.HTTP_401_UNAUTHORIZED,
            "portal_session_invalid",
            "Přihlášení není platné.",
        )

    if instance.status != models.InstanceStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Instance not active")

    return InstanceAuth(instance=instance)


def require_instance(
    request: Request,
    db: Session = Depends(get_db),
    authorization: str | None = Header(default=None),
) -> models.Instance:
    return require_instance_auth(request=request, db=db, authorization=authorization).instance


def require_portal_user_auth(
    request: Request,
    db: Session = Depends(get_db),
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> PortalUserAuth:
    bearer = _bearer_from_auth_header(authorization)
    instance: models.Instance | None
    if bearer:
        auth = require_instance_auth(request=request, db=db, authorization=authorization)
        user = db.execute(
            select(models.PortalUser).where(models.PortalUser.instance_id == auth.instance.id)
        ).scalar_one_or_none()
        instance = auth.instance
    else:
        browser_session = get_portal_session(request, settings)
        if not browser_session.is_authenticated or browser_session.user_id is None:
            raise_enveloped_api_error(
                status.HTTP_401_UNAUTHORIZED, "portal_session_invalid", "Přihlášení není platné."
            )
        user = db.get(models.PortalUser, browser_session.user_id)
        if (
            user is None
            or user.password_hash is None
            or not portal_session_matches_password(browser_session, user.password_hash, settings)
        ):
            raise_enveloped_api_error(
                status.HTTP_401_UNAUTHORIZED, "portal_session_invalid", "Přihlášení není platné."
            )
        instance = user.instance
        require_csrf_header(request)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="K tokenu neni prirazen uzivatel"
        )
    if instance is None or instance.status != models.InstanceStatus.ACTIVE:
        raise_enveloped_api_error(
            status.HTTP_403_FORBIDDEN,
            "portal_instance_inactive",
            "Přístupová instance není aktivní.",
        )
    if user.is_blocked:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "portal_account_blocked",
                "message": "Váš přístup byl zablokován, obraťte se na svého nadřízeného.",
            },
        )
    return PortalUserAuth(instance=instance, user=user)


def require_integration_auth(
    request: Request,
    db: Session = Depends(get_db),
    authorization: str | None = Header(default=None),
) -> IntegrationAuth:
    init_integration_request(request)
    token = _bearer_from_auth_header(authorization)
    if not token:
        raise IntegrationError(
            status.HTTP_401_UNAUTHORIZED,
            "missing_token",
            "Chybí přístupový token.",
        )

    try:
        auth = verify_integration_token(db, token, source_ip=get_source_ip(request))
    except IntegrationTokenError as exc:
        if exc.code == "ip_forbidden":
            raise IntegrationError(status.HTTP_403_FORBIDDEN, exc.code, exc.message) from exc
        raise IntegrationError(status.HTTP_403_FORBIDDEN, "client_disabled", exc.message) from exc

    if auth is None:
        raise IntegrationError(
            status.HTTP_401_UNAUTHORIZED,
            "invalid_token",
            "Přístupový token není platný.",
        )

    audit = get_audit_context(request)
    audit.client_id = auth.client.id
    request.state.integration_rate_key = f"client:{auth.client.id}"

    try:
        touch_client_last_used(db, auth.client)
    except Exception:
        db.rollback()

    return IntegrationAuth(client=auth.client, secret=auth.secret)
