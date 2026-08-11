from __future__ import annotations

import hmac
import secrets
from collections.abc import MutableMapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fastapi import Header, Request, Response

from app.api.errors import EnvelopedAPIError, raise_enveloped_api_error
from app.config import Settings


@dataclass(frozen=True)
class CsrfConfig:
    """Minimal CSRF helper.

    We do not rely on third-party services.

    Design:
      - Issue a random CSRF token and store it in the signed middleware session.
      - Require the token on state-changing admin or portal-cookie requests.
      - Accept token via:
          * header: X-CSRF-Token
          * form field: csrf_token

    Cookie policy:
      - Authentication cookies are HttpOnly+Secure+SameSite and not readable by JS.
      - CSRF token is not a cookie; the admin or portal CSRF bootstrap endpoint
        returns it and the frontend echoes it in X-CSRF-Token.
    """

    header_name: str = "X-CSRF-Token"
    form_field_name: str = "csrf_token"
    rotate_minutes: int = 120


class CsrfError(EnvelopedAPIError):
    def __init__(self, detail: str = "CSRF validation failed"):
        super().__init__(
            status_code=403,
            detail={"code": "csrf_invalid", "message": detail},
        )


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _constant_time_eq(a: str, b: str) -> bool:
    # hmac.compare_digest is constant-time for equal-length strings.
    try:
        return hmac.compare_digest(a, b)
    except TypeError:
        return False


def _get_request_session(request: Request) -> MutableMapping[str, object] | None:
    session_obj = getattr(request, "session", None)
    if isinstance(session_obj, MutableMapping):
        return session_obj
    state = getattr(request, "state", None)
    if state is not None:
        state_session = getattr(state, "session", None)
        if isinstance(state_session, MutableMapping):
            return state_session
    return None


def issue_csrf_token(session: MutableMapping[str, object], cfg: CsrfConfig | None = None) -> str:
    """Issue a CSRF token and store it in the session.

    Session is a mutable dict maintained by the admin session middleware.
    """

    cfg = cfg or CsrfConfig()
    token = secrets.token_urlsafe(32)
    session["csrf_token"] = token
    session["csrf_issued_at"] = _utcnow().isoformat()
    return token


def csrf_issue_token(
    request: Request | None = None,
    response: Response | None = None,
    settings: Settings | None = None,
    cfg: CsrfConfig | None = None,
) -> str:
    """Issue or reuse the synchronizer token for admin and portal bootstrap routes.

    - Stores/rotates token in the Starlette session if available.
    - Returns the token and optionally mirrors it in response headers for SPA use.
    """

    cfg = cfg or CsrfConfig()

    session_store: MutableMapping[str, object] | None = None
    if request is not None:
        session_store = _get_request_session(request)

    session: MutableMapping[str, object] = session_store if session_store is not None else {}

    token = get_or_rotate_csrf_token(session, cfg)

    # Persist into session for middleware-managed storage.
    if session_store is not None:
        session_store.update(session)

    if response is not None:
        response.headers[cfg.header_name] = token

    return token


def get_or_rotate_csrf_token(
    session: MutableMapping[str, object], cfg: CsrfConfig | None = None
) -> str:
    cfg = cfg or CsrfConfig()
    token = session.get("csrf_token")
    issued_at_raw = session.get("csrf_issued_at")

    if not isinstance(token, str) or not isinstance(issued_at_raw, str):
        return issue_csrf_token(session, cfg)

    try:
        issued_at = datetime.fromisoformat(issued_at_raw)
        if issued_at.tzinfo is None:
            issued_at = issued_at.replace(tzinfo=UTC)
    except ValueError:
        return issue_csrf_token(session, cfg)

    if _utcnow() - issued_at > timedelta(minutes=cfg.rotate_minutes):
        return issue_csrf_token(session, cfg)

    return token


def extract_csrf_token(
    request: Request,
    csrf_header: str | None,
    cfg: CsrfConfig | None = None,
) -> str | None:
    cfg = cfg or CsrfConfig()
    if csrf_header:
        return csrf_header.strip()

    # For classic HTML forms (admin UI), accept csrf_token form field.
    # Note: reading form requires async; thus this is used only in dependency below.
    return None


def require_csrf_header(request: Request) -> None:
    """Validate the SPA CSRF header without consuming a request body."""

    if request.method in ("GET", "HEAD", "OPTIONS"):
        return
    session = _get_request_session(request)
    expected = session.get("csrf_token") if session else None
    provided = request.headers.get("X-CSRF-Token", "").strip()
    if not isinstance(expected, str) or not expected or not provided:
        raise_enveloped_api_error(403, "csrf_invalid", "CSRF token chybí nebo není platný.")
    if not _constant_time_eq(provided, expected):
        raise_enveloped_api_error(403, "csrf_invalid", "CSRF token chybí nebo není platný.")


async def require_csrf(
    request: Request,
    csrf_header: str | None = Header(default=None, alias="X-CSRF-Token"),
) -> None:
    """Dependency to protect state-changing cookie-auth endpoints.

    Usage:
        @router.post("/something")
        async def handler(..., _: None = Depends(require_csrf)):
            ...

    Requirements:
      - Session must exist and contain csrf_token.
      - Client must provide matching token.

    Behavior:
      - Safe methods (GET/HEAD/OPTIONS) are not checked.
      - For non-JSON form submits, token can be provided as form field 'csrf_token'.
    """

    if request.method in ("GET", "HEAD", "OPTIONS"):
        return

    session = _get_request_session(request)
    if not session:
        raise CsrfError("Missing session")

    expected = session.get("csrf_token")
    if not isinstance(expected, str) or not expected:
        raise CsrfError("Missing CSRF token in session")

    provided = extract_csrf_token(request, csrf_header)

    if not provided:
        # Try form field.
        try:
            form = await request.form()
            raw_token = form.get("csrf_token")
            if isinstance(raw_token, str):
                provided = raw_token.strip() or None
            else:
                provided = None
        except (RuntimeError, ValueError):
            provided = None

    if not provided:
        raise CsrfError("Missing CSRF token")

    if not _constant_time_eq(provided, expected):
        raise CsrfError()


def attach_csrf_token_to_response(response: Response, token: str) -> None:
    """Optional helper.

    The SPA normally reads the token from its dedicated CSRF bootstrap endpoint.
    """

    response.headers["X-CSRF-Token"] = token
