# SSOT CURRENT

## Monorepo

Repozitář obsahuje FastAPI backend v `app/`, Alembic migrace v `alembic/`, backendové a repozitářové testy v `tests/`, validační skripty v `scripts/`, frontend ve `web/`, aktuální dokumentaci v `docs/` a provozní konfiguraci v `ops/`.

## Produkční runtime

Produkční doména je `https://dagmar.hcasc.cz`. API běží pod `/api/v1/`. Backend naslouchá na `127.0.0.1:8101`. PostgreSQL je publikovaná pouze na `127.0.0.1:5433`. Reverse proxy a TLS obsluhuje Nginx. Nasazení řídí `.github/workflows/ci-cd.yml`.

## Frontend routes

Aktivní veřejné routy jsou `/`, `/app`, `/reset`, `/integration-api`, `/admin/login`, `/admin`, `/admin/prehled`, `/admin/users`, `/admin/dochazka`, `/admin/plan-sluzeb`, `/admin/export`, `/admin/tisky`, `/admin/tisky/preview`, `/admin/settings`, `/admin/ucet` a `/admin/integrace`. Routing definuje `web/src/App.tsx`.

## Backend routes

Aktivní API registruje `app/main.py` z routerů v `app/api/v1/`. Zaměstnanecká část používá `/api/v1/portal/login`, `/api/v1/portal/reset`, `/api/v1/attendance`, `/api/v1/shift-plan` a `/api/v1/shift-plan/day-status`. Administrace používá `/api/v1/admin/*` endpointy pro login, CSRF, přehled, uživatele, úvazky, docházku, zámky, plán služeb, export, nastavení, SMTP a integrační klienty. Veřejná integrační dokumentace běží na `/integration-api` a integrační API na `/api/v1/integration/*`. Zdravotní a verzační endpointy jsou `/api/v1/health`, `/api/health`, `/api/version` a `/api/v1/time`.

## Authentication

Administrace používá session cookie `dagmar_admin_session` a CSRF hlavičku `X-CSRF-Token`. Zaměstnanecká část používá bearer token vrácený z `app/api/v1/portal_auth.py` jako `instance_token`. Integrační API používá samostatné bearer tokeny s prefixem `dgi_`. Externí Google a Apple login v `app/api/v1/external_auth.py` ověřuje pouze už propojené interní účty.

## Permissions And Data Scope

Docházka, plán služeb, zámky a exporty jsou v backendu i frontendu vázané na `employment_id`. Zaměstnanec po loginu vybírá aktivní úvazek z `available_employments`. Admin endpointy vyžadují session autentizaci. Integrační endpointy vynucují scopes a filtrovaný rozsah zaměstnanců a úvazků.

## Main Components

`app/main.py` skládá aplikaci, middleware a routery. `app/config.py` drží runtime konfiguraci a doménové invarianty. `app/services/` obsahuje pracovní logiku pro docházku, externí auth, zámky, čas v Praze a připomínky. `web/src/pages/EmployeePage.tsx` obsluhuje zaměstnaneckou část. `web/src/pages/AdminMatrixPages.tsx`, `web/src/pages/AdminOperationsPages.tsx`, `web/src/pages/AdminUsersPage.tsx`, `web/src/pages/AdminOverviewPage.tsx` a `web/src/pages/AdminAccountPage.tsx` obsluhují administraci. `web/src/api/client.ts` je jediný sdílený HTTP klient frontendu.

## Shared Change Rules

Při změně API se současně upravuje backend, frontend, testy, manifest a relevantní dokumentace. Při změně sdílených frontendových částí se ověřují všichni spotřebitelé v `web/src/pages/` a `web/src/components/`. Při změně autentizace se ověřují session cookie, CSRF, bearer tokeny, oprávnění a chybové stavy.

## Regression Checks

Povinné kontroly jsou `pytest`, `ruff check app tests scripts`, `mypy app`, `python scripts/check_repo_invariants.py`, `python scripts/generate_current_state_manifest.py --check`, `npm run check:branding`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` a `npm run test:e2e`. Testy `tests/test_current_state_manifest.py`, `tests/test_forbidden_domain.py`, `tests/test_admin_auth.py`, `tests/test_integration_api.py`, `web/tests/api.test.ts`, `web/tests/admin-pages.test.tsx`, `web/tests/employee-page-editing.test.tsx` a Playwright scénáře v `web/tests/e2e/` chrání hlavní kontrakty.
