from __future__ import annotations

from datetime import date, timedelta

FIXED_HOLIDAY_LABELS = {
    (1, 1): "Nový rok / Den obnovy samostatného českého státu",
    (5, 1): "Svátek práce",
    (5, 8): "Den vítězství",
    (7, 5): "Den slovanských věrozvěstů Cyrila a Metoděje",
    (7, 6): "Den upálení mistra Jana Husa",
    (9, 28): "Den české státnosti",
    (10, 28): "Den vzniku samostatného československého státu",
    (11, 17): "Den boje za svobodu a demokracii a Mezinárodní den studentstva",
    (12, 24): "Štědrý den",
    (12, 25): "1. svátek vánoční",
    (12, 26): "2. svátek vánoční",
}


def _easter_sunday(year: int) -> date:
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    m = (a + 11 * h + 22 * ((32 + 2 * e + 2 * i - h - k) % 7)) // 451
    month = (h + ((32 + 2 * e + 2 * i - h - k) % 7) - 7 * m + 114) // 31
    return date(year, month, ((h + ((32 + 2 * e + 2 * i - h - k) % 7) - 7 * m + 114) % 31) + 1)


def is_czech_public_holiday(day: date) -> bool:
    return czech_public_holiday_label(day) is not None


def czech_public_holiday_label(day: date) -> str | None:
    fixed = FIXED_HOLIDAY_LABELS.get((day.month, day.day))
    if fixed is not None:
        return fixed
    easter = _easter_sunday(day.year)
    if day == easter - timedelta(days=2):
        return "Velký pátek"
    if day == easter + timedelta(days=1):
        return "Velikonoční pondělí"
    return None
