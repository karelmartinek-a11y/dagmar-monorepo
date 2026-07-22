from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from fastapi.routing import APIRoute

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "docs/current-state-manifest.yaml"

FRONTEND_ROUTES = [
    "/",
    "/app",
    "/reset",
    "/integration-api",
    "/admin/login",
    "/admin",
    "/admin/prehled",
    "/admin/users",
    "/admin/dochazka",
    "/admin/plan-sluzeb",
    "/admin/export",
    "/admin/tisky",
    "/admin/tisky/preview",
    "/admin/settings",
    "/admin/ucet",
    "/admin/integrace",
]

FRONTEND_COMPONENTS = {
    "/app": "web/src/pages/EmployeePage.tsx",
    "/reset": "web/src/pages/AuthPages.tsx",
    "/integration-api": "web/src/pages/IntegrationDocsPage.tsx",
    "/admin/login": "web/src/pages/AuthPages.tsx",
    "/admin/prehled": "web/src/pages/AdminOverviewPage.tsx",
    "/admin/users": "web/src/pages/AdminUsersPage.tsx",
    "/admin/dochazka": "web/src/pages/AdminMatrixPages.tsx",
    "/admin/plan-sluzeb": "web/src/pages/AdminMatrixPages.tsx",
    "/admin/export": "web/src/pages/AdminOperationsPages.tsx",
    "/admin/tisky": "web/src/pages/AdminOperationsPages.tsx",
    "/admin/tisky/preview": "web/src/pages/AdminOperationsPages.tsx",
    "/admin/settings": "web/src/pages/AdminOperationsPages.tsx",
    "/admin/ucet": "web/src/pages/AdminAccountPage.tsx",
    "/admin/integrace": "web/src/pages/AdminOperationsPages.tsx",
}

REPOSITORY_LAYOUT = [
    {"path": "app/", "purpose": "FastAPI backend"},
    {"path": "alembic/", "purpose": "Alembic migrations"},
    {"path": "tests/", "purpose": "Backend and repository regression tests"},
    {"path": "scripts/", "purpose": "Validation, generation and operations scripts"},
    {"path": "web/", "purpose": "Vite, React and TypeScript frontend"},
    {"path": "web/tests/", "purpose": "Frontend unit and end-to-end tests"},
    {"path": "docs/", "purpose": "Current technical and operational documentation"},
    {"path": ".github/workflows/", "purpose": "GitHub CI/CD and production deploy"},
    {"path": "ops/", "purpose": "Nginx and systemd configuration"},
]


def _build_app():
    os.environ["DAGMAR_DATABASE_URL"] = "sqlite+pysqlite:///:memory:"
    os.environ["DAGMAR_SESSION_SECRET"] = "x" * 32
    os.environ["DAGMAR_CSRF_SECRET"] = "y" * 32
    os.environ["DAGMAR_RATE_LIMIT_ENABLED"] = "false"
    os.environ["DAGMAR_DISABLE_DOCS"] = "false"
    from app.config import get_settings
    from app.main import create_app

    get_settings.cache_clear()
    settings = get_settings()
    return create_app(settings=settings)


def _auth_mode(path: str, methods: list[str]) -> str:
    if path.startswith("/api/v1/integration"):
        return "integration_bearer"
    if path in {"/api/v1/portal/login", "/api/v1/portal/reset", "/api/v1/auth/providers", "/api/v1/auth/result"}:
        return "public"
    if path.startswith("/api/v1/portal/auth-methods"):
        return "portal_bearer"
    if path.startswith("/api/v1/admin/auth-methods"):
        return "admin_session"
    if path.startswith("/api/v1/auth/"):
        return "browser_redirect"
    if path.startswith("/api/v1/admin"):
        return "admin_session_csrf" if any(method in {"POST", "PUT", "PATCH", "DELETE"} for method in methods) else "admin_session"
    if path.startswith("/api/v1/attendance") or path.startswith("/api/v1/shift-plan"):
        return "portal_bearer"
    if path.startswith("/api/v1/instances"):
        return "public"
    return "public"


def build_manifest() -> dict[str, object]:
    app = _build_app()
    backend_routes: list[dict[str, object]] = []
    seen: set[tuple[str, tuple[str, ...]]] = set()

    def collect_routes(items: list[object]) -> None:
        for route in items:
            if isinstance(route, APIRoute):
                if not route.path.startswith("/api/"):
                    continue
                methods = sorted(method for method in route.methods if method not in {"HEAD", "OPTIONS"})
                key = (route.path, tuple(methods))
                if key in seen:
                    continue
                seen.add(key)
                backend_routes.append(
                    {
                        "path": route.path,
                        "methods": methods,
                        "auth_mode": _auth_mode(route.path, methods),
                        "handler": f"{route.endpoint.__module__}.{route.endpoint.__name__}",
                    }
                )
                continue
            nested_router = getattr(route, "original_router", None)
            if nested_router is not None:
                collect_routes(list(nested_router.routes))

    collect_routes(list(app.routes))
    backend_routes.sort(key=lambda item: str(item["path"]))

    return {
        "generated_from": [
            "app/main.py",
            "app/api/v1/",
            "web/src/App.tsx",
            "web/src/api/client.ts",
            ".github/workflows/ci-cd.yml",
        ],
        "repository_layout": REPOSITORY_LAYOUT,
        "production": {
            "domain": "https://dagmar.hcasc.cz",
            "api_base_path": "/api/v1/",
            "backend_bind": "127.0.0.1:8101",
            "postgres_bind": "127.0.0.1:5433",
            "deploy_workflow": ".github/workflows/ci-cd.yml",
        },
        "runtime_invariants": {
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
        },
        "frontend_routes": [
            {"path": path, "component": FRONTEND_COMPONENTS.get(path, "web/src/App.tsx")}
            for path in FRONTEND_ROUTES
        ],
        "backend_endpoints": backend_routes,
        "frontend_backend_bindings": [
            {
                "feature": "employee_portal",
                "frontend_routes": ["/app", "/reset"],
                "backend_endpoints": [
                    "/api/v1/portal/login",
                    "/api/v1/portal/reset",
                    "/api/v1/attendance",
                    "/api/v1/attendance/day-status",
                    "/api/v1/shift-plan",
                    "/api/v1/shift-plan/day-status",
                    "/api/v1/auth/providers",
                    "/api/v1/auth/employee/{provider}/start",
                    "/api/v1/auth/result",
                    "/api/v1/portal/auth-methods",
                    "/api/v1/portal/auth-methods/{provider}",
                ],
            },
            {
                "feature": "admin_console",
                "frontend_routes": [
                    "/admin/login",
                    "/admin/prehled",
                    "/admin/users",
                    "/admin/dochazka",
                    "/admin/plan-sluzeb",
                    "/admin/export",
                    "/admin/tisky",
                    "/admin/tisky/preview",
                    "/admin/settings",
                    "/admin/ucet",
                    "/admin/integrace",
                ],
                "backend_endpoints": [
                    "/api/v1/admin/login",
                    "/api/v1/admin/logout",
                    "/api/v1/admin/csrf",
                    "/api/v1/admin/me",
                    "/api/v1/admin/users",
                    "/api/v1/admin/users/{user_id}",
                    "/api/v1/admin/users/{user_id}/employments",
                    "/api/v1/admin/employments/{employment_id}",
                    "/api/v1/admin/attendance",
                    "/api/v1/admin/attendance/month",
                    "/api/v1/admin/attendance/lock",
                    "/api/v1/admin/attendance/unlock",
                    "/api/v1/admin/locks",
                    "/api/v1/admin/shift-plan",
                    "/api/v1/admin/day-status",
                    "/api/v1/admin/shift-plan/selection",
                    "/api/v1/admin/export",
                    "/api/v1/admin/settings",
                    "/api/v1/admin/smtp",
                    "/api/v1/admin/smtp/test",
                    "/api/v1/admin/integrations/clients",
                    "/api/v1/admin/integrations/clients/options",
                    "/api/v1/admin/integrations/clients/{client_id}",
                    "/api/v1/admin/integrations/clients/{client_id}/rotate",
                    "/api/v1/admin/integrations/clients/{client_id}/disable",
                    "/api/v1/admin/integrations/clients/{client_id}/enable",
                    "/api/v1/admin/integrations/clients/{client_id}/revoke-secret",
                    "/api/v1/admin/auth-methods",
                    "/api/v1/admin/auth-methods/{provider}",
                    "/api/v1/auth/admin/{provider}/start",
                ],
            },
            {
                "feature": "integration_docs",
                "frontend_routes": ["/integration-api"],
                "backend_endpoints": [
                    "/api/v1/integration/health",
                    "/api/v1/integration/employments",
                    "/api/v1/integration/shift-plan",
                    "/api/v1/integration/attendances",
                    "/api/v1/integration/attendances/{attendance_id}",
                    "/api/v1/integration/punches",
                    "/api/v1/integration/locks",
                    "/api/v1/integration/openapi.json",
                ],
            },
        ],
        "main_components": [
            "app/main.py",
            "app/config.py",
            "app/services/external_auth.py",
            "app/services/attendance_reminders.py",
            "web/src/api/client.ts",
            "web/src/pages/EmployeePage.tsx",
            "web/src/pages/AdminMatrixPages.tsx",
            "web/src/pages/AdminOperationsPages.tsx",
            "web/src/pages/AdminUsersPage.tsx",
            "web/src/pages/AdminOverviewPage.tsx",
            "web/src/pages/AdminAccountPage.tsx",
            "web/src/pages/IntegrationDocsPage.tsx",
        ],
        "main_services": [
            "employee_attendance",
            "employee_shift_plan",
            "admin_user_management",
            "admin_attendance_matrix",
            "admin_shift_plan_matrix",
            "admin_exports_and_prints",
            "admin_settings_and_smtp",
            "integration_clients",
            "external_auth_linking",
            "public_instance_registration",
        ],
        "critical_invariants": [
            {
                "id": "canonical_domain",
                "rule": "Only https://dagmar.hcasc.cz is valid in code, docs, config and examples.",
                "tests": ["tests/test_forbidden_domain.py", "scripts/check_repo_invariants.py"],
            },
            {
                "id": "employment_scope",
                "rule": "Attendance, shift plan, locks and exports stay scoped by employment_id.",
                "tests": ["tests/test_integration_api.py", "web/tests/employee-page-editing.test.tsx", "web/tests/admin-pages.test.tsx"],
            },
            {
                "id": "auth_modes",
                "rule": "Admin uses session plus CSRF, employee uses bearer token, integrations use dgi_ bearer tokens.",
                "tests": ["tests/test_admin_auth.py", "tests/test_integration_api.py", "web/tests/api.test.ts"],
            },
            {
                "id": "route_contract",
                "rule": "Frontend routes and backend endpoints match the active runtime registration.",
                "tests": ["tests/test_current_state_manifest.py", "python scripts/generate_current_state_manifest.py --check"],
            },
            {
                "id": "clean_build_outputs",
                "rule": "Validation and build commands do not rewrite tracked source files unexpectedly.",
                "tests": ["python scripts/check_repo_invariants.py", "git diff --exit-code"],
            },
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    manifest = build_manifest()
    rendered = json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n"

    if args.check:
        current = MANIFEST_PATH.read_text(encoding="utf-8")
        if current != rendered:
            raise SystemExit("docs/current-state-manifest.yaml is out of date.")
        print("docs/current-state-manifest.yaml matches the active code.")
        return 0

    MANIFEST_PATH.write_text(rendered, encoding="utf-8")
    print(f"Wrote {MANIFEST_PATH.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
