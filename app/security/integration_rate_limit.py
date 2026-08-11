from __future__ import annotations

import time
from collections import deque

from fastapi import Depends, Request

from app.api.integration_common import IntegrationError
from app.config import Settings, get_settings

_WINDOW_SECONDS = 60
_buckets: dict[str, deque[float]] = {}


def _cleanup(bucket: deque[float], now: float) -> None:
    while bucket and now - bucket[0] >= _WINDOW_SECONDS:
        bucket.popleft()


def enforce_rate_limit(request: Request, *, namespace: str, limit_per_minute: int) -> None:
    if limit_per_minute <= 0:
        return
    client_key = getattr(request.state, "integration_rate_key", None)
    if not isinstance(client_key, str) or not client_key:
        source_ip = request.headers.get("x-real-ip") or (
            request.client.host if request.client else "unknown"
        )
        client_key = f"ip:{source_ip}"
    bucket_key = f"{namespace}:{client_key}"
    bucket = _buckets.setdefault(bucket_key, deque())
    now = time.monotonic()
    _cleanup(bucket, now)
    if len(bucket) >= limit_per_minute:
        raise IntegrationError(429, "rate_limited", "Byl překročen limit požadavků.")
    bucket.append(now)


def _enforce_configured_limit(
    request: Request,
    *,
    settings: Settings,
    namespace: str,
    limit_per_minute: int,
) -> None:
    if not settings.rate_limit_enabled:
        return
    enforce_rate_limit(request, namespace=namespace, limit_per_minute=limit_per_minute)


def integration_health_rate_limit(
    request: Request,
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> None:
    _enforce_configured_limit(
        request,
        settings=settings,
        namespace="integration-health",
        limit_per_minute=settings.rate_limit_integration_health_per_minute,
    )


def integration_data_rate_limit(
    request: Request,
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> None:
    _enforce_configured_limit(
        request,
        settings=settings,
        namespace="integration-data",
        limit_per_minute=settings.rate_limit_integration_data_per_minute,
    )


def integration_openapi_rate_limit(
    request: Request,
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> None:
    _enforce_configured_limit(
        request,
        settings=settings,
        namespace="integration-openapi",
        limit_per_minute=settings.rate_limit_integration_openapi_per_minute,
    )


def reset_integration_rate_limits() -> None:
    _buckets.clear()
