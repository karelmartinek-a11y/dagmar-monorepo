# KájovoDagmar

Produkční monorepozitář docházkového systému KájovoDagmar pro `https://dagmar.hcasc.cz`.

## Zdroj pravdy

Normativní cílový stav je přesně uložen v [docs/SSOT_CURRENT.md](docs/SSOT_CURRENT.md). Aktivní zdrojový kód a backendový kontrakt jsou autoritou pro baseline fakta, která SSOT výslovně nenahrazuje. Rozpor cílového SSOT s aktuální implementací je implementační mezera, nikoli důvod požadavek oslabit nebo označit za historický.

Strojově čitelný manifest je v [docs/current-state-manifest.yaml](docs/current-state-manifest.yaml). Staré aktivní UI a dokumentační alternativy se odstraňují; historii nahrazených řešení uchovává Git.

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
- úvazky používají pouze `WORK_CONTRACT`, `DPP_DPC`, `TASK_SHIFT_BASED` a `EXTERNAL_HOURLY`; profil je uložený na konkrétním `Employment`
- docházka používá neomezené chronologické `IN`/`OUT` průchody a automatické přestávky jsou fyzické, neretroaktivní eventy
- backend je jedinou autoritou časových intervalů a kategorií; denní desetiny se matematicky zaokrouhlují a měsíce sčítají z denních desetin
- viditelné hodinové sloupce dodává backend v `display_metrics` podle aktuálního profilu konkrétního úvazku; frontend, tisk, CSV, ZIP a PDF pouze interpretují dodaná čísla
- zaměstnanec i admin vybírají ve zvoleném měsíci jen aktivní úvazky aktivních uživatelů s překryvem období; docházka a plán mají samostatné zámky
- administrátor může potvrzenou idempotentní akcí „Přidej pauzy“ fyzicky doplnit chybějící `OUT`/`IN` eventy do historické docházky
- docházkový tisk jednotlivého úvazku používá jeden A4 list na výšku podle schválené předlohy; náhled i browserové PDF sdílejí stejnou kompozici
- neexistuje pracovní fond ani bilanční porovnávání s fondem nebo plánem

## Lokální ověření

### Backend a repozitář

```bash
python3.12 -m venv .venv
.venv/bin/pip install pip==26.0
.venv/bin/pip install --require-hashes -r requirements-dev.lock
.venv/bin/python -m compileall -q app
.venv/bin/ruff check app tests scripts
.venv/bin/mypy app
.venv/bin/alembic heads
.venv/bin/pytest -q
.venv/bin/python scripts/check_repo_invariants.py
.venv/bin/python scripts/check_broad_exceptions.py
.venv/bin/python scripts/generate_current_state_manifest.py --check
.venv/bin/python scripts/check_python_lock.py
.venv/bin/python scripts/check_security_policy.py
.venv/bin/pip-audit -r requirements-prod.lock
.venv/bin/bandit -r app scripts -ll
git diff --exit-code
git status --short
```

### Frontend

```bash
cd web
npm ci
npm audit --package-lock-only --audit-level=moderate
npm run check:branding
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
git diff --exit-code
git status --short
```
