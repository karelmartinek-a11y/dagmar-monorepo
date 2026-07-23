from __future__ import annotations

import io
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.db.models import Employment, ShiftPlan
from app.services.employment_access import employment_label, employment_overlaps_month
from app.services.month_summary import is_czech_holiday
from app.services.prague_time import prague_now

EMPLOYMENTS_PER_PAGE = 5
PDF_DPI = 200
PAGE_WIDTH = 2339
PAGE_HEIGHT = 1654
PAGE_MARGIN_X = 72
PAGE_MARGIN_Y = 56
HEADER_HEIGHT = 170
LEGEND_HEIGHT = 120
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
    "OFF": "Volno",
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
    cells: list[ShiftPlanReportCell]
    planned_minutes_total: int
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


def _minutes_between(start: str | None, end: str | None) -> int:
    if not start or not end:
        return 0
    start_hour, start_minute = map(int, start.split(":"))
    end_hour, end_minute = map(int, end.split(":"))
    start_total = start_hour * 60 + start_minute
    end_total = end_hour * 60 + end_minute
    if end_total <= start_total:
        end_total += 24 * 60
    return end_total - start_total


def _format_minutes(minutes: int) -> str:
    if minutes <= 0:
        return "0 h"
    hours, rest = divmod(minutes, 60)
    if rest == 0:
        return f"{hours} h"
    return f"{hours}:{rest:02d} h"


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
    except Exception:
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
    missing = [employment_id for employment_id in selected_ids if employment_id not in employment_map]
    if missing:
        raise ValueError("Vybraný úvazek neexistuje nebo už není dostupný.")

    ordered_employments: list[Employment] = []
    for employment_id in selected_ids:
        employment = employment_map[employment_id]
        if not employment_overlaps_month(employment, start, end):
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
        current = start
        cells: list[ShiftPlanReportCell] = []
        planned_minutes_total = 0
        scheduled_days = 0
        holiday_days = 0
        off_days = 0
        while current < end:
            plan = plan_map.get((employment.id, current))
            duration_minutes = _minutes_between(plan.arrival_time if plan else None, plan.departure_time if plan else None)
            if duration_minutes > 0:
                planned_minutes_total += duration_minutes
                scheduled_days += 1
            if plan and plan.status == "HOLIDAY":
                holiday_days += 1
            if plan and plan.status == "OFF":
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
                    status=plan.status if plan else None,
                    status_label=STATUS_LABELS.get(plan.status) if plan and plan.status else None,
                    interval_label=(
                        f"{plan.arrival_time}-{plan.departure_time}"
                        if plan and plan.arrival_time and plan.departure_time
                        else (STATUS_LABELS.get(plan.status, "Bez směny") if plan and plan.status else ("Bez směny" if is_within_employment_period else "Mimo období"))
                    ),
                    duration_label=_format_minutes(duration_minutes) if duration_minutes > 0 else "",
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
                end_date=employment.end_date.isoformat() if employment.end_date is not None else None,
                is_active_in_month=True,
                cells=cells,
                planned_minutes_total=planned_minutes_total,
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
            "V buňce je vždy plánovaný čas směny nebo celodenní stav.",
            "Dovolená = celodenní stav z plánu směn.",
            "Volno = celodenní stav bez plánované směny.",
            "Bez směny = v daný den není naplánovaná směna.",
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
                        "planned_minutes_total": employment.planned_minutes_total,
                        "planned_total_label": _format_minutes(employment.planned_minutes_total),
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


def render_shift_plan_report_pdf(report: ShiftPlanReport) -> bytes:
    regular = _load_font(18)
    small = _load_font(15)
    tiny = _load_font(13)
    title_font = _load_font(28)
    strong_font = _load_font(18)

    images: list[Image.Image] = []
    page_count = max(1, len(report.pages))
    days_count = max(1, len(report.day_headers))
    usable_width = PAGE_WIDTH - (2 * PAGE_MARGIN_X)
    table_top = PAGE_MARGIN_Y + HEADER_HEIGHT
    table_height = PAGE_HEIGHT - table_top - LEGEND_HEIGHT - FOOTER_HEIGHT - PAGE_MARGIN_Y
    row_count = EMPLOYMENTS_PER_PAGE + 1
    row_height = table_height // row_count
    day_column_width = max(
        36,
        (usable_width - LABEL_COLUMN_WIDTH - SUMMARY_COLUMN_WIDTH) // days_count,
    )
    table_width = LABEL_COLUMN_WIDTH + SUMMARY_COLUMN_WIDTH + (day_column_width * days_count)

    for page in report.pages:
        image = Image.new("RGB", (PAGE_WIDTH, PAGE_HEIGHT), "white")
        draw = ImageDraw.Draw(image)

        draw.rounded_rectangle(
            (PAGE_MARGIN_X, PAGE_MARGIN_Y, PAGE_MARGIN_X + table_width, PAGE_MARGIN_Y + HEADER_HEIGHT - 24),
            radius=20,
            outline="#111111",
            width=3,
            fill="#fbf9f4",
        )
        draw.text((PAGE_MARGIN_X + 24, PAGE_MARGIN_Y + 22), "Plán směn", font=title_font, fill="#111111")
        draw.text((PAGE_MARGIN_X + 24, PAGE_MARGIN_Y + 62), f"Měsíc: {report.month_label}", font=regular, fill="#111111")
        draw.text(
            (PAGE_MARGIN_X + 24, PAGE_MARGIN_Y + 92),
            f"Vygenerováno: {report.generated_at_label}",
            font=small,
            fill="#333333",
        )
        draw.text(
            (PAGE_MARGIN_X + table_width - 210, PAGE_MARGIN_Y + 28),
            f"Strana {page.page_number}/{page_count}",
            font=regular,
            fill="#111111",
        )
        draw.text(
            (PAGE_MARGIN_X + table_width - 310, PAGE_MARGIN_Y + 72),
            "KájovoDagmar · dagmar.hcasc.cz",
            font=small,
            fill="#333333",
        )

        x0 = PAGE_MARGIN_X
        y0 = table_top
        draw.rectangle((x0, y0, x0 + table_width, y0 + table_height), outline="#111111", width=2)
        draw.rectangle((x0, y0, x0 + LABEL_COLUMN_WIDTH, y0 + row_height), fill="#efebe2", outline="#111111", width=2)
        draw.text((x0 + 14, y0 + 14), "Úvazek / osoba", font=strong_font, fill="#111111")
        draw.rectangle(
            (x0 + LABEL_COLUMN_WIDTH, y0, x0 + LABEL_COLUMN_WIDTH + SUMMARY_COLUMN_WIDTH, y0 + row_height),
            fill="#efebe2",
            outline="#111111",
            width=2,
        )
        draw.text((x0 + LABEL_COLUMN_WIDTH + 12, y0 + 14), "Součet", font=strong_font, fill="#111111")

        for day_index, header in enumerate(report.day_headers):
            x = x0 + LABEL_COLUMN_WIDTH + SUMMARY_COLUMN_WIDTH + (day_index * day_column_width)
            tone = header["tone"]
            fill = "#f7f3ea"
            if tone == "holiday":
                fill = "#fff1de"
            elif tone == "weekend":
                fill = "#f2f2f2"
            draw.rectangle((x, y0, x + day_column_width, y0 + row_height), fill=fill, outline="#111111", width=1)
            draw.text((x + 7, y0 + 8), str(header["day_number"]), font=strong_font, fill="#111111")
            draw.text((x + 7, y0 + 32), str(header["weekday_short"]), font=small, fill="#333333")
            holiday_label = header["holiday_label"]
            if isinstance(holiday_label, str) and holiday_label:
                short_label = holiday_label[: max(4, min(14, (day_column_width // 8)))]
                draw.text((x + 5, y0 + row_height - 22), short_label, font=tiny, fill="#8a4b08")

        for row_index in range(EMPLOYMENTS_PER_PAGE):
            y = y0 + ((row_index + 1) * row_height)
            draw.line((x0, y, x0 + table_width, y), fill="#111111", width=1)

        for column_x in [x0 + LABEL_COLUMN_WIDTH, x0 + LABEL_COLUMN_WIDTH + SUMMARY_COLUMN_WIDTH]:
            draw.line((column_x, y0, column_x, y0 + table_height), fill="#111111", width=1)
        for day_index in range(days_count + 1):
            x = x0 + LABEL_COLUMN_WIDTH + SUMMARY_COLUMN_WIDTH + (day_index * day_column_width)
            draw.line((x, y0, x, y0 + table_height), fill="#111111", width=1)

        for row_index, employment in enumerate(page.employments):
            row_top = y0 + ((row_index + 1) * row_height)
            row_bottom = row_top + row_height
            draw.multiline_text(
                (x0 + 12, row_top + 12),
                f"{employment.user_name}\n{employment.display_label}",
                font=small,
                fill="#111111",
                spacing=5,
            )
            draw.text(
                (x0 + 12, row_bottom - 34),
                f"{employment.employment_type} · {employment.title}",
                font=tiny,
                fill="#555555",
            )
            draw.multiline_text(
                (x0 + LABEL_COLUMN_WIDTH + 10, row_top + 12),
                f"{_format_minutes(employment.planned_minutes_total)}\n{employment.scheduled_days} směn",
                font=small,
                fill="#111111",
                spacing=5,
            )
            draw.text(
                (x0 + LABEL_COLUMN_WIDTH + 10, row_bottom - 34),
                f"D {employment.holiday_days} · V {employment.off_days}",
                font=tiny,
                fill="#555555",
            )

            for day_index, cell in enumerate(employment.cells):
                cell_left = x0 + LABEL_COLUMN_WIDTH + SUMMARY_COLUMN_WIDTH + (day_index * day_column_width)
                cell_top = row_top
                cell_right = cell_left + day_column_width
                cell_bottom = row_bottom
                if not cell.is_within_employment_period:
                    fill = "#f4f4f4"
                elif cell.tone == "holiday":
                    fill = "#fff7ea"
                elif cell.tone == "weekend":
                    fill = "#f7f7f7"
                else:
                    fill = "white"
                draw.rectangle((cell_left + 1, cell_top + 1, cell_right - 1, cell_bottom - 1), fill=fill)
                text_y = cell_top + 10
                text = cell.interval_label
                if len(text) > 11:
                    parts = text.split(" ")
                    text = "\n".join(parts[:2]) if len(parts) > 1 else text
                draw.multiline_text(
                    (cell_left + 5, text_y),
                    text,
                    font=tiny,
                    fill="#111111" if cell.is_within_employment_period else "#777777",
                    spacing=3,
                    align="center",
                )
                if cell.duration_label:
                    draw.text((cell_left + 5, cell_bottom - 22), cell.duration_label, font=tiny, fill="#555555")

        legend_top = PAGE_HEIGHT - LEGEND_HEIGHT - FOOTER_HEIGHT
        draw.rounded_rectangle(
            (PAGE_MARGIN_X, legend_top, PAGE_MARGIN_X + table_width, legend_top + LEGEND_HEIGHT - 18),
            radius=16,
            outline="#111111",
            width=2,
            fill="#fafafa",
        )
        draw.text((PAGE_MARGIN_X + 18, legend_top + 14), "Legenda", font=strong_font, fill="#111111")
        legend_y = legend_top + 44
        for item in report.legend:
            draw.text((PAGE_MARGIN_X + 24, legend_y), f"• {item}", font=small, fill="#333333")
            legend_y += 20
        draw.text(
            (PAGE_MARGIN_X, PAGE_HEIGHT - FOOTER_HEIGHT),
            "Výstup je optimalizovaný pro A4 na šířku a stránkuje po nejvýše pěti úvazcích.",
            font=tiny,
            fill="#555555",
        )

        images.append(image)

    if not images:
        raise RuntimeError("Nepodařilo se vytvořit žádnou stránku PDF exportu plánu směn.")

    buffer = io.BytesIO()
    first, rest = images[0], images[1:]
    first.save(
        buffer,
        format="PDF",
        save_all=True,
        append_images=rest,
        resolution=PDF_DPI,
    )
    return buffer.getvalue()


def shift_plan_pdf_filename(*, year: int, month: int) -> str:
    return f"plan_smen_{year:04d}-{month:02d}.pdf"
