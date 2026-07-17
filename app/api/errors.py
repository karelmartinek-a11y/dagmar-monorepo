from __future__ import annotations

from typing import Any, NoReturn

from fastapi import HTTPException


def api_error_detail(code: str, message: str, **params: Any) -> dict[str, Any]:
    detail: dict[str, Any] = {"code": code, "message": message}
    if params:
        detail["params"] = params
    return detail


def raise_api_error(status_code: int, code: str, message: str, **params: Any) -> NoReturn:
    raise HTTPException(status_code=status_code, detail=api_error_detail(code, message, **params))
