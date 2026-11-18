"""Receipts for attendance changes admitted by the signed CML web boundary."""

from datetime import UTC

from sqlalchemy import select

from app.db.models import CmlAttendanceActivity


def record_attendance_activity(db, request, action):
    # These receipts share the transaction of the attendance mutation.
    if request is None:
        return
    claims = getattr(request.state, "cml_web_claims", None)
    if claims:
        db.add(CmlAttendanceActivity(actor=claims["sub"], action=action))


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
