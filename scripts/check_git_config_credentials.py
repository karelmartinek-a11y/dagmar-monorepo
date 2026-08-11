from __future__ import annotations

import argparse
import re
from pathlib import Path

_CREDENTIAL_PATTERNS = (
    re.compile(r"https?://[^/\s@]+@", re.IGNORECASE),
    re.compile(r"x-access-token", re.IGNORECASE),
    re.compile(r"github[_-]?token", re.IGNORECASE),
    re.compile(r"gh[pousr]_[A-Za-z0-9_]+"),
)


def contains_embedded_credentials(path: Path) -> bool:
    content = path.read_text(encoding="utf-8", errors="replace")
    return any(pattern.search(content) is not None for pattern in _CREDENTIAL_PATTERNS)


def main() -> None:
    parser = argparse.ArgumentParser(description="Reject credentials embedded in Git config files.")
    parser.add_argument("configs", nargs="*", type=Path)
    args = parser.parse_args()
    failures = [
        path for path in args.configs if path.is_file() and contains_embedded_credentials(path)
    ]
    if failures:
        names = ", ".join(str(path) for path in failures)
        raise SystemExit(f"Embedded Git credentials detected in: {names}")
    print(f"Checked {len(args.configs)} Git config file(s); no embedded credentials found.")


if __name__ == "__main__":
    main()
