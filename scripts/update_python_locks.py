from __future__ import annotations

import hashlib
import importlib.metadata
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PIP_VERSION = "26.0"
PIP_TOOLS_VERSION = "7.6.0"


def dependency_digest() -> str:
    return hashlib.sha256((ROOT / "pyproject.toml").read_bytes()).hexdigest()


def compile_lock(output: str, *, extra: str | None = None) -> None:
    temporary_name = f".{output}.tmp"
    temporary = ROOT / temporary_name
    command = [
        sys.executable,
        "-m",
        "piptools",
        "compile",
        "--generate-hashes",
        "--resolver=backtracking",
        "--strip-extras",
        "--allow-unsafe",
        f"--output-file={temporary_name}",
    ]
    if extra is not None:
        command.append(f"--extra={extra}")
    command.append("pyproject.toml")
    environment = {**os.environ, "CUSTOM_COMPILE_COMMAND": "python scripts/update_python_locks.py"}
    subprocess.run(command, cwd=ROOT, env=environment, check=True)
    generated = temporary.read_text(encoding="utf-8")
    first_requirement = re.search(r"(?m)^[A-Za-z0-9_.-]+==", generated)
    if first_requirement is None:
        raise RuntimeError(f"pip-compile produced no requirements for {output}")
    body = generated[first_requirement.start() :].replace(
        str(ROOT / "pyproject.toml"), "pyproject.toml"
    )
    command_label = "python scripts/update_python_locks.py"
    canonical_header = (
        "#\n# Generated deterministically by pip-tools 7.6.0 with Python 3.12 and pip 26.0.\n"
        f"# Regenerate with: {command_label}\n#\n"
    )
    marker = f"# pyproject-sha256: {dependency_digest()}\n"
    (ROOT / output).write_text(marker + canonical_header + body, encoding="utf-8")
    temporary.unlink()


def main() -> None:
    versions = {
        "pip": importlib.metadata.version("pip"),
        "pip-tools": importlib.metadata.version("pip-tools"),
    }
    expected = {"pip": PIP_VERSION, "pip-tools": PIP_TOOLS_VERSION}
    if versions != expected:
        raise SystemExit(f"Lock toolchain mismatch: expected {expected}, got {versions}")
    compile_lock("requirements-prod.lock")
    compile_lock("requirements-dev.lock", extra="dev")


if __name__ == "__main__":
    main()
