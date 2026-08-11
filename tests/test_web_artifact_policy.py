from __future__ import annotations

from pathlib import Path

from scripts.check_web_artifact import validate_web_artifact


def test_web_artifact_accepts_javascript_without_source_map(tmp_path: Path) -> None:
    (tmp_path / "app.js").write_text("console.log('ok');\n", encoding="utf-8")
    assert validate_web_artifact(tmp_path) == []


def test_web_artifact_rejects_map_file_and_mapping_comment(tmp_path: Path) -> None:
    (tmp_path / "app.js.map").write_text("{}\n", encoding="utf-8")
    (tmp_path / "app.js").write_text("//# sourceMappingURL=app.js.map\n", encoding="utf-8")
    assert validate_web_artifact(tmp_path) == [
        "sourceMappingURL is forbidden: app.js",
        "Source map is forbidden: app.js.map",
    ]
