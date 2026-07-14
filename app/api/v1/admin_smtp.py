# ruff: noqa: B008
from __future__ import annotations

import smtplib
import socket
import ssl
from datetime import datetime
from email.message import EmailMessage
from email.utils import parseaddr

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.config import Settings, get_settings
from app.db.models import AppSettings
from app.db.session import get_db
from app.security.crypto import decrypt_secret, encrypt_secret
from app.security.csrf import require_csrf

router = APIRouter(prefix="/api/v1/admin/smtp", tags=["admin-smtp"])


class SmtpOut(BaseModel):
    host: str | None = None
    port: int | None = None
    security: str | None = None
    username: str | None = None
    from_email: str | None = None
    from_name: str | None = None
    password_set: bool = False


class SmtpIn(BaseModel):
    host: str | None = Field(default=None, max_length=255)
    port: int | None = None
    security: str | None = Field(default=None, max_length=16)
    username: str | None = Field(default=None, max_length=255)
    password: str | None = Field(default=None, max_length=512)
    from_email: str | None = Field(default=None, max_length=255)
    from_name: str | None = Field(default=None, max_length=255)


class SmtpTestStepOut(BaseModel):
    key: str
    label: str
    status: str
    detail: str | None = None


class SmtpTestErrorOut(BaseModel):
    code: str
    message_cs: str
    root_cause: str


class SmtpTestOut(BaseModel):
    ok: bool
    steps: list[SmtpTestStepOut]
    target_email: str | None = None
    error: SmtpTestErrorOut | None = None


def _get_settings(db: Session) -> AppSettings:
    st = db.execute(select(AppSettings).where(AppSettings.id == 1)).scalars().first()
    if st is None:
        st = AppSettings(id=1, afternoon_cutoff_minutes=17 * 60)
        db.add(st)
        db.commit()
        db.refresh(st)
    return st


def _admin_username(admin: object) -> str:
    if isinstance(admin, dict):
        return str(admin.get("username") or admin.get("email") or "").strip()
    return str(getattr(admin, "username", "") or "").strip()


def _looks_like_email(value: str) -> bool:
    _, address = parseaddr(value)
    return bool(address and "@" in address and "." in address.rsplit("@", 1)[-1])


def _decrypt_stored_password(st: AppSettings, settings: Settings) -> str | None:
    if not st.smtp_password:
        return None
    smtp_secret = settings.smtp_password_secret or settings.session_secret
    decrypted = decrypt_secret(st.smtp_password, secret=smtp_secret)
    return decrypted.strip() if decrypted else None


def _step(label_map: dict[str, str], key: str, status: str = "pending", detail: str | None = None) -> SmtpTestStepOut:
    return SmtpTestStepOut(key=key, label=label_map[key], status=status, detail=detail)


def _set_step(steps: list[SmtpTestStepOut], key: str, *, status: str, detail: str | None = None) -> None:
    for step in steps:
        if step.key == key:
            step.status = status
            step.detail = detail
            return


def _smtp_test_error(code: str, message_cs: str, root_cause: str) -> SmtpTestErrorOut:
    return SmtpTestErrorOut(code=code, message_cs=message_cs, root_cause=root_cause)


def _map_smtp_exception(exc: Exception) -> SmtpTestErrorOut:
    if isinstance(exc, ValueError):
        message = str(exc)
        if "admin_email" in message:
            return _smtp_test_error("admin_email_missing", "Aktuální administrátor nemá nastavený e-mail pro doručení testu.", message)
        if "host" in message.lower():
            return _smtp_test_error("smtp_host_missing", "Chybí SMTP server.", message)
        if "port" in message.lower():
            return _smtp_test_error("smtp_port_invalid", "SMTP port není vyplněný nebo má neplatnou hodnotu.", message)
        if "odesilaci" in message.lower() or "from_email" in message.lower():
            return _smtp_test_error("smtp_sender_missing", "Chybí e-mail odesílatele.", message)
        return _smtp_test_error("smtp_validation_failed", "SMTP konfigurace není úplná.", message)
    if isinstance(exc, socket.gaierror):
        return _smtp_test_error("smtp_dns_failed", "Název SMTP serveru se nepodařilo přeložit v DNS.", str(exc))
    if isinstance(exc, (TimeoutError, socket.timeout)):
        return _smtp_test_error("smtp_timeout", "Připojení k SMTP serveru vypršelo.", str(exc))
    if isinstance(exc, ConnectionRefusedError):
        return _smtp_test_error("smtp_connection_refused", "SMTP server odmítl spojení na zadaném portu.", str(exc))
    if isinstance(exc, ssl.SSLError):
        return _smtp_test_error("smtp_tls_failed", "TLS handshake se nezdařil. Zkontrolujte režim zabezpečení a certifikát serveru.", str(exc))
    if isinstance(exc, smtplib.SMTPNotSupportedError):
        return _smtp_test_error("smtp_starttls_unsupported", "SMTP server nepodporuje požadovaný režim STARTTLS nebo AUTH.", str(exc))
    if isinstance(exc, smtplib.SMTPAuthenticationError):
        return _smtp_test_error("smtp_auth_failed", "SMTP server odmítl přihlašovací údaje.", str(exc))
    if isinstance(exc, smtplib.SMTPSenderRefused):
        return _smtp_test_error("smtp_sender_rejected", "SMTP server odmítl adresu odesílatele.", str(exc))
    if isinstance(exc, smtplib.SMTPRecipientsRefused):
        return _smtp_test_error("smtp_recipient_rejected", "SMTP server odmítl cílovou adresu administrátora.", str(exc))
    if isinstance(exc, smtplib.SMTPConnectError):
        return _smtp_test_error("smtp_connect_failed", "Nepodařilo se navázat SMTP spojení.", str(exc))
    if isinstance(exc, smtplib.SMTPServerDisconnected):
        return _smtp_test_error("smtp_server_disconnected", "SMTP server spojení předčasně ukončil.", str(exc))
    return _smtp_test_error("smtp_unknown_error", "SMTP test selhal z neznámého důvodu.", str(exc))


def _run_smtp_test(payload: SmtpIn, *, admin: object, settings: Settings, st: AppSettings) -> SmtpTestOut:
    labels = {
        "validate": "Kontrola vyplněných údajů",
        "sender": "Sestavení odesílatele",
        "connect": "Navázání TCP spojení",
        "tls": "Zabezpečené SMTP spojení",
        "auth": "Přihlášení k SMTP serveru",
        "message": "Sestavení testovacího e-mailu",
        "send": "Odeslání testovací zprávy",
        "quit": "Ukončení SMTP relace",
    }
    steps = [_step(labels, key) for key in labels]
    server: smtplib.SMTP | None = None

    try:
        _set_step(steps, "validate", status="running")
        host = (payload.host or "").strip()
        if not host:
            raise ValueError("smtp_host missing")
        port = int(payload.port) if payload.port else 0
        if port <= 0:
            raise ValueError("smtp_port invalid")
        admin_email = _admin_username(admin).lower()
        if not _looks_like_email(admin_email):
            raise ValueError("admin_email missing")
        _set_step(steps, "validate", status="success", detail=f"Test bude doručen na {admin_email}.")

        _set_step(steps, "sender", status="running")
        username = (payload.username or "").strip()
        security = (payload.security or "SSL").strip().upper()
        stored_password = _decrypt_stored_password(st, settings)
        password = (payload.password or "").strip() or stored_password
        from_email = (payload.from_email or username or "").strip()
        if not from_email:
            raise ValueError("from_email missing")
        from_name = (payload.from_name or "").strip() or None
        _set_step(steps, "sender", status="success", detail=f"Odesílatel: {from_email}")

        _set_step(steps, "connect", status="running")
        with socket.create_connection((host, port), timeout=20):
            pass
        _set_step(steps, "connect", status="success", detail=f"{host}:{port}")

        _set_step(steps, "tls", status="running")
        if security == "SSL":
            server = smtplib.SMTP_SSL(host, port, timeout=20)
            server.ehlo()
            _set_step(steps, "tls", status="success", detail="Navázáno přes implicitní SSL.")
        else:
            server = smtplib.SMTP(host, port, timeout=20)
            server.ehlo()
            if security == "STARTTLS":
                if not server.has_extn("starttls"):
                    raise smtplib.SMTPNotSupportedError("STARTTLS not supported")
                server.starttls(context=ssl.create_default_context())
                server.ehlo()
                _set_step(steps, "tls", status="success", detail="Navázáno přes STARTTLS.")
            else:
                _set_step(steps, "tls", status="success", detail="Bez transportního šifrování.")

        _set_step(steps, "auth", status="running")
        if username and password:
            server.login(username, password)
            _set_step(steps, "auth", status="success", detail=f"Přihlášení jako {username}")
        else:
            _set_step(steps, "auth", status="success", detail="SMTP server nevyžadoval přihlášení.")

        _set_step(steps, "message", status="running")
        message = EmailMessage()
        message["Subject"] = "Dagmar SMTP test"
        message["From"] = f"{from_name} <{from_email}>" if from_name else from_email
        message["To"] = admin_email
        message.set_content(
            "Dobrý den,\n\n"
            "toto je testovací e-mail z administrace KájovoDagmar.\n"
            "Pokud zpráva dorazila, SMTP konfigurace prošla testem.\n"
        )
        _set_step(steps, "message", status="success", detail="Testovací zpráva je připravená.")

        _set_step(steps, "send", status="running")
        server.send_message(message)
        _set_step(steps, "send", status="success", detail="SMTP server zprávu přijal k doručení.")

        _set_step(steps, "quit", status="running")
        server.quit()
        server = None
        _set_step(steps, "quit", status="success", detail="SMTP relace byla korektně ukončena.")

        return SmtpTestOut(ok=True, steps=steps, target_email=admin_email)
    except Exception as exc:
        if server is not None:
            try:
                server.quit()
                _set_step(steps, "quit", status="success", detail="SMTP relace byla ukončena po chybě.")
            except Exception:
                _set_step(steps, "quit", status="error", detail="SMTP relaci se po chybě nepodařilo ukončit korektně.")

        error = _map_smtp_exception(exc)
        for step in steps:
            if step.status == "running":
                step.status = "error"
                step.detail = error.message_cs
                break
        return SmtpTestOut(ok=False, steps=steps, target_email=None, error=error)


@router.get("", response_model=SmtpOut)
def get_smtp(_admin=Depends(require_admin), db: Session = Depends(get_db)):
    st = _get_settings(db)
    return SmtpOut(
        host=st.smtp_host,
        port=st.smtp_port,
        security=st.smtp_security,
        username=st.smtp_username,
        from_email=st.smtp_from_email,
        from_name=st.smtp_from_name,
        password_set=bool(st.smtp_password),
    )


@router.put("", response_model=SmtpOut)
def set_smtp(
    payload: SmtpIn,
    _admin=Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    st = _get_settings(db)
    st.smtp_host = payload.host.strip() if payload.host else None
    st.smtp_port = int(payload.port) if payload.port else None
    st.smtp_security = payload.security.strip().upper() if payload.security else None
    st.smtp_username = payload.username.strip() if payload.username else None
    st.smtp_from_email = payload.from_email.strip() if payload.from_email else None
    st.smtp_from_name = payload.from_name.strip() if payload.from_name else None
    if payload.password:
        smtp_secret = settings.smtp_password_secret or settings.session_secret
        st.smtp_password = encrypt_secret(payload.password, secret=smtp_secret)
    st.smtp_updated_at = datetime.now()
    db.add(st)
    db.commit()
    return SmtpOut(
        host=st.smtp_host,
        port=st.smtp_port,
        security=st.smtp_security,
        username=st.smtp_username,
        from_email=st.smtp_from_email,
        from_name=st.smtp_from_name,
        password_set=bool(st.smtp_password),
    )


@router.post("/test", response_model=SmtpTestOut)
def test_smtp(
    payload: SmtpIn,
    admin=Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    st = _get_settings(db)
    return _run_smtp_test(payload, admin=admin, settings=settings, st=st)
