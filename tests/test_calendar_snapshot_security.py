from __future__ import annotations

from unittest.mock import patch

import pytest

from scripts.generate_calendar_snapshot import MAX_RESPONSE_BYTES, fetch, validate_fetch_url


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "ftp://unpkg.com/names.json",
        "https://127.0.0.1/names.json",
        "https://localhost/names.json",
        "https://user@unpkg.com/names.json",
        "https://unpkg.com:8443/names.json",
    ],
)
def test_calendar_fetch_rejects_unsafe_urls(url: str) -> None:
    with pytest.raises(ValueError, match="allowlisted HTTPS"):
        validate_fetch_url(url)


class _Response:
    def __init__(self, *, final_url: str, body: bytes) -> None:
        self.final_url = final_url
        self.body = body

    def __enter__(self) -> _Response:
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def geturl(self) -> str:
        return self.final_url

    def read(self, limit: int) -> bytes:
        return self.body[:limit]


def test_calendar_fetch_revalidates_redirect_target() -> None:
    response = _Response(final_url="https://127.0.0.1/private", body=b"secret")
    with patch("urllib.request.urlopen", return_value=response):
        with pytest.raises(ValueError, match="allowlisted HTTPS"):
            fetch("https://unpkg.com/namedays.json")


def test_calendar_fetch_rejects_oversized_body() -> None:
    response = _Response(
        final_url="https://unpkg.com/namedays.json",
        body=b"x" * (MAX_RESPONSE_BYTES + 1),
    )
    with patch("urllib.request.urlopen", return_value=response):
        with pytest.raises(ValueError, match="5 MiB"):
            fetch("https://unpkg.com/namedays.json")
