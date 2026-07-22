# KájovoDagmar

Produkční monorepozitář docházkového systému KájovoDagmar pro `https://dagmar.hcasc.cz`.

## Struktura

- `app/` FastAPI backend
- `alembic/` databázové migrace
- `tests/` backendové a repozitářové regresní kontroly
- `scripts/` validační a údržbové skripty
- `web/` Vite, React a TypeScript frontend
- `docs/` aktuální technická a provozní dokumentace
- `ops/` Nginx a systemd konfigurace

## Aktuální kontrakt

- kanonická doména: `https://dagmar.hcasc.cz`
- API base path: `/api/v1/`
- backend bind: `127.0.0.1:8101`
- PostgreSQL publish address: `127.0.0.1:5433`
- admin autentizace: session cookie + CSRF
- zaměstnanecká autentizace: bearer token
- integrační autentizace: samostatný `dgi_` bearer token

Aktuální technický přehled je v [docs/SSOT_CURRENT.md](docs/SSOT_CURRENT.md) a strojově čitelný manifest v [docs/current-state-manifest.yaml](docs/current-state-manifest.yaml).

## Lokální ověření

### Backend

```bash
python3.11 -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/pytest
.venv/bin/ruff check app tests scripts
.venv/bin/mypy app
.venv/bin/alembic heads
.venv/bin/python scripts/check_repo_invariants.py
.venv/bin/python scripts/generate_current_state_manifest.py --check
```

### Frontend

```bash
cd web
npm ci
npm run check:branding
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```
