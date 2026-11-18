"""Receipts for attendance changes admitted by the signed CML web boundary."""

from datetime import UTC

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import CmlAttendanceActivity


def attendance_actor(request: Request) -> str | None:
    claims = getattr(request.state, "cml_web_claims", None)
    return str(claims["sub"]) if claims else None


def record_attendance_activity(db: Session, actor: str | None, action: str) -> None:
    # These receipts share the transaction of the attendance mutation.
    if actor is not None:
        db.add(CmlAttendanceActivity(actor=actor, action=action))


def read_attendance_activity(session_factory, actor, cursor):
    with session_factory() as db:
        query = select(CmlAttendanceActivity).where(CmlAttendanceActivity.actor == actor)
        if cursor is not None:
            query = query.where(CmlAttendanceActivity.id < cursor)
        rows = list(db.scalars(query.order_by(CmlAttendanceActivity.id.desc()).limit(101)))
        return {
            "items": [
                {
                    "seq": row.id,
                    "at": row.at.replace(tzinfo=row.at.tzinfo or UTC).isoformat(),
                    "action": row.action,
                    "status": "saved",
                }
                for row in rows[:100]
            ],
            "next": str(rows[99].id) if len(rows) > 100 else None,
        }
