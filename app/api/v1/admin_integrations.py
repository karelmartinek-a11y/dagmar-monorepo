# ruff: noqa: B008
from __future__ import annotations

from datetime import UTC, date, datetime
from typing import cast

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_admin
from app.api.integration_common import utc_isoformat
from app.config import Settings, get_settings
from app.db import models
from app.db.session import get_db
from app.security.csrf import require_csrf
from app.security.integration_tokens import build_token_record, generate_integration_token
from app.services.integration_admin import (
    CLIENT_STATUS_LABELS,
    DATA_SCOPE_ACTIVE_ONLY,
    DATA_SCOPE_ALL,
    DATA_SCOPE_LABELS,
    DATA_SCOPE_SELECTED_EMPLOYEES,
    DATA_SCOPE_SELECTED_EMPLOYMENTS,
    EXPIRATION_1_YEAR,
    EXPIRATION_30_DAYS,
    EXPIRATION_90_DAYS,
    EXPIRATION_CUSTOM,
    EXPIRATION_NONE,
    IP_RESTRICTION_LABELS,
    IP_RESTRICTION_NONE,
    IP_RESTRICTION_SERVER_MANAGED,
    NAME_MAX_LENGTH,
    NAME_MIN_LENGTH,
    PERMISSION_PROFILE_LABELS,
    PERMISSION_PROFILES,
    SCOPE_BY_ID,
    SCOPE_DEFINITIONS,
    allowed_actions_for_client,
    build_employee_options,
    build_employment_options,
    build_recent_audit_summary,
    client_status_key,
    client_status_label,
    count_active_clients,
    data_scope_summary,
    expiration_choice_from_datetime,
    expiration_from_choice,
    infer_data_scope_mode,
    infer_ip_restriction_mode,
    summarize_scopes,
    validate_client_name,
    validate_scopes,
    validate_selected_employee_ids,
    validate_selected_employment_ids,
)

router = APIRouter(prefix="/api/v1/admin/integrations", tags=["admin-integrations"])


class IntegrationScopeOptionOut(BaseModel):
    id: str
    label: str
    description: str
    data_access: str
    when_to_enable: str
    risk: str
    available: bool
    unavailable_reason: str | None = None


class PermissionProfileOut(BaseModel):
    id: str
    label: str
    description: str
    scopes: list[str]


class DataScopeModeOut(BaseModel):
    id: str
    label: str
    description: str
    supports_inactive_toggle: bool = False


class RestrictionModeOut(BaseModel):
    id: str
    label: str
    description: str
    editable: bool


class ExpirationOptionOut(BaseModel):
    id: str
    label: str
    description: str
    requires_custom_date: bool = False


class IntegrationEmployeeOptionOut(BaseModel):
    id: int
    label: str
    email: str
    is_active: bool
    employment_count: int
    active_employment_count: int
    employment_labels: list[str]


class IntegrationEmploymentOptionOut(BaseModel):
    id: int
    user_id: int
    label: str
    employment_type: str
    start_date: str
    end_date: str | None = None
    is_active: bool


class IntegrationClientOptionsOut(BaseModel):
    name_rules: dict[str, object]
    scopes: list[IntegrationScopeOptionOut]
    permission_profiles: list[PermissionProfileOut]
    data_scope_modes: list[DataScopeModeOut]
    employees: list[IntegrationEmployeeOptionOut]
    employments: list[IntegrationEmploymentOptionOut]
    ip_restriction_modes: list[RestrictionModeOut]
    expiration_options: list[ExpirationOptionOut]
    statuses: list[dict[str, object]]


class IntegrationClientListItemOut(BaseModel):
    id: int
    name: str
    status: str
    status_label: str
    scopes: list[str]
    scope_labels: list[str]
    scope_summary: str
    data_scope_summary: str
    ip_restriction_mode: str
    ip_restriction_summary: str
    expires_at: str | None
    last_used_at: str | None
    created_at: str
    updated_at: str
    created_by: str | None
    active_secret_fingerprint: str | None = None
    active_secret_last4: str | None = None
    available_actions: list[str]


class IntegrationClientConfigurationOut(BaseModel):
    selected_scope_ids: list[str]
    permission_profile_id: str | None = None
    data_scope_mode: str
    selected_employee_ids: list[int]
    selected_employment_ids: list[int]
    include_inactive_employments: bool
    ip_restriction_mode: str
    expiration_choice: str
    custom_expiration_date: str | None = None


class IntegrationClientAuditSummaryOut(BaseModel):
    request_count: int
    last_error: dict[str, object] | None = None
    last_source_ip: str | None = None
    last_path: str | None = None


class IntegrationClientDetailOut(IntegrationClientListItemOut):
    configuration: IntegrationClientConfigurationOut
    audit_summary: IntegrationClientAuditSummaryOut


class IntegrationClientSecretOut(BaseModel):
    client: IntegrationClientDetailOut
    plaintext_token: str


class IntegrationClientCreateIn(BaseModel):
    name: str = Field(min_length=NAME_MIN_LENGTH, max_length=NAME_MAX_LENGTH)
    selected_scope_ids: list[str] = Field(default_factory=list)
    data_scope_mode: str
    selected_employee_ids: list[int] = Field(default_factory=list)
    selected_employment_ids: list[int] = Field(default_factory=list)
    include_inactive_employments: bool = False
    ip_restriction_mode: str = IP_RESTRICTION_NONE
    expiration_choice: str = EXPIRATION_NONE
    custom_expiration_date: date | None = None


class IntegrationClientUpdateIn(IntegrationClientCreateIn):
    pass


def _find_permission_profile(scope_ids: list[str]) -> str | None:
    normalized = tuple(sorted(scope_ids))
    for profile_id, scopes in PERMISSION_PROFILES.items():
        if tuple(sorted(scopes)) == normalized:
            return profile_id
    return None


def _active_secret(client: models.IntegrationClient) -> models.IntegrationClientSecret | None:
    return next((item for item in sorted(client.secrets, key=lambda row: row.id, reverse=True) if item.revoked_at is None), None)


def _serialize_configuration(client: models.IntegrationClient) -> IntegrationClientConfigurationOut:
    expiration_choice, custom_date = expiration_choice_from_datetime(client.expires_at)
    return IntegrationClientConfigurationOut(
        selected_scope_ids=list(client.scopes or []),
        permission_profile_id=_find_permission_profile(list(client.scopes or [])),
        data_scope_mode=infer_data_scope_mode(client),
        selected_employee_ids=[int(item) for item in (client.allowed_employee_ids or [])],
        selected_employment_ids=[int(item) for item in (client.allowed_employment_ids or [])],
        include_inactive_employments=bool(getattr(client, "include_inactive_employments", False)),
        ip_restriction_mode=infer_ip_restriction_mode(client),
        expiration_choice=expiration_choice,
        custom_expiration_date=custom_date.isoformat() if custom_date is not None else None,
    )


def _serialize_list_item(client: models.IntegrationClient) -> IntegrationClientListItemOut:
    active_secret = _active_secret(client)
    scopes = list(client.scopes or [])
    status = client_status_key(client)
    return IntegrationClientListItemOut(
        id=client.id,
        name=client.name,
        status=status,
        status_label=CLIENT_STATUS_LABELS.get(status, client_status_label(client)),
        scopes=scopes,
        scope_labels=[SCOPE_BY_ID[item].label for item in scopes if item in SCOPE_BY_ID],
        scope_summary=summarize_scopes(scopes),
        data_scope_summary=data_scope_summary(client),
        ip_restriction_mode=infer_ip_restriction_mode(client),
        ip_restriction_summary=IP_RESTRICTION_LABELS[infer_ip_restriction_mode(client)],
        expires_at=utc_isoformat(client.expires_at),
        last_used_at=utc_isoformat(client.last_used_at),
        created_at=utc_isoformat(client.created_at) or "",
        updated_at=utc_isoformat(client.updated_at) or "",
        created_by=client.created_by,
        active_secret_fingerprint=active_secret.token_fingerprint if active_secret is not None else None,
        active_secret_last4=active_secret.token_last4 if active_secret is not None else None,
        available_actions=allowed_actions_for_client(client),
    )


def _serialize_detail(client: models.IntegrationClient, db: Session) -> IntegrationClientDetailOut:
    list_item = _serialize_list_item(client)
    audit_summary = build_recent_audit_summary(db, client.id)
    return IntegrationClientDetailOut(
        **list_item.model_dump(),
        configuration=_serialize_configuration(client),
        audit_summary=IntegrationClientAuditSummaryOut(
            request_count=cast(int, audit_summary["request_count"]),
            last_error=cast(dict[str, object] | None, audit_summary["last_error"]),
            last_source_ip=cast(str | None, audit_summary["last_source_ip"]),
            last_path=cast(str | None, audit_summary["last_path"]),
        ),
    )


def _client_query(db: Session):
    return db.execute(
        select(models.IntegrationClient)
        .options(selectinload(models.IntegrationClient.secrets))
        .order_by(models.IntegrationClient.name.asc(), models.IntegrationClient.id.asc())
    ).scalars().all()


def _get_client_or_404(client_id: int, db: Session) -> models.IntegrationClient:
    client = db.execute(
        select(models.IntegrationClient)
        .options(selectinload(models.IntegrationClient.secrets))
        .where(models.IntegrationClient.id == client_id)
    ).scalar_one_or_none()
    if client is None:
        raise HTTPException(status_code=404, detail="Integrační klient nebyl nalezen.")
    return client


def _apply_payload_to_client(
    *,
    client: models.IntegrationClient,
    payload: IntegrationClientCreateIn | IntegrationClientUpdateIn,
    db: Session,
) -> None:
    client.name = validate_client_name(payload.name)
    client.scopes = validate_scopes(payload.selected_scope_ids)

    if payload.data_scope_mode not in {
        DATA_SCOPE_ALL,
        DATA_SCOPE_ACTIVE_ONLY,
        DATA_SCOPE_SELECTED_EMPLOYEES,
        DATA_SCOPE_SELECTED_EMPLOYMENTS,
    }:
        raise HTTPException(status_code=400, detail="Neplatná volba datového rozsahu.")

    client.data_scope_mode = payload.data_scope_mode
    client.include_inactive_employments = False
    client.allowed_employee_ids = []
    client.allowed_employment_ids = []

    if payload.data_scope_mode == DATA_SCOPE_SELECTED_EMPLOYEES:
        client.allowed_employee_ids = validate_selected_employee_ids(db, payload.selected_employee_ids)
        client.include_inactive_employments = bool(payload.include_inactive_employments)
    elif payload.data_scope_mode == DATA_SCOPE_SELECTED_EMPLOYMENTS:
        client.allowed_employment_ids = validate_selected_employment_ids(db, payload.selected_employment_ids)
    elif payload.data_scope_mode == DATA_SCOPE_ALL:
        client.include_inactive_employments = True
    elif payload.data_scope_mode == DATA_SCOPE_ACTIVE_ONLY:
        client.include_inactive_employments = False

    if payload.ip_restriction_mode not in {IP_RESTRICTION_NONE, IP_RESTRICTION_SERVER_MANAGED}:
        raise HTTPException(status_code=400, detail="Neplatná volba IP omezení.")
    if payload.ip_restriction_mode == IP_RESTRICTION_NONE:
        client.ip_allowlist = []
    elif not list(client.ip_allowlist or []):
        raise HTTPException(
            status_code=400,
            detail="IP omezení spravované mimo UI lze použít jen u klienta, který ho už má nastavené technicky.",
        )

    client.expires_at = expiration_from_choice(payload.expiration_choice, payload.custom_expiration_date)


@router.get("/clients/options", response_model=IntegrationClientOptionsOut)
def get_integration_client_options(
    _admin=Depends(require_admin),
    db: Session = Depends(get_db),
) -> IntegrationClientOptionsOut:
    active_clients = count_active_clients(db)
    return IntegrationClientOptionsOut(
        name_rules={
            "min_length": NAME_MIN_LENGTH,
            "max_length": NAME_MAX_LENGTH,
            "allowed_hint": "Písmena, číslice, mezery, pomlčky a podtržítka.",
            "forbidden_hint": "Bez URL adres, HTML značek, tokenů a tajných údajů.",
        },
        scopes=[IntegrationScopeOptionOut(**item.__dict__) for item in SCOPE_DEFINITIONS],
        permission_profiles=[
            PermissionProfileOut(
                id=profile_id,
                label=PERMISSION_PROFILE_LABELS[profile_id],
                description=f"Předvyplní oprávnění: {summarize_scopes(list(scopes))}.",
                scopes=list(scopes),
            )
            for profile_id, scopes in PERMISSION_PROFILES.items()
        ],
        data_scope_modes=[
            DataScopeModeOut(
                id=DATA_SCOPE_ACTIVE_ONLY,
                label=DATA_SCOPE_LABELS[DATA_SCOPE_ACTIVE_ONLY],
                description="Dynamicky zpřístupní všechny aktuálně aktivní úvazky.",
            ),
            DataScopeModeOut(
                id=DATA_SCOPE_SELECTED_EMPLOYEES,
                label=DATA_SCOPE_LABELS[DATA_SCOPE_SELECTED_EMPLOYEES],
                description="Správce vybere konkrétní osoby. Data se dál vedou podle employment_id.",
                supports_inactive_toggle=True,
            ),
            DataScopeModeOut(
                id=DATA_SCOPE_SELECTED_EMPLOYMENTS,
                label=DATA_SCOPE_LABELS[DATA_SCOPE_SELECTED_EMPLOYMENTS],
                description="Správce vybere přesné employment_id reprezentované lidskými popisky úvazků.",
            ),
            DataScopeModeOut(
                id=DATA_SCOPE_ALL,
                label=DATA_SCOPE_LABELS[DATA_SCOPE_ALL],
                description="Kompatibilitní režim pro stávající klienty. Zahrne i neaktivní úvazky.",
            ),
        ],
        employees=[
            IntegrationEmployeeOptionOut(
                id=cast(int, item["id"]),
                label=str(item["label"]),
                email=str(item["email"]),
                is_active=bool(item["is_active"]),
                employment_count=cast(int, item["employment_count"]),
                active_employment_count=cast(int, item["active_employment_count"]),
                employment_labels=cast(list[str], item["employment_labels"]),
            )
            for item in build_employee_options(db)
        ],
        employments=[
            IntegrationEmploymentOptionOut(
                id=cast(int, item["id"]),
                user_id=cast(int, item["user_id"]),
                label=str(item["label"]),
                employment_type=cast(str, item["employment_type"]),
                start_date=str(item["start_date"]),
                end_date=cast(str | None, item["end_date"]),
                is_active=bool(item["is_active"]),
            )
            for item in build_employment_options(db)
        ],
        ip_restriction_modes=[
            RestrictionModeOut(
                id=IP_RESTRICTION_NONE,
                label=IP_RESTRICTION_LABELS[IP_RESTRICTION_NONE],
                description="Klient nebude omezen zdrojovou IP adresou.",
                editable=True,
            ),
            RestrictionModeOut(
                id=IP_RESTRICTION_SERVER_MANAGED,
                label=IP_RESTRICTION_LABELS[IP_RESTRICTION_SERVER_MANAGED],
                description="Použijte jen tehdy, když technický správce nastaví allowlist mimo tuto administraci.",
                editable=False,
            ),
        ],
        expiration_options=[
            ExpirationOptionOut(id=EXPIRATION_NONE, label="Bez expirace", description="Token platí do ruční změny stavu nebo rotace."),
            ExpirationOptionOut(id=EXPIRATION_30_DAYS, label="30 dní", description="Vhodné pro krátkodobé ověření nebo onboarding partnera."),
            ExpirationOptionOut(id=EXPIRATION_90_DAYS, label="90 dní", description="Rozumná výchozí volba pro pilotní provoz."),
            ExpirationOptionOut(id=EXPIRATION_1_YEAR, label="1 rok", description="Vhodné pro stabilní dlouhodobé napojení."),
            ExpirationOptionOut(id=EXPIRATION_CUSTOM, label="Vlastní datum", description="Vyberte konkrétní den v date pickeru.", requires_custom_date=True),
        ],
        statuses=[
            {
                "id": models.IntegrationClientStatus.ACTIVE.value,
                "label": CLIENT_STATUS_LABELS[models.IntegrationClientStatus.ACTIVE.value],
                "description": "Klient může používat token a volat povolené endpointy.",
                "count_hint": active_clients,
            },
            {
                "id": models.IntegrationClientStatus.DISABLED.value,
                "label": CLIENT_STATUS_LABELS[models.IntegrationClientStatus.DISABLED.value],
                "description": "Klient zůstává uložený, ale tokeny jsou dočasně neplatné.",
            },
            {
                "id": models.IntegrationClientStatus.REVOKED.value,
                "label": CLIENT_STATUS_LABELS[models.IntegrationClientStatus.REVOKED.value],
                "description": "Aktivní tokeny byly zneplatněny a klient vyžaduje novou rotaci nebo nové vytvoření.",
            },
            {
                "id": "EXPIRED",
                "label": CLIENT_STATUS_LABELS["EXPIRED"],
                "description": "Klient má nastavenou minulou expiraci a token už nelze použít.",
            },
        ],
    )


@router.get("/clients", response_model=list[IntegrationClientListItemOut])
def list_integration_clients(
    _admin=Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[IntegrationClientListItemOut]:
    return [_serialize_list_item(client) for client in _client_query(db)]


@router.get("/clients/{client_id}", response_model=IntegrationClientDetailOut)
def get_integration_client_detail(
    client_id: int,
    _admin=Depends(require_admin),
    db: Session = Depends(get_db),
) -> IntegrationClientDetailOut:
    client = _get_client_or_404(client_id, db)
    return _serialize_detail(client, db)


@router.post("/clients", response_model=IntegrationClientSecretOut)
def create_integration_client(
    payload: IntegrationClientCreateIn,
    _admin=Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> IntegrationClientSecretOut:
    normalized_name = validate_client_name(payload.name)
    existing = db.execute(select(models.IntegrationClient).where(models.IntegrationClient.name == normalized_name)).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="Integrační klient se stejným názvem už existuje.")

    client = models.IntegrationClient(
        name=normalized_name,
        status=models.IntegrationClientStatus.ACTIVE.value,
        created_by="admin-web",
    )
    _apply_payload_to_client(client=client, payload=payload, db=db)
    db.add(client)
    db.flush()

    plaintext = generate_integration_token(settings)
    token_record = build_token_record(plaintext)
    secret = models.IntegrationClientSecret(
        client_id=client.id,
        token_hash=token_record.token_hash,
        token_prefix=token_record.token_prefix,
        token_last4=token_record.token_last4,
        token_fingerprint=token_record.token_fingerprint,
    )
    db.add(secret)
    db.commit()
    client = _get_client_or_404(client.id, db)
    return IntegrationClientSecretOut(client=_serialize_detail(client, db), plaintext_token=plaintext)


@router.put("/clients/{client_id}", response_model=IntegrationClientDetailOut)
def update_integration_client(
    client_id: int,
    payload: IntegrationClientUpdateIn,
    _admin=Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> IntegrationClientDetailOut:
    client = _get_client_or_404(client_id, db)
    normalized_name = validate_client_name(payload.name)
    name_owner = db.execute(
        select(models.IntegrationClient).where(models.IntegrationClient.name == normalized_name).where(models.IntegrationClient.id != client_id)
    ).scalar_one_or_none()
    if name_owner is not None:
        raise HTTPException(status_code=409, detail="Integrační klient se stejným názvem už existuje.")
    _apply_payload_to_client(client=client, payload=payload, db=db)
    db.add(client)
    db.commit()
    client = _get_client_or_404(client.id, db)
    return _serialize_detail(client, db)


@router.post("/clients/{client_id}/rotate", response_model=IntegrationClientSecretOut)
def rotate_integration_client_secret(
    client_id: int,
    _admin=Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> IntegrationClientSecretOut:
    client = _get_client_or_404(client_id, db)
    now = datetime.now(UTC)
    for secret in client.secrets:
        if secret.revoked_at is None:
            secret.revoked_at = now
            secret.rotated_at = now
            db.add(secret)

    plaintext = generate_integration_token(settings)
    token_record = build_token_record(plaintext)
    secret = models.IntegrationClientSecret(
        client_id=client.id,
        token_hash=token_record.token_hash,
        token_prefix=token_record.token_prefix,
        token_last4=token_record.token_last4,
        token_fingerprint=token_record.token_fingerprint,
    )
    db.add(secret)
    if client.status == models.IntegrationClientStatus.REVOKED.value:
        client.status = models.IntegrationClientStatus.ACTIVE.value
        db.add(client)
    db.commit()
    client = _get_client_or_404(client.id, db)
    return IntegrationClientSecretOut(client=_serialize_detail(client, db), plaintext_token=plaintext)


@router.post("/clients/{client_id}/disable", response_model=IntegrationClientDetailOut)
def disable_integration_client(
    client_id: int,
    _admin=Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> IntegrationClientDetailOut:
    client = _get_client_or_404(client_id, db)
    client.status = models.IntegrationClientStatus.DISABLED.value
    db.add(client)
    db.commit()
    client = _get_client_or_404(client.id, db)
    return _serialize_detail(client, db)


@router.post("/clients/{client_id}/enable", response_model=IntegrationClientDetailOut)
def enable_integration_client(
    client_id: int,
    _admin=Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> IntegrationClientDetailOut:
    client = _get_client_or_404(client_id, db)
    if not list(client.scopes or []):
        raise HTTPException(status_code=400, detail="Bez oprávnění nelze klienta aktivovat.")
    client.status = models.IntegrationClientStatus.ACTIVE.value
    db.add(client)
    db.commit()
    client = _get_client_or_404(client.id, db)
    return _serialize_detail(client, db)


@router.post("/clients/{client_id}/revoke-secret", response_model=IntegrationClientDetailOut)
def revoke_integration_client_secret(
    client_id: int,
    _admin=Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> IntegrationClientDetailOut:
    client = _get_client_or_404(client_id, db)
    now = datetime.now(UTC)
    for secret in client.secrets:
        if secret.revoked_at is None:
            secret.revoked_at = now
            db.add(secret)
    client.status = models.IntegrationClientStatus.REVOKED.value
    db.add(client)
    db.commit()
    client = _get_client_or_404(client.id, db)
    return _serialize_detail(client, db)
