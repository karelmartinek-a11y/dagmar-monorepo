#!/usr/bin/env python3
"""Make every certificate actively referenced by Nginx renewable via WEDOS DNS-01."""

from __future__ import annotations

import argparse
import re
import shutil
import ssl
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

HOOK = "/usr/local/libexec/dagmar-wedos-dns-hook.py"
DEPLOY_HOOK = "/usr/local/libexec/dagmar-certbot-deploy-hook"
RENEWAL_DIR = Path("/etc/letsencrypt/renewal")
LIVE_ROOT = Path("/etc/letsencrypt/live")
ARCHIVE_ROOT = Path("/etc/letsencrypt/renewal-archive")
CERT_RE = re.compile(r"^\s*ssl_certificate\s+(?P<path>/etc/letsencrypt/live/[^;]+/fullchain\.pem);", re.MULTILINE)


def _run(command: list[str], *, dry_run: bool) -> None:
    print(f"certbot-configure: {' '.join(command[:3])} ...")
    if not dry_run:
        subprocess.run(command, check=True)


def _nginx_certificates() -> list[Path]:
    result = subprocess.run(["nginx", "-T"], check=True, capture_output=True, text=True)
    output = f"{result.stdout}\n{result.stderr}"
    paths = {Path(match.group("path")) for match in CERT_RE.finditer(output)}
    return sorted(path for path in paths if path.is_file())


def _renewal_certificates() -> list[Path]:
    paths: set[Path] = set()
    for config in sorted(RENEWAL_DIR.glob("*.conf")):
        for raw in config.read_text(encoding="utf-8").splitlines():
            key, separator, value = raw.partition("=")
            if separator and key.strip() == "fullchain":
                candidate = Path(value.strip())
                if candidate.is_file():
                    paths.add(candidate)
    return sorted(paths)


def _domains(cert_path: Path) -> list[str]:
    decoded = ssl._ssl._test_decode_cert(str(cert_path))  # noqa: SLF001 - stdlib certificate reader
    names = [value for kind, value in decoded.get("subjectAltName", ()) if kind == "DNS"]
    if not names:
        names = [value for row in decoded["subject"] for key, value in row if key == "commonName"]
    domains = sorted({name.rstrip(".").lower() for name in names})
    if not domains or any(
        (name.removeprefix("*.") != "hcasc.cz" and not name.removeprefix("*.").endswith(".hcasc.cz"))
        for name in domains
    ):
        raise RuntimeError(f"certificate contains a domain outside hcasc.cz: {cert_path}")
    return domains


def _cert_name(cert_path: Path) -> str:
    return cert_path.parent.name


def _renewal_config(cert_name: str) -> Path:
    return RENEWAL_DIR / f"{cert_name}.conf"


def _configure(cert_name: str, domains: list[str], *, dry_run: bool) -> None:
    config = _renewal_config(cert_name)
    configured_fullchain = None
    if config.exists():
        for raw in config.read_text(encoding="utf-8").splitlines():
            key, separator, value = raw.partition("=")
            if separator and key.strip() == "fullchain":
                configured_fullchain = Path(value.strip())
                break
    reusable_config = bool(configured_fullchain and configured_fullchain.is_symlink())
    if reusable_config:
        command = [
            "certbot",
            "reconfigure",
            "--non-interactive",
            "--cert-name",
            cert_name,
            "--authenticator",
            "manual",
            "--manual-auth-hook",
            f"{HOOK} auth",
            "--manual-cleanup-hook",
            f"{HOOK} cleanup",
            "--manual-public-ip-logging-ok",
            "--preferred-challenges",
            "dns-01",
            "--deploy-hook",
            DEPLOY_HOOK,
        ]
    else:
        command = [
            "certbot",
            "certonly",
            "--non-interactive",
            "--agree-tos",
            "--register-unsafely-without-email",
            "--cert-name",
            cert_name,
            "--authenticator",
            "manual",
            "--manual-auth-hook",
            f"{HOOK} auth",
            "--manual-cleanup-hook",
            f"{HOOK} cleanup",
            "--manual-public-ip-logging-ok",
            "--preferred-challenges",
            "dns-01",
            "--deploy-hook",
            DEPLOY_HOOK,
        ]
        for domain in domains:
            command.extend(["-d", domain])
    _run(command, dry_run=dry_run)


def _archive_unreferenced_broken_configs(referenced: set[Path], *, dry_run: bool) -> None:
    for config in sorted(RENEWAL_DIR.glob("*.conf")):
        values = {}
        for raw in config.read_text(encoding="utf-8").splitlines():
            key, separator, value = raw.partition("=")
            if separator:
                values[key.strip()] = value.strip()
        cert_path = Path(values.get("fullchain", ""))
        if cert_path in referenced:
            continue
        lineage = cert_path.parent if cert_path else Path()
        if not cert_path or not lineage.is_dir() or cert_path.is_symlink():
            continue
        destination = ARCHIVE_ROOT / datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        destination.mkdir(mode=0o700, parents=True, exist_ok=True)
        target = destination / config.name
        print(f"certbot-configure: archive inactive broken config {config}")
        if not dry_run:
            shutil.move(str(config), target)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    try:
        if not args.dry_run:
            if not Path("/etc/letsencrypt/wedos-wapi.env").is_file():
                raise RuntimeError("/etc/letsencrypt/wedos-wapi.env is missing")
            if Path("/usr/local/libexec/dagmar-wedos-dns-hook.py").stat().st_mode & 0o077:
                raise RuntimeError("WEDOS hook permissions are not root-only")
        certificates = sorted(set(_nginx_certificates()) | set(_renewal_certificates()))
        referenced = set(_nginx_certificates())
        for cert_path in certificates:
            _configure(_cert_name(cert_path), _domains(cert_path), dry_run=args.dry_run)
        _archive_unreferenced_broken_configs(referenced, dry_run=args.dry_run)
    except (OSError, subprocess.CalledProcessError, RuntimeError, ssl.SSLError) as exc:
        print(f"certbot-configure: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
