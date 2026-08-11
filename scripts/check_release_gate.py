from __future__ import annotations

import argparse
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROW = re.compile(r"^\|\s*(DAG-P[01]-\d{3})\s*\|.*?\|\s*(splněno|otevřeno|blokováno)\s*\|")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--github-output", action="store_true")
    args = parser.parse_args()
    statuses: dict[str, str] = {}
    for line in (ROOT / "docs/SSOT_IMPLEMENTATION_MATRIX.md").read_text(encoding="utf-8").splitlines():
        match = ROW.match(line)
        if match:
            statuses[match.group(1)] = match.group(2)
    expected = {f"DAG-P0-{index:03d}" for index in range(1, 5)} | {
        f"DAG-P1-{index:03d}" for index in range(1, 17)
    }
    missing = sorted(expected - set(statuses))
    if missing:
        raise SystemExit(f"Release matrix is missing P0/P1 rows: {', '.join(missing)}")
    open_findings = sorted(key for key, value in statuses.items() if value != "splněno")
    allowed = not open_findings
    if args.github_output:
        output = os.environ.get("GITHUB_OUTPUT")
        if not output:
            raise SystemExit("GITHUB_OUTPUT is not set")
        with Path(output).open("a", encoding="utf-8") as handle:
            handle.write(f"allowed={'true' if allowed else 'false'}\n")
    print("Release allowed." if allowed else f"Release blocked by: {', '.join(open_findings)}")


if __name__ == "__main__":
    main()
