# ruff: noqa: B008
from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from typing import NoReturn

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import PortalUserAuth, require_portal_user_auth
from app.api.errors import raise_api_error
from app.config import Settings, get_settings
from app.db.models import (
    Employment,
    InstanceStatus,
    PortalUser,
    PortalUserResetToken,
    PortalUserRole,
    ResetDeliveryState,
)
from app.db.session import get_db
from app.security.csrf import csrf_issue_token
from app.security.lockout import (
    PORTAL_LOCKOUT_DURATION,
    clear_user_lockout,
    get_lockout_state,
    is_locked,
    record_failed_login,
)
from app.security.passwords import hash_password, verify_password_details
from app.security.sessions import clear_portal_session, set_portal_session
from app.services.employment_access import (
    employment_is_valid_on_day,
    employment_label,
    select_login_employments,
)
from app.services.portal_credentials import change_portal_password, lock_portal_user
from app.services.prague_time import prague_today

router = APIRouter(prefix="/api/v1/portal", tags=["portal-auth"])

PORTAL_ACCOUNT_BLOCKED_MESSAGE = "Váš přístup byl zablokován, obraťte se na svého nadřízeného."


class PortalLoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=160)
    password: str = Field(min_length=1, max_length=256)


class LoginEmploymentOut(BaseModel):
    id: int
    title: str
    employment_type: str
    start_date: str
    end_date: str | None = None
    is_active: bool
    is_current: bool
    label: str


class PortalLoginOut(BaseModel):
    display_name: str
    employment_id: int | None = None
    available_employments: list[LoginEmploymentOut]


class PortalResetIn(BaseModel):
    token: str = Field(min_length=16, max_length=512)
    password: str = Field(min_length=8, max_length=512)


class OkOut(BaseModel):
    ok: bool = True


def _record_login_failure(db: Session, *, email: str, detail: str) -> NoReturn:
    state = get_lockout_state(db, actor_type="portal", principal=email, create=True)
    if state is None:
        raise_api_error(401, "portal_invalid_credentials", detail)
    locked_now = record_failed_login(state, lock_duration=PORTAL_LOCKOUT_DURATION)
    db.add(state)
    db.commit()
    if locked_now or is_locked(state):
        raise_api_error(423, "portal_account_locked", "Účet je dočasně uzamčen po opakovaných neplatných pokusech.")
    raise_api_error(401, "portal_invalid_credentials", detail)


def _to_login_employment_out(employment: Employment, today) -> LoginEmploymentOut:
    return LoginEmploymentOut(
        id=employment.id,
        title=employment.title,
        employment_type=employment.employment_type,
        start_date=employment.start_date.isoformat(),
        end_date=employment.end_date.isoformat() if employment.end_date is not None else None,
        is_active=employment.is_active,
        is_current=employment_is_valid_on_day(employment, today),
        label=employment_label(employment),
    )


def issue_portal_login(user: PortalUser, db: Session) -> PortalLoginOut:
    """Prepare browser login metadata without rotating the non-browser bearer."""
    if user.is_blocked:
        raise_api_error(403, "portal_account_blocked", PORTAL_ACCOUNT_BLOCKED_MESSAGE)
    if not user.is_active or user.role != PortalUserRole.EMPLOYEE:
        raise_api_error(403, "external_account_inactive", "Interní účet není aktivní.")
    if not user.instance_id or user.instance is None:
        raise_api_error(409, "portal_missing_instance_token", "Uživatel nemá připravený přístupový token.")
    if user.instance.status != InstanceStatus.ACTIVE:
        raise_api_error(403, "portal_instance_inactive", "Přístupová instance není aktivní.")
    today = prague_today()
    selection = select_login_employments(user, today)
    if not selection.available:
        raise_api_error(
            403,
            "portal_no_available_employment",
            "Přihlášení není povoleno, protože uživatel nemá dostupný úvazek v povoleném přihlašovacím okně.",
        )
    user.instance.last_seen_at = datetime.now(UTC)
    db.add(user.instance)
    return PortalLoginOut(
        display_name=user.name,
        employment_id=selection.default.id if selection.default is not None else None,
        available_employments=[_to_login_employment_out(item, today) for item in selection.available],
    )


@router.post("/login", response_model=PortalLoginOut)
def portal_login(
    payload: PortalLoginIn,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    email = payload.email.strip().lower()
    lock_state = get_lockout_state(db, actor_type="portal", principal=email, create=True)
    if lock_state is not None and is_locked(lock_state):
        db.commit()
        raise_api_error(423, "portal_account_locked", "Účet je dočasně uzamčen po opakovaných neplatných pokusech.")

    user = (
        db.execute(
            select(PortalUser)
            .options(selectinload(PortalUser.employments))
            .where(PortalUser.email == email)
        )
        .scalars()
        .first()
    )
    if user is None:
        _record_login_failure(db, email=email, detail="Neplatne prihlasovaci udaje")
    if not user.is_active or user.password_hash is None:
        _record_login_failure(db, email=email, detail="Neplatne prihlasovaci udaje")
    if user.role != PortalUserRole.EMPLOYEE:
        _record_login_failure(db, email=email, detail="Nepodporovaný typ účtu")

    password_verification = verify_password_details(payload.password, user.password_hash)
    if not password_verification.valid:
        _record_login_failure(db, email=email, detail="Neplatne prihlasovaci udaje")
    if password_verification.needs_rehash:
        user.password_hash = hash_password(payload.password).value
        db.add(user)

    if user.is_blocked:
        db.commit()
        raise_api_error(403, "portal_account_blocked", PORTAL_ACCOUNT_BLOCKED_MESSAGE)

    login = issue_portal_login(user, db)
    clear_user_lockout(db, actor_type="portal", principal=email)
    db.commit()
    set_portal_session(
        response,
        user_id=user.id,
        password_hash=user.password_hash,
        settings=settings,
    )
    response.headers["Cache-Control"] = "no-store"
    return login


@router.get("/session", response_model=PortalLoginOut)
def portal_session(auth: PortalUserAuth = Depends(require_portal_user_auth)):
    today = prague_today()
    selection = select_login_employments(auth.user, today)
    return PortalLoginOut(
        display_name=auth.user.name,
        employment_id=selection.default.id if selection.default is not None else None,
        available_employments=[_to_login_employment_out(item, today) for item in selection.available],
    )


@router.get("/csrf")
def portal_csrf(
    request: Request,
    response: Response,
    settings: Settings = Depends(get_settings),
):
    return {"csrf_token": csrf_issue_token(request=request, response=response, settings=settings)}


@router.post("/logout", response_model=OkOut)
def portal_logout(
    response: Response,
    _auth: PortalUserAuth = Depends(require_portal_user_auth),
):
    clear_portal_session(response)
    response.headers["Cache-Control"] = "no-store"
    return OkOut()


@router.post("/reset", response_model=OkOut)
def portal_reset(
    payload: PortalResetIn,
    response: Response,
    db: Session = Depends(get_db),
):
    token_hash = hashlib.sha256(payload.token.encode("utf-8")).hexdigest()
    now = datetime.now(UTC)
    row = db.execute(
        select(PortalUserResetToken)
        .where(PortalUserResetToken.token_hash == token_hash)
        .where(PortalUserResetToken.used_at.is_(None))
        .where(PortalUserResetToken.revoked_at.is_(None))
        .where(PortalUserResetToken.delivery_state == ResetDeliveryState.SENT)
        .where(PortalUserResetToken.expires_at > now)
    ).scalars().first()

    if not row or not row.user or not row.user.is_active:
        raise_api_error(400, "portal_reset_token_invalid", "Odkaz je neplatný nebo vypršel.")
    if row.user.is_blocked:
        raise_api_error(403, "portal_account_blocked", PORTAL_ACCOUNT_BLOCKED_MESSAGE)

    user = lock_portal_user(db, row.user_id)
    if user is None or not user.is_active:
        raise_api_error(400, "portal_reset_token_invalid", "Odkaz je neplatný nebo vypršel.")
    if user.is_blocked:
        raise_api_error(403, "portal_account_blocked", PORTAL_ACCOUNT_BLOCKED_MESSAGE)
    row = db.execute(
        select(PortalUserResetToken)
        .where(PortalUserResetToken.id == row.id)
        .where(PortalUserResetToken.used_at.is_(None))
        .where(PortalUserResetToken.revoked_at.is_(None))
        .where(PortalUserResetToken.delivery_state == ResetDeliveryState.SENT)
        .where(PortalUserResetToken.expires_at > now)
        .with_for_update()
    ).scalar_one_or_none()
    if row is None:
        raise_api_error(400, "portal_reset_token_invalid", "Odkaz je neplatný nebo vypršel.")
    try:
        change_portal_password(db, user, payload.password)
    except ValueError as exc:
        raise_api_error(400, "portal_password_policy_failed", str(exc))

    row.used_at = now
    db.add(row)
    db.commit()
    clear_portal_session(response)
    response.headers["Cache-Control"] = "no-store"

    return OkOut(ok=True)
