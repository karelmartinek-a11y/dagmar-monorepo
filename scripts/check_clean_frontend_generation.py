from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BOUNDARY = ROOT / "docs/ui-redesign/forensic-inventory/boundary.json"
SOURCE_SUFFIXES = {".css", ".js", ".jsx", ".mjs", ".ts", ".tsx"}
TOKEN_RE = re.compile(r"[A-Za-z_$][A-Za-z0-9_$]*|\d+(?:\.\d+)?|[^\s]", re.ASCII)
WINDOW = 80


def git_bytes(commit: str, path: str) -> bytes:
    return subprocess.check_output(["git", "show", f"{commit}:{path}"], cwd=ROOT)


def tokens(content: bytes) -> list[str]:
    text = content.decode("utf-8", errors="ignore")
    text = re.sub(r"/\*.*?\*/|//[^\n]*", "", text, flags=re.DOTALL)
    return TOKEN_RE.findall(text)


def windows(items: list[str]) -> set[str]:
    return {
        hashlib.sha256("\0".join(items[index : index + WINDOW]).encode()).hexdigest()
        for index in range(max(0, len(items) - WINDOW + 1))
    }


def main() -> int:
    boundary = json.loads(BOUNDARY.read_text())
    commit = boundary["commit"]
    if (ROOT / "frontend").exists():
        print("Historical frontend/ must not exist after the forensic boundary.", file=sys.stderr)
        return 1
    if (ROOT / "backend").exists():
        print("Historical backend/ wrapper must not exist after the root migration.", file=sys.stderr)
        return 1
    web = ROOT / "web"
    if not web.is_dir():
        print("Clean replacement web/ is missing.", file=sys.stderr)
        return 1

    old_paths = subprocess.check_output(
        ["git", "ls-tree", "-r", "--name-only", commit, "frontend"], cwd=ROOT, text=True
    ).splitlines()
    old_hashes: dict[str, str] = {}
    old_windows: set[str] = set()
    for path in old_paths:
        content = git_bytes(commit, path)
        old_hashes[hashlib.sha256(content).hexdigest()] = path
        if Path(path).suffix in SOURCE_SUFFIXES:
            old_windows.update(windows(tokens(content)))

    failures: list[str] = []
    for path in web.rglob("*"):
        if not path.is_file() or any(part in {"node_modules", "dist", "coverage", "test-results"} for part in path.parts):
            continue
        content = path.read_bytes()
        digest = hashlib.sha256(content).hexdigest()
        if digest in old_hashes:
            failures.append(f"exact copy: {path.relative_to(ROOT)} == {old_hashes[digest]}")
        if path.suffix in SOURCE_SUFFIXES:
            overlap = windows(tokens(content)) & old_windows
            if overlap:
                failures.append(f"shared {WINDOW}-token source sequence: {path.relative_to(ROOT)}")

    runtime_roots = [ROOT / "app", ROOT / "web", ROOT / "ops", ROOT / ".github"]
    for runtime_root in runtime_roots:
        for path in runtime_root.rglob("*"):
            if not path.is_file() or any(part in {"node_modules", "dist", "test-results", "playwright-report"} for part in path.parts):
                continue
            if path.suffix.lower() not in {".py", ".ts", ".tsx", ".js", ".mjs", ".css", ".html", ".yml", ".yaml", ".sh", ".json"}:
                continue
            text = path.read_text(encoding="utf-8", errors="ignore")
            if "frontend/" in text or "backend/app/" in text:
                failures.append(f"historical runtime path reference: {path.relative_to(ROOT)}")

    if failures:
        print("Clean-generation check failed:\n" + "\n".join(failures), file=sys.stderr)
        return 1
    print(f"Clean-generation check passed against {commit} ({boundary['frontend_tree']}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
