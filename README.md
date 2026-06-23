# Dagmar monorepo

Tento repozitář sjednocuje aktuální stav projektů `dagmar-backend` a `dagmar-frontend` do jednoho monorepa bez funkční změny aplikace.

## Struktura

- `backend/` — FastAPI backend pro `dagmar.hcasc.cz`
- `frontend/` — Vite/React/TypeScript frontend pro `dagmar.hcasc.cz`
- `.github/workflows/` — monorepo workflow upravené pouze o pracovní adresáře, triggery a cesty
- `docs/monorepo-migration.md` — záznam nezbytných strukturálních změn

## Zdroj pravdy

Obsah `backend/` byl importován z `karelmartinek-a11y/dagmar-backend`.
Obsah `frontend/` byl importován z `karelmartinek-a11y/dagmar-frontend`.

Historie obou projektů je zachovaná pomocí `git subtree`.

## Lokální práce

### Backend

```bash
cd backend
python -m pip install -e .[dev]
pytest
ruff check app
mypy app
```

### Frontend

```bash
cd frontend
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

## Produkční invarianty

- kanonická doména zůstává `dagmar.hcasc.cz`
- API base path zůstává `/api/v1/`
- backend bind zůstává `127.0.0.1:8101`
- PostgreSQL zůstává publikovaná jen na `127.0.0.1:5433`
- admin zůstává na session cookie + CSRF
- zaměstnanecká část zůstává na bearer tokenu

Detaily k čistě strukturálním změnám jsou v `docs/monorepo-migration.md`.
