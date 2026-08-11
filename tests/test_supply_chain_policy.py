from __future__ import annotations

import datetime as dt
import re
from pathlib import Path

import yaml

from scripts import (
    check_broad_exceptions,
    check_python_lock,
    check_release_gate,
    check_security_policy,
)


def test_lock_rejects_stale_pyproject_digest(tmp_path: Path) -> None:
    lock = tmp_path / "requirements.lock"
    lock.write_text(
        "# pyproject-sha256: stale\nexample==1.0 \\\n+    --hash=sha256:" + "0" * 64 + "\n",
        encoding="utf-8",
    )

    errors = check_python_lock.validate_lock(lock, "current")

    assert errors == ["requirements.lock: missing or stale pyproject digest"]


def test_security_policy_rejects_unpinned_action(tmp_path: Path, monkeypatch) -> None:
    workflows = tmp_path / ".github" / "workflows"
    workflows.mkdir(parents=True)
    (workflows / "ci.yml").write_text(
        "steps:\n  - uses: actions/checkout@v4\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(check_security_policy, "ROOT", tmp_path)

    errors = check_security_policy.validate_actions()

    assert errors == [".github/workflows/ci.yml:2: action is not pinned to 40hex SHA"]


def test_security_policy_rejects_expired_exception(tmp_path: Path, monkeypatch) -> None:
    security = tmp_path / ".security"
    security.mkdir()
    expired = dt.date.today() - dt.timedelta(days=1)
    (security / "audit-exceptions.yml").write_text(
        yaml.safe_dump(
            {
                "exceptions": [
                    {
                        "id": "temporary",
                        "tool": "pip-audit",
                        "finding": "CVE-example",
                        "reason": "Test fixture",
                        "owner": "karelmartinek-a11y",
                        "expires_on": expired.isoformat(),
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(check_security_policy, "ROOT", tmp_path)

    errors = check_security_policy.validate_exceptions()

    assert errors == [f"exception[0] expired on {expired.isoformat()}"]


def test_implementation_matrix_contains_79_unique_atomic_findings() -> None:
    matrix = (check_release_gate.ROOT / "docs" / "SSOT_IMPLEMENTATION_MATRIX.md").read_text(
        encoding="utf-8"
    )
    finding_ids = re.findall(r"^\|\s*(DAG-P[0-3]-\d{3})\s*\|", matrix, re.MULTILINE)

    assert len(finding_ids) == 79
    assert len(set(finding_ids)) == 79
    assert {finding_id for finding_id in finding_ids if finding_id.startswith("DAG-P0-")} == {
        f"DAG-P0-{index:03d}" for index in range(1, 5)
    }
    assert {finding_id for finding_id in finding_ids if finding_id.startswith("DAG-P1-")} == {
        f"DAG-P1-{index:03d}" for index in range(1, 17)
    }


def test_broad_exception_and_production_assert_policy() -> None:
    assert check_broad_exceptions.validate() == []
