import hashlib
from datetime import UTC, date, datetime, timedelta
from http.cookies import SimpleCookie
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Response
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.api.v1 import admin_users
from app.api.v1.admin_users import (
    PortalUserBlockIn,
    block_user,
    delete_user,
    list_users,
    send_reset_link,
)
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
    ResetDeliveryState,
)
from app.security.passwords import hash_password
from app.security.tokens import issue_instance_token_once, verify_instance_token

BLOCKED_MESSAGE = "Váš přístup byl zablokován, obraťte se na svého nadřízeného."


def _correct_password() -> str:
    return "".join(("Correct", "Pass", "123"))


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
        password_hash=hash_password(_correct_password()).value,
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
    reset_row = db.scalars(select(PortalUserResetToken)).one()
    assert reset_row.revoked_at is not None
    assert raw_token is not None
    assert verify_instance_token(db, raw_token) is None


def test_blocked_login_distinguishes_wrong_and_correct_password() -> None:
    _, db, user, _ = _database()
    user.is_blocked = True
    db.commit()

    _assert_api_error(
        lambda: portal_login(
            PortalLoginIn(email=user.email, password="wrong-password"),
            Response(),
            db,
            SimpleNamespace(session_max_age_seconds=3600, cookie_secure=False),
        ),
        401,
        "portal_invalid_credentials",
    )
    _assert_api_error(
        lambda: portal_login(
            PortalLoginIn(email=user.email, password=_correct_password()),
            Response(),
            db,
            SimpleNamespace(session_max_age_seconds=3600, cookie_secure=False),
        ),
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

    response = Response()
    login = portal_login(
        PortalLoginIn(email=user.email, password=_correct_password()),
        response,
        db,
        SimpleNamespace(session_max_age_seconds=3600, cookie_secure=False, session_secret="x" * 32),
    )

    assert "instance_token" not in login.model_dump()
    cookie = SimpleCookie()
    cookie.load(response.headers["set-cookie"])
    new_token = cookie["dagmar_portal_session"].value
    assert new_token != old_token
    assert verify_instance_token(db, old_token) is None
    assert verify_instance_token(db, new_token) is None
    assert instance.token_hash is None


def test_blocked_reset_token_is_rejected_and_new_reset_is_not_started() -> None:
    _, db, user, _ = _database()
    user.is_blocked = True
    reset_token = "reset-token-value"
    db.add(
        PortalUserResetToken(
            user_id=user.id,
            token_hash=hashlib.sha256(reset_token.encode("utf-8")).hexdigest(),
            expires_at=datetime.now(UTC) + timedelta(hours=1),
            delivery_state=ResetDeliveryState.SENT,
        )
    )
    db.commit()

    _assert_api_error(
        lambda: portal_reset(
            PortalResetIn(token=reset_token, password="NewPass123"), Response(), db
        ),
        403,
        "portal_account_blocked",
        BLOCKED_MESSAGE,
    )
    _assert_api_error(
        lambda: send_reset_link(user.id, object(), object(), None, db, object()),
        403,
        "portal_account_blocked",
        BLOCKED_MESSAGE,
    )


def test_admin_list_exposes_block_state_without_losing_employments() -> None:
    _, db, user, _ = _database()
    user.is_blocked = True
    db.commit()

    result = list_users(
        SimpleNamespace(state=SimpleNamespace(request_id="test-user-list")), object(), db
    )

    assert result.users[0].is_blocked is True
    assert len(result.users[0].employments) == 1


def test_admin_list_fails_whole_response_on_data_integrity_error(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    _, db, _, _ = _database()
    monkeypatch.setattr(
        admin_users,
        "_to_user_out",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(ValueError("private row content")),
    )
    with pytest.raises(HTTPException) as error:
        list_users(
            SimpleNamespace(state=SimpleNamespace(request_id="integrity-request")),
            object(),
            db,
        )
    assert error.value.status_code == 500
    assert error.value.detail["code"] == "data_integrity_error"
    assert "user_id=" in caplog.text
    assert "request_id=integrity-request" in caplog.text
    assert "private row content" not in caplog.text


def test_delete_user_removes_the_attached_web_instance() -> None:
    _, db, user, instance = _database()
    user_id = user.id
    instance_id = instance.id

    result = delete_user(user_id, object(), None, db)

    assert result.ok is True
    assert db.get(PortalUser, user_id) is None
    assert db.get(Instance, instance_id) is None


def test_delete_user_preserves_instance_owned_by_another_user() -> None:
    _, db, user, instance = _database()
    other = PortalUser(
        email="shared-owner@example.test",
        name="Shared owner",
        role=PortalUserRole.EMPLOYEE,
        password_hash=hash_password("OtherPass123").value,
        is_active=True,
        instance_id=instance.id,
    )
    db.add(other)
    db.commit()

    assert delete_user(user.id, object(), None, db).ok is True
    assert db.get(Instance, instance.id) is instance
    assert db.get(PortalUser, other.id) is other


def test_failed_reset_delivery_is_never_an_active_token(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    _, db, user, _ = _database()
    caplog.set_level("WARNING", logger="dagmar.security")

    def fail_delivery(**_kwargs) -> None:
        raise ValueError("SMTP detail must not escape")

    monkeypatch.setattr(admin_users, "_send_reset_email", fail_delivery)
    _assert_api_error(
        lambda: send_reset_link(
            user.id,
            object(),
            object(),
            None,
            db,
            SimpleNamespace(public_base_url="https://dagmar.hcasc.cz"),
        ),
        400,
        "reset_email_failed",
        "Resetovací e-mail se nepodařilo odeslat.",
    )
    reset = db.execute(select(PortalUserResetToken)).scalar_one()
    assert reset.delivery_state == ResetDeliveryState.FAILED
    assert reset.revoked_at is not None
    assert "security_event=reset_delivery_failed" in caplog.text
    assert f"user_id={user.id}" in caplog.text
    assert "error_type=ValueError" in caplog.text
    assert "SMTP detail must not escape" not in caplog.text


def test_new_reset_delivery_revokes_the_previous_sent_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, db, user, _ = _database()
    delivered_urls: list[str] = []

    def record_delivery(*, reset_url: str, **_kwargs) -> None:
        delivered_urls.append(reset_url)

    monkeypatch.setattr(admin_users, "_send_reset_email", record_delivery)
    settings = SimpleNamespace(public_base_url="https://dagmar.hcasc.cz")
    send_reset_link(user.id, object(), object(), None, db, settings)
    send_reset_link(user.id, object(), object(), None, db, settings)

    tokens = (
        db.execute(select(PortalUserResetToken).order_by(PortalUserResetToken.id)).scalars().all()
    )
    active = [
        token
        for token in tokens
        if token.delivery_state == ResetDeliveryState.SENT
        and token.used_at is None
        and token.revoked_at is None
    ]
    assert len(tokens) == 2
    assert len(active) == 1
    assert tokens[0].revoked_at is not None
    assert len(delivered_urls) == 2
