"""Rebuild the derived daily time metrics from the canonical backend engine."""

from __future__ import annotations

import argparse
from datetime import date

from sqlalchemy import select

from app.db.models import (
    AttendanceEvent,
    DailyMetricSource,
    Employment,
    EmploymentDailyTimeMetric,
    ShiftPlan,
)
from app.db.session import session_scope
from app.services.month_summary import build_month_summaries


def _metric_row(employment_id: int, day: date, source: DailyMetricSource, metrics) -> EmploymentDailyTimeMetric:
    return EmploymentDailyTimeMetric(
        employment_id=employment_id,
        metric_date=day,
        source=source,
        total_minutes=metrics.total.minutes,
        total_tenths=metrics.total.tenths,
        afternoon_minutes=metrics.afternoon.minutes if metrics.afternoon else None,
        afternoon_tenths=metrics.afternoon.tenths if metrics.afternoon else None,
        night_minutes=metrics.night.minutes if metrics.night else None,
        night_tenths=metrics.night.tenths if metrics.night else None,
        weekend_minutes=metrics.weekend.minutes if metrics.weekend else None,
        weekend_tenths=metrics.weekend.tenths if metrics.weekend else None,
        public_holiday_minutes=metrics.public_holiday.minutes if metrics.public_holiday else None,
        public_holiday_tenths=metrics.public_holiday.tenths if metrics.public_holiday else None,
        calculation_revision=1,
    )


def rebuild(*, apply: bool) -> int:
    changed = 0
    with session_scope() as db:
        employments = list(db.execute(select(Employment)).scalars())
        for employment in employments:
            dates = {event.occurred_at.date() for event in db.execute(select(AttendanceEvent).where(AttendanceEvent.employment_id == employment.id)).scalars()}
            dates.update(plan.date for plan in db.execute(select(ShiftPlan).where(ShiftPlan.employment_id == employment.id)).scalars())
            if not dates:
                continue
            months = {(day.year, day.month) for day in dates}
            expected: dict[tuple[date, DailyMetricSource], object] = {}
            for year, month in months:
                summaries = build_month_summaries(db, employments=[employment], year=year, month=month)[employment.id]
                expected.update({(item.date, DailyMetricSource.ATTENDANCE): item.worked for item in summaries.day_summaries if item.worked is not None})
                expected.update({(item.date, DailyMetricSource.SHIFT_PLAN): item.planned for item in summaries.day_summaries if item.planned is not None})
            existing = list(db.execute(select(EmploymentDailyTimeMetric).where(EmploymentDailyTimeMetric.employment_id == employment.id)).scalars())
            for row in existing:
                if (row.metric_date, row.source) not in expected:
                    changed += 1
                    if apply:
                        db.delete(row)
            for key, metrics in expected.items():
                row = db.get(EmploymentDailyTimeMetric, (employment.id, key[0], key[1]))
                expected_row = _metric_row(employment.id, key[0], key[1], metrics)
                if row is None or any(getattr(row, field) != getattr(expected_row, field) for field in ("total_minutes", "total_tenths", "afternoon_minutes", "afternoon_tenths", "night_minutes", "night_tenths", "weekend_minutes", "weekend_tenths", "public_holiday_minutes", "public_holiday_tenths")):
                    changed += 1
                    if apply:
                        if row is not None:
                            db.delete(row)
                        db.add(expected_row)
        if not apply and changed:
            db.rollback()
    return changed


def main() -> int:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    changed = rebuild(app=args.apply)
    if args.check and changed:
        print(f"{changed} denních metrik neodpovídá kanonickému enginu.")
        return 1
    print(f"Denní metriky: {changed} změn.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
