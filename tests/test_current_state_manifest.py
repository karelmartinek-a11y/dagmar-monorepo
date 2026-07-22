from __future__ import annotations

import json
import re
from pathlib import Path

from scripts.generate_current_state_manifest import MANIFEST_PATH, build_manifest

ROOT = Path(__file__).resolve().parents[1]
APP_TSX = ROOT / "web/src/App.tsx"
README_MD = ROOT / "README.md"
SSOT_MD = ROOT / "docs/SSOT_CURRENT.md"
AGENTS_MD = ROOT / "AGENTS.md"
API_LITERAL_RE = re.compile(r"(?P<quote>['\"`])(?P<path>/api/v1[^'\"`\s]*)")
ROUTE_RE = re.compile(r'<Route path="([^"]+)"')
REMOVED_PATHS = [
    ROOT / "AUDIT_SOURCE_CODE_FORENSIC.md",
    ROOT / "docs/backend-puls-audit-2026-02-20.md",
    ROOT / "docs/backend-source-audit.md",
    ROOT / "docs/historical-frontend-refactor-report.md",
    ROOT / "docs/monorepo-migration.md",
    ROOT / "docs/integration-api/changelog.md",
    ROOT / "docs/ui-redesign/forensic-inventory",
]
KEY_DOCS = {
    README_MD: [
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
    SSOT_MD: [
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
    AGENTS_MD: [
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
        "Povinný závěrečný report",
    ],
}


def _manifest() -> dict[str, object]:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def _backend_route_patterns(manifest: dict[str, object]) -> list[re.Pattern[str]]:
    patterns: list[re.Pattern[str]] = []
    for endpoint in manifest["backend_endpoints"]:
        path = endpoint["path"]
        escaped = re.escape(path).replace(r"\{", "{").replace(r"\}", "}")
        escaped = re.sub(r"\{[^/]+\}", r"[^/]+", escaped)
        patterns.append(re.compile(f"^{escaped}$"))
    return patterns


def _normalize_frontend_api_path(path: str) -> str:
    path = path.split("?", 1)[0]
    path = re.sub(r"\$\{[^}]+\}", "{param}", path)
    return path


def test_current_state_manifest_matches_generator() -> None:
    expected = build_manifest()
    assert _manifest() == expected


def test_manifest_includes_repository_layout_and_runtime_invariants() -> None:
    manifest = _manifest()
    layout_paths = [item["path"] for item in manifest["repository_layout"]]
    assert layout_paths == [
        "app/",
        "alembic/",
        "tests/",
        "scripts/",
        "web/",
        "web/tests/",
        "docs/",
        ".github/workflows/",
        "ops/",
    ]
    assert manifest["runtime_invariants"] == {
        "canonical_domain": "https://dagmar.hcasc.cz",
        "api_namespace": "/api/v1/",
        "backend_bind": "127.0.0.1:8101",
        "postgres_bind": "127.0.0.1:5433",
        "admin_auth": "session_cookie_plus_csrf",
        "employee_auth": "bearer_instance_token",
        "integration_auth": "dgi_bearer_token",
        "employment_scope": "attendance_shift_plan_locks_exports_are_scoped_by_employment_id",
        "timezone": "Europe/Prague",
        "reverse_proxy_tls": "nginx",
    }


def test_frontend_routes_are_unique_and_match_manifest() -> None:
    manifest_routes = [item["path"] for item in _manifest()["frontend_routes"]]
    assert manifest_routes == sorted(set(manifest_routes), key=manifest_routes.index)

    route_paths = [path for path in ROUTE_RE.findall(APP_TSX.read_text(encoding="utf-8")) if path != "*"]
    normalized = []
    for path in route_paths:
        if path.startswith("/"):
            normalized.append(path)
        elif path:
            normalized.append(f"/admin/{path}")
    assert sorted(set(normalized)) == sorted(set(manifest_routes))


def test_manifest_frontend_backend_bindings_reference_active_endpoints() -> None:
    manifest = _manifest()
    patterns = _backend_route_patterns(manifest)
    for binding in manifest["frontend_backend_bindings"]:
        for path in binding["backend_endpoints"]:
            normalized = re.sub(r"\{[^/]+\}", "{param}", path)
            candidate = re.sub(r"\{param\}", "value", normalized)
            assert any(pattern.match(candidate) for pattern in patterns), path


def test_frontend_api_literals_map_to_backend_routes() -> None:
    manifest = _manifest()
    patterns = _backend_route_patterns(manifest)
    hits: set[str] = set()
    for path in (ROOT / "web/src").rglob("*"):
        if not path.is_file() or path.suffix.lower() not in {".ts", ".tsx"}:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        for match in API_LITERAL_RE.finditer(text):
            raw = match.group("path")
            normalized = _normalize_frontend_api_path(raw)
            if "${" in raw:
                continue
            hits.add(normalized)
    unmatched = sorted(path for path in hits if not any(pattern.match(path) for pattern in patterns))
    assert unmatched == []


def test_removed_historical_artifacts_are_absent() -> None:
    for path in REMOVED_PATHS:
        assert not path.exists(), path.relative_to(ROOT)


def test_key_docs_reference_current_layout_and_invariants() -> None:
    for path, snippets in KEY_DOCS.items():
        text = path.read_text(encoding="utf-8")
        assert "`backend/`" not in text
        assert "`frontend/`" not in text
        for snippet in snippets:
            assert snippet in text, f"{snippet!r} missing in {path.relative_to(ROOT)}"
