from __future__ import annotations

import os
from pathlib import Path

import pytest

from scripts.cleanup_releases import (
    FAILED_MARKER,
    STATUS_DIRECTORY,
    SUCCESS_MARKER,
    cleanup_releases,
)


def _release(root: Path, index: int, *, marker: str = SUCCESS_MARKER) -> Path:
    path = root / f"{index:040x}-1"
    path.mkdir()
    status = root / STATUS_DIRECTORY
    status.mkdir(exist_ok=True)
    marker_path = status / f"{path.name}{marker}"
    marker_path.write_text("ok\n", encoding="utf-8")
    os.utime(marker_path, ns=(index, index))
    return path


def test_cleanup_retains_five_newest_successful_releases(tmp_path: Path) -> None:
    releases = [_release(tmp_path, index) for index in range(1, 8)]
    removed = cleanup_releases(tmp_path, keep=5, protected=[])
    assert removed == releases[:2]
    assert [path.exists() for path in releases] == [False, False, True, True, True, True, True]


def test_cleanup_always_protects_current_and_previous_targets(tmp_path: Path) -> None:
    releases = [_release(tmp_path, index) for index in range(1, 8)]
    removed = cleanup_releases(tmp_path, keep=5, protected=[releases[0], releases[1]])
    assert removed == releases[2:4]
    assert [path.exists() for path in releases] == [True, True, False, False, True, True, True]


def test_cleanup_leaves_unknown_directories_and_small_sets_unchanged(tmp_path: Path) -> None:
    releases = [_release(tmp_path, index) for index in range(1, 4)]
    unknown = tmp_path / "manual-backup"
    unknown.mkdir()
    assert cleanup_releases(tmp_path, keep=5, protected=[]) == []
    assert unknown.exists()
    assert all(path.exists() for path in releases)


def test_cleanup_removes_failed_release_but_never_follows_symlink(tmp_path: Path) -> None:
    outside = tmp_path.parent / f"{tmp_path.name}-outside"
    outside.mkdir()
    sentinel = outside / "sentinel"
    sentinel.write_text("keep\n", encoding="utf-8")
    (tmp_path / f"{'f' * 40}-1").symlink_to(outside, target_is_directory=True)
    failed = _release(tmp_path, 1, marker=FAILED_MARKER)
    assert cleanup_releases(tmp_path, keep=5, protected=[]) == [failed]
    assert sentinel.exists()


def test_cleanup_rejects_protected_target_outside_release_root(tmp_path: Path) -> None:
    outside = tmp_path.parent / f"{tmp_path.name}-protected"
    outside.mkdir()
    with pytest.raises(ValueError, match="not a direct release"):
        cleanup_releases(tmp_path, keep=5, protected=[outside])
