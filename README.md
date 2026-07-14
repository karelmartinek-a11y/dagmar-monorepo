# KájovoDagmar

Produkční zdrojový kód docházkového systému KájovoDagmar pro `https://dagmar.hcasc.cz`.

## Struktura

- `app/` — FastAPI backend
- `alembic/` — verzované databázové migrace
- `tests/` — backendové testy
- `web/` — čistý Vite/React/TypeScript frontend
- `docs/` — provozní, integrační a forenzní dokumentace

## Zdroj pravdy

Historie původních projektů zůstává dohledatelná v git historii. Generační hranice nového frontendu je popsána v `docs/ui-redesign/forensic-inventory/boundary.json`.

## Lokální práce

### Backend

```bash
python3.11 -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/pytest
.venv/bin/ruff check app tests scripts
.venv/bin/mypy app
.venv/bin/alembic heads
```

### Frontend

```bash
cd web
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Skutečné integrační E2E se spouští v CI proti izolovanému PostgreSQL a lokálnímu FastAPI; seed skript odmítne jakoukoli databázi, která není explicitní lokální E2E cíl.

## Produkční invarianty

- kanonická doména zůstává `dagmar.hcasc.cz`
- API base path zůstává `/api/v1/`
- backend bind zůstává `127.0.0.1:8101`
- PostgreSQL zůstává publikovaná jen na `127.0.0.1:5433`
- admin zůstává na session cookie + CSRF
- zaměstnanecká část zůstává na bearer tokenu

Detaily k čistě strukturálním změnám jsou v `docs/monorepo-migration.md`.
