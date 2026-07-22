# KájovoDagmar

Produkční monorepozitář docházkového systému KájovoDagmar pro `https://dagmar.hcasc.cz`.

## Zdroj pravdy

Nejvyšší autoritou je aktuální funkční zdrojový kód v tomto checkoutu. Když se dokumentace nebo testy rozcházejí s kódem, nejprve se ověřuje aktivní implementace a teprve potom se opravuje doprovodný artefakt.

Kanonický technický přehled je v [docs/SSOT_CURRENT.md](docs/SSOT_CURRENT.md) a strojově čitelný manifest v [docs/current-state-manifest.yaml](docs/current-state-manifest.yaml).

## Aktuální struktura

- `app/` FastAPI backend
- `alembic/` Alembic migrace
- `tests/` backendové a repozitářové regresní kontroly
- `scripts/` validační, generační a provozní skripty
- `web/` Vite, React a TypeScript frontend
- `web/tests/` frontendové unit a E2E testy
- `docs/` aktuální technická a provozní dokumentace
- `.github/workflows/` GitHub CI/CD a produkční deploy
- `ops/` Nginx a systemd konfigurace

## Runtime invarianty

- kanonická doména: `https://dagmar.hcasc.cz`
- API namespace: `/api/v1/`
- backend bind: `127.0.0.1:8101`
- PostgreSQL publish address: `127.0.0.1:5433`
- admin autentizace: session cookie + CSRF
- zaměstnanecká autentizace: bearer token
- integrační autentizace: samostatný `dgi_` bearer token
- docházka, plán služeb, zámky a exporty jsou vedené podle `employment_id`
- časová autorita: `Europe/Prague`

## Lokální ověření

### Backend a repozitář

```bash
python3.11 -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/python -m compileall -q app
.venv/bin/ruff check app tests scripts
.venv/bin/mypy app
.venv/bin/alembic heads
.venv/bin/pytest -q
.venv/bin/python scripts/check_repo_invariants.py
.venv/bin/python scripts/generate_current_state_manifest.py --check
git diff --exit-code
git status --short
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
git diff --exit-code
git status --short
```
