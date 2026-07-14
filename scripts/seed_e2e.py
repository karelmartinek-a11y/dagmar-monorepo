"""Seed the isolated PostgreSQL database used by browser integration tests."""

from __future__ import annotations

import os
import uuid
from datetime import UTC, date, datetime

from sqlalchemy import select
from sqlalchemy.engine import make_url

from app.db.models import (
    ClientType,
    Employment,
    Instance,
    InstanceStatus,
    PortalUser,
    PortalUserRole,
)
from app.db.session import get_sessionmaker
from app.security.passwords import hash_password


def main() -> None:
    database_url = os.environ["DAGMAR_DATABASE_URL"]
    url = make_url(database_url)
    if os.getenv("DAGMAR_E2E_SEED") != "1" or url.host not in {"127.0.0.1", "localhost"} or "e2e" not in (url.database or ""):
        raise SystemExit("Refusing to seed a database that is not an explicit local E2E target.")

    email = os.getenv("DAGMAR_E2E_USER_EMAIL", "employee.e2e@example.test")
    password = os.getenv("DAGMAR_E2E_USER_PASSWORD", "EmployeeE2E-Strong-123")
    today = date.today()
    with get_sessionmaker()() as db:
        user = db.execute(select(PortalUser).where(PortalUser.email == email)).scalar_one_or_none()
        if user is None:
            instance = Instance(
                id=str(uuid.uuid4()),
                client_type=ClientType.WEB,
                device_fingerprint="dagmar-e2e-browser",
                status=InstanceStatus.ACTIVE,
                display_name="E2E prohlížeč",
                activated_at=datetime.now(UTC),
                employment_template="DPP_DPC",
            )
            user = PortalUser(
                email=email,
                name="Testovací zaměstnanec",
                role=PortalUserRole.EMPLOYEE,
                password_hash=hash_password(password).value,
                is_active=True,
                instance=instance,
            )
            db.add(user)
            db.flush()
            db.add(
                Employment(
                    user_id=user.id,
                    title="E2E provozní úvazek",
                    employment_type="DPP_DPC",
                    start_date=date(today.year - 1, 1, 1),
                    end_date=None,
                    is_active=True,
                )
            )
        db.commit()


if __name__ == "__main__":
    main()
