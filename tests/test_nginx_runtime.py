from __future__ import annotations

import contextlib
import shutil
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


def _copy_nginx_fixtures(name: str, tls: Path) -> None:
    # Copy fixtures through Docker's API so external-disk checkouts work in VM runtimes.
    rootfs = tls / "rootfs"
    files = {
        ROOT / "tests/fixtures/nginx/nginx.conf": "etc/nginx/nginx.conf",
        ROOT / "ops/nginx/dagmar-location.conf": "etc/nginx/conf.d/dagmar-location.conf",
        ROOT
        / "ops/nginx/dagmar-security-headers.conf": "etc/nginx/snippets/dagmar-security-headers.conf",
        ROOT / "web/index.html": "var/www/dagmar/frontend/index.html",
        tls / "key.pem": "etc/nginx/tls/key.pem",
        tls / "cert.pem": "etc/nginx/tls/cert.pem",
    }
    for source, target in files.items():
        destination = rootfs / target
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
    subprocess.run(["docker", "cp", f"{rootfs}/.", f"{name}:/"], check=True)


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

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(
            self,
            req: urllib.request.Request,
            fp: object,
            code: int,
            msg: str,
            headers: object,
            newurl: str,
        ) -> None:
            return None

    opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(context=context))
    try:
        return opener.open(url, timeout=3)
    except urllib.error.HTTPError as exc:
        return exc


def test_real_nginx_configuration_and_headers() -> None:
    with tempfile.TemporaryDirectory(prefix="dagmar-nginx-") as temporary:
        _run_nginx_assertions(Path(temporary))


def _run_nginx_assertions(tls: Path) -> None:
    _generate_certificate(tls)

    port = _free_port()
    name = f"dagmar-nginx-test-{uuid.uuid4().hex}"
    subprocess.run(
        [
            "docker",
            "create",
            "--name",
            name,
            "-p",
            f"127.0.0.1:{port}:8443",
            NGINX_IMAGE,
        ],
        check=True,
        stdout=subprocess.DEVNULL,
    )
    try:
        _copy_nginx_fixtures(name, tls)
        subprocess.run(["docker", "start", name], check=True, stdout=subprocess.DEVNULL)
        subprocess.run(["docker", "exec", name, "nginx", "-T"], check=True)
        for _ in range(30):
            with contextlib.suppress(OSError):
                if _response(f"https://127.0.0.1:{port}/").status == 302:
                    break
            time.sleep(0.1)
        else:
            raise AssertionError("Local Nginx did not become ready.")

        for path, expected_status in (
            ("/", 302),
            ("/login", 302),
            ("/reset?token=synthetic-legacy-token", 302),
            ("/assets/old.js", 302),
            ("/index.html", 302),
            ("/api/v1/health", 502),
            ("/cml-web/identity", 502),
            ("/cml-web/api/profiles/00000000-0000-4000-8000-000000000001", 502),
            ("/api/v1/auth/google/callback", 502),
        ):
            response = _response(f"https://127.0.0.1:{port}{path}")
            assert response.status == expected_status
            if expected_status == 302:
                assert response.headers.get_all("Location") == [
                    "https://kajovocml.hcasc.cz/#dochazka"
                ]
                assert response.headers.get_all("Cache-Control") == ["no-store"]
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
