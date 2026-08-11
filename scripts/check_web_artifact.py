from __future__ import annotations

import argparse
from pathlib import Path


def validate_web_artifact(root: Path) -> list[str]:
    errors: list[str] = []
    if not root.is_dir():
        return [f"Web artifact directory does not exist: {root}"]
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(root)
        if path.suffix == ".map":
            errors.append(f"Source map is forbidden: {relative}")
        if path.suffix in {".js", ".mjs", ".cjs"}:
            content = path.read_text(encoding="utf-8", errors="replace")
            if "sourceMappingURL" in content:
                errors.append(f"sourceMappingURL is forbidden: {relative}")
    return errors


def main() -> None:
    parser = argparse.ArgumentParser(description="Reject source maps in the web release artifact.")
    parser.add_argument("root", type=Path, nargs="?", default=Path("web/dist"))
    args = parser.parse_args()
    errors = validate_web_artifact(args.root)
    if errors:
        raise SystemExit("\n".join(errors))
    print(f"Web artifact contains no source maps: {args.root}")


if __name__ == "__main__":
    main()
