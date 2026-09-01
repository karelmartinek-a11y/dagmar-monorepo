from __future__ import annotations

import ipaddress
import os
from datetime import UTC, datetime
from functools import lru_cache
from typing import Literal, cast
from urllib.parse import SplitResult, urlsplit

from dotenv import dotenv_values
from pydantic import BaseModel, Field


def _format_deploy_tag(dt: datetime) -> str:
    return f"{dt.year % 100:02d}{dt.month:02d}{dt.day:02d}{dt.hour:02d}{dt.minute:02d}"


_ENV_VALUES = ("production", "staging", "development")
_SAMESITE_VALUES = ("lax", "strict")
ADMIN_IDENTITY_EMAIL = "provoz@hotelchodovasc.cz"


def _coerce_environment(value: str) -> Literal["production", "staging", "development"]:
    normalized = value.lower()
    if normalized in _ENV_VALUES:
        return cast(Literal["production", "staging", "development"], normalized)
    raise ValueError(
        f"DAGMAR_ENV must be one of: production, staging, development (received {value!r})."
    )


def _coerce_cookie_samesite(value: str) -> Literal["lax", "strict"]:
    normalized = value.lower()
    if normalized in _SAMESITE_VALUES:
        return cast(Literal["lax", "strict"], normalized)
    raise ValueError(f"DAGMAR_COOKIE_SAMESITE must be one of: lax, strict (received {value!r}).")


def _split_https_url(value: str, *, setting_name: str) -> SplitResult:
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError as exc:
        raise ValueError(f"{setting_name} is not a valid URL.") from exc
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError(f"{setting_name} must be an absolute HTTPS URL.")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError(f"{setting_name} must not contain userinfo.")
    if port is not None:
        raise ValueError(f"{setting_name} must not contain a port.")
    if parsed.query or parsed.fragment:
        raise ValueError(f"{setting_name} must not contain a query or fragment.")
    return parsed


def validate_external_endpoint_url(
    value: str,
    *,
    setting_name: str,
    allowed_hosts: set[str],
    allowed_paths: set[str],
) -> str:
    """Validate an outbound OAuth/OIDC URL against an exact public allowlist."""

    parsed = _split_https_url(value, setting_name=setting_name)
    hostname = str(parsed.hostname).lower().rstrip(".")
    if hostname == "localhost" or hostname.endswith(".localhost"):
        raise ValueError(f"{setting_name} must not target localhost.")
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        address = None
    if address is not None:
        raise ValueError(f"{setting_name} must not target an IP address.")
    if hostname not in allowed_hosts or parsed.path not in allowed_paths:
        raise ValueError(f"{setting_name} is outside the approved provider allowlist.")
    return value


class Settings(BaseModel):
    # --- App basics ---
    app_name: str = Field(default="DAGMAR", description="Human-readable app name")
    environment: Literal["production", "staging", "development"] = Field(default="production")

    # --- Network / public URLs ---
    # Canonical domain required by spec.
    public_base_url: str = Field(
        default="https://dagmar.hcasc.cz",
        description="Public base URL used in links and Android WebView.",
    )

    # --- Backend bind ---
    bind_host: str = Field(default="127.0.0.1")
    bind_port: int = Field(default=8101)

    # --- Database ---
    database_url: str = Field(
        ...,
        description=(
            "PostgreSQL DSN. For production, DAGMAR DB is in Docker and published only on loopback: "
            "postgresql+psycopg://USER:PASS@127.0.0.1:5433/DBNAME"
        ),
    )
    db_pool_size: int = Field(default=5)
    db_max_overflow: int = Field(default=10)
    db_pool_timeout_seconds: int = Field(default=30)

    # --- Admin auth (single admin account) ---
    admin_username: str = Field(default=ADMIN_IDENTITY_EMAIL)
    admin_password_hash: str | None = Field(
        default=None,
        description="Password hash stored/used by backend. Preferred in production.",
    )

    # --- Session & CSRF secrets ---
    # These must be set in /etc/dagmar/backend.env
    session_secret: str = Field(..., min_length=32)
    smtp_password_secret: str | None = Field(default=None, min_length=32)

    # Cookie name for admin session.
    admin_session_cookie: str = Field(default="dagmar_admin_session")
    session_max_age_seconds: int = Field(default=60 * 60 * 12)  # 12h default

    # Cookie flags enforced by spec.
    cookie_secure: bool = Field(default=True)
    cookie_samesite: Literal["lax", "strict"] = Field(default="lax")

    # --- CORS ---
    # Frontend is served on the same domain by Nginx, so CORS can stay restrictive.
    cors_enabled: bool = Field(default=False)
    cors_allow_origins: list[str] = Field(default_factory=lambda: ["https://dagmar.hcasc.cz"])

    # --- Rate limiting ---
    rate_limit_enabled: bool = Field(default=True)
    rate_limit_default_per_minute: int = Field(default=120)
    rate_limit_admin_login_per_minute: int = Field(default=10)
    rate_limit_instance_status_per_minute: int = Field(default=60)
    rate_limit_instance_claim_per_minute: int = Field(default=30)
    rate_limit_integration_health_per_minute: int = Field(default=60)
    rate_limit_integration_data_per_minute: int = Field(default=120)
    rate_limit_integration_openapi_per_minute: int = Field(default=10)

    # --- Security / tokens ---
    integration_token_length: int = Field(
        default=48, description="Random token length for integration clients"
    )

    # --- Logging ---
    log_level: str = Field(default="INFO")
    disable_docs: bool = Field(default=True)
    integration_contract_version: str = Field(default="2026-09-01")

    # --- Optional external sign-in (OIDC) ---
    external_auth_transaction_ttl_seconds: int = Field(default=600, ge=120, le=1800)
    external_auth_result_ttl_seconds: int = Field(default=120, ge=30, le=600)
    external_auth_http_timeout_seconds: float = Field(default=10.0, ge=2.0, le=30.0)
    external_auth_clock_skew_seconds: int = Field(default=30, ge=0, le=120)
    google_oidc_enabled: bool = Field(default=False)
    google_oidc_client_id: str | None = None
    google_oidc_client_secret: str | None = None
    google_oidc_discovery_url: str = "https://accounts.google.com/.well-known/openid-configuration"
    google_oidc_callback_url: str | None = None
    apple_signin_enabled: bool = Field(default=False)
    apple_services_id: str | None = None
    apple_team_id: str | None = None
    apple_key_id: str | None = None
    apple_private_key_path: str | None = None
    apple_issuer: str = "https://appleid.apple.com"
    apple_authorization_endpoint: str = "https://appleid.apple.com/auth/authorize"
    apple_token_endpoint: str = "https://appleid.apple.com/auth/token"
    apple_jwks_endpoint: str = "https://appleid.apple.com/auth/keys"
    apple_callback_url: str | None = None

    # --- Deploy metadata ---
    deploy_tag: str = Field(
        default_factory=lambda: _format_deploy_tag(datetime.now(UTC)),
        description="Kód nasazení backendu (YYMMDDHHMM).",
    )

    def ensure_canonical_domain(self) -> None:
        parsed = _split_https_url(self.public_base_url, setting_name="DAGMAR_PUBLIC_BASE_URL")
        if parsed.path not in {"", "/"}:
            raise ValueError("DAGMAR_PUBLIC_BASE_URL must not contain a path.")
        normalized = f"https://{parsed.hostname}"
        if self.environment == "production" and normalized != "https://dagmar.hcasc.cz":
            raise ValueError(
                "Production DAGMAR_PUBLIC_BASE_URL must be exactly https://dagmar.hcasc.cz."
            )
        self.public_base_url = normalized

        normalized_origins: list[str] = []
        for origin in self.cors_allow_origins:
            cors = _split_https_url(origin, setting_name="DAGMAR_CORS_ALLOW_ORIGINS")
            if cors.path not in {"", "/"}:
                raise ValueError("DAGMAR_CORS_ALLOW_ORIGINS entries must be origins without paths.")
            normalized_origins.append(f"https://{cors.hostname}")
        if self.environment == "production" and normalized_origins != ["https://dagmar.hcasc.cz"]:
            raise ValueError(
                "Production DAGMAR_CORS_ALLOW_ORIGINS must contain only https://dagmar.hcasc.cz."
            )
        self.cors_allow_origins = normalized_origins

    def validate_external_auth(self) -> None:
        canonical = self.public_base_url.rstrip("/")
        expected_callbacks = {
            "google": f"{canonical}/api/v1/auth/google/callback",
            "apple": f"{canonical}/api/v1/auth/apple/callback",
        }
        if self.google_oidc_enabled:
            missing = [
                name
                for name, value in (
                    ("DAGMAR_GOOGLE_OIDC_CLIENT_ID", self.google_oidc_client_id),
                    ("DAGMAR_GOOGLE_OIDC_CLIENT_SECRET", self.google_oidc_client_secret),
                )
                if not value
            ]
            if missing:
                raise ValueError(f"Google OIDC je zapnutý, ale chybí: {', '.join(missing)}")
            if (
                self.google_oidc_callback_url
                and self.google_oidc_callback_url != expected_callbacks["google"]
            ):
                raise ValueError(
                    "Google callback URL musí přesně odpovídat kanonické HTTPS callback cestě."
                )
            validate_external_endpoint_url(
                self.google_oidc_discovery_url,
                setting_name="DAGMAR_GOOGLE_OIDC_DISCOVERY_URL",
                allowed_hosts={"accounts.google.com"},
                allowed_paths={"/.well-known/openid-configuration"},
            )
        if self.apple_signin_enabled:
            missing = [
                name
                for name, value in (
                    ("DAGMAR_APPLE_SERVICES_ID", self.apple_services_id),
                    ("DAGMAR_APPLE_TEAM_ID", self.apple_team_id),
                    ("DAGMAR_APPLE_KEY_ID", self.apple_key_id),
                    ("DAGMAR_APPLE_PRIVATE_KEY_PATH", self.apple_private_key_path),
                )
                if not value
            ]
            if missing:
                raise ValueError(f"Sign in with Apple je zapnutý, ale chybí: {', '.join(missing)}")
            if not os.path.isfile(str(self.apple_private_key_path)):
                raise ValueError("DAGMAR_APPLE_PRIVATE_KEY_PATH neodkazuje na čitelný soubor.")
            if self.apple_callback_url and self.apple_callback_url != expected_callbacks["apple"]:
                raise ValueError(
                    "Apple callback URL musí přesně odpovídat kanonické HTTPS callback cestě."
                )
            for name, endpoint, path in (
                (
                    "DAGMAR_APPLE_AUTHORIZATION_ENDPOINT",
                    self.apple_authorization_endpoint,
                    "/auth/authorize",
                ),
                ("DAGMAR_APPLE_TOKEN_ENDPOINT", self.apple_token_endpoint, "/auth/token"),
                ("DAGMAR_APPLE_JWKS_ENDPOINT", self.apple_jwks_endpoint, "/auth/keys"),
            ):
                validate_external_endpoint_url(
                    endpoint,
                    setting_name=name,
                    allowed_hosts={"appleid.apple.com"},
                    allowed_paths={path},
                )
            validate_external_endpoint_url(
                self.apple_issuer,
                setting_name="DAGMAR_APPLE_ISSUER",
                allowed_hosts={"appleid.apple.com"},
                allowed_paths={""},
            )

    def external_callback_url(self, provider: str) -> str:
        if provider == "google":
            return (
                self.google_oidc_callback_url
                or f"{self.public_base_url.rstrip('/')}/api/v1/auth/google/callback"
            )
        if provider == "apple":
            return (
                self.apple_callback_url
                or f"{self.public_base_url.rstrip('/')}/api/v1/auth/apple/callback"
            )
        raise ValueError("Nepodporovaný poskytovatel.")

    # Property aliases used by call sites that access settings in attribute-style uppercase form.
    @property
    def DATABASE_URL(self) -> str:
        return self.database_url

    @property
    def DB_POOL_SIZE(self) -> int:
        return self.db_pool_size

    @property
    def DB_MAX_OVERFLOW(self) -> int:
        return self.db_max_overflow

    @property
    def DB_POOL_TIMEOUT_SECONDS(self) -> int:
        return self.db_pool_timeout_seconds

    @property
    def session_cookie_name(self) -> str:
        return self.admin_session_cookie


def _load_env_file(path: str) -> None:
    """Load an optional dotenv file without overriding process environment."""

    for key, value in dotenv_values(path).items():
        if value is not None:
            os.environ.setdefault(key, value)


@lru_cache(maxsize=1)
def get_settings(env_file: str = "/etc/dagmar/backend.env") -> Settings:
    # Load env file into process env if present.
    _load_env_file(env_file)

    settings = Settings(
        app_name=os.getenv("DAGMAR_APP_NAME", "DAGMAR"),
        environment=_coerce_environment(os.getenv("DAGMAR_ENV", "production")),
        public_base_url=os.getenv("DAGMAR_PUBLIC_BASE_URL", "https://dagmar.hcasc.cz"),
        bind_host=os.getenv("DAGMAR_BIND_HOST", "127.0.0.1"),
        bind_port=int(os.getenv("DAGMAR_BIND_PORT", "8101")),
        database_url=os.environ["DAGMAR_DATABASE_URL"],
        db_pool_size=int(os.getenv("DAGMAR_DB_POOL_SIZE", "5")),
        db_max_overflow=int(os.getenv("DAGMAR_DB_MAX_OVERFLOW", "10")),
        db_pool_timeout_seconds=int(os.getenv("DAGMAR_DB_POOL_TIMEOUT_SECONDS", "30")),
        admin_username=ADMIN_IDENTITY_EMAIL,
        admin_password_hash=os.getenv("DAGMAR_ADMIN_PASSWORD_HASH") or None,
        session_secret=os.environ["DAGMAR_SESSION_SECRET"],
        smtp_password_secret=os.getenv("DAGMAR_SMTP_PASSWORD_SECRET") or None,
        admin_session_cookie=os.getenv(
            "DAGMAR_ADMIN_SESSION_COOKIE", os.getenv("DAGMAR_COOKIE_NAME", "dagmar_admin_session")
        ),
        session_max_age_seconds=int(os.getenv("DAGMAR_SESSION_MAX_AGE_SECONDS", str(60 * 60 * 12))),
        cookie_secure=os.getenv("DAGMAR_COOKIE_SECURE", "true").lower() == "true",
        cookie_samesite=_coerce_cookie_samesite(os.getenv("DAGMAR_COOKIE_SAMESITE", "lax")),
        cors_enabled=os.getenv("DAGMAR_CORS_ENABLED", "false").lower() == "true",
        cors_allow_origins=(
            [
                o.strip()
                for o in os.getenv("DAGMAR_CORS_ALLOW_ORIGINS", "https://dagmar.hcasc.cz").split(
                    ","
                )
                if o.strip()
            ]
        ),
        rate_limit_enabled=os.getenv("DAGMAR_RATE_LIMIT_ENABLED", "true").lower() == "true",
        rate_limit_default_per_minute=int(os.getenv("DAGMAR_RATE_LIMIT_DEFAULT_PER_MINUTE", "120")),
        rate_limit_admin_login_per_minute=int(
            os.getenv("DAGMAR_RATE_LIMIT_ADMIN_LOGIN_PER_MINUTE", "10")
        ),
        rate_limit_instance_status_per_minute=int(
            os.getenv("DAGMAR_RATE_LIMIT_INSTANCE_STATUS_PER_MINUTE", "60")
        ),
        rate_limit_instance_claim_per_minute=int(
            os.getenv("DAGMAR_RATE_LIMIT_INSTANCE_CLAIM_PER_MINUTE", "30")
        ),
        rate_limit_integration_health_per_minute=int(
            os.getenv("DAGMAR_RATE_LIMIT_INTEGRATION_HEALTH_PER_MINUTE", "60")
        ),
        rate_limit_integration_data_per_minute=int(
            os.getenv("DAGMAR_RATE_LIMIT_INTEGRATION_DATA_PER_MINUTE", "120")
        ),
        rate_limit_integration_openapi_per_minute=int(
            os.getenv("DAGMAR_RATE_LIMIT_INTEGRATION_OPENAPI_PER_MINUTE", "10")
        ),
        integration_token_length=int(os.getenv("DAGMAR_INTEGRATION_TOKEN_LENGTH", "48")),
        log_level=os.getenv("DAGMAR_LOG_LEVEL", "INFO"),
        disable_docs=os.getenv("DAGMAR_DISABLE_DOCS", "true").lower() == "true",
        integration_contract_version=os.getenv("DAGMAR_INTEGRATION_CONTRACT_VERSION", "2026-09-01"),
        external_auth_transaction_ttl_seconds=int(
            os.getenv("DAGMAR_EXTERNAL_AUTH_TRANSACTION_TTL_SECONDS", "600")
        ),
        external_auth_result_ttl_seconds=int(
            os.getenv("DAGMAR_EXTERNAL_AUTH_RESULT_TTL_SECONDS", "120")
        ),
        external_auth_http_timeout_seconds=float(
            os.getenv("DAGMAR_EXTERNAL_AUTH_HTTP_TIMEOUT_SECONDS", "10")
        ),
        external_auth_clock_skew_seconds=int(
            os.getenv("DAGMAR_EXTERNAL_AUTH_CLOCK_SKEW_SECONDS", "30")
        ),
        google_oidc_enabled=os.getenv("DAGMAR_GOOGLE_OIDC_ENABLED", "false").lower() == "true",
        google_oidc_client_id=os.getenv("DAGMAR_GOOGLE_OIDC_CLIENT_ID") or None,
        google_oidc_client_secret=os.getenv("DAGMAR_GOOGLE_OIDC_CLIENT_SECRET") or None,
        google_oidc_discovery_url=os.getenv(
            "DAGMAR_GOOGLE_OIDC_DISCOVERY_URL",
            "https://accounts.google.com/.well-known/openid-configuration",
        ),
        google_oidc_callback_url=os.getenv("DAGMAR_GOOGLE_OIDC_CALLBACK_URL") or None,
        apple_signin_enabled=os.getenv("DAGMAR_APPLE_SIGNIN_ENABLED", "false").lower() == "true",
        apple_services_id=os.getenv("DAGMAR_APPLE_SERVICES_ID") or None,
        apple_team_id=os.getenv("DAGMAR_APPLE_TEAM_ID") or None,
        apple_key_id=os.getenv("DAGMAR_APPLE_KEY_ID") or None,
        apple_private_key_path=os.getenv("DAGMAR_APPLE_PRIVATE_KEY_PATH") or None,
        apple_issuer=os.getenv("DAGMAR_APPLE_ISSUER", "https://appleid.apple.com"),
        apple_authorization_endpoint=os.getenv(
            "DAGMAR_APPLE_AUTHORIZATION_ENDPOINT", "https://appleid.apple.com/auth/authorize"
        ),
        apple_token_endpoint=os.getenv(
            "DAGMAR_APPLE_TOKEN_ENDPOINT", "https://appleid.apple.com/auth/token"
        ),
        apple_jwks_endpoint=os.getenv(
            "DAGMAR_APPLE_JWKS_ENDPOINT", "https://appleid.apple.com/auth/keys"
        ),
        apple_callback_url=os.getenv("DAGMAR_APPLE_CALLBACK_URL") or None,
        deploy_tag=os.getenv(
            "DAGMAR_DEPLOY_TAG",
            _format_deploy_tag(datetime.now(UTC)),
        ),
    )

    settings.ensure_canonical_domain()
    settings.validate_external_auth()
    return settings
