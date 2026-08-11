from __future__ import annotations

from collections.abc import Callable

import httpx
import pytest

from app.config import Settings, validate_external_endpoint_url
from app.services import external_auth
from app.services.external_auth import ExternalAuthError


def _settings() -> Settings:
    return Settings(
        database_url="sqlite+pysqlite:///:memory:",
        session_secret="x" * 32,
        google_oidc_enabled=True,
        google_oidc_client_id="client",
        google_oidc_client_secret="secret",
    )


@pytest.mark.parametrize(
    "url",
    [
        "http://accounts.google.com/.well-known/openid-configuration",
        "https://user@accounts.google.com/.well-known/openid-configuration",
        "https://accounts.google.com:443/.well-known/openid-configuration",
        "https://127.0.0.1/.well-known/openid-configuration",
        "https://localhost/.well-known/openid-configuration",
        "https://accounts.google.com.evil.example/.well-known/openid-configuration",
        "https://accounts.google.com/other",
    ],
)
def test_provider_url_allowlist_rejects_ssrf_targets(url: str) -> None:
    with pytest.raises(ValueError):
        validate_external_endpoint_url(
            url,
            setting_name="test",
            allowed_hosts={"accounts.google.com"},
            allowed_paths={"/.well-known/openid-configuration"},
        )


def _mock_client(
    monkeypatch: pytest.MonkeyPatch, handler: Callable[[httpx.Request], httpx.Response]
) -> None:
    transport = httpx.MockTransport(handler)
    original_client = httpx.Client

    def factory(**kwargs: object) -> httpx.Client:
        return original_client(transport=transport, **kwargs)

    monkeypatch.setattr(external_auth.httpx, "Client", factory)
    external_auth._metadata_cache.clear()


def test_google_discovery_validates_issuer_and_all_endpoints(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            request=request,
            json={
                "issuer": "https://accounts.google.com",
                "authorization_endpoint": "https://accounts.google.com/o/oauth2/v2/auth",
                "token_endpoint": "https://oauth2.googleapis.com/token",
                "jwks_uri": "https://www.googleapis.com/oauth2/v3/certs",
            },
        )

    _mock_client(monkeypatch, handler)
    metadata = external_auth.google_metadata(_settings())
    assert metadata["issuer"] == "https://accounts.google.com"


def test_google_discovery_rejects_private_metadata_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            request=request,
            json={
                "issuer": "https://accounts.google.com",
                "authorization_endpoint": "https://127.0.0.1/authorize",
                "token_endpoint": "https://oauth2.googleapis.com/token",
                "jwks_uri": "https://www.googleapis.com/oauth2/v3/certs",
            },
        )

    _mock_client(monkeypatch, handler)
    with pytest.raises(ExternalAuthError, match="provider_invalid_configuration"):
        external_auth.google_metadata(_settings())


def test_google_discovery_revalidates_redirect_target(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            302,
            request=request,
            headers={"location": "http://169.254.169.254/latest/meta-data"},
        )

    _mock_client(monkeypatch, handler)
    with pytest.raises(ExternalAuthError, match="provider_invalid_configuration"):
        external_auth.google_metadata(_settings())
