"""Atomically commit an MCP receipt with the existing attendance mutation."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.api.errors import raise_api_error
from app.db.models import AttendanceMCPOperation

_PAYLOAD_KEY = "attendance_mcp_receipt"


class AttendanceOperationOut(BaseModel):
    operation_id: str
    state: Literal["completed", "not_found"]
    action: str | None = None
    employment_id: int | None = None
    event_id: int | None = None
    group_id: int | None = None
    at: datetime | None = None


@dataclass
class Completion:
    row: AttendanceMCPOperation
    employment_id: int | None
    check_authority: Callable[[Session], None]


def _completed(row: AttendanceMCPOperation) -> AttendanceOperationOut:
    if row.result is None or row.completed_at is None:
        raise_api_error(409, "attendance_outcome_unconfirmed", "Ověř stav původní operace.")
    return AttendanceOperationOut(
        operation_id=row.operation_id,
        state="completed",
        action=row.action,
        employment_id=row.result["employment_id"],
        event_id=row.result.get("event_id"),
        group_id=row.result.get("group_id"),
        at=row.completed_at,
    )


def operation_status(db: Session, actor: str, operation_id: str) -> AttendanceOperationOut:
    row = db.get(AttendanceMCPOperation, (actor, operation_id))
    if row is None:
        return AttendanceOperationOut(operation_id=operation_id, state="not_found")
    return _completed(row)


def _claim(
    db: Session,
    actor: str,
    operation_id: str,
    action: str,
    digest: str,
) -> tuple[AttendanceMCPOperation, bool]:
    insert = sqlite_insert if db.get_bind().dialect.name == "sqlite" else pg_insert
    statement = (
        insert(AttendanceMCPOperation)
        .values(actor=actor, operation_id=operation_id, action=action, request_digest=digest)
        .on_conflict_do_nothing(index_elements=["actor", "operation_id"])
        .returning(AttendanceMCPOperation.operation_id)
    )
    fresh = db.scalar(statement) is not None
    row = db.get(AttendanceMCPOperation, (actor, operation_id))
    if row is None:
        raise_api_error(409, "attendance_outcome_unconfirmed", "Ověř stav původní operace.")
    return row, fresh


def invoke_operation(
    db: Session,
    *,
    actor: str,
    operation_id: str,
    action: str,
    arguments: dict[str, Any],
    employment_id: int | None,
    check_authority: Callable[[Session], None],
    mutate: Callable[[], object],
) -> AttendanceOperationOut:
    encoded = json.dumps(
        {"action": action, "arguments": arguments},
        sort_keys=True,
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    digest = hashlib.sha256(encoded.encode()).hexdigest()
    row, fresh = _claim(db, actor, operation_id, action, digest)
    if not fresh:
        if row.request_digest != digest:
            raise_api_error(409, "operation_conflict", "ID operace už patří jinému požadavku.")
        return _completed(row)

    db.info[_PAYLOAD_KEY] = Completion(row, employment_id, check_authority)
    try:
        mutate()
        return _completed(row)
    finally:
        db.info.pop(_PAYLOAD_KEY, None)


def commit_attendance_mutation(
    db: Session,
    *,
    event_id: int | None = None,
    group_id: int | None = None,
    only_receipt: bool = False,
) -> None:
    receipt = db.info.get(_PAYLOAD_KEY)
    if isinstance(receipt, Completion):
        receipt.check_authority(db)
        receipt.row.result = {
            "employment_id": receipt.employment_id,
            "event_id": event_id,
            "group_id": group_id,
        }
        receipt.row.completed_at = datetime.now(UTC)
    elif only_receipt:
        return
    db.commit()
