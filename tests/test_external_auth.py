from __future__ import annotations

import json
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from fastapi import FastAPI
from fastapi.testclient import TestClient
from jwt.algorithms import RSAAlgorithm
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import PortalUserAuth, require_admin, require_portal_user_auth
from app.api.v1 import external_auth
from app.config import ADMIN_IDENTITY_EMAIL, Settings, get_settings
from app.db.models import (
    Base,
    ClientType,
    Employment,
    ExternalIdentity,
    Instance,
    InstanceStatus,
    OAuthTransaction,
    PortalUser,
    PortalUserRole,
)
from app.db.session import get_db
from app.security.csrf import require_csrf
from app.security.passwords import hash_password
from app.services import external_auth as service


def _settings(**changes) -> Settings:
    values = dict(
        database_url="sqlite+pysqlite:///:memory:",
        session_secret="s" * 32,
        csrf_secret="c" * 32,
        cookie_secure=False,
        rate_limit_enabled=False,
        google_oidc_enabled=True,
        google_oidc_client_id="google-client",
        google_oidc_client_secret="google-secret",
        apple_signin_enabled=True,
        apple_services_id="apple.service",
        apple_team_id="TEAM123",
        apple_key_id="KEY123",
        apple_private_key_path="/nonexistent-test-key.p8",
        admin_password_hash=hash_password("AdminPass123").value,
    )
    values.update(changes)
    return Settings(**values)


@pytest.fixture
def db_factory() -> sessionmaker[Session]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def _employee(db: Session, *, email: str = "employee@example.test", active: bool = True) -> PortalUser:
    instance = Instance(
        id=f"instance-{email}",
        client_type=ClientType.WEB,
        device_fingerprint=f"fingerprint-{email}",
        status=InstanceStatus.ACTIVE,
        display_name="Employee",
        employment_template="DPP_DPC",
    )
    user = PortalUser(
        email=email,
        name="Employee",
        role=PortalUserRole.EMPLOYEE,
        password_hash=hash_password("EmployeePass123").value,
        is_active=active,
        instance=instance,
    )
    db.add(user)
    db.flush()
    db.add(Employment(user_id=user.id, title="Pracovní poměr", employment_type="HPP", start_date=date(2020, 1, 1), is_active=True))
    db.commit()
    db.refresh(user)
    return user


def test_safe_return_path_rejects_external_and_encoded_urls() -> None:
    assert service.safe_return_path("employee", "login", "https://evil.test") == "/app"
    assert service.safe_return_path("employee", "login", "//evil.test") == "/app"
    assert service.safe_return_path("admin", "login", "/%2f%2fevil.test") == "/admin/prehled"
    assert service.safe_return_path("admin", "link", "/admin/ucet") == "/admin/ucet"


def test_enabled_provider_requires_complete_secure_configuration() -> None:
    with pytest.raises(ValueError, match="GOOGLE_OIDC_CLIENT_SECRET"):
        _settings(google_oidc_client_secret=None, apple_signin_enabled=False).validate_external_auth()
    with pytest.raises(ValueError, match="callback URL"):
        _settings(
            apple_signin_enabled=False,
            google_oidc_callback_url="https://evil.test/callback",
        ).validate_external_auth()


def test_transaction_is_random_bound_expiring_and_one_time(db_factory, monkeypatch) -> None:
    monkeypatch.setattr(service, "authorization_url", lambda *args, **kwargs: "https://provider.test/authorize")
    settings = _settings()
    with db_factory() as db:
        started = service.start_transaction(
            db, provider="google", purpose="login", portal="employee", return_path="/app",
            browser_secret=None, settings=settings,
        )
        assert started.transaction.state_hash != started.state
        assert started.transaction.nonce
        assert started.transaction.code_verifier
        consumed = service.consume_transaction(db, provider="google", state=started.state, browser_secret=started.browser_secret)
        assert consumed.consumed_at is not None
        with pytest.raises(service.ExternalAuthError, match="callback_replayed"):
            service.consume_transaction(db, provider="google", state=started.state, browser_secret=started.browser_secret)


@pytest.mark.parametrize("failure", ["state", "browser", "expired"])
def test_transaction_rejects_invalid_security_context(db_factory, monkeypatch, failure) -> None:
    monkeypatch.setattr(service, "authorization_url", lambda *args, **kwargs: "https://provider.test/authorize")
    with db_factory() as db:
        started = service.start_transaction(
            db, provider="google", purpose="login", portal="employee", return_path="/app",
            browser_secret="b" * 40, settings=_settings(),
        )
        state = "invalid" if failure == "state" else started.state
        browser = "invalid" if failure == "browser" else started.browser_secret
        if failure == "expired":
            started.transaction.expires_at = datetime.now(UTC) - timedelta(seconds=1)
            db.commit()
        with pytest.raises(service.ExternalAuthError):
            service.consume_transaction(db, provider="google", state=state, browser_secret=browser)


def test_google_authorization_url_uses_oidc_pkce(monkeypatch) -> None:
    monkeypatch.setattr(service, "google_metadata", lambda settings: {"authorization_endpoint": "https://accounts.google.test/auth"})
    url = service.authorization_url("google", "state", "nonce", "verifier", _settings())
    query = parse_qs(urlparse(url).query)
    assert query["response_type"] == ["code"]
    assert query["scope"] == ["openid email profile"]
    assert query["nonce"] == ["nonce"]
    assert query["code_challenge_method"] == ["S256"]
    assert query["redirect_uri"] == ["https://dagmar.hcasc.cz/api/v1/auth/google/callback"]


def test_apple_authorization_url_uses_form_post() -> None:
    query = parse_qs(urlparse(service.authorization_url("apple", "state", "nonce", None, _settings())).query)
    assert query["response_mode"] == ["form_post"]
    assert query["scope"] == ["name email"]
    assert query["client_id"] == ["apple.service"]


def test_apple_client_secret_is_short_lived_es256(tmp_path) -> None:
    key = ec.generate_private_key(ec.SECP256R1())
    from cryptography.hazmat.primitives import serialization

    path = tmp_path / "apple.p8"
    path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    token = service._apple_client_secret(_settings(apple_private_key_path=str(path)))
    header = jwt.get_unverified_header(token)
    claims = jwt.decode(token, options={"verify_signature": False})
    assert header == {"alg": "ES256", "kid": "KEY123", "typ": "JWT"}
    assert claims["iss"] == "TEAM123"
    assert claims["sub"] == "apple.service"
    assert 0 < claims["exp"] - claims["iat"] <= 300


def _rsa_token(*, issuer="https://accounts.google.com", audience="google-client", nonce="nonce", expired=False, key=None, kid="kid-1"):
    key = key or rsa.generate_private_key(public_exponent=65537, key_size=2048)
    now = datetime.now(UTC)
    token = jwt.encode(
        {"iss": issuer, "sub": "provider-subject", "aud": audience, "iat": now, "exp": now + (-timedelta(minutes=2) if expired else timedelta(minutes=5)), "nonce": nonce, "email": "relay@privaterelay.appleid.com", "email_verified": True},
        key, algorithm="RS256", headers={"kid": kid},
    )
    jwk = json.loads(RSAAlgorithm.to_jwk(key.public_key()))
    jwk["kid"] = kid
    jwk["alg"] = "RS256"
    return token, jwk


@pytest.mark.parametrize(
    ("issuer", "audience", "nonce", "expired", "expected"),
    [
        ("https://wrong.test", "google-client", "nonce", False, "token_validation_failed"),
        ("https://accounts.google.com", "wrong-client", "nonce", False, "token_validation_failed"),
        ("https://accounts.google.com", "google-client", "wrong", False, "nonce_invalid"),
        ("https://accounts.google.com", "google-client", "nonce", True, "token_expired"),
    ],
)
def test_id_token_claim_validation(monkeypatch, issuer, audience, nonce, expired, expected) -> None:
    token, jwk = _rsa_token(issuer=issuer, audience=audience, nonce=nonce, expired=expired)
    monkeypatch.setattr(service, "_token_request", lambda *args: (token, "https://jwks.test", "https://accounts.google.com"))
    monkeypatch.setattr(service, "_get_json", lambda *args, **kwargs: {"keys": [jwk]})
    tx = SimpleNamespace(nonce="nonce", code_verifier="verifier")
    with pytest.raises(service.ExternalAuthError, match=expected):
        service.exchange_and_validate("google", "code", tx, _settings())


def test_id_token_valid_and_private_relay_is_informational(monkeypatch) -> None:
    token, jwk = _rsa_token()
    monkeypatch.setattr(service, "_token_request", lambda *args: (token, "https://jwks.test", "https://accounts.google.com"))
    monkeypatch.setattr(service, "_get_json", lambda *args, **kwargs: {"keys": [jwk]})
    claims = service.exchange_and_validate("google", "code", SimpleNamespace(nonce="nonce"), _settings())
    assert claims.subject == "provider-subject"
    assert claims.email == "relay@privaterelay.appleid.com"


def test_google_legacy_issuer_is_accepted(monkeypatch) -> None:
    token, jwk = _rsa_token(issuer="accounts.google.com")
    monkeypatch.setattr(service, "_token_request", lambda *args: (token, "https://jwks.test", "https://accounts.google.com"))
    monkeypatch.setattr(service, "_get_json", lambda *args, **kwargs: {"keys": [jwk]})
    claims = service.exchange_and_validate("google", "code", SimpleNamespace(nonce="nonce"), _settings())
    assert claims.issuer == "accounts.google.com"


def test_jwks_rotation_refreshes_unknown_kid(monkeypatch) -> None:
    token, jwk = _rsa_token(kid="rotated")
    calls: list[bool] = []
    def fake_json(*args, refresh=False, **kwargs):
        calls.append(refresh)
        return {"keys": [jwk]} if refresh else {"keys": []}
    monkeypatch.setattr(service, "_get_json", fake_json)
    assert service._signing_key(token, "https://jwks.test", _settings()) is not None
    assert calls == [False, True]


def _client(db_factory, settings: Settings, employee: PortalUser) -> TestClient:
    app = FastAPI()
    app.include_router(external_auth.router)
    def override_db():
        with db_factory() as db:
            yield db
    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_settings] = lambda: settings
    with db_factory() as db:
        instance = db.get(Instance, employee.instance_id)
        user = db.get(PortalUser, employee.id)
        assert instance and user
        employee_auth = PortalUserAuth(instance=instance, user=user)
    app.dependency_overrides[require_portal_user_auth] = lambda: employee_auth
    app.dependency_overrides[require_admin] = lambda: SimpleNamespace(username=ADMIN_IDENTITY_EMAIL)
    app.dependency_overrides[require_csrf] = lambda: None
    return TestClient(app)


def test_link_requires_fresh_password_and_unlink_preserves_password(db_factory, monkeypatch) -> None:
    settings = _settings()
    with db_factory() as db:
        user = _employee(db)
    client = _client(db_factory, settings, user)
    response = client.post("/api/v1/portal/auth-methods/google/link", json={"password": "wrong"})
    assert response.status_code == 401
    with db_factory() as db:
        db.add(ExternalIdentity(account_type="employee", portal_user_id=user.id, provider="google", issuer="https://accounts.google.com", subject="sub", email="person@example.test", email_verified=True))
        db.commit()
    response = client.request("DELETE", "/api/v1/portal/auth-methods/google", json={"password": "EmployeePass123"})
    assert response.status_code == 200
    with db_factory() as db:
        stored = db.get(PortalUser, user.id)
        assert stored and stored.password_hash and not db.execute(select(ExternalIdentity)).scalars().all()


def test_same_provider_subject_cannot_link_two_accounts(db_factory) -> None:
    with db_factory() as db:
        first = _employee(db, email="first@example.test")
        second = _employee(db, email="second@example.test")
        db.add(ExternalIdentity(account_type="employee", portal_user_id=first.id, provider="google", issuer="https://accounts.google.com", subject="same", email_verified=True))
        db.commit()
        tx = OAuthTransaction(id="tx", state_hash="state", browser_hash="browser", provider="google", purpose="link", portal="employee", return_path="/app", portal_user_id=second.id, nonce="nonce", expires_at=datetime.now(UTC) + timedelta(minutes=5))
        with pytest.raises(service.ExternalAuthError, match="identity_owned_by_another_account"):
            external_auth._complete_link(db, SimpleNamespace(client=None, headers={}, state=SimpleNamespace(request_id="r")), _settings(), tx, service.ProviderClaims("https://accounts.google.com", "same", None, None))


def test_employee_and_admin_identity_targets_are_separate(db_factory) -> None:
    with db_factory() as db:
        user = _employee(db)
        db.add_all([
            ExternalIdentity(account_type="employee", portal_user_id=user.id, provider="google", issuer="https://accounts.google.com", subject="employee-sub"),
            ExternalIdentity(account_type="admin", admin_username=ADMIN_IDENTITY_EMAIL, provider="google", issuer="https://accounts.google.com", subject="admin-sub"),
        ])
        db.commit()
        assert db.execute(select(ExternalIdentity)).scalars().all().__len__() == 2


def test_employee_link_callback_creates_only_explicit_target(db_factory, monkeypatch) -> None:
    settings = _settings()
    with db_factory() as db:
        user = _employee(db)
        monkeypatch.setattr(service, "authorization_url", lambda *args, **kwargs: "https://provider.test")
        started = service.start_transaction(
            db, provider="google", purpose="link", portal="employee", return_path="/app",
            browser_secret="browser-secret-value-with-sufficient-length", settings=settings, portal_user_id=user.id,
        )
    client = _client(db_factory, settings, user)
    client.cookies.set(external_auth.BROWSER_COOKIE, started.browser_secret)
    monkeypatch.setattr(external_auth, "exchange_and_validate", lambda *args: service.ProviderClaims("https://accounts.google.com", "linked-sub", "different-email@example.test", True))
    response = client.get(f"/api/v1/auth/google/callback?state={started.state}&code=one-time", follow_redirects=False)
    assert response.status_code == 303
    assert response.headers["location"] == "/app?external_auth_linked=google"
    with db_factory() as db:
        identity = db.execute(select(ExternalIdentity)).scalar_one()
        stored_user = db.get(PortalUser, user.id)
        assert identity.portal_user_id == user.id
        assert identity.email == "different-email@example.test"
        assert stored_user and stored_user.email == "employee@example.test"


def test_unlinked_external_login_never_matches_email(db_factory, monkeypatch) -> None:
    settings = _settings()
    with db_factory() as db:
        user = _employee(db)
        monkeypatch.setattr(service, "authorization_url", lambda *args, **kwargs: "https://provider.test")
        started = service.start_transaction(
            db, provider="google", purpose="login", portal="employee", return_path="/app",
            browser_secret="browser-secret-value-with-sufficient-length", settings=settings,
        )
    client = _client(db_factory, settings, user)
    client.cookies.set(external_auth.BROWSER_COOKIE, started.browser_secret)
    monkeypatch.setattr(external_auth, "exchange_and_validate", lambda *args: service.ProviderClaims("https://accounts.google.com", "not-linked", user.email, True))
    response = client.get(f"/api/v1/auth/google/callback?state={started.state}&code=code", follow_redirects=False)
    assert response.status_code == 303
    assert "external_identity_not_linked" in response.headers["location"]
    with db_factory() as db:
        assert db.execute(select(ExternalIdentity)).scalars().all() == []


def test_employee_external_login_returns_standard_internal_bearer_once(db_factory, monkeypatch) -> None:
    settings = _settings()
    with db_factory() as db:
        user = _employee(db)
        db.add(ExternalIdentity(account_type="employee", portal_user_id=user.id, provider="google", issuer="https://accounts.google.com", subject="linked"))
        db.commit()
        monkeypatch.setattr(service, "authorization_url", lambda *args, **kwargs: "https://provider.test")
        started = service.start_transaction(
            db, provider="google", purpose="login", portal="employee", return_path="/app",
            browser_secret="browser-secret-value-with-sufficient-length", settings=settings,
        )
    client = _client(db_factory, settings, user)
    client.cookies.set(external_auth.BROWSER_COOKIE, started.browser_secret)
    monkeypatch.setattr(external_auth, "exchange_and_validate", lambda *args: service.ProviderClaims("https://accounts.google.com", "linked", None, None))
    callback = client.get(f"/api/v1/auth/google/callback?state={started.state}&code=code", follow_redirects=False)
    assert callback.status_code == 303
    assert callback.headers["location"] == "/app?external_auth=complete"
    result = client.post("/api/v1/auth/result")
    assert result.status_code == 200
    assert result.json()["instance_token"].startswith("dg_")
    assert result.json()["employment_id"] is not None
    assert client.post("/api/v1/auth/result").status_code == 400


def test_admin_external_login_issues_admin_session_not_employee_access(db_factory, monkeypatch) -> None:
    settings = _settings()
    with db_factory() as db:
        user = _employee(db)
        db.add(ExternalIdentity(account_type="admin", admin_username=ADMIN_IDENTITY_EMAIL, provider="apple", issuer="https://appleid.apple.com", subject="admin-sub"))
        db.commit()
        monkeypatch.setattr(service, "authorization_url", lambda *args, **kwargs: "https://provider.test")
        started = service.start_transaction(
            db, provider="apple", purpose="login", portal="admin", return_path="/admin/prehled",
            browser_secret="browser-secret-value-with-sufficient-length", settings=settings,
        )
    client = _client(db_factory, settings, user)
    client.cookies.set(external_auth.BROWSER_COOKIE, started.browser_secret)
    monkeypatch.setattr(external_auth, "exchange_and_validate", lambda *args: service.ProviderClaims("https://appleid.apple.com", "admin-sub", "relay@privaterelay.appleid.com", True))
    callback = client.post(
        "/api/v1/auth/apple/callback",
        data={"state": started.state, "code": "apple-code", "user": json.dumps({"name": {"firstName": "Ignored"}})},
        follow_redirects=False,
    )
    assert callback.status_code == 303
    assert callback.headers["location"] == "/admin/prehled"
    assert callback.cookies.get("dagmar_admin_session")
    assert external_auth.RESULT_COOKIE not in callback.cookies
