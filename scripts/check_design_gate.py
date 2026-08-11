"""Fail closed unless the current design review has a complete approval."""

from __future__ import annotations

from pathlib import Path

import yaml

REQUIRED_VIEWPORTS = {"1440x900", "768x1024", "390x844", "print"}
REQUIRED_LANGUAGES = {"cs", "en", "sk", "de", "hi"}


def main() -> int:
    path = Path("docs/design-review/current.yaml")
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    evidence = data.get("evidence", {})
    viewports = set(evidence.get("viewports", []))
    languages = set(evidence.get("languages", []))
    approved = (
        data.get("status") == "SCHVÁLENO"
        and data.get("verdict") == "SCHVÁLENO"
        and evidence.get("backend") == "complete"
        and evidence.get("frontend") == "complete"
        and REQUIRED_VIEWPORTS <= viewports
        and REQUIRED_LANGUAGES <= languages
    )
    if not approved:
        raise SystemExit("design gate requires SCHVÁLENO and complete local render evidence")
    print("design gate: SCHVÁLENO")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
