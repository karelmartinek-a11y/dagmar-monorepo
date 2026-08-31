#!/usr/bin/env python3
"""Certbot DNS-01 hooks for the WEDOS DNS API.

The hook deliberately uses only the ``hcasc.cz`` zone.  It creates one TXT
row per challenge and removes only the row recorded for that challenge.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from contextlib import contextmanager
from datetime import datetime
from fcntl import LOCK_EX, LOCK_UN, flock
from pathlib import Path
from zoneinfo import ZoneInfo

API_URL = "https://api.wedos.com/wapi/json"
ZONE = "hcasc.cz"
TXT_NAME = "_acme-challenge"
DNS_SERVERS = ("ns.wedos.cz", "ns.wedos.com", "ns.wedos.eu", "ns.wedos.net")
ENV_FILE = Path("/etc/letsencrypt/wedos-wapi.env")
STATE_FILE = Path("/var/lib/letsencrypt/wedos-dns/state.json")
LOCK_FILE = Path("/run/lock/dagmar-wedos-dns.lock")
TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{20,512}$")


class HookError(RuntimeError):
    """A safe, user-facing hook failure."""


def _load_env(path: Path | None = None) -> dict[str, str]:
    path = path or ENV_FILE
    if not path.is_file():
        raise HookError(f"WEDOS credential file is missing: {path}")
    if path.stat().st_mode & 0o077:
        raise HookError(f"WEDOS credential file is not root-only: {path}")
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or not re.fullmatch(r"[A-Z][A-Z0-9_]*", key):
            raise HookError("invalid WEDOS credential configuration")
        values[key] = value.strip().strip('"').strip("'")
    login = values.get("WEDOS_WAPI_LOGIN", "")
    password = values.get("WEDOS_WAPI_PASSWORD", "")
    if not login or not password:
        raise HookError("WEDOS WAPI credentials are incomplete")
    values.setdefault("WEDOS_WAPI_URL", API_URL)
    if values["WEDOS_WAPI_URL"] != API_URL:
        raise HookError("WEDOS WAPI URL is not the canonical HTTPS endpoint")
    if values.get("WEDOS_WAPI_ZONE", ZONE) != ZONE:
        raise HookError("WEDOS WAPI zone is not the canonical zone")
    return values


def _auth(login: str, password: str, now: datetime | None = None) -> str:
    current = now or datetime.now(ZoneInfo("Europe/Prague"))
    password_hash = hashlib.sha1(password.encode("utf-8")).hexdigest()  # nosec B324 - required by WEDOS WAPI
    return hashlib.sha1(  # nosec B324 - required by WEDOS WAPI
        f"{login}{password_hash}{current:%H}".encode()
    ).hexdigest()


def _wapi(values: dict[str, str], command: str, data: dict[str, str] | None = None) -> dict:
    login = values["WEDOS_WAPI_LOGIN"]
    request = {
        "request": {
            "user": login,
            "auth": _auth(login, values["WEDOS_WAPI_PASSWORD"]),
            "command": command,
            "clTRID": f"dagmar-certbot-{int(time.time())}",
        }
    }
    if data:
        request["request"]["data"] = data
    payload = urllib.parse.urlencode({"request": json.dumps(request)}).encode("utf-8")
    request_obj = urllib.request.Request(
        values.get("WEDOS_WAPI_URL", API_URL),
        data=payload,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request_obj, timeout=60) as response:  # nosec B310 - URL is allowlisted above
            result = json.load(response)
    except Exception as exc:  # noqa: BLE001 - external API boundary
        raise HookError(f"WEDOS API request failed: {command}") from exc
    response = result.get("response")
    if not isinstance(response, dict):
        raise HookError(f"WEDOS API returned an invalid response: {command}")
    try:
        code = int(response.get("code"))
    except (TypeError, ValueError) as exc:
        raise HookError(f"WEDOS API returned an invalid status: {command}") from exc
    if code not in {1000, 1001}:
        raise HookError(f"WEDOS API rejected command {command} with code {code}")
    return response


def _rows(values: dict[str, str]) -> dict[str, dict[str, str]]:
    response = _wapi(values, "dns-rows-list", {"domain": ZONE})
    data = response.get("data", {})
    if not isinstance(data, dict):
        raise HookError("WEDOS DNS row response is invalid")
    rows: dict[str, dict[str, str]] = {}
    for row in data.values():
        if isinstance(row, dict) and row.get("ID"):
            rows[str(row["ID"])] = {str(k): str(v) for k, v in row.items()}
    return rows


def _commit(values: dict[str, str]) -> None:
    _wapi(values, "dns-domain-commit", {"domain": ZONE})


def _validate_domain(domain: str) -> None:
    normalized = domain.removeprefix("*.").rstrip(".").lower()
    if normalized != ZONE and not normalized.endswith(f".{ZONE}"):
        raise HookError("certificate domain is outside the canonical DNS zone")


def _token() -> str:
    token = os.environ.get("CERTBOT_VALIDATION", "")
    if not TOKEN_RE.fullmatch(token):
        raise HookError("CERTBOT_VALIDATION is missing or malformed")
    return token


def _read_state() -> dict[str, str]:
    if not STATE_FILE.exists():
        return {}
    try:
        state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HookError("WEDOS challenge state is unreadable") from exc
    if not isinstance(state, dict):
        raise HookError("WEDOS challenge state is invalid")
    return {str(k): str(v) for k, v in state.items()}


def _write_state(state: dict[str, str]) -> None:
    STATE_FILE.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = STATE_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, sort_keys=True), encoding="utf-8")
    temporary.chmod(0o600)
    os.replace(temporary, STATE_FILE)


@contextmanager
def _locked():
    LOCK_FILE.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    with LOCK_FILE.open("a+") as handle:
        flock(handle, LOCK_EX)
        try:
            yield
        finally:
            flock(handle, LOCK_UN)


def _wait_for_dns(token: str) -> None:
    query = f"{TXT_NAME}.{ZONE}"
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        try:
            propagated = all(
                token
                in subprocess.run(
                    ["/usr/bin/dig", "+short", "TXT", query, f"@{server}"],
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=10,
                ).stdout
                for server in DNS_SERVERS
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise HookError("unable to query authoritative WEDOS DNS") from exc
        if propagated:
            return
        time.sleep(5)
    raise HookError("WEDOS TXT challenge did not propagate before timeout")


def authenticate() -> None:
    domain = os.environ.get("CERTBOT_DOMAIN", "")
    _validate_domain(domain)
    token = _token()
    values = _load_env()
    with _locked():
        state = _read_state()
        rows_before = _rows(values)
        quoted = json.dumps(token)
        existing = next(
            (row_id for row_id, row in rows_before.items() if row.get("name") == TXT_NAME and row.get("rdtype") == "TXT" and row.get("rdata") == quoted),
            None,
        )
        row_id = existing
        if row_id is None:
            _wapi(values, "dns-row-add", {"domain": ZONE, "name": TXT_NAME, "ttl": "60", "type": "TXT", "rdata": quoted})
            _commit(values)
            rows_after = _rows(values)
            created = [
                candidate
                for candidate, row in rows_after.items()
                if candidate not in rows_before and row.get("name") == TXT_NAME and row.get("rdtype") == "TXT" and row.get("rdata") == quoted
            ]
            if len(created) != 1:
                raise HookError("unable to identify the WEDOS TXT row created for the challenge")
            row_id = created[0]
        state[token] = row_id
        _write_state(state)
    _wait_for_dns(token)


def cleanup() -> None:
    token = _token()
    values = _load_env()
    with _locked():
        state = _read_state()
        row_id = state.get(token)
        rows = _rows(values) if row_id else {}
        if row_id and row_id in rows:
            _wapi(values, "dns-row-delete", {"domain": ZONE, "row_id": row_id})
            _commit(values)
        if row_id:
            state.pop(token, None)
            _write_state(state)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("auth", "cleanup"))
    args = parser.parse_args(argv)
    try:
        authenticate() if args.action == "auth" else cleanup()
    except HookError as exc:
        print(f"dagmar-wedos-dns: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
