from __future__ import annotations

import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEXT_SUFFIXES = {
    ".md",
    ".rst",
    ".adoc",
    ".py",
    ".toml",
    ".yaml",
    ".yml",
    ".json",
    ".ini",
    ".cfg",
    ".txt",
    ".tsx",
    ".ts",
    ".js",
    ".mjs",
    ".sh",
    ".html",
    ".css",
}
SKIP_DIRS = {".git", ".venv", "__pycache__", "node_modules", "dist", "playwright-report", "test-results", ".pytest_cache", ".ruff_cache", ".mypy_cache"}
REMOVED_PATHS = [
    Path("AUDIT_SOURCE_CODE_FORENSIC.md"),
    Path("docs/backend-puls-audit-2026-02-20.md"),
    Path("docs/backend-source-audit.md"),
    Path("docs/historical-frontend-refactor-report.md"),
    Path("docs/monorepo-migration.md"),
    Path("docs/integration-api/changelog.md"),
    Path("docs/ui-redesign/forensic-inventory"),
]
FORBIDDEN_REFERENCES = {
    "karelmartinek-a11y/dagmar-backend": {"scripts/check_repo_invariants.py"},
    "karelmartinek-a11y/dagmar-frontend": {"scripts/check_repo_invariants.py"},
    "dochazka.hcasc.cz": {"app/config.py", "tests/test_forbidden_domain.py", "scripts/check_repo_invariants.py"},
}
LINK_RE = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
KEY_DOCS = {
    Path("README.md"): [
        "`app/`",
        "`web/`",
        "`web/tests/`",
        "`alembic/`",
        "`tests/`",
        "`scripts/`",
        "`docs/`",
        "https://dagmar.hcasc.cz",
        "/api/v1/",
        "git diff --exit-code",
        "git status --short",
    ],
    Path("docs/SSOT_CURRENT.md"): [
        "`app/`",
        "`web/`",
        "`web/tests/`",
        "`alembic/`",
        "`tests/`",
        "`scripts/`",
        "`docs/`",
        "`ops/`",
        "https://dagmar.hcasc.cz",
        "/api/v1/",
        "git diff --exit-code",
        "git status --short",
    ],
    Path("AGENTS.md"): [
        "karelmartinek-a11y/dagmar-monorepo",
        "`app/`",
        "`web/`",
        "`web/tests/`",
        "`alembic/`",
        "`tests/`",
        "`scripts/`",
        "`docs/`",
        "`ops/`",
        "https://dagmar.hcasc.cz",
        "/api/v1/",
        "Každá změna, včetně malé opravy, musí být před commitem uzavřena napříč všemi dotčenými artefakty.",
        "Git historie je jediným místem pro historii odstraněných funkcí.",
        "git diff --exit-code",
        "git status --short",
        "Povinný závěrečný report",
    ],
}
LEGACY_LAYOUT_PATTERNS = (
    re.compile(r"`backend/`"),
    re.compile(r"`frontend/`"),
)
HOUR_AUTHORITY_FRONTEND_FILES = (
    Path("web/src/pages/EmployeePage.tsx"),
    Path("web/src/pages/AdminMatrixPages.tsx"),
    Path("web/src/pages/AdminOperationsPages.tsx"),
)
FORBIDDEN_FRONTEND_HOUR_CALCULATORS = (
    "normalizeMinutes",
    "durationMinutes",
    "dayMinutes",
    "actualDayMinutes",
    "plannedDayMinutes",
    "hhmmToMinutes",
    "normalizeInterval",
    "overlapMinutes",
    "durationMinutes",
    "workedMinutes",
    "plannedMinutes",
    "nightMinutes",
    "weekendMinutes",
    "holidayMinutes",
    "publicHolidayMinutes",
    "afternoonMinutes",
    "minutesToHours",
    "hoursFromMinutes",
)
FORBIDDEN_FRONTEND_TIME_MATH_PATTERNS = (
    re.compile(r"\.reduce\s*\("),
    re.compile(r"\.toFixed\s*\("),
    re.compile(r"Math\.(?:round|floor|ceil)\s*\("),
    re.compile(r"(?:minutes|hours)\s*[*/+-]", re.IGNORECASE),
)
FORBIDDEN_ACTIVE_CONTRACTS = (
    "HPP",
    "arrival_time_2",
    "departure_time_2",
    "work_fund",
    "work_fund_source",
    "plan_balance",
    "worked_balance",
    "elapsed_fund",
    "worked_balance_mode",
    "weekend_holiday",
    "pause_hours",
    "pause_minutes",
    "afternoon_cutoff",
)
MIGRATION_FORENSIC_FILES = {"tests/test_migration_0021_to_head.py"}


def _text_files() -> list[Path]:
    files: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(ROOT, topdown=True):
        dirnames[:] = [dirname for dirname in dirnames if dirname not in SKIP_DIRS]
        base = Path(dirpath)
        for filename in filenames:
            path = base / filename
            if path.suffix.lower() in TEXT_SUFFIXES or path.name == ".env.example":
                files.append(path)
    return files


def _validate_removed_paths(failures: list[str]) -> None:
    for rel in REMOVED_PATHS:
        if (ROOT / rel).exists():
            failures.append(f"historical artifact present: {rel}")


def _validate_forbidden_references(failures: list[str]) -> None:
    for path in _text_files():
        rel = path.relative_to(ROOT).as_posix()
        text = path.read_text(encoding="utf-8", errors="ignore")
        for needle, allowed in FORBIDDEN_REFERENCES.items():
            if needle in text and rel not in allowed:
                failures.append(f"forbidden reference {needle!r} in {rel}")


def _validate_local_links(failures: list[str]) -> None:
    for path in _text_files():
        if path.suffix.lower() != ".md":
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        for target in LINK_RE.findall(text):
            if "://" in target or target.startswith("#") or target.startswith("mailto:"):
                continue
            target_path = target.split("#", 1)[0]
            if not target_path:
                continue
            candidate = (path.parent / target_path).resolve()
            if not candidate.exists():
                failures.append(f"broken markdown link in {path.relative_to(ROOT)} -> {target}")


def _validate_key_docs(failures: list[str]) -> None:
    for rel, required_snippets in KEY_DOCS.items():
        path = ROOT / rel
        if not path.exists():
            failures.append(f"missing key documentation file: {rel}")
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        for snippet in required_snippets:
            if snippet not in text:
                failures.append(f"missing required snippet {snippet!r} in {rel}")
        for pattern in LEGACY_LAYOUT_PATTERNS:
            if pattern.search(text):
                failures.append(f"legacy top-level layout reference in {rel}: {pattern.pattern}")


def _validate_backend_hour_authority(failures: list[str]) -> None:
    for rel in HOUR_AUTHORITY_FRONTEND_FILES:
        text = (ROOT / rel).read_text(encoding="utf-8")
        for identifier in FORBIDDEN_FRONTEND_HOUR_CALCULATORS:
            if identifier in text:
                failures.append(f"frontend hour calculator {identifier!r} present in {rel}")
        for pattern in FORBIDDEN_FRONTEND_TIME_MATH_PATTERNS:
            if pattern.search(text):
                failures.append(f"frontend time mathematics {pattern.pattern!r} present in {rel}")


def _validate_frontend_lock_contract(failures: list[str]) -> None:
    for rel in HOUR_AUTHORITY_FRONTEND_FILES:
        text = (ROOT / rel).read_text(encoding="utf-8")
        for legacy_value in ('lock_type: "ATTENDANCE"', 'lock_type: "SHIFT_PLAN"'):
            if legacy_value in text:
                failures.append(
                    f"frontend uses non-API lock value {legacy_value!r} in {rel}"
                )


def _validate_removed_contracts(failures: list[str]) -> None:
    for path in _text_files():
        rel = path.relative_to(ROOT).as_posix()
        if rel in {"scripts/check_repo_invariants.py", *MIGRATION_FORENSIC_FILES} or rel.startswith("alembic/versions/") or rel.startswith("tests/migrations/"):
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        for needle in FORBIDDEN_ACTIVE_CONTRACTS:
            if needle in text:
                failures.append(f"removed active contract {needle!r} present in {rel}")


def _validate_shift_plan_write_serialization(failures: list[str]) -> None:
    service = (ROOT / "app/services/employment_access.py").read_text(encoding="utf-8")
    if ".with_for_update()" not in service:
        failures.append("employment mutation lock no longer uses SELECT FOR UPDATE")
    for rel in (
        Path("app/api/v1/attendance.py"),
        Path("app/api/v1/admin_attendance.py"),
        Path("app/api/v1/integration.py"),
        Path("app/api/v1/shift_plan.py"),
        Path("app/api/v1/admin_shift_plan.py"),
        Path("app/api/v1/admin_locks.py"),
        Path("app/api/v1/admin_employments.py"),
    ):
        text = (ROOT / rel).read_text(encoding="utf-8")
        if "lock_employment_for_time_mutation" not in text:
            failures.append(f"shift-plan mutations are not row-lock serialized in {rel}")


def main() -> int:
    failures: list[str] = []
    _validate_removed_paths(failures)
    _validate_forbidden_references(failures)
    _validate_local_links(failures)
    _validate_key_docs(failures)
    _validate_backend_hour_authority(failures)
    _validate_frontend_lock_contract(failures)
    _validate_removed_contracts(failures)
    _validate_shift_plan_write_serialization(failures)
    if failures:
        print("Repository invariant check failed:")
        for failure in failures:
            print(f" - {failure}")
        return 1
    print("Repository invariants passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
