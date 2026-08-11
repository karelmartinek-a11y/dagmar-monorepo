from __future__ import annotations

import contextlib
import socket
import ssl
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NGINX_IMAGE = "nginx@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10"


def _free_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def _docker_args(tls: Path) -> list[str]:
    return [
        "-v",
        f"{ROOT / 'tests/fixtures/nginx/nginx.conf'}:/etc/nginx/nginx.conf:ro",
        "-v",
        f"{ROOT / 'ops/nginx/dagmar-location.conf'}:/etc/nginx/conf.d/dagmar-location.conf:ro",
        "-v",
        f"{ROOT / 'ops/nginx/dagmar-security-headers.conf'}:/etc/nginx/snippets/dagmar-security-headers.conf:ro",
        "-v",
        f"{ROOT / 'web'}:/var/www/dagmar/frontend:ro",
        "-v",
        f"{tls}:/etc/nginx/tls:ro",
    ]


def _generate_certificate(tls: Path) -> None:
    subprocess.run(
        [
            "openssl",
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-subj",
            "/CN=dagmar.hcasc.cz",
            "-keyout",
            str(tls / "key.pem"),
            "-out",
            str(tls / "cert.pem"),
            "-days",
            "1",
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def _response(url: str) -> urllib.response.addinfourl | urllib.error.HTTPError:
    context = ssl._create_unverified_context()  # noqa: S323 - local one-day fixture certificate
    try:
        return urllib.request.urlopen(url, context=context, timeout=3)
    except urllib.error.HTTPError as exc:
        return exc


def test_real_nginx_configuration_and_headers() -> None:
    with tempfile.TemporaryDirectory(prefix="dagmar-nginx-", dir=ROOT.parent) as temporary:
        _run_nginx_assertions(Path(temporary))


def _run_nginx_assertions(tls: Path) -> None:
    _generate_certificate(tls)
    mounts = _docker_args(tls)
    subprocess.run(
        ["docker", "run", "--rm", *mounts, NGINX_IMAGE, "nginx", "-T"], check=True
    )

    port = _free_port()
    name = f"dagmar-nginx-test-{uuid.uuid4().hex}"
    subprocess.run(
        [
            "docker",
            "run",
            "--detach",
            "--rm",
            "--name",
            name,
            "-p",
            f"127.0.0.1:{port}:8443",
            *mounts,
            NGINX_IMAGE,
        ],
        check=True,
        stdout=subprocess.DEVNULL,
    )
    try:
        for _ in range(30):
            with contextlib.suppress(OSError):
                if _response(f"https://127.0.0.1:{port}/").status == 200:
                    break
            time.sleep(0.1)
        else:
            raise AssertionError("Local Nginx did not become ready.")

        for path, expected_status in (
            ("/", 200),
            ("/api/v1/health", 502),
            ("/api/v1/auth/google/callback", 502),
        ):
            response = _response(f"https://127.0.0.1:{port}{path}")
            assert response.status == expected_status
            assert response.headers.get_all("Strict-Transport-Security") == ["max-age=31536000"]
            assert len(response.headers.get_all("Content-Security-Policy") or []) == 1
            assert response.headers.get_all("Cross-Origin-Opener-Policy") == [
                "same-origin-allow-popups"
            ]
            assert response.headers.get_all("Cross-Origin-Resource-Policy") == ["same-origin"]
    finally:
        subprocess.run(
            ["docker", "rm", "--force", name],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
