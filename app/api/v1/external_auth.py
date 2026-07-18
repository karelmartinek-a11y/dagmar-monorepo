# ruff: noqa: B008
from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime, timedelta
from typing import Literal
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload
from starlette.responses import RedirectResponse

from app.api.deps import PortalUserAuth, require_admin, require_portal_user_auth
from app.api.errors import raise_api_error
from app.api.v1.portal_auth import PortalLoginOut, issue_portal_login
from app.config import Settings, get_settings
from app.db.models import ExternalAuthAuditLog, ExternalIdentity, OAuthTransaction, PortalUser
from app.db.session import get_db
from app.security.crypto import decrypt_secret, encrypt_secret
from app.security.csrf import require_csrf
from app.security.passwords import verify_password
from app.security.rate_limit import limiter
from app.security.sessions import set_admin_session
from app.services.external_auth import (
    ExternalAuthError,
    Portal,
    Provider,
    ProviderClaims,
    consume_transaction,
    exchange_and_validate,
    provider_enabled,
    safe_return_path,
    start_transaction,
    utc_aware,
)

router = APIRouter(prefix="/api/v1", tags=["external-auth"])
BROWSER_COOKIE = "dagmar_oauth_browser"
RESULT_COOKIE = "dagmar_oauth_result"


class PasswordConfirmation(BaseModel):
    password: str = Field(min_length=1, max_length=512)
    return_path: str | None = Field(default=None, max_length=255)


class MethodOut(BaseModel):
    provider: Provider
    enabled: bool
    linked: bool
    identifier: str | None = None
    linked_at: datetime | None = None
    last_login_at: datetime | None = None


class MethodsOut(BaseModel):
    password_enabled: bool = True
    methods: list[MethodOut]


class StartOut(BaseModel):
    authorization_url: str


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _mask_email(email: str | None) -> str | None:
    if not email or "@" not in email:
        return None
    local, domain = email.rsplit("@", 1)
    return f"{local[:2]}…@{domain}" if local else f"…@{domain}"


def _source_hash(request: Request, settings: Settings) -> str | None:
    if request.client is None:
        return None
    return _hash(f"{settings.session_secret}:{request.client.host}")


def _audit(
    db: Session,
    request: Request,
    settings: Settings,
    *,
    portal: str,
    provider: str,
    event: str,
    outcome: str,
    account_ref: str | None = None,
    reason: str | None = None,
    subject: str | None = None,
) -> None:
    db.add(
        ExternalAuthAuditLog(
            account_type=portal,
            account_ref=account_ref,
            provider=provider,
            event=event,
            outcome=outcome,
            reason=reason,
            subject_hash=_hash(f"{settings.session_secret}:{subject}") if subject else None,
            request_id=getattr(request.state, "request_id", None),
            source_ip_hash=_source_hash(request, settings),
        )
    )


def _identity_query(portal: str, provider: str, account_ref: int | str):
    query = select(ExternalIdentity).where(
        ExternalIdentity.account_type == portal,
        ExternalIdentity.provider == provider,
    )
    if portal == "employee":
        return query.where(ExternalIdentity.portal_user_id == int(account_ref))
    return query.where(ExternalIdentity.admin_username == str(account_ref))


def _method_status(db: Session, settings: Settings, portal: str, account_ref: int | str) -> MethodsOut:
    methods: list[MethodOut] = []
    for provider in ("google", "apple"):
        identity = db.execute(_identity_query(portal, provider, account_ref)).scalar_one_or_none()
        methods.append(
            MethodOut(
                provider=provider,
                enabled=provider_enabled(settings, provider),
                linked=identity is not None,
                identifier=_mask_email(identity.email) if identity else None,
                linked_at=identity.linked_at if identity else None,
                last_login_at=identity.last_login_at if identity else None,
            )
        )
    return MethodsOut(methods=methods)


@router.get("/auth/providers")
def providers(settings: Settings = Depends(get_settings)):
    return {"google": provider_enabled(settings, "google"), "apple": provider_enabled(settings, "apple")}


@router.get("/portal/auth-methods", response_model=MethodsOut)
def employee_methods(
    auth: PortalUserAuth = Depends(require_portal_user_auth),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    return _method_status(db, settings, "employee", auth.user.id)


@router.get("/admin/auth-methods", response_model=MethodsOut)
def admin_methods(
    admin=Depends(require_admin),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    return _method_status(db, settings, "admin", str(admin.username))


def _verify_link_password(portal: Portal, password: str, *, employee: PortalUser | None, admin_username: str | None, settings: Settings) -> None:
    if portal == "employee":
        valid = bool(employee and employee.password_hash and verify_password(password, employee.password_hash))
    else:
        valid = bool(
            admin_username
            and admin_username == settings.admin_username.lower()
            and settings.admin_password_hash
            and verify_password(password, settings.admin_password_hash)
        )
    if not valid:
        raise_api_error(401, "fresh_password_required", "Pro tuto operaci je nutné znovu ověřit interní heslo.")


def _set_browser_cookie(response: Response, value: str, settings: Settings) -> None:
    response.set_cookie(
        BROWSER_COOKIE,
        value,
        max_age=settings.external_auth_transaction_ttl_seconds,
        secure=settings.cookie_secure,
        httponly=True,
        samesite="none" if settings.cookie_secure else "lax",
        path="/api/v1/auth",
    )


@router.get("/auth/{portal}/{provider}/start")
@limiter.limit("20/minute")
def login_start(
    request: Request,
    portal: Literal["employee", "admin"],
    provider: Literal["google", "apple"],
    return_path: str | None = None,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    try:
        started = start_transaction(
            db,
            provider=provider,
            purpose="login",
            portal=portal,
            return_path=return_path,
            browser_secret=request.cookies.get(BROWSER_COOKIE),
            settings=settings,
        )
    except ExternalAuthError as exc:
        raise_api_error(503, exc.code, "Externí přihlášení nyní není dostupné.")
    _audit(db, request, settings, portal=portal, provider=provider, event="login_started", outcome="success")
    db.commit()
    response = RedirectResponse(started.authorization_url, status_code=303)
    _set_browser_cookie(response, started.browser_secret, settings)
    response.headers["Cache-Control"] = "no-store"
    return response


def _start_link(
    request: Request,
    payload: PasswordConfirmation,
    provider: Provider,
    portal: Portal,
    account_ref: int | str,
    employee: PortalUser | None,
    db: Session,
    settings: Settings,
) -> Response:
    admin_username = str(account_ref).lower() if portal == "admin" else None
    _verify_link_password(portal, payload.password, employee=employee, admin_username=admin_username, settings=settings)
    if db.execute(_identity_query(portal, provider, account_ref)).scalar_one_or_none():
        raise_api_error(409, "identity_already_linked", "Tato přihlašovací metoda je již propojena.")
    started = start_transaction(
        db,
        provider=provider,
        purpose="link",
        portal=portal,
        return_path=payload.return_path,
        browser_secret=request.cookies.get(BROWSER_COOKIE),
        settings=settings,
        portal_user_id=int(account_ref) if portal == "employee" else None,
        admin_username=admin_username,
    )
    _audit(db, request, settings, portal=portal, provider=provider, event="link_started", outcome="success", account_ref=str(account_ref))
    db.commit()
    response = Response(
        content=StartOut(authorization_url=started.authorization_url).model_dump_json(),
        media_type="application/json",
    )
    _set_browser_cookie(response, started.browser_secret, settings)
    response.headers["Cache-Control"] = "no-store"
    return response


@router.post("/portal/auth-methods/{provider}/link")
@limiter.limit("10/minute")
def employee_link(
    request: Request,
    payload: PasswordConfirmation,
    provider: Literal["google", "apple"],
    auth: PortalUserAuth = Depends(require_portal_user_auth),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    return _start_link(request, payload, provider, "employee", auth.user.id, auth.user, db, settings)


@router.post("/admin/auth-methods/{provider}/link")
@limiter.limit("10/minute")
def admin_link(
    request: Request,
    payload: PasswordConfirmation,
    provider: Literal["google", "apple"],
    admin=Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    return _start_link(request, payload, provider, "admin", str(admin.username), None, db, settings)


def _unlink(
    request: Request,
    payload: PasswordConfirmation,
    provider: Provider,
    portal: Portal,
    account_ref: int | str,
    employee: PortalUser | None,
    db: Session,
    settings: Settings,
):
    admin_username = str(account_ref).lower() if portal == "admin" else None
    _verify_link_password(portal, payload.password, employee=employee, admin_username=admin_username, settings=settings)
    identity = db.execute(_identity_query(portal, provider, account_ref)).scalar_one_or_none()
    if identity is None:
        raise_api_error(404, "identity_not_linked", "Tato přihlašovací metoda není propojena.")
    pending = select(OAuthTransaction).where(
        OAuthTransaction.provider == provider,
        OAuthTransaction.portal == portal,
        OAuthTransaction.purpose == "link",
        OAuthTransaction.consumed_at.is_(None),
    )
    pending = pending.where(OAuthTransaction.portal_user_id == int(account_ref)) if portal == "employee" else pending.where(OAuthTransaction.admin_username == admin_username)
    db.execute(delete(OAuthTransaction).where(OAuthTransaction.id.in_(pending.with_only_columns(OAuthTransaction.id))))
    subject = identity.subject
    db.delete(identity)
    _audit(db, request, settings, portal=portal, provider=provider, event="unlinked", outcome="success", account_ref=str(account_ref), subject=subject)
    db.commit()
    return {"ok": True}


@router.delete("/portal/auth-methods/{provider}")
@limiter.limit("10/minute")
def employee_unlink(
    request: Request,
    response: Response,
    payload: PasswordConfirmation,
    provider: Literal["google", "apple"],
    auth: PortalUserAuth = Depends(require_portal_user_auth),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    return _unlink(request, payload, provider, "employee", auth.user.id, auth.user, db, settings)


@router.delete("/admin/auth-methods/{provider}")
@limiter.limit("10/minute")
def admin_unlink(
    request: Request,
    response: Response,
    payload: PasswordConfirmation,
    provider: Literal["google", "apple"],
    admin=Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    return _unlink(request, payload, provider, "admin", str(admin.username), None, db, settings)


def _callback_error_path(transaction: OAuthTransaction | None, code: str) -> str:
    base = transaction.return_path if transaction else "/app"
    if transaction and transaction.portal == "admin" and transaction.purpose == "login":
        return f"/admin/login?{urlencode({'external_auth_error': code, 'next': base})}"
    separator = "&" if "?" in base else "?"
    return f"{base}{separator}external_auth_error={code}"


def _complete_link(db: Session, request: Request, settings: Settings, transaction: OAuthTransaction, claims: ProviderClaims) -> None:
    existing_subject = db.execute(
        select(ExternalIdentity).where(
            ExternalIdentity.provider == transaction.provider,
            ExternalIdentity.issuer == claims.issuer,
            ExternalIdentity.subject == claims.subject,
        )
    ).scalar_one_or_none()
    if existing_subject is not None:
        same_target = (
            transaction.portal == existing_subject.account_type
            and (
                (transaction.portal == "employee" and transaction.portal_user_id == existing_subject.portal_user_id)
                or (transaction.portal == "admin" and transaction.admin_username == existing_subject.admin_username)
            )
        )
        if same_target:
            raise ExternalAuthError("identity_already_linked")
        raise ExternalAuthError("identity_owned_by_another_account")
    identity = ExternalIdentity(
        account_type=transaction.portal,
        portal_user_id=transaction.portal_user_id,
        admin_username=transaction.admin_username,
        provider=transaction.provider,
        issuer=claims.issuer,
        subject=claims.subject,
        email=claims.email,
        email_verified=claims.email_verified,
        created_ip_hash=_source_hash(request, settings),
        created_user_agent=(request.headers.get("user-agent") or "")[:255] or None,
    )
    db.add(identity)
    try:
        db.flush()
    except IntegrityError as exc:
        raise ExternalAuthError("identity_link_conflict") from exc


def _complete_login(db: Session, transaction: OAuthTransaction, claims: ProviderClaims, settings: Settings) -> PortalLoginOut | None:
    identity = db.execute(
        select(ExternalIdentity).where(
            ExternalIdentity.provider == transaction.provider,
            ExternalIdentity.issuer == claims.issuer,
            ExternalIdentity.subject == claims.subject,
            ExternalIdentity.account_type == transaction.portal,
        )
    ).scalar_one_or_none()
    if identity is None:
        raise ExternalAuthError("external_identity_not_linked")
    identity.last_login_at = datetime.now(UTC)
    identity.email = claims.email or identity.email
    identity.email_verified = claims.email_verified if claims.email_verified is not None else identity.email_verified
    db.add(identity)
    if transaction.portal == "employee":
        user = db.execute(
            select(PortalUser)
            .options(selectinload(PortalUser.employments), selectinload(PortalUser.instance))
            .where(PortalUser.id == identity.portal_user_id)
        ).scalar_one_or_none()
        if user is None or not user.is_active:
            raise ExternalAuthError("external_account_inactive")
        return issue_portal_login(user, db)
    if not settings.admin_password_hash or identity.admin_username != settings.admin_username.lower():
        raise ExternalAuthError("external_account_inactive")
    return None


def _handle_callback(
    request: Request,
    provider: Provider,
    state: str | None,
    code: str | None,
    provider_error: str | None,
    db: Session,
    settings: Settings,
):
    transaction: OAuthTransaction | None = None
    try:
        if not state:
            raise ExternalAuthError("invalid_state")
        transaction = consume_transaction(
            db,
            provider=provider,
            state=state,
            browser_secret=request.cookies.get(BROWSER_COOKIE),
        )
        if provider_error:
            raise ExternalAuthError("provider_cancelled" if provider_error == "access_denied" else "provider_error")
        if not code:
            raise ExternalAuthError("authorization_code_missing")
        claims = exchange_and_validate(provider, code, transaction, settings)
        account_ref = str(transaction.portal_user_id or transaction.admin_username or "") or None
        if transaction.purpose == "link":
            _complete_link(db, request, settings, transaction, claims)
            _audit(db, request, settings, portal=transaction.portal, provider=provider, event="linked", outcome="success", account_ref=account_ref, subject=claims.subject)
            db.commit()
            response = RedirectResponse(transaction.return_path + "?external_auth_linked=" + provider, status_code=303)
        else:
            login = _complete_login(db, transaction, claims, settings)
            _audit(db, request, settings, portal=transaction.portal, provider=provider, event="login", outcome="success", account_ref=account_ref, subject=claims.subject)
            if transaction.portal == "employee":
                transaction.result_payload = encrypt_secret(login.model_dump_json(), secret=settings.session_secret) if login else None
                transaction.result_expires_at = datetime.now(UTC) + timedelta(seconds=settings.external_auth_result_ttl_seconds)
                db.add(transaction)
                db.commit()
                response = RedirectResponse(safe_return_path("employee", "login", transaction.return_path) + "?external_auth=complete", status_code=303)
                response.set_cookie(RESULT_COOKIE, transaction.id, max_age=settings.external_auth_result_ttl_seconds, secure=settings.cookie_secure, httponly=True, samesite="lax", path="/api/v1/auth/result")
            else:
                db.commit()
                response = RedirectResponse(safe_return_path("admin", "login", transaction.return_path), status_code=303)
                set_admin_session(response, username=str(transaction.admin_username or settings.admin_username).lower(), settings=settings)
        response.headers["Cache-Control"] = "no-store"
        return response
    except ExternalAuthError as exc:
        db.rollback()
        portal = transaction.portal if transaction else "employee"
        account_ref = str(transaction.portal_user_id or transaction.admin_username or "") if transaction else None
        _audit(db, request, settings, portal=portal, provider=provider, event="callback", outcome="failure", account_ref=account_ref, reason=exc.code)
        db.commit()
        response = RedirectResponse(_callback_error_path(transaction, exc.code), status_code=303)
        response.headers["Cache-Control"] = "no-store"
        return response


@router.get("/auth/google/callback")
@limiter.limit("30/minute")
def google_callback(
    request: Request,
    state: str | None = None,
    code: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    return _handle_callback(request, "google", state, code, error, db, settings)


@router.post("/auth/apple/callback")
@limiter.limit("30/minute")
async def apple_callback(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    form = await request.form()
    state = form.get("state")
    code = form.get("code")
    error = form.get("error")
    return _handle_callback(
        request,
        "apple",
        state if isinstance(state, str) else None,
        code if isinstance(code, str) else None,
        error if isinstance(error, str) else None,
        db,
        settings,
    )


@router.post("/auth/result", response_model=PortalLoginOut)
@limiter.limit("20/minute")
def consume_login_result(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    transaction_id = request.cookies.get(RESULT_COOKIE)
    browser_secret = request.cookies.get(BROWSER_COOKIE)
    transaction = db.get(OAuthTransaction, transaction_id) if transaction_id else None
    now = datetime.now(UTC)
    if (
        transaction is None
        or transaction.portal != "employee"
        or transaction.purpose != "login"
        or transaction.result_consumed_at is not None
        or transaction.result_expires_at is None
        or utc_aware(transaction.result_expires_at) <= now
        or not browser_secret
        or transaction.browser_hash != _hash(browser_secret)
        or not transaction.result_payload
    ):
        response.delete_cookie(RESULT_COOKIE, path="/api/v1/auth/result")
        raise_api_error(400, "oauth_result_invalid", "Výsledek přihlášení není dostupný nebo vypršel.")
    try:
        payload = decrypt_secret(transaction.result_payload, secret=settings.session_secret)
        login = PortalLoginOut.model_validate_json(payload or "")
    except (ValueError, json.JSONDecodeError):
        raise_api_error(400, "oauth_result_invalid", "Výsledek přihlášení není platný.")
    transaction.result_consumed_at = now
    transaction.result_payload = None
    db.add(transaction)
    db.commit()
    response.delete_cookie(RESULT_COOKIE, path="/api/v1/auth/result")
    response.headers["Cache-Control"] = "no-store"
    return login
