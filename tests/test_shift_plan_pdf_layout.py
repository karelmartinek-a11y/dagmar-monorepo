from unittest.mock import Mock

import pytest
from fastapi import HTTPException
from PIL import Image, ImageChops, ImageDraw

from app.api.v1 import admin_export
from app.services.shift_plan_reports import _draw_text_box, _fit_text_box


@pytest.mark.parametrize(
    ("text", "width", "height", "size"),
    [
        ("Příliš dlouhé jméno zaměstnance " * 6 + "\nVelmi dlouhý název úvazku " * 6, 396, 170, 16),
        ("NepřerušenýNázev" * 12, 396, 170, 16),
        (
            "Plán 168,5 h\nOdpoledne 20,0 h\nNoc 8,1 h\nVíkend 8,0 h\nSvátek 0,0 h\n21 směn\nD 0 · V 0",
            102,
            170,
            14,
        ),
        ("08:00\n16:03", 45, 44, 14),
        ("Den vzniku ČSR", 45, 100, 12),
        ("Dovolená\nD 8,0", 45, 100, 12),
    ],
)
def test_pdf_text_fits_its_cell_without_losing_content(text, width, height, size) -> None:
    image = Image.new("RGB", (500, 250), "white")
    draw = ImageDraw.Draw(image)
    wrapped, font = _fit_text_box(draw, text, width, height, size)
    assert "".join(wrapped.split()) == "".join(text.split())
    assert getattr(font, "size", 10) >= 10
    _draw_text_box(draw, (20, 20, 20 + width, 20 + height), text, size=size)
    bounds = ImageChops.difference(image, Image.new("RGB", image.size, "white")).getbbox()
    assert bounds is not None
    assert bounds[0] >= 20 and bounds[1] >= 20
    assert bounds[2] <= 20 + width and bounds[3] <= 20 + height


def test_unreadable_pdf_content_fails_closed() -> None:
    draw = ImageDraw.Draw(Image.new("RGB", (100, 100), "white"))
    with pytest.raises(ValueError, match="print_capacity_exceeded"):
        _fit_text_box(draw, "Nečitelný text", 1, 1, 16)


def test_pdf_capacity_failure_uses_shared_error_contract(monkeypatch) -> None:
    monkeypatch.setattr(admin_export, "build_shift_plan_report", Mock(return_value=object()))
    monkeypatch.setattr(
        admin_export,
        "render_shift_plan_report_pdf",
        Mock(side_effect=ValueError("print_capacity_exceeded")),
    )
    with pytest.raises(HTTPException) as caught:
        admin_export.export_shift_plan_pdf(
            admin_export.ShiftPlanReportRequestIn(year=2026, month=10, employment_ids=[1]),
            _admin={},
            _=None,
            db=Mock(),
        )
    assert caught.value.status_code == 409
    assert caught.value.detail["code"] == "print_capacity_exceeded"
