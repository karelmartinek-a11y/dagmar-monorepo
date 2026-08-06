import hashlib
from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.api.v1.admin_users import PortalUserBlockIn, block_user, list_users, send_reset_link
from app.api.v1.portal_auth import PortalLoginIn, PortalResetIn, portal_login, portal_reset
from app.db.models import (
    Base,
    ClientType,
    Employment,
    EmploymentType,
    Instance,
    InstanceStatus,
    PortalUser,
    PortalUserResetToken,
    PortalUserRole,
)
from app.security.passwords import hash_password
from app.security.tokens import issue_instance_token_once, verify_instance_token

BLOCKED_MESSAGE = "Váš přístup byl zablokován, obraťte se na svého nadřízeného."


def _database() -> tuple[object, Session, PortalUser, Instance]:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = Session(engine)
    instance = Instance(
        id="blocking-test-instance",
        client_type=ClientType.WEB,
        device_fingerprint="blocking-test-device",
        status=InstanceStatus.ACTIVE,
        display_name="Blocking test",
    )
    user = PortalUser(
        email="blocking@example.test",
        name="Blocking test user",
        role=PortalUserRole.EMPLOYEE,
        password_hash=hash_password("CorrectPass123").value,
        is_active=True,
        is_blocked=False,
        instance=instance,
    )
    user.employments.append(
        Employment(
            title="Test employment",
            employment_type=EmploymentType.WORK_CONTRACT,
            workload_fraction=1,
            total_hours_enabled=True,
            night_hours_enabled=True,
            start_date=date(2026, 1, 1),
            is_active=True,
        )
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    db.refresh(instance)
    return engine, db, user, instance


def _assert_api_error(call, status_code: int, code: str, message: str | None = None) -> None:
    with pytest.raises(HTTPException) as raised:
        call()
    assert raised.value.status_code == status_code
    assert raised.value.detail["code"] == code
    if message is not None:
        assert raised.value.detail["message"] == message


def test_blocking_preserves_profile_and_revokes_token_and_reset_tokens() -> None:
    _, db, user, instance = _database()
    raw_token = issue_instance_token_once(db, instance)
    db.add(
        PortalUserResetToken(
            user_id=user.id,
            token_hash="stale-reset-token",
            expires_at=datetime.now(UTC) + timedelta(hours=1),
        )
    )
    db.commit()
    password_hash = user.password_hash
    employment_id = user.employments[0].id

    result = block_user(user.id, PortalUserBlockIn(blocked=True), object(), None, db)

    assert result.is_blocked is True
    assert user.is_active is True
    assert user.password_hash == password_hash
    assert user.employments[0].id == employment_id
    assert instance.token_hash is None
    assert db.scalars(select(PortalUserResetToken)).all() == []
    assert raw_token is not None
    assert verify_instance_token(db, raw_token) is None


def test_blocked_login_distinguishes_wrong_and_correct_password() -> None:
    _, db, user, _ = _database()
    user.is_blocked = True
    db.commit()

    _assert_api_error(
        lambda: portal_login(PortalLoginIn(email=user.email, password="wrong-password"), db),
        401,
        "portal_invalid_credentials",
    )
    _assert_api_error(
        lambda: portal_login(PortalLoginIn(email=user.email, password="CorrectPass123"), db),
        403,
        "portal_account_blocked",
        BLOCKED_MESSAGE,
    )


def test_unblock_allows_new_login_but_never_restores_old_token() -> None:
    _, db, user, instance = _database()
    old_token = issue_instance_token_once(db, instance)
    db.commit()
    block_user(user.id, PortalUserBlockIn(blocked=True), object(), None, db)
    block_user(user.id, PortalUserBlockIn(blocked=False), object(), None, db)

    login = portal_login(PortalLoginIn(email=user.email, password="CorrectPass123"), db)

    assert login.instance_token != old_token
    assert verify_instance_token(db, old_token) is None
    assert verify_instance_token(db, login.instance_token) is instance


def test_blocked_reset_token_is_rejected_and_new_reset_is_not_started() -> None:
    _, db, user, _ = _database()
    user.is_blocked = True
    reset_token = "reset-token-value"
    db.add(
        PortalUserResetToken(
            user_id=user.id,
            token_hash=hashlib.sha256(reset_token.encode("utf-8")).hexdigest(),
            expires_at=datetime.now(UTC) + timedelta(hours=1),
        )
    )
    db.commit()

    _assert_api_error(
        lambda: portal_reset(PortalResetIn(token=reset_token, password="NewPass123"), db),
        403,
        "portal_account_blocked",
        BLOCKED_MESSAGE,
    )
    _assert_api_error(
        lambda: send_reset_link(user.id, object(), None, db, object()),
        403,
        "portal_account_blocked",
        BLOCKED_MESSAGE,
    )


def test_admin_list_exposes_block_state_without_losing_employments() -> None:
    _, db, user, _ = _database()
    user.is_blocked = True
    db.commit()

    result = list_users(object(), db)

    assert result.users[0].is_blocked is True
    assert len(result.users[0].employments) == 1
