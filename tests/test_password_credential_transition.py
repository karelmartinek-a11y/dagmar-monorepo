from __future__ import annotations

import base64
import hashlib
from datetime import UTC, date, datetime, timedelta

import bcrypt
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.config import Settings
from app.db.models import (
    AuthLockoutState,
    AuthUnlockToken,
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
from app.security import sessions
from app.security.lockout import (
    ADMIN_LOCKOUT_DURATION,
    ADMIN_LOCKOUT_THRESHOLD,
    ADMIN_LOCKOUT_WINDOW,
    is_locked,
    issue_unlock_token,
    record_failed_login,
)
from app.security.passwords import hash_password, verify_password_details
from app.security.tokens import (
    generate_instance_token,
    issue_instance_token_once,
    verify_instance_token,
)
from app.services.portal_credentials import change_portal_password


def test_legacy_bcrypt_is_verified_directly_and_requires_argon2_rehash() -> None:
    legacy = bcrypt.hashpw(b"LegacyPass123", bcrypt.gensalt()).decode("ascii")
    valid = verify_password_details("LegacyPass123", legacy)
    invalid = verify_password_details("wrong", legacy)
    assert valid.valid is True
    assert valid.needs_rehash is True
    assert invalid.valid is False


def test_new_password_hash_is_argon2_and_malformed_hash_is_rejected() -> None:
    encoded = hash_password("StrongPass123").value
    assert encoded.startswith("$argon2")
    assert verify_password_details("StrongPass123", encoded).valid is True
    assert verify_password_details("StrongPass123", "$argon2id$broken").valid is False


def test_legacy_plain_sha256_is_constant_time_verified_and_requires_rehash() -> None:
    legacy = hashlib.sha256(b"LegacyPass123").hexdigest()
    valid = verify_password_details("LegacyPass123", legacy)
    invalid = verify_password_details("wrong", legacy)
    assert valid.valid is True
    assert valid.needs_rehash is True
    assert invalid.valid is False


def test_removed_ineffective_auth_settings_and_dead_admin_session_api_stay_absent() -> None:
    assert "csrf_secret" not in Settings.model_fields
    assert "instance_token_length" not in Settings.model_fields
    assert "admin_password" not in Settings.model_fields
    assert "admin_users" not in Base.metadata.tables
    assert not hasattr(sessions, "create_admin_session_row")
    assert not hasattr(sessions, "load_admin_session_data")


def test_instance_token_format_has_one_fixed_cryptographic_size() -> None:
    token = generate_instance_token()
    assert token.startswith("dg_")
    assert len(token) == 46
    assert len(base64.urlsafe_b64decode(token.removeprefix("dg_") + "=")) == 32


def test_admin_lockout_does_not_extend_while_locked() -> None:
    now = datetime.now(UTC)
    state = AuthLockoutState(actor_type="admin", principal="admin@example.test")
    for offset in range(ADMIN_LOCKOUT_THRESHOLD):
        record_failed_login(
            state,
            now=now + timedelta(seconds=offset),
            lock_duration=ADMIN_LOCKOUT_DURATION,
            threshold=ADMIN_LOCKOUT_THRESHOLD,
            window=ADMIN_LOCKOUT_WINDOW,
        )
    locked_until = state.locked_until
    assert is_locked(state, now + timedelta(seconds=5))
    record_failed_login(
        state,
        now=now + timedelta(minutes=1),
        lock_duration=ADMIN_LOCKOUT_DURATION,
        threshold=ADMIN_LOCKOUT_THRESHOLD,
        window=ADMIN_LOCKOUT_WINDOW,
    )
    assert state.locked_until == locked_until
    assert locked_until is not None
    assert not is_locked(state, locked_until + timedelta(microseconds=1))


def test_credential_transition_rolls_back_as_one_unit() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = Session(engine)
    instance = Instance(
        id="rollback-instance",
        client_type=ClientType.WEB,
        device_fingerprint="user:rollback@example.test",
        status=InstanceStatus.ACTIVE,
    )
    user = PortalUser(
        email="rollback@example.test",
        name="Rollback",
        role=PortalUserRole.EMPLOYEE,
        password_hash=hash_password("OriginalPass123").value,
        is_active=True,
        instance=instance,
    )
    user.employments.append(
        Employment(
            title="Rollback employment",
            employment_type=EmploymentType.WORK_CONTRACT,
            workload_fraction=1,
            total_hours_enabled=True,
            night_hours_enabled=True,
            start_date=date(2026, 1, 1),
            is_active=True,
        )
    )
    db.add(user)
    db.flush()
    raw_instance_token = issue_instance_token_once(db, instance)
    reset = PortalUserResetToken(
        user_id=user.id,
        token_hash="rollback-reset",
        expires_at=datetime.now(UTC) + timedelta(hours=1),
        delivery_state=ResetDeliveryState.SENT,
    )
    db.add(reset)
    issue_unlock_token(db, actor_type="portal", principal=user.email, purpose="unlock")
    db.commit()
    original_hash = user.password_hash

    change_portal_password(db, user, "ChangedPass123")
    db.flush()
    assert instance.token_hash is None
    assert reset.revoked_at is not None
    assert db.execute(select(AuthUnlockToken)).scalars().all() == []
    db.rollback()

    db.refresh(user)
    db.refresh(instance)
    db.refresh(reset)
    assert user.password_hash == original_hash
    assert reset.revoked_at is None
    assert raw_instance_token is not None
    assert verify_instance_token(db, raw_instance_token) is instance
    assert len(db.execute(select(AuthUnlockToken)).scalars().all()) == 1
