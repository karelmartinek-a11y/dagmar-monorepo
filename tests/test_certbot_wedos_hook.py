from __future__ import annotations

import importlib.util
import json
from datetime import datetime
from pathlib import Path
from types import ModuleType
from zoneinfo import ZoneInfo


def _hook() -> ModuleType:
    path = Path("ops/certbot/wedos_dns_hook.py")
    spec = importlib.util.spec_from_file_location("wedos_dns_hook", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_wapi_auth_uses_prague_hour() -> None:
    hook = _hook()
    now = datetime(2026, 8, 14, 23, 59, tzinfo=ZoneInfo("Europe/Prague"))
    assert hook._auth("user@example.test", "wapi-password", now) == (
        "8ea151f3134817839ce851cb18f6c91fd9f0817e"
    )


def test_auth_and_cleanup_manage_only_their_txt_row(monkeypatch, tmp_path: Path) -> None:
    hook = _hook()
    hook.ENV_FILE = tmp_path / "wedos.env"
    hook.STATE_FILE = tmp_path / "state.json"
    hook.LOCK_FILE = tmp_path / "hook.lock"
    hook.ENV_FILE.write_text(
        "WEDOS_WAPI_LOGIN=user@example.test\nWEDOS_WAPI_PASSWORD=secret\n",
        encoding="utf-8",
    )
    hook.ENV_FILE.chmod(0o600)
    monkeypatch.setenv("CERTBOT_DOMAIN", "*.dagmar.hcasc.cz")
    monkeypatch.setenv("CERTBOT_VALIDATION", "validation-token-1234567890")
    calls: list[tuple[str, dict[str, str] | None]] = []
    rows = [
        {},
        {
            "42": {"ID": "42", "name": "other", "rdtype": "TXT", "rdata": '"other"'},
            "99": {
                "ID": "99",
                "name": "_acme-challenge",
                "rdtype": "TXT",
                "rdata": '"validation-token-1234567890"',
            },
        },
        {
            "99": {
                "ID": "99",
                "name": "_acme-challenge",
                "rdtype": "TXT",
                "rdata": '"validation-token-1234567890"',
            }
        },
    ]

    def fake_wapi(_values, command, data=None):
        calls.append((command, data))
        if command == "dns-rows-list":
            return {"data": rows.pop(0)}
        return {"code": 1000}

    monkeypatch.setattr(hook, "_wapi", fake_wapi)
    monkeypatch.setattr(hook, "_wait_for_dns", lambda _token: None)
    hook.authenticate()
    state = json.loads(hook.STATE_FILE.read_text(encoding="utf-8"))
    assert state == {"validation-token-1234567890": "99"}
    assert [command for command, _ in calls] == ["dns-rows-list", "dns-row-add", "dns-domain-commit", "dns-rows-list"]

    hook.cleanup()
    assert [command for command, _ in calls][-3:] == ["dns-rows-list", "dns-row-delete", "dns-domain-commit"]
    assert json.loads(hook.STATE_FILE.read_text(encoding="utf-8")) == {}


def test_domain_scope_rejects_other_zones(monkeypatch) -> None:
    hook = _hook()
    monkeypatch.setenv("CERTBOT_DOMAIN", "example.invalid")
    monkeypatch.setenv("CERTBOT_VALIDATION", "validation-token-1234567890")
    try:
        hook.authenticate()
    except hook.HookError as exc:
        assert "outside" in str(exc)
    else:
        raise AssertionError("unexpectedly accepted a domain outside hcasc.cz")


def test_dns_propagation_retries_until_all_authorities_have_token(monkeypatch) -> None:
    hook = _hook()
    outputs = iter(["\"token\"\n", "", "\"token\"\n", "\"token\"\n", "\"token\"\n"] * 4)
    calls = []

    class Result:
        def __init__(self, stdout: str) -> None:
            self.stdout = stdout

    monkeypatch.setattr(hook.subprocess, "run", lambda *_args, **_kwargs: Result(next(outputs)))
    monkeypatch.setattr(hook.time, "sleep", lambda seconds: calls.append(seconds))
    hook._wait_for_dns("token")
    assert calls == [5]
