from __future__ import annotations

from typing import Any, NoReturn

from fastapi import HTTPException


class EnvelopedAPIError(HTTPException):
    """HTTP error already using the target non-integration API contract."""


def api_error_detail(code: str, message: str, **params: Any) -> dict[str, Any]:
    detail: dict[str, Any] = {"code": code, "message": message}
    if params:
        detail["params"] = params
    return detail


def raise_api_error(status_code: int, code: str, message: str, **params: Any) -> NoReturn:
    raise EnvelopedAPIError(
        status_code=status_code, detail=api_error_detail(code, message, **params)
    )


def raise_enveloped_api_error(
    status_code: int,
    code: str,
    message: str,
    **details: Any,
) -> NoReturn:
    payload: dict[str, Any] = {"code": code, "message": message}
    if details:
        payload["details"] = details
    raise EnvelopedAPIError(status_code=status_code, detail=payload)
