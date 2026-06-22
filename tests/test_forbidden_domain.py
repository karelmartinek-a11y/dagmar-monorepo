from __future__ import annotations

from pathlib import Path

import pytest

from app.config import Settings

FORBIDDEN_DOMAIN = "dochazka.hcasc.cz"
BACKEND_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_ROOT = BACKEND_ROOT.parent / "dagmar-frontend"
TEXT_SUFFIXES = {
    ".md",
    ".py",
    ".toml",
    ".yaml",
    ".yml",
    ".json",
    ".ini",
    ".cfg",
    ".env",
    ".example",
    ".txt",
    ".tsx",
    ".ts",
    ".js",
    ".mjs",
    ".html",
    ".css",
}
BACKEND_ALLOWED = {
    Path("app/config.py"),
    Path("tests/test_forbidden_domain.py"),
}
FRONTEND_ALLOWED = {
    Path("tests/forbiddenDomain.test.ts"),
}
SKIP_DIRS = {
    ".git",
    ".venv",
    ".pytest_cache",
    "node_modules",
    "dist",
    "build",
    "__pycache__",
}


def _iter_text_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.suffix.lower() in TEXT_SUFFIXES or path.name in {".env.example"}:
            files.append(path)
    return files


def _find_forbidden_refs(root: Path, allowed: set[Path]) -> list[Path]:
    hits: list[Path] = []
    for path in _iter_text_files(root):
        relative = path.relative_to(root)
        content = path.read_text(encoding="utf-8", errors="ignore")
        if FORBIDDEN_DOMAIN in content and relative not in allowed:
            hits.append(relative)
    return sorted(hits)


def test_settings_reject_forbidden_public_domain() -> None:
    settings = Settings(
        database_url="sqlite:///tmp.db",
        session_secret="x" * 32,
        csrf_secret="y" * 32,
        public_base_url=f"https://{FORBIDDEN_DOMAIN}",
    )
    with pytest.raises(ValueError):
        settings.ensure_canonical_domain()


def test_backend_repo_does_not_reintroduce_forbidden_domain() -> None:
    hits = _find_forbidden_refs(BACKEND_ROOT, BACKEND_ALLOWED)
    assert hits == []


def test_frontend_repo_does_not_reintroduce_forbidden_domain() -> None:
    if not FRONTEND_ROOT.exists():
        pytest.skip("Frontend checkout neni v tomto prostredi k dispozici.")
    hits = _find_forbidden_refs(FRONTEND_ROOT, FRONTEND_ALLOWED)
    assert hits == []
