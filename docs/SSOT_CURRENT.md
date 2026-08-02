# SSOT CURRENT

## Rozsah

Tento dokument popisuje pouze současný implementovaný stav monorepozitáře `karelmartinek-a11y/dagmar-monorepo`. Pokud se text rozchází s aktivním kódem, přednost má aktuální kód, routery, migrace a produkční chování.

## Struktura monorepa

- `app/` FastAPI backend
- `alembic/` Alembic migrace
- `tests/` backendové a repozitářové regresní testy
- `scripts/` validační, generační a provozní skripty
- `web/` Vite, React a TypeScript frontend
- `web/tests/` frontendové unit a E2E testy
- `docs/` aktuální technická a provozní dokumentace
- `.github/workflows/` GitHub CI/CD a produkční deploy
- `ops/` Nginx a systemd konfigurace

## Produkční runtime

- produkční doména: `https://dagmar.hcasc.cz`
- aktivní API namespace: `/api/v1/`
- backend bind: `127.0.0.1:8101`
- PostgreSQL publish address: `127.0.0.1:5433`
- reverse proxy a TLS: Nginx
- nasazení řídí `.github/workflows/ci-cd.yml`
- časová autorita: `Europe/Prague`

## Frontend routy

Aktivní routy definuje [web/src/App.tsx](../web/src/App.tsx):

- `/`
- `/app`
- `/reset`
- `/integration-api`
- `/admin/login`
- `/admin`
- `/admin/prehled`
- `/admin/users`
- `/admin/dochazka`
- `/admin/plan-sluzeb`
- `/admin/skupiny-uvazku`
- `/admin/export`
- `/admin/tisky`
- `/admin/tisky/preview`
- `/admin/settings`
- `/admin/ucet`
- `/admin/integrace`

## Backend endpointy a auth model

Aktivní API registruje [app/main.py](../app/main.py) z routerů v `app/api/v1/` a z integračního namespace.

- veřejné endpointy zahrnují `/api/v1/health`, `/api/health`, `/api/version`, `/api/v1/time`, `/api/v1/portal/login`, `/api/v1/portal/reset`, `/api/v1/auth/providers` a `/api/v1/auth/result`
- zaměstnanecká část používá bearer `instance_token` a endpointy `/api/v1/attendance`, `/api/v1/attendance/employments`, `/api/v1/attendance/events*`, `/api/v1/attendance/day-status`, `/api/v1/shift-plan`, `/api/v1/shift-plan/day-status`, `/api/v1/shift-plan/groups*` a `/api/v1/portal/auth-methods*`
- administrace používá session cookie `dagmar_admin_session`, CSRF hlavičku `X-CSRF-Token` a `/api/v1/admin/*` endpointy pro login, uživatele, úvazky, docházkové eventy, plán služeb, zámky, exporty, SMTP a integrační klienty
- integrační API používá bearer tokeny s prefixem `dgi_` a běží na `/api/v1/integration/*`
- veřejná integrační dokumentace je dostupná na `/integration-api`

## Scope dat a hlavní invarianty

- docházka, plán služeb, zámky a exporty jsou vedené podle `employment_id`
- existují pouze typy `WORK_CONTRACT`, `DPP_DPC`, `TASK_SHIFT_BASED` a `EXTERNAL_HOURLY`; všechna časová nastavení patří konkrétnímu `Employment`
- docházka je neomezená posloupnost chronologických `IN`/`OUT` eventů; intervaly se párují přes půlnoc i hranice měsíců
- backend je jedinou autoritou časové matematiky; denní hodnoty se matematicky zaokrouhlují na desetiny a měsíční součty vznikají součtem denních desetin
- backend synchronizuje `EmploymentDailyTimeMetric` po změně eventu, plánu nebo profilu; běžná mutace přepočítá jen skutečně dotčené měsíce, zatímco změna profilu a provozní backfill pokryjí celou historii. Aktivní hodinová metrika bez zdrojových faktů má backendovou nulu. Frontend, tisky a exporty řídí sloupce pouze pomocí `display_metrics` a dodané hodnoty nepřepočítávají
- `WORK_CONTRACT` má povinnou celkovou a noční metriku; ostatní zvláštní metriky jsou volitelné. `DPP_DPC` a `EXTERNAL_HOURLY` mají všechny metriky volitelné a `TASK_SHIFT_BASED` nemá hodinové metriky
- přestávky se při běžném provozu fyzicky vkládají při uzavření nového intervalu; potvrzené adminské „Přidej pauzy“ je idempotentně doplní také do historických uzavřených intervalů bez hromadného undo a započítá přitom délku už existujících ručních pauz
- zaměstnanecké i adminské měsíční výběry vyžadují aktivního uživatele, aktivní úvazek a překryv období úvazku se zvoleným měsícem
- docházka a plán služeb mají nezávislé měsíční zámky; celodenní nepřítomnosti podporují dovolenou, nemoc, volno a paragraf
- noční plán musí být platný a odemčený ve všech dnech a měsících, do kterých zasahuje, a nesmí se překrývat s jinou směnou stejného úvazku. Všechny časové mutace jednoho úvazku serializuje řádkový databázový zámek; po jeho získání se pod zámkem vlastníka znovu ověří aktivita úvazku i uživatele. Pokračování z předchozího dne backend označí jako carryover; frontend je nezapisuje jako nový plán následujícího dne a při další nepřekrývající se směně zobrazí oba intervaly i správnou plánovou nápovědu každého odchodu
- deploy zastaví starý backend před migrací, provede Alembic upgrade, backfill denních metrik a čistý `--check`, a až potom atomicky aktivuje nový release. Po zahájení změny schématu žádná chybová větev nespustí starý backend; při neúspěchu zůstane služba zastavená, dokud není dostupný kompatibilní release
- eventová mutace kontroluje zámky všech měsíců dotčených změnou intervalu a nelze jí vytvořit docházku v dni s celodenní nepřítomností
- pracovní fond a bilanční porovnávání nejsou aktivní součástí systému
- zaměstnanec po loginu dostává bearer `instance_token`, `employment_id` a `available_employments`
- zaměstnanec může pracovat jen s úvazkem, ke kterému má přístup
- integrační klienti mají scope a datový rozsah filtrovaný podle zaměstnanců a úvazků
- externí Google a Apple login slouží jen k ověření již propojeného interního účtu

## Hlavní komponenty

- `app/main.py` skládá aplikaci, middleware, health a version endpointy a registruje routery
- `app/config.py` drží runtime konfiguraci a doménové invarianty
- `app/services/attendance_reminders.py` zajišťuje background připomínky
- `app/services/external_auth.py` zajišťuje Google a Apple auth toky
- `web/src/api/client.ts` je sdílený frontendový HTTP klient
- `web/src/pages/EmployeePage.tsx` obsluhuje zaměstnaneckou část
- `web/src/pages/AdminOverviewPage.tsx`, `web/src/pages/AdminUsersPage.tsx`, `web/src/pages/AdminMatrixPages.tsx`, `web/src/pages/AdminOperationsPages.tsx` a `web/src/pages/AdminAccountPage.tsx` obsluhují administraci
- `web/src/pages/IntegrationDocsPage.tsx` obsluhuje veřejnou integrační dokumentaci

## Povinné změnové uzavření

Při změně API se současně upravuje backend, frontend, testy, manifest a relevantní dokumentace. Při změně sdílených částí se ověřují všichni konzumenti. Při změně autentizace se ověřují session cookie, CSRF, bearer tokeny, oprávnění a chybové stavy.

## Povinné kontroly

Backend a repozitář:

```bash
python -m compileall -q app
ruff check app tests scripts
mypy app
alembic heads
pytest -q
python scripts/check_repo_invariants.py
python scripts/generate_current_state_manifest.py --check
git diff --exit-code
git status --short
```

Frontend z `web/`:

```bash
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
