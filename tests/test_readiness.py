from __future__ import annotations

from sqlalchemy import create_engine, text

from app.services.readiness import check_readiness, packaged_alembic_head


def _revision_engine(revision: str):
    engine = create_engine("sqlite+pysqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(64))"))
        connection.execute(
            text("INSERT INTO alembic_version (version_num) VALUES (:revision)"),
            {"revision": revision},
        )
    return engine


def test_packaged_repository_has_exactly_one_alembic_head() -> None:
    assert packaged_alembic_head() == "2026_08_11_0026"


def test_readiness_requires_exact_packaged_revision() -> None:
    head = packaged_alembic_head()
    status = check_readiness(engine=_revision_engine(head))
    assert status.ready is True
    assert status.database is True
    assert status.revision is True


def test_readiness_rejects_wrong_database_revision() -> None:
    status = check_readiness(engine=_revision_engine("2026_08_11_0025"))
    assert status.ready is False
    assert status.database is True
    assert status.revision is False
