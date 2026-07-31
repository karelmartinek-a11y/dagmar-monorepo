# ruff: noqa: B008
from __future__ import annotations

import csv
import io
import zipfile
from collections.abc import Iterable
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import distinct, or_, select
from sqlalchemy.orm import Session, joinedload

from ...db.models import AttendanceEvent, Employment, ShiftPlan
from ...db.session import get_db
from ...security.csrf import require_csrf
from ...services.shift_plan_reports import (
    build_shift_plan_report,
    render_shift_plan_report_pdf,
    report_to_payload,
    shift_plan_pdf_filename,
)
from ...utils.slugify import filename_safe
from ..deps import require_admin

router = APIRouter(tags=["admin"])


class ShiftPlanReportRequestIn(BaseModel):
    year: int = Field(..., ge=2000, le=2100)
    month: int = Field(..., ge=1, le=12)
    employment_ids: list[int] = Field(default_factory=list)


def _month_range(month_yyyy_mm: str) -> tuple[date, date]:
    try:
        y_str, m_str = month_yyyy_mm.split("-", 1)
        y = int(y_str)
        m = int(m_str)
        if not (1 <= m <= 12):
            raise ValueError
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid month. Expected YYYY-MM") from exc

    start = date(y, m, 1)
    if m == 12:
        end = date(y + 1, 1, 1)
    else:
        end = date(y, m + 1, 1)
    return start, end


def _employment_display_name(employment: Employment) -> str:
    user_name = employment.user.name if employment.user else f"Uzivatel {employment.user_id}"
    type_label = str(employment.employment_type)
    return f"{user_name} - {type_label} - {employment.title}"


def _csv_for_employment(
    *,
    db: Session,
    employment: Employment,
    start: date,
    end: date,
) -> bytes:
    q = select(AttendanceEvent).where(AttendanceEvent.employment_id == employment.id).order_by(AttendanceEvent.occurred_at, AttendanceEvent.id)
    attendance_rows = db.execute(q).scalars().all()
    plan_rows = db.execute(
        select(ShiftPlan)
        .where(ShiftPlan.employment_id == employment.id)
        .where(ShiftPlan.date >= start)
        .where(ShiftPlan.date < end)
        .order_by(ShiftPlan.date.asc())
    ).scalars().all()
    plan_by_date = {row.date: row for row in plan_rows}
    event_dates = {row.occurred_at.astimezone().date() for row in attendance_rows}
    all_dates = sorted(event_dates | set(plan_by_date))

    buf = io.StringIO(newline="")
    w = csv.writer(buf, delimiter=",", quoting=csv.QUOTE_MINIMAL)
    w.writerow(
        [
            "zamestnanec",
            "uvazek",
            "typ_uvazku",
            "datum",
            "pruchody",
            "stav_dne",
            "plan_prichod",
            "plan_odchod",
        ]
    )
    user_name = employment.user.name if employment.user else f"Uzivatel {employment.user_id}"
    for day in all_dates:
        plan_row = plan_by_date.get(day)
        events = [row for row in attendance_rows if row.occurred_at.astimezone().date() == day]
        w.writerow(
            [
                user_name,
                employment.title,
                employment.employment_type,
                day.isoformat(),
                ";".join(f"{row.event_type.value}:{row.occurred_at.isoformat()}" for row in events),
                plan_row.status if plan_row is not None and plan_row.status else "",
                plan_row.arrival_time if plan_row is not None and plan_row.arrival_time else "",
                plan_row.departure_time if plan_row is not None and plan_row.departure_time else "",
            ]
        )

    return buf.getvalue().encode("utf-8")


def _iter_bytes(data: bytes, chunk_size: int = 64 * 1024) -> Iterable[bytes]:
    for i in range(0, len(data), chunk_size):
        yield data[i : i + chunk_size]


def _load_relevant_employments(db: Session, start: date, end: date) -> list[Employment]:
    candidates = (
        db.execute(
            select(Employment)
            .options(joinedload(Employment.user))
            .where(
                or_(
                    Employment.end_date.is_(None),
                    Employment.end_date >= start,
                )
            )
            .where(Employment.start_date < end)
            .order_by(Employment.start_date.asc(), Employment.id.asc())
        )
        .scalars()
        .all()
    )
    attendance_ids = db.execute(
        select(distinct(AttendanceEvent.employment_id)).where(AttendanceEvent.occurred_at >= start, AttendanceEvent.occurred_at < end)
    ).scalars().all()
    attendance_id_set = set(attendance_ids)
    relevant = [employment for employment in candidates if employment.is_active or employment.id in attendance_id_set]
    seen = {employment.id for employment in relevant}
    if attendance_id_set - seen:
        extra = (
            db.execute(
                select(Employment)
                .options(joinedload(Employment.user))
                .where(Employment.id.in_(attendance_id_set - seen))
            )
            .scalars()
            .all()
        )
        relevant.extend(extra)
    relevant.sort(key=lambda item: (item.user.name if item.user else "", item.start_date, item.id))
    return relevant


@router.get("/api/v1/admin/export")
def export_csv_or_zip(
    month: str = Query(..., description="YYYY-MM"),
    employment_id: int | None = Query(None),
    bulk: bool | None = Query(False),
    _admin=Depends(require_admin),
    db: Session = Depends(get_db),
):
    start, end = _month_range(month)

    if bulk and employment_id:
        raise HTTPException(status_code=400, detail="Use either bulk=true or employment_id, not both")

    if not bulk:
        if not employment_id:
            raise HTTPException(status_code=400, detail="employment_id is required unless bulk=true")

        employment = (
            db.execute(select(Employment).options(joinedload(Employment.user)).where(Employment.id == employment_id))
            .scalars()
            .first()
        )
        if not employment:
            raise HTTPException(status_code=404, detail="Employment not found")

        display = _employment_display_name(employment)
        fname = f"{filename_safe(display)}_{month}.csv"
        content = _csv_for_employment(db=db, employment=employment, start=start, end=end)

        return StreamingResponse(
            _iter_bytes(content),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{fname}"'},
        )

    employments = _load_relevant_employments(db, start, end)

    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, mode="w", compression=zipfile.ZIP_DEFLATED) as z:
        for employment in employments:
            display = _employment_display_name(employment)
            fname = f"{filename_safe(display)}_{month}.csv"
            csv_bytes = _csv_for_employment(db=db, employment=employment, start=start, end=end)
            z.writestr(fname, csv_bytes)

    zip_bytes = zip_buf.getvalue()
    zip_name = f"export_{month}.zip"

    return StreamingResponse(
        _iter_bytes(zip_bytes),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{zip_name}"'},
    )


@router.post("/api/v1/admin/export/shift-plan/report")
def export_shift_plan_report_payload(
    body: ShiftPlanReportRequestIn,
    _admin=Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
):
    try:
        report = build_shift_plan_report(
            db,
            year=body.year,
            month=body.month,
            employment_ids=body.employment_ids,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return report_to_payload(report)


@router.post("/api/v1/admin/export/shift-plan/pdf")
def export_shift_plan_pdf(
    body: ShiftPlanReportRequestIn,
    _admin=Depends(require_admin),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
):
    try:
        report = build_shift_plan_report(
            db,
            year=body.year,
            month=body.month,
            employment_ids=body.employment_ids,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    pdf_bytes = render_shift_plan_report_pdf(report)
    filename = shift_plan_pdf_filename(year=body.year, month=body.month)
    return StreamingResponse(
        _iter_bytes(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
