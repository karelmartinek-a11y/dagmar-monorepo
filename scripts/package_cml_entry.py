"""Package only the new CML delivery marker; the UI is in the backend wheel."""

from __future__ import annotations

import argparse
import gzip
import io
import json
import re
import tarfile
from pathlib import Path


def build_entry(commit: str, output: Path) -> None:
    if re.fullmatch(r"[0-9a-f]{40}", commit) is None:
        raise ValueError("A full source commit is required")
    marker = {
        "contract": "kajovo-web-ui/1",
        "section": "dochazka",
        "central_entry": "https://kajovocml.hcasc.cz/#dochazka",
        "ui_delivery": "signed_backend_wheel",
        "source_commit": commit,
    }
    data = (json.dumps(marker, sort_keys=True, indent=2) + "\n").encode()
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w") as archive:
        info = tarfile.TarInfo("cml-entry.json")
        info.size, info.mode, info.mtime = len(data), 0o644, 0
        archive.addfile(info, io.BytesIO(data))
    with output.open("xb") as handle:
        handle.write(gzip.compress(buffer.getvalue(), mtime=0))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    build_entry(args.commit, args.output)


if __name__ == "__main__":
    main()
