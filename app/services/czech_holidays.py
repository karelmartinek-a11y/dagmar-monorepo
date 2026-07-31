from __future__ import annotations

from datetime import date, timedelta


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
    fixed = {(1, 1), (5, 1), (5, 8), (7, 5), (7, 6), (9, 28), (10, 28), (11, 17), (12, 24), (12, 25), (12, 26)}
    easter = _easter_sunday(day.year)
    return (day.month, day.day) in fixed or day in {easter - timedelta(days=2), easter + timedelta(days=1)}
