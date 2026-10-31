from __future__ import annotations

from pathlib import Path

WORKFLOW = Path(".github/workflows/ci-cd.yml").read_text(encoding="utf-8")
DEPLOY = WORKFLOW.split("\n  deploy:\n", 1)[1]


def test_deploy_uses_readiness_and_public_https_browser_smoke() -> None:
    activation = DEPLOY.index("Install and atomically activate release")
    local_readiness = DEPLOY.index("/api/v1/readiness", activation)
    public_smoke = DEPLOY.index("Public HTTPS, backend version and exclusive CML entry smoke")
    browser_smoke = DEPLOY.index("scripts/cml-production-smoke.mjs", public_smoke)
    finalize = DEPLOY.index("Mark success and retain five safe releases", browser_smoke)
    assert activation < local_readiness < public_smoke < browser_smoke < finalize
    assert "DAGMAR_PRODUCTION_URL" in DEPLOY[public_smoke:finalize]
    assert "/api/v1/health" not in DEPLOY[activation:public_smoke]


def test_deploy_checks_disk_and_git_credentials_before_schema_change() -> None:
    disk = DEPLOY.index("REQUIRED_KB=")
    git_credentials = DEPLOY.index("check_git_config_credentials.py")
    backend_stop = DEPLOY.index("systemctl stop dagmar-backend")
    migration = DEPLOY.index('alembic.ini" upgrade head')
    assert disk < git_credentials < backend_stop < migration


def test_deploy_rollback_never_starts_old_backend_after_schema_change() -> None:
    rollback = DEPLOY.index("Roll back a failed public validation safely")
    schema_guard = DEPLOY.index('if [ "$SCHEMA_AFTER" = "$SCHEMA_BEFORE" ]', rollback)
    previous_backend = DEPLOY.index('switch_link "$PREV_BACK"', schema_guard)
    stop_backend = DEPLOY.index("systemctl stop dagmar-backend", previous_backend)
    assert rollback < schema_guard < previous_backend < stop_backend


def test_deploy_has_no_git_remote_credential_contract() -> None:
    assert "GITHUB_TOKEN" not in DEPLOY
    assert "x-access-token" not in DEPLOY
    assert "github.com/" not in DEPLOY


def test_legacy_web_is_checked_but_only_the_cml_marker_is_packaged() -> None:
    build = WORKFLOW.index("npm run build")
    map_check = WORKFLOW.index("check_web_artifact.py", build)
    package = WORKFLOW.index("Package the CML entry marker without the retired SPA", map_check)
    assert build < map_check < package
    packaging = WORKFLOW[package : WORKFLOW.index("name: web-release", package)]
    assert 'package_cml_entry.py --commit "$GITHUB_SHA" --output web-release.tgz' in packaging
    assert "node --check web/scripts/cml-production-smoke.mjs" in packaging
    assert "-C web/dist" not in packaging


def test_deploy_recreates_backend_app_link_idempotently() -> None:
    assert 'ln -sfn "$APP_DIR" "$BACK_RELEASE/app"' in DEPLOY
    assert 'sysconfig.get_path("purelib")' in DEPLOY
    assert 'test -L "$BACK_RELEASE/app"' in DEPLOY


def test_deploy_does_not_manage_provider_dns_or_certificates() -> None:
    assert "WEDOS" not in WORKFLOW
    assert "certbot" not in DEPLOY
