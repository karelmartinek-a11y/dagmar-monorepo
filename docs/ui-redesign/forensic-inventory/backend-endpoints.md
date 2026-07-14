# Backendové endpointy a workflow

Souhrn vznikl před restrukturalizací z kódu, který je nyní v `app/main.py` a routerech pod `app/api/v1/`.

## Globální invarianty

- hlavní aplikace: `app/main.py`
- health: `GET /api/v1/health`
- kompatibilní health alias: `GET /api/health`
- build metadata: `GET /api/version`
- časová autorita: `GET /api/v1/time`
- JSON chyby jsou sjednocené přes centrální handlery
- integrační namespace má samostatný audit, request ID a vlastní error kontrakt

## Autentizace a role

| Režim | Použití | Poznámka |
| --- | --- | --- |
| Session cookie + CSRF | `/api/v1/admin/*` | stavové změny vyžadují CSRF |
| Bearer `dg_` instance token | zaměstnanecké `/api/v1/attendance`, `/api/v1/shift-plan/day-status` | navázáno na zaměstnance a jeho instanci |
| Bearer `dgi_` integrační token | `/api/v1/integration/*` | oddělené scopes a audit |
| Bez přihlášení | health, verze, veřejná registrace instancí | pouze omezené veřejné routy |

## Přehled routerů

| Router | Prefix / klíčové cesty | Soubor | Režim |
| --- | --- | --- | --- |
| Attendance | `/api/v1/attendance` | `backend/app/api/v1/attendance.py` | employee bearer |
| Employee day status | `/api/v1/shift-plan/day-status` | `backend/app/api/v1/shift_plan.py` | employee bearer |
| Portal auth | `/api/v1/portal/login`, `/api/v1/portal/reset` | `backend/app/api/v1/portal_auth.py` | anonymous |
| Admin auth | `/api/v1/admin/login`, `/api/v1/admin/csrf`, `/api/v1/admin/logout`, `/api/v1/admin/me`, `/api/v1/admin/forgot-password` | `backend/app/api/v1/admin_auth.py` | anonymous/session |
| Admin users | `/api/v1/admin/users*` | `backend/app/api/v1/admin_users.py` | admin session + CSRF for writes |
| Admin employments | `/api/v1/admin/users/{user_id}/employments`, `/api/v1/admin/employments/{employment_id}` | `backend/app/api/v1/admin_employments.py` | admin session + CSRF for writes |
| Admin attendance | `/api/v1/admin/attendance`, `/api/v1/admin/attendance/month`, `/lock`, `/unlock` | `backend/app/api/v1/admin_attendance.py` | admin session + CSRF for writes |
| Admin shift plan | `/api/v1/admin/shift-plan`, `/api/v1/admin/day-status`, `/api/v1/admin/shift-plan/selection` | `backend/app/api/v1/admin_shift_plan.py` | admin session + CSRF for writes |
| Admin export | `/api/v1/admin/export` | `backend/app/api/v1/admin_export.py` | admin session |
| Admin settings | `/api/v1/admin/settings` | `backend/app/api/v1/admin_settings.py` | admin session + CSRF for writes |
| Admin SMTP | `/api/v1/admin/smtp` | `backend/app/api/v1/admin_smtp.py` | admin session + CSRF for writes |
| Admin instances | `/api/v1/admin/instances*` | `backend/app/api/v1/admin_instances.py` | admin session + CSRF for writes |
| Admin integrations | `/api/v1/admin/integrations/clients*` | `backend/app/api/v1/admin_integrations.py` | admin session + CSRF for writes |
| Public instances | `/api/v1/instances/register`, `/api/v1/instances/{id}/status`, `/claim-token` | `backend/app/api/v1/public_instances.py` | anonymous / device bootstrap |
| Integration API | `/api/v1/integration/*` | `backend/app/api/v1/integration.py` | integration bearer |

## Kritické workflow

### Zaměstnanec

1. `POST /api/v1/portal/login`
2. `GET /api/v1/attendance?employment_id&year&month`
3. `PUT /api/v1/attendance`
4. `PUT /api/v1/shift-plan/day-status`

Hlavní pravidla:

- login vyžaduje aktivního uživatele role `employee`, heslo, instanci a dostupný `employment_id`
- opakované neplatné pokusy spouští lockout `423`
- zápis docházky respektuje období úvazku, zámky a zákaz změny historicky uložených časů

### Administrace

1. `GET /api/v1/admin/csrf`
2. `POST /api/v1/admin/login`
3. `GET /api/v1/admin/me`
4. následné admin GET/PUT/POST/DELETE podle modulu

Hlavní pravidla:

- cookie a CSRF jsou povinné
- admin účty jsou centralizované mimo portal users
- změny úvazků a mazání úvazků mohou vracet `409` s detailními konflikty navázaných dat

### Integrace

Hlavní read endpointy:

- `GET /api/v1/integration/health`
- `GET /api/v1/integration/employments`
- `GET /api/v1/integration/shift-plan`
- `GET /api/v1/integration/attendances`
- `GET /api/v1/integration/punches`
- `GET /api/v1/integration/locks`
- `GET /api/v1/integration/openapi.json`

Write endpointy:

- `POST /api/v1/integration/attendances`
- `PATCH /api/v1/integration/attendances/{attendance_id}`
- `DELETE /api/v1/integration/attendances/{attendance_id}`

Hlavní pravidla:

- list endpointy vrací `data` a `pagination`
- časová okna `shift-plan`, `attendances`, `punches` mají limit 31 dní
- zapisuje se pouze docházka svázaná s `employment_id`

## Uzavřené návaznosti na restrukturalizaci

- `app/main.py` čte release verzi ze stabilního `/opt/dagmar/backend/backend-version.json` nebo kořene serverového checkoutu.
- Jednotný workflow nasazuje kořenový backend a `web/dist/` se shodným commitem.
- `tests/test_forbidden_domain.py` ověřuje kořenový backend i nový `web/`.
