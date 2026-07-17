# ruff: noqa: B008
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.api.deps import require_admin
from app.api.errors import raise_api_error
from app.db.models import Employment
from app.db.session import get_db
from app.security.csrf import require_csrf
from app.services.locks import LockType, set_month_lock_state_bulk

router = APIRouter(tags=["admin"])


class AdminLockSetIn(BaseModel):
    lock_type: LockType
    year: int = Field(..., ge=2000, le=2100)
    month: int = Field(..., ge=1, le=12)
    locked: bool
    employment_ids: list[int] = Field(default_factory=list)


class AdminLockSetOut(BaseModel):
    ok: bool = True
    updated_count: int = 0
    lock_type: LockType
    year: int
    month: int
    locked: bool


@router.put("/api/v1/admin/locks", response_model=AdminLockSetOut)
def admin_set_locks(
    body: AdminLockSetIn,
    admin=Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> AdminLockSetOut:
    uniq_ids = list(dict.fromkeys(body.employment_ids))
    if not uniq_ids:
        raise_api_error(400, "employment_ids_required", "Vyberte alespoň jeden úvazek.")

    employments = (
        db.execute(
            select(Employment)
            .options(joinedload(Employment.user))
            .where(Employment.id.in_(uniq_ids))
            .order_by(Employment.id.asc())
        )
        .unique()
        .scalars()
        .all()
    )
    employment_by_id = {employment.id: employment for employment in employments}
    missing_ids = [employment_id for employment_id in uniq_ids if employment_id not in employment_by_id]
    if missing_ids:
        raise_api_error(404, "employment_not_found", "Úvazek nebyl nalezen.", employment_ids=missing_ids)

    rows = [
        (
            employment.id,
            employment.user.instance_id if employment.user is not None else None,
        )
        for employment in (employment_by_id[employment_id] for employment_id in uniq_ids)
    ]
    set_month_lock_state_bulk(
        db,
        lock_type=body.lock_type,
        employment_rows=rows,
        year=body.year,
        month=body.month,
        locked=body.locked,
        locked_by=getattr(admin, "username", None),
    )
    db.commit()
    return AdminLockSetOut(
        ok=True,
        updated_count=len(rows),
        lock_type=body.lock_type,
        year=body.year,
        month=body.month,
        locked=body.locked,
    )
