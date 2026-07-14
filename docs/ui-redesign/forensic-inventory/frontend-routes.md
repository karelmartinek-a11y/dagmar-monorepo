# Frontendové routy a klientské workflow

Souhrn vznikl z `frontend/src/App.tsx`, API klientů v `frontend/src/api/` a hlavních stránek v `frontend/src/pages/`.

## Kořenová mapa tras

| Route | Stránka | Role | Hlavní režim auth |
| --- | --- | --- | --- |
| `/` | redirect na `/app` | veřejné | bez auth |
| `/app` | `EmployeePage` | zaměstnanec | bearer token v `localStorage` |
| `/reset` | `PortalResetPage` | zaměstnanec s reset tokenem | bez session |
| `/integration-api` | `IntegrationApiDocsPage` | partner / veřejnost | bez auth |
| `/admin/login` | `AdminLoginPage` | admin | session bootstrap |
| `/admin/prehled` | `AdminOverviewPage` | admin | session + CSRF |
| `/admin/users` | `AdminUsersPage` | admin | session + CSRF |
| `/admin/dochazka` | `AdminAttendanceSheetsPage` | admin | session + CSRF |
| `/admin/plan-sluzeb` | `AdminShiftPlanPage` | admin | session + CSRF |
| `/admin/export` | `AdminExportPage` | admin | session |
| `/admin/tisky` | `AdminPrintsPage` | admin | session |
| `/admin/tisky/preview` | `AdminPrintPreviewPage` | admin | session |
| `/admin/settings` | `AdminSettingsPage` | admin | session + CSRF |
| `/admin/instances` | `AdminInstancesPage` | admin | session + CSRF |
| `/admin/integrace` | `AdminIntegrationsPage` | admin | session + CSRF |

## Klientská autentizace a stav

### Zaměstnanec

- login přes `portalLogin()` na `POST /api/v1/portal/login`
- bearer token je uložen v `localStorage` pod `dagmar_portal_auth_v2`
- perzistence ukládá:
  - token
  - `employmentId`
  - `displayName`
  - dostupné úvazky
- klient nepoužívá cookie session

### Admin

- CSRF se načítá z `GET /api/v1/admin/csrf`
- token se čte z cookie `dagmar_csrf_token` nebo `sessionStorage`
- session je cookie-based
- state-changing requesty posílají `X-CSRF-Token`

## Klíčové klientské moduly

| Modul | Soubor | Účel |
| --- | --- | --- |
| API client | `frontend/src/api/client.ts` | společný fetch wrapper, JSON chyby, retry |
| Portal auth store | `frontend/src/state/portalAuthStore.ts` | lokální perzistence zaměstnance |
| Portal API | `frontend/src/api/portal.ts` | login a reset hesla |
| Attendance API | `frontend/src/api/attendance.ts` | zaměstnanecká docházka a day status |
| Admin API | `frontend/src/api/admin.ts` | uživatelé, úvazky, SMTP, settings, instances, integrace, export URL |
| Admin attendance API | `frontend/src/api/adminAttendance.ts` | měsíční matice, editace, lock/unlock |
| Admin shift plan API | `frontend/src/api/adminShiftPlan.ts` | plán směn, výběr úvazků, day status |

## Zjištěné funkční charakteristiky

- zaměstnanecká část pracuje s volbou `employment_id`
- admin docházka používá:
  - fulltext
  - filtry podle typu úvazku a stavu
  - přímou editaci v buňce
  - kontextové menu
  - konfliktní potvrzení při změně celodenního statusu
  - zámky měsíců
- admin plán služeb používá:
  - výběr aktivních zaměstnanců pro měsíc
  - tabulkovou editaci
  - day status konflikty
- uživatelé a úvazky obsahují:
  - reset hesla
  - unlock
  - konfliktní změny období úvazku
  - mazání úvazků s potvrzením navázaných dat
- integrace obsahují:
  - jednorázové zobrazení plaintext tokenu
  - detail klienta
  - scope profily
  - omezení na zaměstnance a úvazky
- `/integration-api` je veřejná dokumentační stránka, ne interaktivní konzole

## Klientské stavy, které jsou explicitně implementované

- loading
- error
- empty
- success / toast
- disabled
- locked
- conflict confirm
- offline fronta v zaměstnanecké části

## Rizikové body pro čistou generační náhradu

- nový frontend nesmí převzít stávající zdrojové soubory z `frontend/`
- ale musí znovu pokrýt stejné funkce:
  - login a reset
  - volbu úvazku
  - docházku zaměstnance
  - plán a status dne
  - admin shell
  - tabulkové moduly docházky a plánu
  - exporty, tisky a preview
  - zařízení
  - integrace
  - veřejnou integrační dokumentaci
