"""Keep MCP file bytes out of the conversation and bind downloads to the same CML actor."""

import hashlib
import time
from datetime import UTC, datetime
from uuid import uuid4

from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.errors import raise_api_error
from app.db.models import AttendanceMCPExport
from app.security.attendance_oauth import CML

EXPIRY_SECONDS = 600


class AttendanceExportOut(BaseModel):
    filename: str
    media_type: str
    size_bytes: int
    sha256: str
    expires_at: datetime
    download_url: str


def store(
    db: Session,
    actor: str,
    filename: str,
    media_type: str,
    content: bytes,
) -> AttendanceExportOut:
    limit = 50_000_000 if media_type == "application/pdf" else 16 * 1024 * 1024
    if not content or len(content) > limit:
        raise_api_error(413, "export_size_limit", "Zmenši rozsah exportu.")
    now = int(time.time())
    db.execute(delete(AttendanceMCPExport).where(AttendanceMCPExport.expires_at <= now))
    export_id = str(uuid4())
    expires = now + EXPIRY_SECONDS
    digest = hashlib.sha256(content).hexdigest()
    db.add(
        AttendanceMCPExport(
            id=export_id,
            actor=actor,
            filename=filename,
            media_type=media_type,
            content=content,
            sha256=digest,
            expires_at=expires,
        )
    )
    db.commit()
    return AttendanceExportOut(
        filename=filename,
        media_type=media_type,
        size_bytes=len(content),
        sha256=digest,
        expires_at=datetime.fromtimestamp(expires, tz=UTC),
        download_url=f"{CML}/sections/dochazka/api/v1/admin/export/mcp/{export_id}",
    )


def load(db: Session, actor: str, export_id: str) -> AttendanceMCPExport:
    row = db.scalar(
        select(AttendanceMCPExport).where(
            AttendanceMCPExport.id == export_id,
            AttendanceMCPExport.actor == actor,
            AttendanceMCPExport.expires_at > int(time.time()),
        )
    )
    if row is None:
        raise_api_error(404, "export_not_found", "Soubor vypršel nebo není v tvém přístupu.")
    return row
