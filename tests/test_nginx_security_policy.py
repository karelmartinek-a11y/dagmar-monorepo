from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCATION = (ROOT / "ops/nginx/dagmar-location.conf").read_text(encoding="utf-8")
HEADERS = (ROOT / "ops/nginx/dagmar-security-headers.conf").read_text(encoding="utf-8")


def test_security_headers_are_included_once_per_web_and_api_location() -> None:
    include = "include /etc/nginx/snippets/dagmar-security-headers.conf;"
    assert LOCATION.count(include) == 2
    prefix, remainder = LOCATION.split("location ^~ /api/", 1)
    api, web = remainder.split("location /", 1)
    assert include not in prefix
    assert api.count(include) == 1
    assert web.count(include) == 1


def test_hsts_is_one_year_without_parent_domain_assertions() -> None:
    assert 'Strict-Transport-Security "max-age=31536000"' in HEADERS
    assert "includeSubDomains" not in HEADERS
    assert "preload" not in HEADERS


def test_csp_is_enforced_and_does_not_allow_dynamic_scripts() -> None:
    expected = (
        "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; "
        "script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
        "font-src 'self' data:; connect-src 'self'; form-action 'self'; "
        "upgrade-insecure-requests"
    )
    assert f'add_header Content-Security-Policy "{expected}" always;' in HEADERS
    assert "Content-Security-Policy-Report-Only" not in HEADERS
    assert "'unsafe-eval'" not in HEADERS
    assert "script-src *" not in HEADERS
    assert "script-src http:" not in HEADERS
    assert "script-src data:" not in HEADERS


def test_permissions_and_cross_origin_headers_are_exact() -> None:
    assert (
        'add_header Permissions-Policy "geolocation=(), microphone=(), camera=(), '
        "payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=(), "
        'fullscreen=(self)" always;'
    ) in HEADERS
    assert 'add_header Cross-Origin-Opener-Policy "same-origin-allow-popups" always;' in HEADERS
    assert 'add_header Cross-Origin-Resource-Policy "same-origin" always;' in HEADERS
