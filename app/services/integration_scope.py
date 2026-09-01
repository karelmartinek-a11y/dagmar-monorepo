from __future__ import annotations

from fastapi import status
from sqlalchemy import false, select
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from app.api.integration_common import raise_integration_error
from app.db import models
from app.services.integration_admin import (
    DATA_SCOPE_ACTIVE_ONLY,
    DATA_SCOPE_ALL,
    DATA_SCOPE_SELECTED_EMPLOYEES,
    DATA_SCOPE_SELECTED_EMPLOYMENTS,
)
from app.services.prague_time import prague_today


def _integer_ids(values: object) -> tuple[int, ...]:
    if not isinstance(values, list):
        return ()
    normalized: set[int] = set()
    for value in values:
        if isinstance(value, bool):
            continue
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            continue
        if parsed > 0:
            normalized.add(parsed)
    return tuple(sorted(normalized))


def employment_scope_predicate(client: models.IntegrationClient) -> ColumnElement[bool]:
    """Return the sole authoritative employment predicate for an integration client."""
    mode = str(client.data_scope_mode or "").strip()
    if mode == DATA_SCOPE_ALL:
        return models.Employment.id.is_not(None)
    current = prague_today()
    valid_now = (
        (models.Employment.start_date <= current)
        & (models.Employment.end_date.is_(None) | (models.Employment.end_date >= current))
    )
    if mode == DATA_SCOPE_ACTIVE_ONLY:
        return valid_now & models.Employment.user.has(
            models.PortalUser.is_active.is_(True)
        )
    if mode == DATA_SCOPE_SELECTED_EMPLOYEES:
        employee_ids = _integer_ids(client.allowed_employee_ids)
        if not employee_ids:
            return false()
        predicate: ColumnElement[bool] = models.Employment.user_id.in_(employee_ids)
        if not bool(client.include_inactive_employments):
            predicate &= valid_now
        return predicate
    if mode == DATA_SCOPE_SELECTED_EMPLOYMENTS:
        employment_ids = _integer_ids(client.allowed_employment_ids)
        if not employment_ids:
            return false()
        return models.Employment.id.in_(employment_ids)
    return false()


def require_employment_access(
    db: Session,
    *,
    client: models.IntegrationClient,
    employment_id: int,
) -> None:
    permitted = db.execute(
        select(models.Employment.id).where(
            models.Employment.id == employment_id,
            employment_scope_predicate(client),
        )
    ).scalar_one_or_none()
    if permitted is None:
        raise_integration_error(
            status.HTTP_403_FORBIDDEN,
            "insufficient_scope",
            "Úvazek není v rozsahu klienta.",
        )
