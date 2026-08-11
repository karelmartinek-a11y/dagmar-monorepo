from __future__ import annotations

from pathlib import Path

from scripts.check_git_config_credentials import contains_embedded_credentials


def test_git_config_allows_secret_free_remote(tmp_path: Path) -> None:
    config = tmp_path / "config"
    config.write_text(
        '[remote "origin"]\n\turl = https://github.com/example/repository.git\n',
        encoding="utf-8",
    )
    assert contains_embedded_credentials(config) is False


def test_git_config_rejects_embedded_credentials_without_exposing_value(tmp_path: Path) -> None:
    config = tmp_path / "config"
    config.write_text(
        '[remote "origin"]\n\turl = https://example-user:example-secret@github.com/repo.git\n',
        encoding="utf-8",
    )
    assert contains_embedded_credentials(config) is True
