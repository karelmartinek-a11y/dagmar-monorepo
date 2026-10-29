from __future__ import annotations

import io
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.db.models import Employment, ShiftPlan
from app.services.employment_access import (
    display_metrics_for_employment,
    employment_label,
    employment_overlaps_month,
)
from app.services.month_summary import build_month_summaries, is_czech_holiday
from app.services.prague_time import prague_now
from app.services.time_metrics import STATUS_METRIC_KEYS, DailyMetrics, MetricValue

EMPLOYMENTS_PER_PAGE = 5
PDF_DPI = 200
PAGE_WIDTH = 2339
PAGE_HEIGHT = 1654
PAGE_MARGIN_X = 72
PAGE_MARGIN_Y = 56
HEADER_HEIGHT = 170
LEGEND_HEIGHT = 160
FOOTER_HEIGHT = 44
LABEL_COLUMN_WIDTH = 420
SUMMARY_COLUMN_WIDTH = 118
MONTH_LABELS_CS = {
    1: "leden",
    2: "únor",
    3: "březen",
    4: "duben",
    5: "květen",
    6: "červen",
    7: "červenec",
    8: "srpen",
    9: "září",
    10: "říjen",
    11: "listopad",
    12: "prosinec",
}
WEEKDAY_SHORT_CS = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"]
STATUS_LABELS = {
    "HOLIDAY": "Dovolená",
    "SICKNESS": "Nemoc",
    "OFF": "Volno",
    "PARAGRAPH": "Paragraf",
}
METRIC_LABELS = {
    "total": "Plán",
    "afternoon": "Odpoledne",
    "night": "Noc",
    "weekend": "Víkend",
    "public_holiday": "Svátek",
}
FONT_CANDIDATES = [
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    Path("/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf"),
    Path("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"),
    Path("/Library/Fonts/Arial Unicode.ttf"),
    Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf"),
    Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
]


@dataclass(frozen=True)
class ShiftPlanReportCell:
    date_iso: str
    day_number: int
    weekday_short: str
    holiday_label: str | None
    tone: str
    is_within_employment_period: bool
    arrival_time: str | None
    departure_time: str | None
    status: str | None
    status_label: str | None
    interval_label: str
    duration_label: str
    planned_minutes: int
    planned_hours: float
    planned_metrics: dict[str, dict[str, int | float]]
    status_metrics: dict[str, dict[str, int | float]]


@dataclass(frozen=True)
class ShiftPlanReportEmployment:
    employment_id: int
    display_label: str
    user_name: str
    title: str
    employment_type: str
    start_date: str
    end_date: str | None
    is_active_in_month: bool
    display_metrics: list[str]
    cells: list[ShiftPlanReportCell]
    planned_minutes_total: int
    planned_hours: float
    planned_metrics: dict[str, dict[str, int | float]]
    status_metrics: dict[str, dict[str, int | float]]
    scheduled_days: int
    holiday_days: int
    off_days: int


@dataclass(frozen=True)
class ShiftPlanReportPage:
    page_number: int
    employments: list[ShiftPlanReportEmployment]


@dataclass(frozen=True)
class ShiftPlanReport:
    year: int
    month: int
    month_label: str
    generated_at_iso: str
    generated_at_label: str
    day_headers: list[dict[str, str | int | None]]
    pages: list[ShiftPlanReportPage]
    legend: list[str]


def month_range(year: int, month: int) -> tuple[date, date]:
    start = date(year, month, 1)
    if month == 12:
        end = date(year + 1, 1, 1)
    else:
        end = date(year, month + 1, 1)
    return start, end


def _unique_ids(values: list[int]) -> list[int]:
    result: list[int] = []
    seen: set[int] = set()
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def _format_hours(hours: float) -> str:
    return f"{hours:.1f}".replace(".", ",") + " h"


def _metric_payload(value: MetricValue) -> dict[str, int | float]:
    return {"minutes": value.minutes, "tenths": value.tenths, "hours": value.hours}


def _daily_metric_payload(
    metrics: DailyMetrics | None,
    display_metrics: list[str],
) -> dict[str, dict[str, int | float]]:
    if metrics is None:
        return {}
    return {
        key: _metric_payload(value)
        for key in display_metrics
        if (value := getattr(metrics, key)) is not None
    }


def _monthly_metric_payload(
    metrics: dict[str, MetricValue | None] | None,
    display_metrics: list[str],
) -> dict[str, dict[str, int | float]]:
    if metrics is None:
        return {}
    return {
        key: _metric_payload(value)
        for key in display_metrics
        if (value := metrics.get(key)) is not None
    }


def _status_metric_payload(
    metrics: dict[str, MetricValue | None],
) -> dict[str, dict[str, int | float]]:
    return {
        key: _metric_payload(value)
        for key in STATUS_METRIC_KEYS
        if (value := metrics.get(key)) is not None
    }


def _metric_summary_label(metrics: dict[str, dict[str, int | float]]) -> str:
    return "\n".join(
        f"{METRIC_LABELS[key]} {_format_hours(float(value['hours']))}"
        for key, value in metrics.items()
    )


def _metric_cell_label(metrics: dict[str, dict[str, int | float]]) -> str:
    abbreviations = {
        "total": "P",
        "afternoon": "O",
        "night": "N",
        "weekend": "V",
        "public_holiday": "S",
    }
    return "\n".join(
        f"{abbreviations[key]} {float(value['hours']):.1f}".replace(".", ",")
        for key, value in metrics.items()
    )


def _status_metric_summary_label(metrics: dict[str, dict[str, int | float]]) -> str:
    labels = {"holiday": "Dovolená", "sickness": "Nemoc", "paragraph": "Paragraf"}
    return "\n".join(
        f"{labels[key]} {_format_hours(float(value['hours']))}" for key, value in metrics.items()
    )


def _status_metric_cell_label(metrics: dict[str, dict[str, int | float]]) -> str:
    labels = {"holiday": "DOV", "sickness": "NEM", "paragraph": "PAR"}
    return "\n".join(
        f"{labels[key]} {float(value['hours']):.1f}".replace(".", ",")
        for key, value in metrics.items()
    )


def _holiday_label(value: date) -> str | None:
    fixed = {
        (1, 1): "Nový rok",
        (5, 1): "Svátek práce",
        (5, 8): "Den vítězství",
        (7, 5): "Cyril a Metoděj",
        (7, 6): "Jan Hus",
        (9, 28): "Den české státnosti",
        (10, 28): "Den vzniku ČSR",
        (11, 17): "Den boje za svobodu",
        (12, 24): "Štědrý den",
        (12, 25): "1. svátek vánoční",
        (12, 26): "2. svátek vánoční",
    }
    if (value.month, value.day) in fixed:
        return fixed[(value.month, value.day)]
    if is_czech_holiday(value):
        return "Pohyblivý svátek"
    return None


def _tone_for_day(value: date) -> str:
    if is_czech_holiday(value):
        return "holiday"
    if value.weekday() >= 5:
        return "weekend"
    return "work"


def _font_path() -> Path:
    for candidate in FONT_CANDIDATES:
        if candidate.exists():
            return candidate
    raise RuntimeError("Není dostupné žádné podporované systémové písmo pro PDF export plánu směn.")


def _load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    path = _font_path()
    try:
        return ImageFont.truetype(str(path), size=size, layout_engine=ImageFont.Layout.BASIC)
    except OSError:
        return ImageFont.load_default()


def build_shift_plan_report(
    db: Session,
    *,
    year: int,
    month: int,
    employment_ids: list[int],
) -> ShiftPlanReport:
    selected_ids = _unique_ids(employment_ids)
    if not selected_ids:
        raise ValueError("Vyberte alespoň jeden úvazek pro tisk plánu směn.")

    start, end = month_range(year, month)
    generated_at = prague_now()
    generated_label = generated_at.strftime("%d.%m.%Y %H:%M")

    employments = (
        db.execute(
            select(Employment)
            .options(joinedload(Employment.user))
            .where(Employment.id.in_(selected_ids))
        )
        .scalars()
        .all()
    )
    employment_map = {employment.id: employment for employment in employments}
    missing = [
        employment_id for employment_id in selected_ids if employment_id not in employment_map
    ]
    if missing:
        raise ValueError("Vybraný úvazek neexistuje nebo už není dostupný.")

    ordered_employments: list[Employment] = []
    for employment_id in selected_ids:
        employment = employment_map[employment_id]
        if (
            not employment_overlaps_month(employment, start, end)
            or employment.user is None
            or not employment.user.is_active
        ):
            raise ValueError("Vybraný úvazek není v zadaném měsíci aktivní.")
        ordered_employments.append(employment)

    plan_rows = (
        db.execute(
            select(ShiftPlan)
            .where(ShiftPlan.employment_id.in_(selected_ids))
            .where(ShiftPlan.date >= start)
            .where(ShiftPlan.date < end)
            .order_by(ShiftPlan.employment_id.asc(), ShiftPlan.date.asc())
        )
        .scalars()
        .all()
    )
    plan_map = {(row.employment_id, row.date): row for row in plan_rows}
    summaries = build_month_summaries(
        db, employments=ordered_employments, year=year, month=month, use_persisted=False
    )

    day_headers: list[dict[str, str | int | None]] = []
    current = start
    while current < end:
        day_headers.append(
            {
                "date_iso": current.isoformat(),
                "day_number": current.day,
                "weekday_short": WEEKDAY_SHORT_CS[current.weekday()],
                "tone": _tone_for_day(current),
                "holiday_label": _holiday_label(current),
            }
        )
        current += timedelta(days=1)

    report_rows: list[ShiftPlanReportEmployment] = []
    for employment in ordered_employments:
        user_name = employment.user.name if employment.user else f"Uživatel {employment.user_id}"
        display_metrics = display_metrics_for_employment(employment)
        show_total = "total" in display_metrics
        summary = summaries[employment.id]
        day_summary_by_date = {item.date: item for item in summary.day_summaries}
        current = start
        cells: list[ShiftPlanReportCell] = []
        scheduled_days = 0
        holiday_days = 0
        off_days = 0
        while current < end:
            plan = plan_map.get((employment.id, current))
            day_summary = day_summary_by_date[current]
            effective_status = day_summary.effective_status
            interval_parts: list[str] = []
            if plan and plan.arrival_time and plan.departure_time:
                interval_parts.extend([plan.arrival_time, plan.departure_time])
            duration_minutes = day_summary.planned_minutes
            if plan and plan.arrival_time and plan.departure_time:
                scheduled_days += 1
            if effective_status == "HOLIDAY":
                holiday_days += 1
            if effective_status == "OFF":
                off_days += 1
            is_within_employment_period = employment.start_date <= current and (
                employment.end_date is None or current <= employment.end_date
            )
            cells.append(
                ShiftPlanReportCell(
                    date_iso=current.isoformat(),
                    day_number=current.day,
                    weekday_short=WEEKDAY_SHORT_CS[current.weekday()],
                    holiday_label=_holiday_label(current),
                    tone=_tone_for_day(current),
                    is_within_employment_period=is_within_employment_period,
                    arrival_time=plan.arrival_time if plan else None,
                    departure_time=plan.departure_time if plan else None,
                    status=effective_status,
                    status_label=STATUS_LABELS.get(effective_status) if effective_status else None,
                    interval_label="; ".join(interval_parts),
                    duration_label=_format_hours(day_summary.planned_hours)
                    if show_total and duration_minutes > 0
                    else "",
                    planned_minutes=duration_minutes,
                    planned_hours=day_summary.planned_hours,
                    planned_metrics=_daily_metric_payload(day_summary.planned, display_metrics),
                    status_metrics=_status_metric_payload(
                        {
                            key: getattr(day_summary.status_metrics, key)
                            for key in STATUS_METRIC_KEYS
                        }
                    ),
                )
            )
            current += timedelta(days=1)

        report_rows.append(
            ShiftPlanReportEmployment(
                employment_id=employment.id,
                display_label=employment_label(employment, user_name),
                user_name=user_name,
                title=employment.title,
                employment_type=employment.employment_type,
                start_date=employment.start_date.isoformat(),
                end_date=employment.end_date.isoformat()
                if employment.end_date is not None
                else None,
                is_active_in_month=True,
                display_metrics=display_metrics,
                cells=cells,
                planned_minutes_total=summary.planned_minutes,
                planned_hours=summary.planned_hours,
                planned_metrics=_monthly_metric_payload(summary.planned, display_metrics),
                status_metrics=_status_metric_payload(summary.status_metrics),
                scheduled_days=scheduled_days,
                holiday_days=holiday_days,
                off_days=off_days,
            )
        )

    pages = [
        ShiftPlanReportPage(
            page_number=(index // EMPLOYMENTS_PER_PAGE) + 1,
            employments=report_rows[index : index + EMPLOYMENTS_PER_PAGE],
        )
        for index in range(0, len(report_rows), EMPLOYMENTS_PER_PAGE)
    ]

    return ShiftPlanReport(
        year=year,
        month=month,
        month_label=f"{MONTH_LABELS_CS[month]} {year}",
        generated_at_iso=generated_at.isoformat(timespec="seconds"),
        generated_at_label=generated_label,
        day_headers=day_headers,
        pages=pages,
        legend=[
            "V buňce jsou chronologické plánované časy nebo celodenní stav.",
            "Dovolená = celodenní stav z plánu směn.",
            "Volno = celodenní stav bez plánované směny.",
            "Šedé buňky označují víkend, béžové státní svátek.",
        ],
    )


def report_to_payload(report: ShiftPlanReport) -> dict[str, object]:
    return {
        "year": report.year,
        "month": report.month,
        "month_label": report.month_label,
        "generated_at_iso": report.generated_at_iso,
        "generated_at_label": report.generated_at_label,
        "page_count": len(report.pages),
        "day_headers": report.day_headers,
        "legend": report.legend,
        "pages": [
            {
                "page_number": page.page_number,
                "employments": [
                    {
                        "employment_id": employment.employment_id,
                        "display_label": employment.display_label,
                        "user_name": employment.user_name,
                        "title": employment.title,
                        "employment_type": employment.employment_type,
                        "start_date": employment.start_date,
                        "end_date": employment.end_date,
                        "is_active_in_month": employment.is_active_in_month,
                        "display_metrics": employment.display_metrics,
                        "planned_metrics": employment.planned_metrics,
                        "status_metrics": employment.status_metrics,
                        "scheduled_days": employment.scheduled_days,
                        "holiday_days": employment.holiday_days,
                        "off_days": employment.off_days,
                        "cells": [
                            {
                                "date_iso": cell.date_iso,
                                "day_number": cell.day_number,
                                "weekday_short": cell.weekday_short,
                                "holiday_label": cell.holiday_label,
                                "tone": cell.tone,
                                "is_within_employment_period": cell.is_within_employment_period,
                                "arrival_time": cell.arrival_time,
                                "departure_time": cell.departure_time,
                                "status": cell.status,
                                "status_label": cell.status_label,
                                "interval_label": cell.interval_label,
                                "duration_label": cell.duration_label,
                                "planned_metrics": cell.planned_metrics,
                                "status_metrics": cell.status_metrics,
                            }
                            for cell in employment.cells
                        ],
                    }
                    for employment in page.employments
                ],
            }
            for page in report.pages
        ],
    }


def _fit_text_box(
    draw: ImageDraw.ImageDraw, text: str, width: int, height: int, size: int
) -> tuple[str, ImageFont.FreeTypeFont | ImageFont.ImageFont]:
    """Wrap complete text using measured glyph widths, then fit its cell height."""
    for font_size in range(size, 9, -1):
        font = _load_font(font_size)
        lines: list[str] = []
        for paragraph in text.split("\n"):
            line = ""
            for word in paragraph.split():
                candidate = f"{line} {word}" if line else word
                if draw.textlength(candidate, font=font) <= width:
                    line = candidate
                    continue
                if line:
                    lines.append(line)
                    line = ""
                for character in word:
                    if line and draw.textlength(line + character, font=font) > width:
                        lines.append(line)
                        line = ""
                    line += character
            lines.append(line)
        wrapped = "\n".join(lines)
        left, top, right, bottom = draw.multiline_textbbox((0, 0), wrapped, font=font, spacing=3)
        if right - left <= width and bottom - top <= height:
            return wrapped, font
    raise ValueError("print_capacity_exceeded")


def _draw_text_box(
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    text: str,
    *,
    size: int = 15,
    fill: str = "#111111",
) -> None:
    if not text:
        return
    x, y, right, bottom = box
    wrapped, font = _fit_text_box(draw, text, right - x, bottom - y, size)
    left_offset, top_offset, _, _ = draw.multiline_textbbox((0, 0), wrapped, font=font, spacing=3)
    draw.multiline_text((x - left_offset, y - top_offset), wrapped, font=font, fill=fill, spacing=3)


def render_shift_plan_report_pdf(report: ShiftPlanReport) -> bytes:
    images: list[Image.Image] = []
    page_count = max(1, len(report.pages))
    days_count = max(1, len(report.day_headers))
    usable_width = PAGE_WIDTH - 2 * PAGE_MARGIN_X
    table_top = PAGE_MARGIN_Y + HEADER_HEIGHT
    table_height = PAGE_HEIGHT - table_top - LEGEND_HEIGHT - FOOTER_HEIGHT - PAGE_MARGIN_Y
    row_height = table_height // (EMPLOYMENTS_PER_PAGE + 1)
    day_width = (usable_width - LABEL_COLUMN_WIDTH - SUMMARY_COLUMN_WIDTH) // days_count
    table_width = LABEL_COLUMN_WIDTH + SUMMARY_COLUMN_WIDTH + day_width * days_count
    x0 = PAGE_MARGIN_X
    summary_x = x0 + LABEL_COLUMN_WIDTH
    days_x = summary_x + SUMMARY_COLUMN_WIDTH
    right = x0 + table_width

    for page in report.pages:
        image = Image.new("RGB", (PAGE_WIDTH, PAGE_HEIGHT), "white")
        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle(
            (x0, PAGE_MARGIN_Y, right, table_top - 24),
            radius=20,
            outline="#111111",
            width=3,
            fill="#fbf9f4",
        )
        _draw_text_box(
            draw,
            (x0 + 24, PAGE_MARGIN_Y + 20, right - 340, table_top - 36),
            f"Plán směn\nMěsíc: {report.month_label}\nVygenerováno: {report.generated_at_label}",
            size=24,
        )
        _draw_text_box(
            draw,
            (right - 325, PAGE_MARGIN_Y + 28, right - 20, table_top - 36),
            f"Strana {page.page_number}/{page_count}\nKájovoDagmar · dagmar.hcasc.cz",
            size=16,
        )
        draw.rectangle((x0, table_top, right, table_top + row_height), fill="#efebe2")
        _draw_text_box(
            draw,
            (x0 + 12, table_top + 12, summary_x - 12, table_top + row_height - 12),
            "Úvazek / osoba\nČasy PRŮCHOD 1, PRŮCHOD 2\nv každé buňce shora dolů",
            size=18,
        )
        _draw_text_box(
            draw,
            (summary_x + 8, table_top + 12, days_x - 8, table_top + row_height - 12),
            "Měsíční součet (h)",
            size=16,
        )
        for day_index, header in enumerate(report.day_headers):
            x = days_x + day_index * day_width
            fill = (
                "#fff1de"
                if header["tone"] == "holiday"
                else "#f2f2f2"
                if header["tone"] == "weekend"
                else "#f7f3ea"
            )
            draw.rectangle((x, table_top, x + day_width, table_top + row_height), fill=fill)
            _draw_text_box(
                draw,
                (x + 5, table_top + 10, x + day_width - 5, table_top + 65),
                f"{header['day_number']}\n{header['weekday_short']}",
                size=18,
            )
            _draw_text_box(
                draw,
                (x + 4, table_top + 80, x + day_width - 4, table_top + row_height - 10),
                str(header["holiday_label"] or ""),
                size=12,
                fill="#8a4b08",
            )
        for row_index, employment in enumerate(page.employments):
            top = table_top + (row_index + 1) * row_height
            bottom = top + row_height
            _draw_text_box(
                draw,
                (x0 + 12, top + 12, summary_x - 12, bottom - 12),
                f"{employment.user_name}\n{employment.title}\n{employment.employment_type}",
                size=16,
            )
            other_metrics = {
                key: value for key, value in employment.planned_metrics.items() if key != "total"
            }
            summary = "\n".join(
                value
                for value in (
                    f"Plán {_format_hours(employment.planned_hours)}",
                    _metric_summary_label(other_metrics),
                    _status_metric_summary_label(employment.status_metrics),
                    f"{employment.scheduled_days} směn",
                    f"D {employment.holiday_days} · V {employment.off_days}",
                )
                if value
            )
            _draw_text_box(
                draw, (summary_x + 8, top + 10, days_x - 8, bottom - 10), summary, size=14
            )
            for day_index, cell in enumerate(employment.cells):
                left = days_x + day_index * day_width
                cell_right = left + day_width
                fill = (
                    "#f4f4f4"
                    if not cell.is_within_employment_period
                    else "#fff7ea"
                    if cell.tone == "holiday"
                    else "#f7f7f7"
                    if cell.tone == "weekend"
                    else "white"
                )
                draw.rectangle((left, top, cell_right, bottom), fill=fill)
                # A day stays in one column: stack complete neutral times instead of
                # squeezing two subcolumns into an unreadable fraction of an A4 page.
                times = "\n".join(
                    value for value in (cell.arrival_time, cell.departure_time) if value
                )
                _draw_text_box(draw, (left + 4, top + 10, cell_right - 4, top + 54), times, size=14)
                status = "\n".join(
                    value
                    for value in (cell.status_label, _status_metric_cell_label(cell.status_metrics))
                    if value
                )
                _draw_text_box(
                    draw,
                    (left + 4, top + 60, cell_right - 4, bottom - 10),
                    status,
                    size=12,
                    fill="#8a4b08",
                )
                _draw_text_box(
                    draw,
                    (left + 4, top + 65, cell_right - 4, bottom - 10),
                    "" if cell.status_label else _metric_cell_label(cell.planned_metrics),
                    size=12,
                    fill="#555555",
                )
        for index in range(EMPLOYMENTS_PER_PAGE + 2):
            y = table_top + index * row_height
            draw.line((x0, y, right, y), fill="#111111", width=1)
        for x in [x0, summary_x, *[days_x + index * day_width for index in range(days_count + 1)]]:
            draw.line(
                (x, table_top, x, table_top + (EMPLOYMENTS_PER_PAGE + 1) * row_height),
                fill="#111111",
                width=1,
            )
        legend_top = PAGE_HEIGHT - LEGEND_HEIGHT - FOOTER_HEIGHT
        draw.rounded_rectangle(
            (x0, legend_top, right, PAGE_HEIGHT - FOOTER_HEIGHT - 12),
            radius=16,
            outline="#111111",
            width=2,
            fill="#fafafa",
        )
        _draw_text_box(
            draw,
            (x0 + 18, legend_top + 12, right - 18, PAGE_HEIGHT - FOOTER_HEIGHT - 24),
            "Legenda\n" + "\n".join(f"• {item}" for item in report.legend),
            size=15,
        )
        _draw_text_box(
            draw,
            (x0, PAGE_HEIGHT - FOOTER_HEIGHT, right, PAGE_HEIGHT - 8),
            "Výstup je optimalizovaný pro A4 na šířku a stránkuje po nejvýše pěti úvazcích.",
            size=13,
            fill="#555555",
        )
        images.append(image)
    if not images:
        raise RuntimeError("Nepodařilo se vytvořit žádnou stránku PDF exportu plánu směn.")
    buffer = io.BytesIO()
    first, rest = images[0], images[1:]
    first.save(buffer, format="PDF", save_all=True, append_images=rest, resolution=PDF_DPI)
    return buffer.getvalue()


def shift_plan_pdf_filename(*, year: int, month: int) -> str:
    return f"plan_smen_{year:04d}-{month:02d}.pdf"
