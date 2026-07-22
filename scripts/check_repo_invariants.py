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


def main() -> int:
    failures: list[str] = []
    _validate_removed_paths(failures)
    _validate_forbidden_references(failures)
    _validate_local_links(failures)
    _validate_key_docs(failures)
    if failures:
        print("Repository invariant check failed:")
        for failure in failures:
            print(f" - {failure}")
        return 1
    print("Repository invariants passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
