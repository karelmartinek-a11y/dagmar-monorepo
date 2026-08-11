# ruff: noqa: B008
from __future__ import annotations

import json
import logging
import smtplib
from email.message import EmailMessage

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field, ValidationError

from app.api.errors import raise_api_error, raise_enveloped_api_error
from app.config import Settings, get_settings
from app.db.models import AppSettings
from app.db.session import get_db
from app.security.crypto import decrypt_secret
from app.security.csrf import csrf_issue_token, require_csrf
from app.security.lockout import (
    ADMIN_LOCKOUT_DURATION,
    ADMIN_LOCKOUT_THRESHOLD,
    ADMIN_LOCKOUT_WINDOW,
    clear_user_lockout,
    get_lockout_state,
    is_locked,
    record_failed_login,
)
from app.security.passwords import verify_password
from app.security.rate_limit import limiter
from app.security.sessions import clear_admin_session, get_admin_session, set_admin_session

router = APIRouter(tags=["admin"])
logger = logging.getLogger("dagmar.security")


def _audit_admin_login(request: Request, event: str) -> None:
    source_ip = request.headers.get("x-real-ip") or (
        request.client.host if request.client else "unknown"
    )
    logger.info(
        "security_event=%s request_id=%s source_ip=%s",
        event,
        getattr(request.state, "request_id", "unknown"),
        source_ip,
    )


class AdminLoginBody(BaseModel):
    username: str | None = Field(default=None, min_length=1, max_length=128)
    email: str | None = Field(default=None, min_length=3, max_length=160)
    password: str = Field(min_length=1, max_length=256)


class AdminForgotPasswordIn(BaseModel):
    email: str = Field(min_length=3, max_length=160)


class AdminMeResponse(BaseModel):
    authenticated: bool
    username: str | None = None


class CsrfTokenResponse(BaseModel):
    csrf_token: str


def _smtp_settings(db):
    return db.query(AppSettings).filter(AppSettings.id == 1).one_or_none()


def _send_admin_help_email(*, settings: Settings, to_email: str, cfg: AppSettings | None) -> None:
    if cfg is None or not cfg.smtp_host or not cfg.smtp_port:
        return

    smtp_secret = settings.smtp_password_secret or settings.session_secret
    password = decrypt_secret(cfg.smtp_password, secret=smtp_secret) if cfg.smtp_password else None
    username = (cfg.smtp_username or "").strip()
    from_email = (cfg.smtp_from_email or username or "").strip()
    if not from_email:
        return

    msg = EmailMessage()
    msg["Subject"] = "Pomoc s přístupem do administrace DAGMAR"
    msg["From"] = f"{cfg.smtp_from_name} <{from_email}>" if cfg.smtp_from_name else from_email
    msg["To"] = to_email
    msg.set_content(
        "Dobrý den,\n\n"
        "pro reset administrátorského hesla kontaktujte interní podporu provozu HCASC.\n"
        "Tento e-mail úmyslně neobsahuje resetovací odkaz ani token.\n\n"
        "DAGMAR backend"
    )

    security = (cfg.smtp_security or "SSL").strip().upper()
    server: smtplib.SMTP
    if security == "SSL":
        server = smtplib.SMTP_SSL(cfg.smtp_host, int(cfg.smtp_port), timeout=20)
    else:
        server = smtplib.SMTP(cfg.smtp_host, int(cfg.smtp_port), timeout=20)
        if security == "STARTTLS":
            server.starttls()

    try:
        if username and password:
            server.login(username, password)
        server.send_message(msg)
    finally:
        server.quit()


async def _parse_admin_login_body(request: Request) -> AdminLoginBody | None:
    raw_body = await request.body()
    payload: AdminLoginBody | None = None

    if raw_body:
        try:
            payload = AdminLoginBody.model_validate(json.loads(raw_body))
        except (ValueError, ValidationError):
            payload = None

    if payload is None:
        try:
            form = await request.form()
            raw_username = form.get("username")
            raw_email = form.get("email")
            raw_password = form.get("password")
            payload = AdminLoginBody(
                username=(raw_username.strip() if isinstance(raw_username, str) else "") or None,
                email=(raw_email.strip() if isinstance(raw_email, str) else "") or None,
                password=raw_password if isinstance(raw_password, str) else "",
            )
        except ValidationError:
            raise_api_error(400, "admin_login_missing_credentials", "Vyplňte uživatelské jméno a heslo.")
        except Exception:
            raise_api_error(400, "admin_login_invalid_payload", "Nelze zpracovat přihlašovací údaje.")

    return payload


@router.post("/api/v1/admin/forgot-password")
async def admin_forgot_password(
    payload: AdminForgotPasswordIn,
    settings: Settings = Depends(get_settings),
    db=Depends(get_db),
):
    requested = payload.email.strip().lower()
    if requested == (settings.admin_username or "").strip().lower():
        cfg = _smtp_settings(db)
        _send_admin_help_email(settings=settings, to_email=requested, cfg=cfg)
    return {"ok": True}


@router.post("/api/v1/admin/login")
@limiter.limit("10/minute")
async def admin_login(
    request: Request,
    response: Response,
    settings: Settings = Depends(get_settings),
    db=Depends(get_db),
):
    """Admin login.

    Contract:
      - POST /api/v1/admin/login
      - body { username, password }
      - sets session cookie

    Notes:
      - Only a single admin credential pair is supported (seeded via env).
      - Session is a stateless signed HttpOnly cookie.
    """

    configured_user = (settings.admin_username or "").strip().lower()
    configured_hash = settings.admin_password_hash

    if not configured_hash:
        raise_enveloped_api_error(
            503,
            "admin_account_not_initialized",
            "Admin účet není inicializován v bezpečné serverové konfiguraci.",
        )

    lock_state = get_lockout_state(db, actor_type="admin", principal=configured_user, create=True)
    if lock_state is not None and is_locked(lock_state):
        db.commit()
        _audit_admin_login(request, "admin_login_locked")
        raise_enveloped_api_error(
            423,
            "admin_account_locked",
            "Administrátorský účet je na 15 minut uzamčen.",
        )

    payload = await _parse_admin_login_body(request)
    if not payload:
        raise_api_error(400, "admin_login_missing_credentials", "Vyplňte uživatelské jméno a heslo.")

    username = (payload.username or payload.email or "").strip().lower()
    if not username or not payload.password:
        raise_api_error(400, "admin_login_missing_credentials", "Vyplňte uživatelské jméno a heslo.")

    user_ok = username == configured_user
    pass_ok = verify_password(payload.password, configured_hash)

    if not (user_ok and pass_ok):
        if lock_state is not None:
            record_failed_login(
                lock_state,
                lock_duration=ADMIN_LOCKOUT_DURATION,
                threshold=ADMIN_LOCKOUT_THRESHOLD,
                window=ADMIN_LOCKOUT_WINDOW,
            )
            db.add(lock_state)
            db.commit()
            if is_locked(lock_state):
                _audit_admin_login(request, "admin_login_lock_started")
                raise_enveloped_api_error(
                    423,
                    "admin_account_locked",
                    "Administrátorský účet je na 15 minut uzamčen.",
                )
        _audit_admin_login(request, "admin_login_failed")
        raise_api_error(401, "admin_login_invalid_credentials", "Neplatné přihlašovací údaje")

    clear_user_lockout(db, actor_type="admin", principal=configured_user)
    db.commit()
    _audit_admin_login(request, "admin_login_succeeded")
    set_admin_session(response=response, username=configured_user, settings=settings)
    csrf = csrf_issue_token(request=request, response=response, settings=settings)
    return {"ok": True, "csrf_token": csrf}


@router.get("/api/v1/admin/csrf", response_model=CsrfTokenResponse)
async def admin_csrf(
    request: Request,
    response: Response,
    settings: Settings = Depends(get_settings),
):
    csrf = csrf_issue_token(request=request, response=response, settings=settings)
    return {"csrf_token": csrf}


@router.post("/api/v1/admin/logout")
async def admin_logout(
    request: Request,
    response: Response,
    settings: Settings = Depends(get_settings),
    _: None = Depends(require_csrf),
):
    clear_admin_session(response=response, settings=settings)
    return {"ok": True}


@router.get("/api/v1/admin/me", response_model=AdminMeResponse)
async def admin_me(
    request: Request,
    settings: Settings = Depends(get_settings),
):
    sess = get_admin_session(request=request, settings=settings)
    if not sess or not sess.is_authenticated:
        return AdminMeResponse(authenticated=False)
    return AdminMeResponse(authenticated=True, username=sess.username)
