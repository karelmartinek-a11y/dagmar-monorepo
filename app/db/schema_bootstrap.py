from __future__ import annotations

import os
from pathlib import Path

from alembic.config import Config

from alembic import command
from app.config import Settings


def ensure_schema_up_to_date(settings: Settings) -> None:
    """Při startu dotáhne databázové migrace na aktuální head."""

    package_root = Path(__file__).resolve().parents[2]
    working_root = Path.cwd()
    repository_root = next(
        (
            candidate
            for candidate in (working_root, package_root)
            if (candidate / "alembic.ini").is_file() and (candidate / "alembic").is_dir()
        ),
        None,
    )
    if repository_root is None:
        raise RuntimeError("Cannot locate the active release Alembic configuration")
    alembic_ini = repository_root / "alembic.ini"
    cfg = Config(str(alembic_ini))
    cfg.set_main_option("script_location", str((repository_root / "alembic").as_posix()))

    original_database_url = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = settings.database_url
    try:
        command.upgrade(cfg, "head")
    finally:
        if original_database_url is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = original_database_url
