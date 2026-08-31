from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_wedos_hook_has_no_static_credentials_or_broad_network_fallback() -> None:
    source = (ROOT / "ops/certbot/wedos_dns_hook.py").read_text(encoding="utf-8")
    assert "WEDOS_WAPI_PASSWORD" in source
    assert "api.wedos.com/wapi/json" in source
    assert "replace-with-a-dedicated-wapi-password" not in source
    assert "requests" not in source


def test_systemd_timer_is_independent_from_vendor_certbot_timer() -> None:
    timer = (ROOT / "ops/systemd/dagmar-certbot-renew.timer").read_text(encoding="utf-8")
    service = (ROOT / "ops/systemd/dagmar-certbot-renew.service").read_text(encoding="utf-8")
    assert "Unit=dagmar-certbot-renew.service" in timer
    assert "certbot renew --non-interactive --quiet" in service
    assert "network-online.target" in service
