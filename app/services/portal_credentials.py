from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime

from sqlalchemy import select, text, update
from sqlalchemy.orm import Session

from app.db.models import Instance, PortalUser, PortalUserResetToken, ResetDeliveryState
from app.security.lockout import clear_user_lockout, revoke_unlock_tokens
from app.security.passwords import hash_password


def revoke_instance_credential(db: Session, user: PortalUser) -> None:
    instance = user.instance or (db.get(Instance, user.instance_id) if user.instance_id else None)
    if instance is None:
        return
    instance.token_hash = None
    instance.token_issued_at = None
    db.add(instance)


def revoke_password_reset_tokens(db: Session, user_id: int, *, now: datetime | None = None) -> None:
    revoked_at = now or datetime.now(UTC)
    db.execute(
        update(PortalUserResetToken)
        .where(PortalUserResetToken.user_id == user_id)
        .where(PortalUserResetToken.used_at.is_(None))
        .where(PortalUserResetToken.revoked_at.is_(None))
        .values(revoked_at=revoked_at)
    )


def change_portal_password(db: Session, user: PortalUser, raw_password: str) -> None:
    """Apply the complete credential transition in the caller's transaction."""

    password = raw_password.strip()
    if not password:
        raise ValueError("Heslo nesmí být prázdné.")
    user.password_hash = hash_password(password).value
    revoke_password_reset_tokens(db, user.id)
    revoke_unlock_tokens(db, actor_type="portal", principal=user.email.lower())
    clear_user_lockout(db, actor_type="portal", principal=user.email.lower())
    revoke_instance_credential(db, user)
    db.add(user)


def lock_portal_user(db: Session, user_id: int) -> PortalUser | None:
    return db.execute(
        select(PortalUser)
        .where(PortalUser.id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()


def mark_reset_delivery(
    row: PortalUserResetToken,
    state: ResetDeliveryState,
    *,
    revoked: bool = False,
) -> None:
    row.delivery_state = state
    if revoked:
        row.revoked_at = datetime.now(UTC)


@contextmanager
def reset_issuance_lock(db: Session, user_id: int) -> Iterator[None]:
    """Serialize reset delivery across commits on PostgreSQL for one user."""

    is_postgres = db.get_bind().dialect.name == "postgresql"
    if is_postgres:
        db.execute(text("SELECT pg_advisory_lock(1145520466, :id)"), {"id": user_id})
    try:
        yield
    finally:
        if is_postgres:
            db.execute(text("SELECT pg_advisory_unlock(1145520466, :id)"), {"id": user_id})
