from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from alembic.util import CommandError

ROOT = Path(__file__).resolve().parents[1]


def _migration(filename: str):
    path = ROOT / "alembic" / "versions" / filename
    spec = importlib.util.spec_from_file_location(filename.removesuffix(".py"), path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load migration {filename}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_alembic_revision_chain_resolves_head() -> None:
    alembic_ini = Path(__file__).resolve().parents[1] / "alembic.ini"
    cfg = Config(str(alembic_ini))
    cfg.set_main_option("script_location", str((alembic_ini.parent / "alembic").as_posix()))

    script = ScriptDirectory.from_config(cfg)
    heads = script.get_heads()

    assert heads == ["2026_09_01_0028"]


def test_migration_0002_drops_only_named_unique_constraint() -> None:
    engine = sa.create_engine("sqlite+pysqlite:///:memory:")
    metadata = sa.MetaData()
    sa.Table(
        "instances",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("client_type", sa.String(16), nullable=False),
        sa.Column("device_fingerprint", sa.String(128), nullable=False),
        sa.UniqueConstraint(
            "client_type", "device_fingerprint", name="uq_instances_client_fingerprint"
        ),
    )
    metadata.create_all(engine)
    module = _migration("2026_01_20_0002_instance_templates_deactivate_settings.py")
    with engine.begin() as connection:
        module.op = Operations(MigrationContext.configure(connection))
        module.upgrade()
        inspector = sa.inspect(connection)
        assert "uq_instances_client_fingerprint" not in {
            item.get("name") for item in inspector.get_unique_constraints("instances")
        }
        assert {"activated_at", "revoked_at", "deactivated_at", "employment_template"}.issubset(
            {item["name"] for item in inspector.get_columns("instances")}
        )


def test_irreversible_employment_migration_raises_actionable_command_error() -> None:
    module = _migration("2026_05_20_0011_employments_as_attendance_root.py")
    with pytest.raises(CommandError, match="restore-before-2026_05_20_0011"):
        module.downgrade()


def test_migration_0027_removes_drifted_inactive_auth_tables() -> None:
    engine = sa.create_engine("sqlite+pysqlite:///:memory:")
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE admin_users (id INTEGER PRIMARY KEY)")
        connection.exec_driver_sql("CREATE TABLE admin_sessions (id INTEGER PRIMARY KEY)")
        module = _migration("2026_08_11_0027_remove_inactive_auth_tables.py")
        module.op = Operations(MigrationContext.configure(connection))
        module.upgrade()
        assert not set(sa.inspect(connection).get_table_names()).intersection(
            {"admin_users", "admin_sessions"}
        )
        module.downgrade()
