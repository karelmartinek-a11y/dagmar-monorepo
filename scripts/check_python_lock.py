from __future__ import annotations

import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCKS = ("requirements-prod.lock", "requirements-dev.lock")
PIN_RE = re.compile(r"^[A-Za-z0-9_.-]+==[^\\\s]+(?:\s*\\)?$")


def validate_lock(path: Path, expected_digest: str) -> list[str]:
    errors: list[str] = []
    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines or lines[0] != f"# pyproject-sha256: {expected_digest}":
        errors.append(f"{path.name}: missing or stale pyproject digest")
    package_start: int | None = None
    package_name = ""
    saw_hash = False
    for number, line in enumerate(lines, start=1):
        stripped = line.strip()
        if line and not line[0].isspace() and PIN_RE.match(stripped):
            if package_start is not None and not saw_hash:
                errors.append(f"{path.name}:{package_start}: {package_name} has no SHA-256 hash")
            package_start = number
            package_name = stripped.split("==", 1)[0]
            saw_hash = False
        elif package_start is not None and "--hash=sha256:" in stripped:
            saw_hash = True
    if package_start is not None and not saw_hash:
        errors.append(f"{path.name}:{package_start}: {package_name} has no SHA-256 hash")
    if package_start is None:
        errors.append(f"{path.name}: no pinned distributions found")
    return errors


def main() -> None:
    digest = hashlib.sha256((ROOT / "pyproject.toml").read_bytes()).hexdigest()
    errors: list[str] = []
    for name in LOCKS:
        path = ROOT / name
        if not path.exists():
            errors.append(f"{name}: missing")
            continue
        errors.extend(validate_lock(path, digest))
    if errors:
        raise SystemExit("\n".join(errors))
    print("Python locks are pinned, hashed, and synchronized with pyproject.toml.")


if __name__ == "__main__":
    main()
