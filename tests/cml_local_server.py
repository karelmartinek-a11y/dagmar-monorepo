"""Loopback-only UI qualification host using real attendance routes and calculations."""
from __future__ import annotations

import os
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import FastAPI
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.admin_attendance import router as admin_attendance
from app.api.v1.admin_employment_groups import router as groups
from app.api.v1.admin_export import router as exports
from app.api.v1.admin_locks import router as locks
from app.api.v1.admin_shift_plan import router as admin_plan
from app.api.v1.attendance import router as attendance
from app.api.v1.shift_plan import router as plan
from app.db import models
from app.db.session import get_db
from app.security.cml_web import CmlWebBoundary
from app.services.cml_identity import resolve_identity
from app.services.daily_metrics import sync_employment_metric_months

if os.getenv('CML_LOCAL_QUALIFICATION') != '1':
    raise RuntimeError('This host is isolated qualification only')
engine = create_engine('sqlite://',connect_args={'check_same_thread':False},poolclass=StaticPool)
models.Base.metadata.create_all(engine)
factory = sessionmaker(bind=engine)
with factory() as db:
    instance=models.Instance(id='10000000-0000-4000-8000-000000000001',client_type=models.ClientType.WEB,device_fingerprint='synthetic-local-ui',status=models.InstanceStatus.ACTIVE)
    db.add(instance)
    user=models.PortalUser(id=1,email='attendance@example.invalid',name='Testovací zaměstnanec',role=models.PortalUserRole.EMPLOYEE,is_active=True,is_blocked=False,instance=instance,password_hash='synthetic-unused')
    db.add(user)
    employment=models.Employment(id=1,user=user,title='Recepce',employment_type=models.EmploymentType.WORK_CONTRACT,workload_fraction=Decimal('1.0'),start_date=date(2026,1,1),total_hours_enabled=True,night_hours_enabled=True,afternoon_hours_enabled=True,afternoon_start_minutes=14*60,weekend_hours_enabled=True,public_holiday_hours_enabled=True,automatic_breaks_enabled=False)
    db.add(employment)
    db.flush()
    for day in [1,2,5]:
        for h,m in [(8,0),(12,0),(12,30),(16,30)]:
            db.add(models.AttendanceEvent(employment_id=1,occurred_at=datetime(2026,10,day,h,m,tzinfo=ZoneInfo('Europe/Prague'))))
        db.add(models.ShiftPlan(employment_id=1,date=date(2026,10,day),arrival_time='08:00',departure_time='16:30'))
    db.flush()
    sync_employment_metric_months(db,employment=employment,months={(2026,10)})
    db.commit()
app=FastAPI()
for router in [admin_attendance,admin_plan,attendance,plan,groups,exports,locks]:
    app.include_router(router)

def dependency():
    with factory() as db:
        yield db

app.dependency_overrides[get_db]=dependency
app.add_middleware(CmlWebBoundary,audience='dochazka',session_factory=factory,resolve_identity=resolve_identity,ui_root=Path(__file__).resolve().parents[1]/'app/web_ui')
