# ruff: noqa: B008
from __future__ import annotations

import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.api.errors import raise_api_error
from app.db.models import ClientType, Instance, InstanceStatus
from app.db.session import get_db
from app.security.csrf import require_csrf

router = APIRouter(prefix="/api/v1/admin/instances", tags=["admin-instances"])
logger = logging.getLogger("dagmar.security")


class InstanceListItemOut(BaseModel):
    id: str
    client_type: ClientType
    status: InstanceStatus
    display_name: str | None
    created_at: datetime
    last_seen_at: datetime | None


class InstanceListOut(BaseModel):
    data: list[InstanceListItemOut]


class ActivateInstanceIn(BaseModel):
    display_name: str | None = Field(default=None, max_length=128)


class ActivateInstanceOut(BaseModel):
    id: str
    status: InstanceStatus
    display_name: str | None
    activated_at: datetime


@router.get("", response_model=InstanceListOut)
def list_instances(
    instance_status: InstanceStatus = Query(alias="status"),
    _admin=Depends(require_admin),
    db: Session = Depends(get_db),
) -> InstanceListOut:
    instances = (
        db.execute(
            select(Instance)
            .where(Instance.status == instance_status)
            .order_by(Instance.created_at, Instance.id)
        )
        .scalars()
        .all()
    )
    return InstanceListOut(
        data=[InstanceListItemOut.model_validate(row, from_attributes=True) for row in instances]
    )


@router.post("/{instance_id}/activate", response_model=ActivateInstanceOut)
def activate_instance(
    instance_id: str,
    payload: ActivateInstanceIn,
    request: Request,
    _admin=Depends(require_admin),
    _csrf: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> ActivateInstanceOut:
    instance = db.execute(
        select(Instance).where(Instance.id == instance_id).with_for_update()
    ).scalar_one_or_none()
    if instance is None:
        raise_api_error(
            status.HTTP_404_NOT_FOUND, "instance_not_found", "Instance nebyla nalezena."
        )
    if instance.status != InstanceStatus.PENDING:
        raise_api_error(
            status.HTTP_409_CONFLICT,
            "instance_activation_conflict",
            "Aktivovat lze pouze čekající instanci.",
        )

    display_name = payload.display_name.strip() if payload.display_name else None
    instance.display_name = display_name or instance.display_name
    instance.status = InstanceStatus.ACTIVE
    instance.activated_at = datetime.now(UTC)
    instance.revoked_at = None
    instance.deactivated_at = None
    db.commit()
    db.refresh(instance)
    logger.info(
        "security_event=admin_instance_activated request_id=%s instance_id=%s",
        getattr(request.state, "request_id", "unknown"),
        instance.id,
    )
    return ActivateInstanceOut.model_validate(instance, from_attributes=True)
