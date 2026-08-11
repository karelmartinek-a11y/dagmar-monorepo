# ruff: noqa: B008
from __future__ import annotations

import hashlib
import logging
import secrets
import smtplib
from datetime import UTC, date, datetime, timedelta
from email.message import EmailMessage
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_admin
from app.api.errors import raise_api_error
from app.config import Settings, get_settings
from app.db.models import (
    AppSettings,
    AuthLockoutState,
    ClientType,
    Employment,
    Instance,
    InstanceStatus,
    PortalUser,
    PortalUserResetToken,
    PortalUserRole,
    ResetDeliveryState,
)
from app.db.session import get_db
from app.security.crypto import decrypt_secret
from app.security.csrf import require_csrf
from app.security.lockout import as_utc, clear_user_lockout, is_locked, revoke_unlock_tokens
from app.services.employment_access import employment_label, select_login_employments
from app.services.portal_credentials import (
    change_portal_password,
    lock_portal_user,
    mark_reset_delivery,
    reset_issuance_lock,
    revoke_instance_credential,
    revoke_password_reset_tokens,
)
from app.services.prague_time import prague_today

router = APIRouter(prefix="/api/v1/admin/users", tags=["admin-users"])
logger = logging.getLogger("dagmar.security")

RESET_TTL_HOURS = 24


class EmploymentOut(BaseModel):
    id: int
    user_id: int
    title: str
    employment_type: str
    start_date: str
    end_date: str | None = None
    is_active: bool
    label: str
    workload_fraction: str | None = None
    time_profile: dict


class PortalUserOut(BaseModel):
    id: int
    name: str
    email: str
    phone: str | None = None
    role: str
    has_password: bool
    is_active: bool
    is_blocked: bool
    is_locked: bool = False
    locked_until: str | None = None
    login_status: str
    login_status_reason: str | None = None
    last_login_at: str | None = None
    employments: list[EmploymentOut]


class PortalUserListOut(BaseModel):
    users: list[PortalUserOut]


class PortalUserBlockIn(BaseModel):
    blocked: bool


class PortalUserCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    email: str = Field(min_length=3, max_length=160)
    phone: str | None = Field(default=None, max_length=32)
    role: str = Field(min_length=1, max_length=32)
    password: str | None = Field(default=None, min_length=8, max_length=256)
    is_active: bool = True

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Jméno je povinné.")
        return normalized

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if "@" not in normalized or "." not in normalized.split("@")[-1]:
            raise ValueError("Zadejte platný e-mail ve formátu jmeno@domena.cz.")
        return normalized

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            return None
        compact = normalized.replace(" ", "")
        if not compact.lstrip("+").isdigit() or len(compact.lstrip("+")) < 9:
            raise ValueError(
                "Telefon zadejte jako české nebo mezinárodní číslo, například +420 777 888 999."
            )
        return normalized


class PortalUserUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    email: str | None = Field(default=None, min_length=3, max_length=160)
    phone: str | None = Field(default=None, max_length=32)
    role: str | None = Field(default=None, min_length=1, max_length=32)
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=8, max_length=256)

    @field_validator("name")
    @classmethod
    def validate_optional_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("Jméno je povinné.")
        return normalized

    @field_validator("email")
    @classmethod
    def validate_optional_email(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower()
        if "@" not in normalized or "." not in normalized.split("@")[-1]:
            raise ValueError("Zadejte platný e-mail ve formátu jmeno@domena.cz.")
        return normalized

    @field_validator("phone")
    @classmethod
    def validate_optional_phone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            return None
        compact = normalized.replace(" ", "")
        if not compact.lstrip("+").isdigit() or len(compact.lstrip("+")) < 9:
            raise ValueError(
                "Telefon zadejte jako české nebo mezinárodní číslo, například +420 777 888 999."
            )
        return normalized


class PortalUserPasswordIn(BaseModel):
    password: str = Field(min_length=8, max_length=256)


class OkOut(BaseModel):
    ok: bool = True


def _get_settings(db: Session) -> AppSettings:
    st = db.execute(select(AppSettings).where(AppSettings.id == 1)).scalars().first()
    if st is None:
        st = AppSettings(id=1)
        db.add(st)
        db.commit()
        db.refresh(st)
    return st


def _send_reset_email(
    *, settings: Settings, cfg: AppSettings, to_email: str, reset_url: str
) -> None:
    host = (cfg.smtp_host or "").strip()
    if not host or not cfg.smtp_port:
        raise ValueError("SMTP neni nastaveno.")

    username = (cfg.smtp_username or "").strip()
    smtp_secret = settings.smtp_password_secret or settings.session_secret
    decrypted_password = (
        decrypt_secret(cfg.smtp_password, secret=smtp_secret) if cfg.smtp_password else None
    )
    password = decrypted_password.strip() if decrypted_password else None
    security = (cfg.smtp_security or "SSL").strip().upper()
    from_email = (cfg.smtp_from_email or username or "").strip()
    if not from_email:
        raise ValueError("Chybi odesilaci e-mail.")

    base_url = settings.public_base_url.rstrip("/")
    login_url = f"{base_url}/app"

    msg = EmailMessage()
    msg["Subject"] = "Nastaveni nebo zmena hesla"
    msg["From"] = f"{cfg.smtp_from_name} <{from_email}>" if cfg.smtp_from_name else from_email
    msg["To"] = to_email
    msg.set_content(
        "Dobry den,\n\n"
        "pres tento odkaz si nastavite nebo zmenite heslo do systemu DAGMAR (platnost 24 hodin):\n\n"
        f"{reset_url}\n\n"
        "Po ulozeni hesla se prihlasite zde:\n"
        f"{login_url}\n\n"
        "Prihlaseni do systemu probiha pres vyse uvedenou adresu.\n\n"
        "Pokud jste o zmenu nezadali, ignorujte tento e-mail."
    )

    server: smtplib.SMTP
    if security == "SSL":
        server = smtplib.SMTP_SSL(host, int(cfg.smtp_port), timeout=20)
    else:
        server = smtplib.SMTP(host, int(cfg.smtp_port), timeout=20)
        if security == "STARTTLS":
            server.starttls()

    try:
        if username and password:
            server.login(username, password)
        server.send_message(msg)
    finally:
        server.quit()


def _normalize_phone(raw_phone: str | None) -> str | None:
    if raw_phone is None:
        return None
    phone = raw_phone.strip()
    return phone or None


def _safe_iso_date(value: object) -> str | None:
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, str):
        normalized = value.strip()
        return normalized or None
    return None


def _employment_sort_key(employment: Employment) -> tuple[date, int]:
    start_date = employment.start_date if isinstance(employment.start_date, date) else date.max
    return (start_date, employment.id)


def _employment_type_value(value: object) -> str:
    raw_value = getattr(value, "value", value)
    return str(raw_value or "").strip() or "DPP_DPC"


def _to_employment_out(employment: Employment) -> EmploymentOut:
    employment_type = _employment_type_value(getattr(employment, "employment_type", None))
    afternoon_start_minutes = getattr(employment, "afternoon_start_minutes", None)
    return EmploymentOut(
        id=employment.id,
        user_id=employment.user_id,
        title=(employment.title or "").strip() or "Bez názvu úvazku",
        employment_type=employment_type,
        start_date=_safe_iso_date(employment.start_date) or "1970-01-01",
        end_date=_safe_iso_date(employment.end_date),
        is_active=employment.is_active,
        label=employment_label(employment, user_name=getattr(employment.user, "name", None)),
        workload_fraction=f"{employment.workload_fraction:.3f}"
        if getattr(employment, "workload_fraction", None) is not None
        else None,
        time_profile={
            "automatic_breaks_enabled": bool(
                getattr(employment, "automatic_breaks_enabled", False)
            ),
            "total": {
                "enabled": bool(getattr(employment, "total_hours_enabled", True)),
                "mandatory": employment_type == "WORK_CONTRACT",
            },
            "afternoon": {
                "enabled": bool(getattr(employment, "afternoon_hours_enabled", False)),
                "mandatory": False,
                "start": f"{afternoon_start_minutes // 60:02d}:{afternoon_start_minutes % 60:02d}"
                if isinstance(afternoon_start_minutes, int)
                else None,
            },
            "night": {
                "enabled": bool(getattr(employment, "night_hours_enabled", False)),
                "mandatory": employment_type == "WORK_CONTRACT",
            },
            "weekend": {
                "enabled": bool(getattr(employment, "weekend_hours_enabled", False)),
                "mandatory": False,
            },
            "public_holiday": {
                "enabled": bool(getattr(employment, "public_holiday_hours_enabled", False)),
                "mandatory": False,
            },
        },
    )


def _user_login_status(user: PortalUser) -> tuple[str, str | None]:
    if getattr(user, "is_blocked", False):
        return "BLOCKED", "Váš přístup byl zablokován, obraťte se na svého nadřízeného."
    if not user.is_active:
        return "DEACTIVATED", "Ucet je rucne deaktivovany administratorem."
    today = prague_today()
    selection = select_login_employments(user, today)
    if selection.available:
        return "ACTIVE", None
    if user.employments:
        return "EMPLOYMENT_WINDOW_BLOCKED", "Zadny uvazek neni v povolenem prihlasovacim okne."
    return "EMPLOYMENT_WINDOW_BLOCKED", "Uzivatel nema zadny uvazek."


def _to_user_out(user: PortalUser, lock_state: AuthLockoutState | None = None) -> PortalUserOut:
    locked_until = as_utc(lock_state.locked_until) if lock_state is not None else None
    login_status, login_status_reason = _user_login_status(user)
    employments = sorted(user.employments, key=_employment_sort_key)
    last_login_at = (
        as_utc(getattr(user.instance, "last_seen_at", None))
        if getattr(user, "instance", None) is not None
        else None
    )
    return PortalUserOut(
        id=user.id,
        name=(user.name or "").strip(),
        email=(user.email or "").strip(),
        phone=user.phone,
        role=user.role.value if hasattr(user.role, "value") else str(user.role or ""),
        has_password=bool(user.password_hash),
        is_active=user.is_active,
        is_blocked=bool(getattr(user, "is_blocked", False)),
        is_locked=is_locked(lock_state),
        locked_until=locked_until.isoformat() if locked_until is not None else None,
        login_status=login_status,
        login_status_reason=login_status_reason,
        last_login_at=last_login_at.isoformat() if last_login_at is not None else None,
        employments=[_to_employment_out(item) for item in employments],
    )


def _apply_password(db: Session, user: PortalUser, raw_password: str | None) -> None:
    if raw_password is None:
        return
    password = raw_password.strip()
    if not password:
        raise HTTPException(status_code=400, detail="Heslo nesmi byt prazdne.")
    try:
        change_portal_password(db, user, password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("", response_model=PortalUserListOut)
def list_users(
    request: Request, _admin=Depends(require_admin), db: Session = Depends(get_db)
) -> PortalUserListOut:
    users = (
        db.execute(
            select(PortalUser)
            .options(selectinload(PortalUser.employments), selectinload(PortalUser.instance))
            .order_by(PortalUser.name.asc(), PortalUser.id.asc())
        )
        .scalars()
        .all()
    )
    principals = [user.email.lower() for user in users]
    lock_rows = (
        db.execute(
            select(AuthLockoutState).where(
                AuthLockoutState.actor_type == "portal",
                AuthLockoutState.principal.in_(principals),
            )
        )
        .scalars()
        .all()
        if principals
        else []
    )
    locks_by_principal = {row.principal: row for row in lock_rows}

    out: list[PortalUserOut] = []
    for user in users:
        try:
            out.append(
                _to_user_out(
                    user,
                    locks_by_principal.get(user.email.lower()),
                )
            )
        except (AttributeError, KeyError, TypeError, ValueError) as exc:
            logger.error(
                "data_integrity_error entity=portal_user user_id=%s request_id=%s error_type=%s",
                user.id,
                getattr(request.state, "request_id", "unknown"),
                type(exc).__name__,
            )
            raise_api_error(
                500,
                "data_integrity_error",
                "Data uživatele nejsou konzistentní.",
            )

    return PortalUserListOut(users=out)


@router.post("", response_model=PortalUserOut)
def create_user(
    payload: PortalUserCreateIn,
    _admin=Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
):
    email = payload.email.strip().lower()
    if email == "provoz@hotelchodovasc.cz":
        raise_api_error(400, "reserved_admin_email", "Tento e-mail je vyhrazen pro admin ucet.")

    try:
        role_enum = PortalUserRole(payload.role)
    except ValueError:
        raise_api_error(400, "invalid_user_role", "Neplatna role uzivatele.")

    exists = db.execute(select(PortalUser).where(PortalUser.email == email)).scalars().first()
    if exists:
        raise_api_error(409, "user_email_exists", "Uzivatel s timto e-mailem uz existuje.")

    now = datetime.now(UTC)
    inst = Instance(
        id=str(uuid4()),
        client_type=ClientType.WEB,
        device_fingerprint=f"user:{email}",
        status=InstanceStatus.ACTIVE,
        display_name=payload.name.strip(),
        created_at=now,
        last_seen_at=now,
        activated_at=now,
    )
    db.add(inst)

    user = PortalUser(
        name=payload.name.strip(),
        email=email,
        phone=_normalize_phone(payload.phone),
        role=role_enum,
        password_hash=None,
        is_active=payload.is_active,
        is_blocked=False,
        instance_id=inst.id,
    )
    db.add(user)
    db.flush()

    if payload.password is not None:
        _apply_password(db, user, payload.password)

    db.commit()
    db.refresh(user)
    db.refresh(inst)
    user = (
        db.execute(
            select(PortalUser)
            .options(selectinload(PortalUser.employments))
            .where(PortalUser.id == user.id)
        )
        .scalars()
        .one()
    )
    return _to_user_out(user)


@router.put("/{user_id}/block", response_model=PortalUserOut)
def block_user(
    user_id: int,
    payload: PortalUserBlockIn,
    _admin=Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
):
    user = (
        db.execute(
            select(PortalUser)
            .options(selectinload(PortalUser.employments))
            .where(PortalUser.id == int(user_id))
        )
        .scalars()
        .first()
    )
    if user is None:
        raise_api_error(404, "user_not_found", "Uzivatel nenalezen.")

    user.is_blocked = payload.blocked
    if payload.blocked:
        revoke_password_reset_tokens(db, user.id)
        revoke_instance_credential(db, user)
    db.add(user)
    db.commit()
    db.refresh(user)
    return _to_user_out(user)


@router.put("/{user_id}", response_model=PortalUserOut)
def update_user(
    user_id: int,
    payload: PortalUserUpdateIn,
    _admin=Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
):
    user = (
        db.execute(
            select(PortalUser)
            .options(selectinload(PortalUser.employments))
            .where(PortalUser.id == int(user_id))
        )
        .scalars()
        .first()
    )
    if user is None:
        raise_api_error(404, "user_not_found", "Uzivatel nenalezen.")

    if payload.name is not None:
        user.name = payload.name.strip()
        if user.instance is not None:
            user.instance.display_name = user.name
            db.add(user.instance)

    if payload.phone is not None:
        user.phone = _normalize_phone(payload.phone)

    if payload.email is not None:
        email = payload.email.strip().lower()
        if email == "provoz@hotelchodovasc.cz":
            raise_api_error(400, "reserved_admin_email", "Tento e-mail je vyhrazen pro admin ucet.")
        if email != user.email:
            exists = (
                db.execute(
                    select(PortalUser)
                    .where(PortalUser.email == email)
                    .where(PortalUser.id != user.id)
                )
                .scalars()
                .first()
            )
            if exists:
                raise_api_error(409, "user_email_exists", "Uzivatel s timto e-mailem uz existuje.")
            clear_user_lockout(db, actor_type="portal", principal=user.email.lower())
            revoke_unlock_tokens(db, actor_type="portal", principal=user.email.lower())
            user.email = email

    if payload.role is not None:
        try:
            user.role = PortalUserRole(payload.role)
        except ValueError:
            raise_api_error(400, "invalid_user_role", "Neplatna role uzivatele.")

    if payload.is_active is not None:
        user.is_active = payload.is_active
        if not payload.is_active:
            revoke_password_reset_tokens(db, user.id)
            revoke_instance_credential(db, user)

    if payload.password is not None:
        _apply_password(db, user, payload.password)

    db.add(user)
    db.commit()
    db.refresh(user)
    user = (
        db.execute(
            select(PortalUser)
            .options(selectinload(PortalUser.employments))
            .where(PortalUser.id == user.id)
        )
        .scalars()
        .one()
    )
    return _to_user_out(user)


@router.post("/{user_id}/set-password", response_model=PortalUserOut)
def set_user_password(
    user_id: int,
    payload: PortalUserPasswordIn,
    _admin=Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
):
    user = (
        db.execute(
            select(PortalUser)
            .options(selectinload(PortalUser.employments))
            .where(PortalUser.id == int(user_id))
        )
        .scalars()
        .first()
    )
    if user is None:
        raise_api_error(404, "user_not_found", "Uzivatel nenalezen.")
    _apply_password(db, user, payload.password)
    db.add(user)
    db.commit()
    db.refresh(user)
    return _to_user_out(user)


@router.delete("/{user_id}", response_model=OkOut)
def delete_user(
    user_id: int,
    _admin=Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
):
    row = (
        db.execute(
            select(PortalUser.id, PortalUser.email, PortalUser.instance_id).where(
                PortalUser.id == int(user_id)
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise_api_error(404, "user_not_found", "Uzivatel nenalezen.")

    email = str(row["email"] or "").strip().lower()
    instance_id = str(row["instance_id"] or "").strip() or None
    if email:
        clear_user_lockout(db, actor_type="portal", principal=email)
        revoke_unlock_tokens(db, actor_type="portal", principal=email)

    db.execute(delete(PortalUserResetToken).where(PortalUserResetToken.user_id == int(user_id)))
    db.execute(delete(Employment).where(Employment.user_id == int(user_id)))
    instance = db.get(Instance, instance_id) if instance_id else None
    if instance is not None:
        instance.token_hash = None
        instance.token_issued_at = None
        db.add(instance)
    db.execute(delete(PortalUser).where(PortalUser.id == int(user_id)))
    if instance is not None and instance.client_type == ClientType.WEB:
        other_owner = db.execute(
            select(PortalUser.id).where(PortalUser.instance_id == instance.id).limit(1)
        ).scalar_one_or_none()
        if other_owner is None:
            db.delete(instance)

    db.commit()
    return OkOut(ok=True)


@router.post("/{user_id}/send-reset", response_model=OkOut)
def send_reset_link(
    user_id: int,
    request: Request,
    _admin=Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    with reset_issuance_lock(db, int(user_id)):
        user = lock_portal_user(db, int(user_id))
        if not user or not user.is_active:
            raise_api_error(404, "user_not_found", "Uzivatel nenalezen.")
        if user.is_blocked:
            raise_api_error(
                403,
                "portal_account_blocked",
                "Váš přístup byl zablokován, obraťte se na svého nadřízeného.",
            )

        raw_token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
        expires_at = datetime.now(UTC) + timedelta(hours=RESET_TTL_HOURS)

        revoke_password_reset_tokens(db, user.id)
        row = PortalUserResetToken(
            user_id=user.id,
            token_hash=token_hash,
            expires_at=expires_at,
            delivery_state=ResetDeliveryState.PENDING,
        )
        db.add(row)
        db.commit()

        cfg = _get_settings(db)
        reset_url = f"{settings.public_base_url}/reset?token={raw_token}"
        try:
            _send_reset_email(settings=settings, cfg=cfg, to_email=user.email, reset_url=reset_url)
        except (OSError, ValueError, smtplib.SMTPException) as exc:
            mark_reset_delivery(row, ResetDeliveryState.FAILED, revoked=True)
            db.add(row)
            db.commit()
            logger.warning(
                "security_event=reset_delivery_failed request_id=%s user_id=%s error_type=%s",
                getattr(getattr(request, "state", None), "request_id", "unknown"),
                user.id,
                type(exc).__name__,
            )
            raise_api_error(400, "reset_email_failed", "Resetovací e-mail se nepodařilo odeslat.")

        locked_user = lock_portal_user(db, user.id)
        if locked_user is None or not locked_user.is_active or locked_user.is_blocked:
            mark_reset_delivery(row, ResetDeliveryState.FAILED, revoked=True)
            db.add(row)
            db.commit()
            raise_api_error(409, "reset_delivery_stale", "Stav účtu se během odesílání změnil.")
        mark_reset_delivery(row, ResetDeliveryState.SENT)
        db.add(row)
        db.commit()

        return OkOut(ok=True)


@router.post("/{user_id}/unlock", response_model=OkOut)
def unlock_user(
    user_id: int,
    _admin=Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
):
    user = db.get(PortalUser, int(user_id))
    if user is None:
        raise_api_error(404, "user_not_found", "Uzivatel nenalezen.")

    clear_user_lockout(db, actor_type="portal", principal=user.email.lower())
    revoke_unlock_tokens(db, actor_type="portal", principal=user.email.lower())
    db.commit()
    return OkOut(ok=True)


@router.get("/{user_id}/employments", response_model=list[EmploymentOut])
def list_user_employments(
    user_id: int, _admin=Depends(require_admin), db: Session = Depends(get_db)
):
    rows = (
        db.execute(
            select(Employment)
            .where(Employment.user_id == user_id)
            .order_by(Employment.start_date.asc(), Employment.id.asc())
        )
        .scalars()
        .all()
    )
    return [_to_employment_out(row) for row in rows]
