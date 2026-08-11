from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass
from typing import Literal

from starlette.requests import Request
from starlette.responses import Response

from app.config import Settings, get_settings

SESSION_COOKIE_NAME = "dagmar_admin_session"
ADMIN_SESSION_COOKIE = SESSION_COOKIE_NAME
PORTAL_SESSION_COOKIE = "dagmar_portal_session"


@dataclass(frozen=True)
class AdminSession:
    username: str | None
    issued_at: int

    @property
    def is_authenticated(self) -> bool:
        return bool(self.username)


@dataclass(frozen=True)
class PortalSession:
    user_id: int | None
    credential_tag: str | None
    issued_at: int

    @property
    def is_authenticated(self) -> bool:
        return self.user_id is not None and bool(self.credential_tag)


@dataclass(frozen=True)
class SessionCookieConfig:
    name: str = SESSION_COOKIE_NAME
    path: str = "/"
    secure: bool = True
    httponly: bool = True
    samesite: Literal["lax", "strict"] = "lax"
    max_age_seconds: int = 60 * 60 * 12


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def generate_session_id() -> str:
    return _b64url(secrets.token_bytes(32))


def _sign(payload: str, secret: str) -> str:
    mac = hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).digest()
    return _b64url(mac)


def _portal_credential_tag(password_hash: str, secret: str) -> str:
    return _sign(f"portal-password:{password_hash}", secret)


def _cookie_cfg_from_settings(settings: Settings) -> SessionCookieConfig:
    return SessionCookieConfig(
        name=settings.admin_session_cookie,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        max_age_seconds=settings.session_max_age_seconds,
    )


def set_admin_session(
    response: Response,
    *,
    username: str,
    settings: Settings | None = None,
) -> None:
    """Issue the stateless, signed admin session cookie."""

    settings = settings or get_settings()
    issued_at = int(time.time())
    payload = json.dumps(
        {"u": username, "iat": issued_at, "jti": generate_session_id()},
        separators=(",", ":"),
    )
    sig = _sign(payload, settings.session_secret)
    token = f"{_b64url(payload.encode('utf-8'))}.{sig}"

    cfg = _cookie_cfg_from_settings(settings)
    response.set_cookie(
        cfg.name,
        token,
        max_age=cfg.max_age_seconds,
        path=cfg.path,
        secure=cfg.secure,
        httponly=True,
        samesite=cfg.samesite,
    )


def clear_admin_session(
    response: Response,
    *,
    settings: Settings | None = None,
) -> None:
    settings = settings or get_settings()
    cfg = _cookie_cfg_from_settings(settings)
    response.delete_cookie(cfg.name, path=cfg.path)


def get_admin_session(
    request: Request,
    settings: Settings | None = None,
) -> AdminSession:
    """Validate the stateless admin cookie and return its authentication state."""

    settings = settings or get_settings()
    cfg = _cookie_cfg_from_settings(settings)
    raw = request.cookies.get(cfg.name)
    if not raw:
        return AdminSession(username=None, issued_at=int(time.time()))

    try:
        payload_b64, sig = raw.split(".", 1)
        payload = base64.urlsafe_b64decode(payload_b64 + "==").decode("utf-8")
    except (UnicodeError, ValueError):
        return AdminSession(username=None, issued_at=int(time.time()))

    expected_sig = _sign(payload, settings.session_secret)
    if not hmac.compare_digest(expected_sig, sig):
        return AdminSession(username=None, issued_at=int(time.time()))

    try:
        data = json.loads(payload)
        username = str(data.get("u") or "")
        issued_at = int(data.get("iat") or 0)
    except (AttributeError, TypeError, ValueError, json.JSONDecodeError):
        return AdminSession(username=None, issued_at=int(time.time()))

    if not username or int(time.time()) - issued_at > cfg.max_age_seconds:
        return AdminSession(username=None, issued_at=issued_at)
    return AdminSession(username=username, issued_at=issued_at)


def set_portal_session(
    response: Response,
    *,
    user_id: int,
    password_hash: str,
    settings: Settings,
) -> None:
    """Issue a browser-only session invalidated by the next password change."""

    issued_at = int(time.time())
    payload = json.dumps(
        {
            "uid": user_id,
            "ct": _portal_credential_tag(password_hash, settings.session_secret),
            "iat": issued_at,
            "jti": generate_session_id(),
        },
        separators=(",", ":"),
    )
    token = f"{_b64url(payload.encode('utf-8'))}.{_sign(payload, settings.session_secret)}"
    response.set_cookie(
        PORTAL_SESSION_COOKIE,
        token,
        max_age=settings.session_max_age_seconds,
        path="/",
        secure=settings.cookie_secure,
        httponly=True,
        samesite="lax",
    )


def clear_portal_session(response: Response) -> None:
    response.delete_cookie(PORTAL_SESSION_COOKIE, path="/")


def get_portal_session(request: Request, settings: Settings) -> PortalSession:
    raw = request.cookies.get(PORTAL_SESSION_COOKIE)
    invalid = PortalSession(user_id=None, credential_tag=None, issued_at=int(time.time()))
    if not raw:
        return invalid
    try:
        payload_b64, signature = raw.split(".", 1)
        payload = base64.urlsafe_b64decode(payload_b64 + "==").decode("utf-8")
    except (UnicodeError, ValueError):
        return invalid
    if not hmac.compare_digest(_sign(payload, settings.session_secret), signature):
        return invalid
    try:
        data = json.loads(payload)
        user_id = int(data.get("uid"))
        credential_tag = str(data.get("ct") or "")
        issued_at = int(data.get("iat") or 0)
    except (AttributeError, TypeError, ValueError, json.JSONDecodeError):
        return invalid
    if user_id <= 0 or not credential_tag or int(time.time()) - issued_at > settings.session_max_age_seconds:
        return PortalSession(user_id=None, credential_tag=None, issued_at=issued_at)
    return PortalSession(user_id=user_id, credential_tag=credential_tag, issued_at=issued_at)


def portal_session_matches_password(session: PortalSession, password_hash: str, settings: Settings) -> bool:
    if not session.is_authenticated or session.credential_tag is None:
        return False
    expected = _portal_credential_tag(password_hash, settings.session_secret)
    return hmac.compare_digest(expected, session.credential_tag)
