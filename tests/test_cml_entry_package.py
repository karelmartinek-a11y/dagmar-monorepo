from __future__ import annotations

import json
import tarfile
from pathlib import Path

import pytest

from scripts.package_cml_entry import build_entry


def test_entry_package_contains_only_a_reproducible_source_bound_delivery_marker(
    tmp_path: Path,
) -> None:
    first, second = tmp_path / "first.tgz", tmp_path / "second.tgz"
    commit = "1234567890abcdef" * 2 + "12345678"
    build_entry(commit, first)
    build_entry(commit, second)
    assert first.read_bytes() == second.read_bytes()
    with tarfile.open(first) as archive:
        assert archive.getnames() == ["cml-entry.json"]
        member = archive.extractfile("cml-entry.json")
        assert member is not None
        value = json.loads(member.read())
        assert value == {
            "contract": "kajovo-web-ui/1",
            "section": "dochazka",
            "central_entry": "https://kajovocml.hcasc.cz/#dochazka",
            "ui_delivery": "signed_backend_wheel",
            "source_commit": commit,
        }


def test_entry_package_rejects_unknown_source_and_cannot_overwrite_an_artifact(
    tmp_path: Path,
) -> None:
    output = tmp_path / "entry.tgz"
    with pytest.raises(ValueError):
        build_entry("unknown", output)
    assert not output.exists()
    build_entry("a" * 40, output)
    before = output.read_bytes()
    with pytest.raises(FileExistsError):
        build_entry("b" * 40, output)
    assert output.read_bytes() == before
