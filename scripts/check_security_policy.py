from __future__ import annotations

import datetime as dt
import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
SHA_ACTION = re.compile(r"^\s*-?\s*uses:\s*[^@\s]+@([0-9a-f]{40})(?:\s+#\s+\S.*)?$")


def validate_actions() -> list[str]:
    errors: list[str] = []
    for workflow in sorted((ROOT / ".github/workflows").glob("*.y*ml")):
        for number, line in enumerate(workflow.read_text(encoding="utf-8").splitlines(), start=1):
            if "uses:" in line and not SHA_ACTION.match(line):
                errors.append(
                    f"{workflow.relative_to(ROOT)}:{number}: action is not pinned to 40hex SHA"
                )
    return errors


def validate_exceptions() -> list[str]:
    path = ROOT / ".security/audit-exceptions.yml"
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    rows = data.get("exceptions")
    if not isinstance(rows, list):
        return [".security/audit-exceptions.yml: exceptions must be a list"]
    errors: list[str] = []
    today = dt.date.today()
    required = {"id", "tool", "finding", "reason", "owner", "expires_on"}
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            errors.append(f"exception[{index}] must be a mapping")
            continue
        missing = required - set(row)
        if missing:
            errors.append(f"exception[{index}] missing: {', '.join(sorted(missing))}")
            continue
        if any(not str(row[key]).strip() for key in required):
            errors.append(f"exception[{index}] contains an empty required value")
        try:
            expiry = dt.date.fromisoformat(str(row["expires_on"]))
        except ValueError:
            errors.append(f"exception[{index}] has invalid expires_on")
        else:
            if expiry < today:
                errors.append(f"exception[{index}] expired on {expiry.isoformat()}")
    return errors


def main() -> None:
    errors = [*validate_actions(), *validate_exceptions()]
    if errors:
        raise SystemExit("\n".join(errors))
    print("Security policy configuration is valid.")


if __name__ == "__main__":
    main()
