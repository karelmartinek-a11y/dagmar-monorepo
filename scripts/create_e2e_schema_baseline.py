"""Create the exact pre-Alembic schema required by the isolated local E2E database."""

from __future__ import annotations

import os

import sqlalchemy as sa
from sqlalchemy.engine import make_url


def main() -> None:
    database_url = os.environ["DAGMAR_DATABASE_URL"]
    url = make_url(database_url)
    if os.getenv("DAGMAR_E2E_SEED") != "1" or url.host not in {"127.0.0.1", "localhost"} or "e2e" not in (url.database or ""):
        raise SystemExit("Refusing to create the E2E schema outside an explicit local E2E database.")
    if url.get_backend_name() != "postgresql":
        raise SystemExit("The E2E schema baseline is validated only with PostgreSQL.")

    metadata = sa.MetaData()
    client_type = sa.Enum("ANDROID", "WEB", name="client_type")
    instance_status = sa.Enum("PENDING", "ACTIVE", "REVOKED", name="instance_status")
    instances = sa.Table(
        "instances",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("client_type", client_type, nullable=False),
        sa.Column("device_fingerprint", sa.String(128), nullable=False),
        sa.Column("device_info_json", sa.Text(), nullable=True),
        sa.Column("status", instance_status, nullable=False),
        sa.Column("display_name", sa.String(128), nullable=True),
        sa.Column("token_hash", sa.String(255), nullable=True),
        sa.Column("token_issued_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("client_type", "device_fingerprint", name="uq_instances_client_fingerprint"),
    )
    sa.Index("ix_instances_status", instances.c.status)
    sa.Index("ix_instances_last_seen_at", instances.c.last_seen_at)
    attendance = sa.Table(
        "attendance",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("instance_id", sa.String(36), sa.ForeignKey("instances.id", ondelete="CASCADE"), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("arrival_time", sa.String(5), nullable=True),
        sa.Column("departure_time", sa.String(5), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("instance_id", "date", name="uq_attendance_instance_date"),
    )
    sa.Index("ix_attendance_instance_date", attendance.c.instance_id, attendance.c.date)

    engine = sa.create_engine(database_url)
    with engine.begin() as connection:
        if sa.inspect(connection).get_table_names():
            raise SystemExit("E2E baseline database is not empty.")
        metadata.create_all(connection)


if __name__ == "__main__":
    main()
