from __future__ import annotations

import base64
import hashlib
import secrets
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from threading import Lock
from typing import Any, Literal
from urllib.parse import urlencode

import httpx
import jwt
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import Settings
from app.db.models import OAuthTransaction

Provider = Literal["google", "apple"]
Portal = Literal["employee", "admin"]
Purpose = Literal["login", "link"]

ALLOWED_RETURN_PATHS: dict[tuple[Portal, Purpose], set[str]] = {
    ("employee", "login"): {"/app"},
    ("employee", "link"): {"/app"},
    ("admin", "login"): {"/admin/prehled", "/admin/ucet"},
    ("admin", "link"): {"/admin/ucet"},
}


class ExternalAuthError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class ProviderClaims:
    issuer: str
    subject: str
    email: str | None
    email_verified: bool | None


@dataclass(frozen=True)
class StartedTransaction:
    transaction: OAuthTransaction
    state: str
    browser_secret: str
    authorization_url: str


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def utc_aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def safe_return_path(portal: Portal, purpose: Purpose, candidate: str | None) -> str:
    default = "/app" if portal == "employee" else ("/admin/ucet" if purpose == "link" else "/admin/prehled")
    if candidate in ALLOWED_RETURN_PATHS[(portal, purpose)]:
        return str(candidate)
    return default


def provider_enabled(settings: Settings, provider: Provider) -> bool:
    return settings.google_oidc_enabled if provider == "google" else settings.apple_signin_enabled


def _pkce_challenge(verifier: str) -> str:
    return _b64url(hashlib.sha256(verifier.encode("ascii")).digest())


_metadata_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_jwks_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_cache_lock = Lock()


def _cache_ttl(response: httpx.Response, default: int = 3600) -> int:
    for part in response.headers.get("cache-control", "").split(","):
        key, _, value = part.strip().partition("=")
        if key.lower() == "max-age" and value.isdigit():
            return max(60, min(int(value), 86400))
    return default


def _get_json(url: str, settings: Settings, cache: dict[str, tuple[float, dict[str, Any]]], *, refresh: bool = False) -> dict[str, Any]:
    now = time.monotonic()
    with _cache_lock:
        cached = cache.get(url)
        if not refresh and cached and cached[0] > now:
            return cached[1]
    try:
        with httpx.Client(timeout=settings.external_auth_http_timeout_seconds, follow_redirects=False) as client:
            response = client.get(url, headers={"Accept": "application/json"})
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise ExternalAuthError("provider_unavailable") from exc
    if not isinstance(payload, dict):
        raise ExternalAuthError("provider_invalid_response")
    with _cache_lock:
        cache[url] = (now + _cache_ttl(response), payload)
    return payload


def google_metadata(settings: Settings) -> dict[str, Any]:
    return _get_json(settings.google_oidc_discovery_url, settings, _metadata_cache)


def authorization_url(provider: Provider, state: str, nonce: str, verifier: str | None, settings: Settings) -> str:
    if provider == "google":
        metadata = google_metadata(settings)
        endpoint = str(metadata.get("authorization_endpoint") or "")
        if not endpoint.startswith("https://"):
            raise ExternalAuthError("provider_invalid_configuration")
        params = {
            "client_id": str(settings.google_oidc_client_id),
            "redirect_uri": settings.external_callback_url("google"),
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "nonce": nonce,
            "code_challenge": _pkce_challenge(str(verifier)),
            "code_challenge_method": "S256",
        }
    else:
        endpoint = settings.apple_authorization_endpoint
        params = {
            "client_id": str(settings.apple_services_id),
            "redirect_uri": settings.external_callback_url("apple"),
            "response_type": "code",
            "response_mode": "form_post",
            "scope": "name email",
            "state": state,
            "nonce": nonce,
        }
    return f"{endpoint}?{urlencode(params)}"


def start_transaction(
    db: Session,
    *,
    provider: Provider,
    purpose: Purpose,
    portal: Portal,
    return_path: str | None,
    browser_secret: str | None,
    settings: Settings,
    portal_user_id: int | None = None,
    admin_username: str | None = None,
) -> StartedTransaction:
    if not provider_enabled(settings, provider):
        raise ExternalAuthError("provider_disabled")
    now = datetime.now(UTC)
    db.execute(delete(OAuthTransaction).where(OAuthTransaction.expires_at < now - timedelta(hours=1)))
    state = secrets.token_urlsafe(32)
    browser_secret = browser_secret if browser_secret and len(browser_secret) >= 32 else secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64) if provider == "google" else None
    transaction = OAuthTransaction(
        id=secrets.token_urlsafe(32),
        state_hash=_sha256(state),
        browser_hash=_sha256(browser_secret),
        provider=provider,
        purpose=purpose,
        portal=portal,
        return_path=safe_return_path(portal, purpose, return_path),
        portal_user_id=portal_user_id,
        admin_username=admin_username,
        nonce=nonce,
        code_verifier=verifier,
        expires_at=now + timedelta(seconds=settings.external_auth_transaction_ttl_seconds),
    )
    db.add(transaction)
    db.commit()
    return StartedTransaction(
        transaction=transaction,
        state=state,
        browser_secret=browser_secret,
        authorization_url=authorization_url(provider, state, nonce, verifier, settings),
    )


def consume_transaction(db: Session, *, provider: Provider, state: str, browser_secret: str | None) -> OAuthTransaction:
    now = datetime.now(UTC)
    transaction = db.execute(
        select(OAuthTransaction)
        .where(OAuthTransaction.state_hash == _sha256(state), OAuthTransaction.provider == provider)
        .with_for_update()
    ).scalar_one_or_none()
    if transaction is None:
        raise ExternalAuthError("invalid_state")
    if transaction.consumed_at is not None:
        raise ExternalAuthError("callback_replayed")
    if utc_aware(transaction.expires_at) <= now:
        transaction.consumed_at = now
        db.commit()
        raise ExternalAuthError("transaction_expired")
    if not browser_secret or not secrets.compare_digest(transaction.browser_hash, _sha256(browser_secret)):
        raise ExternalAuthError("browser_binding_failed")
    transaction.consumed_at = now
    db.add(transaction)
    db.commit()
    db.refresh(transaction)
    return transaction


def _apple_client_secret(settings: Settings) -> str:
    now = int(time.time())
    try:
        with open(str(settings.apple_private_key_path), encoding="utf-8") as key_file:
            private_key = key_file.read()
        return str(jwt.encode(
            {"iss": settings.apple_team_id, "iat": now, "exp": now + 300, "aud": "https://appleid.apple.com", "sub": settings.apple_services_id},
            private_key,
            algorithm="ES256",
            headers={"kid": settings.apple_key_id},
        ))
    except (OSError, ValueError, jwt.PyJWTError) as exc:
        raise ExternalAuthError("provider_invalid_configuration") from exc


def _token_request(provider: Provider, code: str, transaction: OAuthTransaction, settings: Settings) -> tuple[str, str, str]:
    if provider == "google":
        metadata = google_metadata(settings)
        endpoint = str(metadata.get("token_endpoint") or "")
        jwks_uri = str(metadata.get("jwks_uri") or "")
        issuer = str(metadata.get("issuer") or "")
        client_id = str(settings.google_oidc_client_id)
        data = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": settings.external_callback_url("google"),
            "client_id": client_id,
            "client_secret": str(settings.google_oidc_client_secret),
            "code_verifier": str(transaction.code_verifier),
        }
    else:
        endpoint = settings.apple_token_endpoint
        jwks_uri = settings.apple_jwks_endpoint
        issuer = settings.apple_issuer
        client_id = str(settings.apple_services_id)
        data = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": settings.external_callback_url("apple"),
            "client_id": client_id,
            "client_secret": _apple_client_secret(settings),
        }
    if not endpoint.startswith("https://") or not jwks_uri.startswith("https://"):
        raise ExternalAuthError("provider_invalid_configuration")
    try:
        with httpx.Client(timeout=settings.external_auth_http_timeout_seconds, follow_redirects=False) as client:
            response = client.post(endpoint, data=data, headers={"Accept": "application/json"})
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise ExternalAuthError("provider_unavailable") from exc
    token = payload.get("id_token") if isinstance(payload, dict) else None
    if not isinstance(token, str) or not token:
        raise ExternalAuthError("provider_invalid_response")
    return token, jwks_uri, issuer


def _signing_key(id_token: str, jwks_uri: str, settings: Settings) -> Any:
    try:
        header = jwt.get_unverified_header(id_token)
        if header.get("alg") != "RS256" or not isinstance(header.get("kid"), str):
            raise ExternalAuthError("token_signature_invalid")
    except jwt.PyJWTError as exc:
        raise ExternalAuthError("token_signature_invalid") from exc
    for refresh in (False, True):
        jwks = _get_json(jwks_uri, settings, _jwks_cache, refresh=refresh)
        for item in jwks.get("keys", []):
            if isinstance(item, dict) and item.get("kid") == header["kid"]:
                try:
                    return jwt.PyJWK.from_dict(item).key
                except (jwt.PyJWTError, ValueError) as exc:
                    raise ExternalAuthError("token_signature_invalid") from exc
    raise ExternalAuthError("token_signature_invalid")


def exchange_and_validate(provider: Provider, code: str, transaction: OAuthTransaction, settings: Settings) -> ProviderClaims:
    id_token, jwks_uri, issuer = _token_request(provider, code, transaction, settings)
    client_id = str(settings.google_oidc_client_id if provider == "google" else settings.apple_services_id)
    key = _signing_key(id_token, jwks_uri, settings)
    accepted_issuers: str | list[str] = issuer
    if provider == "google" and issuer == "https://accounts.google.com":
        accepted_issuers = [issuer, "accounts.google.com"]
    try:
        claims = jwt.decode(
            id_token,
            key,
            algorithms=["RS256"],
            audience=client_id,
            issuer=accepted_issuers,
            leeway=settings.external_auth_clock_skew_seconds,
            options={"require": ["iss", "sub", "aud", "exp", "iat", "nonce"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise ExternalAuthError("token_expired") from exc
    except jwt.PyJWTError as exc:
        raise ExternalAuthError("token_validation_failed") from exc
    if not secrets.compare_digest(str(claims.get("nonce") or ""), transaction.nonce):
        raise ExternalAuthError("nonce_invalid")
    azp = claims.get("azp")
    if azp is not None and azp != client_id:
        raise ExternalAuthError("token_validation_failed")
    subject = claims.get("sub")
    if not isinstance(subject, str) or not subject:
        raise ExternalAuthError("token_validation_failed")
    email = claims.get("email") if isinstance(claims.get("email"), str) else None
    verified_raw = claims.get("email_verified")
    verified = verified_raw if isinstance(verified_raw, bool) else (verified_raw.lower() == "true" if isinstance(verified_raw, str) else None)
    return ProviderClaims(issuer=str(claims["iss"]), subject=subject, email=email, email_verified=verified)
