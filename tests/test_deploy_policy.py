from __future__ import annotations

from pathlib import Path

WORKFLOW = Path(".github/workflows/ci-cd.yml").read_text(encoding="utf-8")
DEPLOY = WORKFLOW.split("\n  deploy:\n", 1)[1]


def test_deploy_uses_readiness_and_public_https_browser_smoke() -> None:
    activation = DEPLOY.index("Install and atomically activate release")
    local_readiness = DEPLOY.index("/api/v1/readiness", activation)
    public_smoke = DEPLOY.index("Public HTTPS readiness, headers, version and browser smoke")
    browser_smoke = DEPLOY.index("production-smoke.mjs", public_smoke)
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


def test_web_artifact_is_checked_before_packaging() -> None:
    build = WORKFLOW.index("npm run build")
    map_check = WORKFLOW.index("check_web_artifact.py", build)
    package = WORKFLOW.index("Package exact web artifact", map_check)
    assert build < map_check < package


def test_deploy_installs_and_validates_dns01_certificate_automation() -> None:
    install = DEPLOY.index("install -m 0755 \"$BACK_RELEASE/ops/certbot/wedos_dns_hook.py\"")
    secret = DEPLOY.index("/etc/letsencrypt/wedos-wapi.env", install)
    disable_vendor_timer = DEPLOY.index("systemctl disable --now certbot.timer", secret)
    configure = DEPLOY.index("configure-certbot-dns01.py", disable_vendor_timer)
    dry_run = DEPLOY.index("certbot renew --dry-run", configure)
    enable_timer = DEPLOY.index("systemctl enable --now dagmar-certbot-renew.timer", dry_run)
    assert install < secret < disable_vendor_timer < configure < dry_run < enable_timer
    assert "GITHUB_TOKEN" not in DEPLOY[install:enable_timer]


def test_deploy_recreates_backend_app_link_idempotently() -> None:
    assert 'ln -sfn "$APP_DIR" "$BACK_RELEASE/app"' in DEPLOY
    assert 'sysconfig.get_path("purelib")' in DEPLOY
    assert 'test -L "$BACK_RELEASE/app"' in DEPLOY
