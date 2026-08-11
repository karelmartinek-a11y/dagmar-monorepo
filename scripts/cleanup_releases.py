from __future__ import annotations

import argparse
import re
import shutil
from pathlib import Path

RELEASE_NAME = re.compile(r"^[0-9a-f]{40}-[1-9][0-9]*$")
STATUS_DIRECTORY = ".release-status"
SUCCESS_MARKER = ".success"
FAILED_MARKER = ".failed"


def _direct_release_directory(root: Path, path: Path) -> bool:
    return (
        path.parent == root
        and RELEASE_NAME.fullmatch(path.name) is not None
        and path.is_dir()
        and not path.is_symlink()
    )


def _status_marker(root: Path, release: Path, marker: str) -> Path:
    return root / STATUS_DIRECTORY / f"{release.name}{marker}"


def cleanup_releases(root: Path, *, keep: int, protected: list[Path]) -> list[Path]:
    if keep < 1:
        raise ValueError("keep must be at least 1")
    resolved_root = root.resolve(strict=True)
    protected_resolved: set[Path] = set()
    for item in protected:
        try:
            resolved = item.resolve(strict=True)
        except FileNotFoundError:
            continue
        if not _direct_release_directory(resolved_root, resolved):
            raise ValueError(f"Protected target is not a direct release directory: {item}")
        protected_resolved.add(resolved)

    successful: list[Path] = []
    failed: list[Path] = []
    for child in resolved_root.iterdir():
        if not _direct_release_directory(resolved_root, child):
            continue
        if _status_marker(resolved_root, child, SUCCESS_MARKER).is_file():
            successful.append(child)
        elif _status_marker(resolved_root, child, FAILED_MARKER).is_file():
            failed.append(child)

    successful.sort(
        key=lambda path: (
            _status_marker(resolved_root, path, SUCCESS_MARKER).stat().st_mtime_ns,
            path.name,
        ),
        reverse=True,
    )
    retained = set(protected_resolved)
    for path in successful:
        if len(retained) >= keep:
            break
        retained.add(path)
    removable = [path for path in successful if path not in retained]
    removable.extend(path for path in failed if path not in protected_resolved)

    removed: list[Path] = []
    for path in sorted(set(removable)):
        if not _direct_release_directory(resolved_root, path):
            raise RuntimeError(f"Release changed during cleanup: {path}")
        shutil.rmtree(path)
        for marker in (SUCCESS_MARKER, FAILED_MARKER):
            _status_marker(resolved_root, path, marker).unlink(missing_ok=True)
        removed.append(path)
    return removed


def main() -> None:
    parser = argparse.ArgumentParser(description="Safely retain immutable DAGMAR releases.")
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--keep", type=int, default=5)
    parser.add_argument("--protect", action="append", type=Path, default=[])
    args = parser.parse_args()
    for path in cleanup_releases(args.root, keep=args.keep, protected=args.protect):
        print(path)


if __name__ == "__main__":
    main()
