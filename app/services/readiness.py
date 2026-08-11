from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.db.session import get_engine


@dataclass(frozen=True)
class ReadinessStatus:
    ready: bool
    database: bool
    revision: bool
    expected_revision: str
    actual_revision: str | None


def packaged_alembic_head(repository_root: Path | None = None) -> str:
    if repository_root is not None:
        root = repository_root
    else:
        candidates = (
            Path.cwd(),
            Path(__file__).absolute().parents[2],
            Path(__file__).resolve().parents[2],
        )
        discovered_root = next(
            (
                candidate
                for candidate in candidates
                if (candidate / "alembic.ini").is_file() and (candidate / "alembic").is_dir()
            ),
            None,
        )
        if discovered_root is None:
            raise RuntimeError("Packaged Alembic configuration is unavailable.")
        root = discovered_root
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str((root / "alembic").as_posix()))
    heads = ScriptDirectory.from_config(config).get_heads()
    if len(heads) != 1:
        raise RuntimeError(f"Expected exactly one packaged Alembic head, found {len(heads)}.")
    return heads[0]


def check_readiness(
    *, engine: Engine | None = None, repository_root: Path | None = None
) -> ReadinessStatus:
    expected = packaged_alembic_head(repository_root)
    active_engine = engine or get_engine()
    with active_engine.connect() as connection:
        connection.execute(text("SELECT 1")).scalar_one()
        revisions = list(
            connection.execute(text("SELECT version_num FROM alembic_version")).scalars()
        )
    actual = revisions[0] if len(revisions) == 1 else None
    revision_matches = actual == expected and len(revisions) == 1
    return ReadinessStatus(
        ready=revision_matches,
        database=True,
        revision=revision_matches,
        expected_revision=expected,
        actual_revision=actual,
    )
