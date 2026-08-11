from __future__ import annotations

import pytest

from app.config import Settings, _coerce_cookie_samesite, _coerce_environment


def _settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "database_url": "sqlite+pysqlite:///:memory:",
        "session_secret": "x" * 32,
    }
    values.update(overrides)
    return Settings(**values)


@pytest.mark.parametrize(
    "value",
    [
        "http://dagmar.hcasc.cz",
        "https://evil-dagmar.hcasc.cz",
        "https://dagmar.hcasc.cz.evil.example",
        "https://dagmar.hcasc.cz:443",
        "https://user@dagmar.hcasc.cz",
        "https://dagmar.hcasc.cz/path",
        "https://dagmar.hcasc.cz?x=1",
        "https://dagmar.hcasc.cz#fragment",
    ],
)
def test_production_public_url_rejects_noncanonical_variants(value: str) -> None:
    with pytest.raises(ValueError):
        _settings(public_base_url=value).ensure_canonical_domain()


def test_production_public_url_normalizes_single_trailing_slash() -> None:
    settings = _settings(public_base_url="https://dagmar.hcasc.cz/")
    settings.ensure_canonical_domain()
    assert settings.public_base_url == "https://dagmar.hcasc.cz"


@pytest.mark.parametrize(
    "origins",
    [[], ["https://other.example"], ["https://dagmar.hcasc.cz", "https://other.example"]],
)
def test_production_cors_is_exact_even_when_disabled(origins: list[str]) -> None:
    settings = _settings(cors_enabled=False, cors_allow_origins=origins)
    with pytest.raises(ValueError, match="DAGMAR_CORS_ALLOW_ORIGINS"):
        settings.ensure_canonical_domain()


def test_staging_accepts_a_structurally_valid_distinct_domain() -> None:
    settings = _settings(
        environment="staging",
        public_base_url="https://staging.example.test/",
        cors_allow_origins=["https://staging.example.test"],
    )
    settings.ensure_canonical_domain()
    assert settings.public_base_url == "https://staging.example.test"


@pytest.mark.parametrize("value", ["", "prod", "PRODUCTION ", "invalid"])
def test_environment_rejects_invalid_or_ambiguous_values(value: str) -> None:
    with pytest.raises(ValueError, match="DAGMAR_ENV"):
        _coerce_environment(value)


def test_environment_case_policy_is_case_insensitive() -> None:
    assert _coerce_environment("PRODUCTION") == "production"


@pytest.mark.parametrize("value", ["", "none", "Lax ", "invalid"])
def test_cookie_samesite_rejects_invalid_values(value: str) -> None:
    with pytest.raises(ValueError, match="DAGMAR_COOKIE_SAMESITE"):
        _coerce_cookie_samesite(value)


def test_cookie_samesite_case_policy_is_case_insensitive() -> None:
    assert _coerce_cookie_samesite("STRICT") == "strict"
