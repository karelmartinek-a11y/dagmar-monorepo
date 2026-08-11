from __future__ import annotations

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCAN_ROOTS = (ROOT / "app", ROOT / "scripts", ROOT / "gunicorn.conf.py")
ALLOWLIST = {
    ("app/main.py", "request_id_and_timing"),
    ("app/db/session.py", "session_scope"),
    ("app/services/attendance_reminders.py", "run_attendance_reminders_once"),
}


class BroadExceptionVisitor(ast.NodeVisitor):
    def __init__(self, relative_path: str, lines: list[str]) -> None:
        self.relative_path = relative_path
        self.lines = lines
        self.functions: list[str] = []
        self.failures: list[str] = []

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self.functions.append(node.name)
        self.generic_visit(node)
        self.functions.pop()

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_ExceptHandler(self, node: ast.ExceptHandler) -> None:
        broad = isinstance(node.type, ast.Name) and node.type.id in {"Exception", "BaseException"}
        if broad:
            function = self.functions[-1] if self.functions else "<module>"
            key = (self.relative_path, function)
            previous = "\n".join(self.lines[max(0, node.lineno - 3) : node.lineno])
            if key not in ALLOWLIST:
                self.failures.append(
                    f"{self.relative_path}:{node.lineno}: broad exception outside allowlist"
                )
            elif "process-boundary" not in previous:
                self.failures.append(
                    f"{self.relative_path}:{node.lineno}: allowlisted catch lacks process-boundary marker"
                )
        self.generic_visit(node)


def _paths() -> list[Path]:
    paths: list[Path] = []
    for root in SCAN_ROOTS:
        paths.extend(root.rglob("*.py") if root.is_dir() else [root])
    return sorted(set(paths))


def validate() -> list[str]:
    failures: list[str] = []
    seen_allowlist: set[tuple[str, str]] = set()
    for path in _paths():
        source = path.read_text(encoding="utf-8")
        relative = path.relative_to(ROOT).as_posix()
        visitor = BroadExceptionVisitor(relative, source.splitlines())
        visitor.visit(ast.parse(source, filename=str(path)))
        failures.extend(visitor.failures)
        for key in ALLOWLIST:
            if key[0] == relative and key[1] in visitor.functions:
                seen_allowlist.add(key)
        for function in ast.walk(ast.parse(source)):
            if isinstance(function, (ast.FunctionDef, ast.AsyncFunctionDef)):
                key = (relative, function.name)
                if key in ALLOWLIST:
                    seen_allowlist.add(key)
                    segment = ast.get_source_segment(source, function) or ""
                    if "logger.exception" not in segment:
                        failures.append(
                            f"{relative}:{function.lineno}: allowlisted boundary lacks logger.exception"
                        )
    for missing in sorted(ALLOWLIST - seen_allowlist):
        failures.append(f"stale broad-exception allowlist entry: {missing[0]}:{missing[1]}")
    for path in (ROOT / "app" / "api").rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Assert):
                failures.append(
                    f"{path.relative_to(ROOT)}:{node.lineno}: production assert is forbidden"
                )
    return failures


def main() -> int:
    failures = validate()
    if failures:
        print("\n".join(failures))
        return 1
    print("Broad-exception policy OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
