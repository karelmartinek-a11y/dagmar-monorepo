#!/usr/bin/env bash
set -euo pipefail
python -m pip install --disable-pip-version-check pip==26.0
python -m pip install --require-hashes -r requirements-dev.lock
PYTHONPATH=. python -m pytest "$@"
