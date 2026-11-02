"""Full-month print fixture. Uses only the isolated CML qualification database."""
from datetime import date, datetime
from zoneinfo import ZoneInfo

import cml_local_server as base
from sqlalchemy import delete

from app.db import models
from app.services.daily_metrics import sync_employment_metric_months

with base.factory() as db:
    employment = db.get(models.Employment, 1)
    employment.user.name = "Testovací zaměstnanec s delším jménem"
    db.execute(delete(models.AttendanceEvent))
    db.execute(delete(models.ShiftPlan))
    for year, month, days in [(2026, 2, 28), (2028, 2, 29), (2026, 6, 30), (2026, 10, 31)]:
        for day in range(1, days + 1):
            for hour, minute in [(7, 0), (9, 0), (9, 15), (11, 15), (11, 30), (13, 30), (13, 45), (15, 48)]:
                db.add(models.AttendanceEvent(
                    employment_id=1,
                    occurred_at=datetime(year, month, day, hour, minute, tzinfo=ZoneInfo("Europe/Prague")),
                ))
            db.add(models.ShiftPlan(
                employment_id=1, date=date(year, month, day),
                arrival_time="07:00", departure_time="15:03",
            ))
    db.flush()
    sync_employment_metric_months(db, employment=employment, months={(2026, 2), (2028, 2), (2026, 6), (2026, 10)})
    db.commit()

app = base.app
