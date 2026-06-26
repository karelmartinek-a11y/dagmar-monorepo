# ruff: noqa: B008
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..deps import PortalUserAuth, require_portal_user_auth
from ...db.models import Employment
from ...db.session import get_db
from ...services.day_status import normalize_day_status, set_day_status
from ...utils.timeparse import parse_yyyy_mm_dd

from .attendance import _ensure_month_not_locked, _require_accessible_employment

router = APIRouter(tags=["shift-plan"])


class PortalDayStatusUpsertIn(BaseModel):
    employment_id: int = Field(..., ge=1)
    date: str = Field(..., description="YYYY-MM-DD")
    status: str | None = Field(
        None, description="HOLIDAY | OFF | null", pattern="^(HOLIDAY|OFF)?$", examples=["HOLIDAY", "OFF"]
    )
    confirm_delete_conflicts: bool = False


class OkOut(BaseModel):
    ok: bool = True


def _ensure_day_in_employment_period(employment: Employment, day: dt.date) -> None:
    if day < employment.start_date or (employment.end_date is not None and day > employment.end_date):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Zvolené datum neleží v období platnosti vybraného úvazku.",
        )


@router.put("/api/v1/shift-plan/day-status", response_model=OkOut)
def portal_upsert_day_status(
    body: PortalDayStatusUpsertIn,
    db: Session = Depends(get_db),
    auth: PortalUserAuth = Depends(require_portal_user_auth),
) -> OkOut:
    employment = _require_accessible_employment(body.employment_id, auth, db)

    try:
        day = parse_yyyy_mm_dd(body.date)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    _ensure_day_in_employment_period(employment, day)
    _ensure_month_not_locked(employment.id, day.year, day.month, db)

    try:
        status_value = normalize_day_status(body.status)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    conflicts = set_day_status(
        db,
        employment=employment,
        day=day,
        status=status_value,
        confirm_delete_conflicts=body.confirm_delete_conflicts,
        instance_id=auth.instance.id,
    )
    if status_value is not None and conflicts.has_conflicts and not body.confirm_delete_conflicts:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=conflicts.to_detail(employment_id=employment.id, day=day, next_status=status_value),
        )

    db.commit()
    return OkOut(ok=True)
