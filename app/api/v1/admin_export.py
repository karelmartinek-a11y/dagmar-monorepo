# ruff: noqa: B008
from __future__ import annotations

import csv
import io
import zipfile
from collections.abc import Iterable
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, joinedload

from ...api.v1.attendance import _build_month
from ...db.models import Employment
from ...db.session import get_db
from ...security.csrf import require_csrf
from ...services.employment_access import employment_is_currently_valid
from ...services.prague_time import PRAGUE_TIMEZONE
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
    except ValueError as exc:
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
    month_data = _build_month(db, employment, start.year, start.month)
    metric_labels = {
        "total": "odpracovano_h",
        "afternoon": "odpoledni_h",
        "night": "nocni_h",
        "weekend": "vikend_h",
        "public_holiday": "svatek_h",
    }
    status_metric_labels = {
        "holiday": "dovolena_h",
        "sickness": "nemoc_h",
        "paragraph": "paragraf_h",
    }
    event_column_count = max(4, max((len(day.events) for day in month_data.days), default=0))
    plan_column_count = max(
        3,
        max(
            (
                sum(
                    value is not None
                    for value in (
                        day.planned_carryover_departure_time,
                        day.planned_arrival_time,
                        day.planned_departure_time,
                    )
                )
                for day in month_data.days
            ),
            default=0,
        ),
    )

    buf = io.StringIO(newline="")
    w = csv.writer(buf, delimiter=",", quoting=csv.QUOTE_MINIMAL)
    w.writerow(
        [
            "zamestnanec",
            "uvazek",
            "typ_uvazku",
            "datum",
            "stav_dne",
            *status_metric_labels.values(),
            *[f"PRŮCHOD {index}" for index in range(1, event_column_count + 1)],
            *[f"PLÁN – PRŮCHOD {index}" for index in range(1, plan_column_count + 1)],
            *[metric_labels[key] for key in month_data.display_metrics],
        ]
    )

    def displayed_hours(day, key: str) -> float | str:
        metric = day.worked.get(key) if day.worked else None
        return metric.hours if metric is not None else ""

    def status_hours(day, key: str) -> float | str:
        metric = day.status_metrics.get(key)
        return metric.hours if metric is not None else ""

    user_name = employment.user.name if employment.user else f"Uzivatel {employment.user_id}"
    for day in month_data.days:
        has_displayed_work = bool(
            day.worked
            and any(
                metric is not None and metric.tenths != 0
                for key in month_data.display_metrics
                if (metric := day.worked.get(key)) is not None
            )
        )
        has_status_hours = any(
            metric is not None and metric.tenths != 0
            for metric in day.status_metrics.values()
        )
        if (
            not day.events
            and not day.effective_status
            and not day.planned_arrival_time
            and not day.planned_departure_time
            and not day.planned_carryover_departure_time
            and not has_displayed_work
            and not has_status_hours
        ):
            continue
        w.writerow(
            [
                user_name,
                employment.title,
                employment.employment_type,
                day.date,
                day.effective_status or "",
                *[status_hours(day, key) for key in status_metric_labels],
                *[
                    datetime.fromisoformat(day.events[index].occurred_at)
                    .astimezone(PRAGUE_TIMEZONE)
                    .strftime("%H:%M")
                    if index < len(day.events)
                    else ""
                    for index in range(event_column_count)
                ],
                *[
                    value
                    for value in (
                        day.planned_carryover_departure_time,
                        day.planned_arrival_time,
                        day.planned_departure_time,
                    )
                ],
                *["" for _ in range(plan_column_count - 3)],
                *[displayed_hours(day, key) for key in month_data.display_metrics],
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
    relevant = [
        employment
        for employment in candidates
        if employment_is_currently_valid(employment) and employment.user is not None and employment.user.is_active
    ]
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
        raise HTTPException(
            status_code=400, detail="Use either bulk=true or employment_id, not both"
        )

    if not bulk:
        if not employment_id:
            raise HTTPException(
                status_code=400, detail="employment_id is required unless bulk=true"
            )

        employment = (
            db.execute(
                select(Employment)
                .options(joinedload(Employment.user))
                .where(Employment.id == employment_id)
            )
            .scalars()
            .first()
        )
        if (
            not employment
            or not employment_is_currently_valid(employment)
            or employment.user is None
            or not employment.user.is_active
            or employment.start_date >= end
            or (employment.end_date is not None and employment.end_date < start)
        ):
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
