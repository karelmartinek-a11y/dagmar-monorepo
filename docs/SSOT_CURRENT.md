# KájovoDagmar — kanonická reprodukční SSOT

## Identita, auditní základ a autorita dokumentu

Tento jediný dokument je kanonický normativní zdroj pravdy pro úplný požadovaný stav monorepozitáře `karelmartinek-a11y/dagmar-monorepo`. Je určen tak, aby jiný implementátor nebo generátor mohl bez znalosti původní konverzace, historie projektu a nezdokumentovaných souvislostí vytvořit funkčně, datově, bezpečnostně, provozně a uživatelsky ekvivalentní systém.

### Auditní základ

- auditovaný repozitář: `karelmartinek-a11y/dagmar-monorepo`;
- auditovaná větev: `main`;
- auditovaný commit: `39db1556f035139bd680676509d49d6e2d89a6aa`;
- auditovaný stav vznikl 2. srpna 2026 a forenzní rekonstrukce byla provedena 3. srpna 2026;
- rekonstruované zdroje zahrnují aktivní backend, frontend, databázové modely, API, služby, testy, CI/CD, provozní konfiguraci, README, AGENTS a strojový current-state manifest;
- audit je statický audit zdrojového kódu přes GitHub na uvedeném SHA. Lokální checkout nebyl v auditním prostředí dostupný, proto tento dokument netvrdí, že při jeho tvorbě byly znovu spuštěny testy nebo produkční runtime. Povinné příkazy pro takové ověření jsou normativně uvedeny níže;
- závěrečný adversariální průchod byl proveden 3. srpna 2026. Při rozporu má přednost aktivně volaná implementace a její testy před komentářem, docstringem, dormantním helperem, generovaným manifestem nebo dřívějším shrnutím;
- tvrzení, které nebylo možné staticky doložit, nesmí být prezentováno jako baseline fakt. Je buď odstraněno, nebo výslovně označeno jako cílový požadavek, známá asymetrie či implementační blocker.

### Dvě vrstvy pravdy bez směšování

1. **Rekonstruovaný baseline** popisuje skutečně nalezené architektonické, datové, bezpečnostní a funkční chování na auditovaném commitu. Baseline je důkaz původu a ochrana proti ztrátě existujících funkcí.
2. **Kanonický cílový stav** je výsledný program, který má být implementován. Obsahuje celý baseline, pokud jej tento dokument výslovně nenahrazuje, a současně obsahuje schválené změny tabulkového UI, přímé editace, označení `PRŮCHOD`, responzivity, tisků a design gate.

Kde se baseline a cílový stav liší, cílový stav je normativní. Rozdíl se nesmí vyřešit zachováním paralelního starého řešení. Kde tento dokument změnu výslovně neurčuje, musí zůstat chování baseline zachováno. Interní doménové názvy `IN` a `OUT` zůstávají strojovým datovým kontraktem; jejich zobrazení člověku je zakázáno pravidly `PRŮCHOD`.

Po přijetí tohoto dokumentu do repozitáře platí:

- zdrojový kód, databázové schéma, API, frontend, testy, exporty, tisky, CI/CD, manifest a provozní dokumentace musí být uvedeny do souladu s tímto SSOT;
- rozpor aktivního kódu s tímto dokumentem je implementační mezera, nikoli důvod k oslabení nebo obejití požadavku;
- změnový celek, který tento SSOT zavádí, musí současně aktualizovat `README.md`, `AGENTS.md`, `docs/current-state-manifest.yaml` a všechny další artefakty, jejichž text nebo kontrolní pravidla by s novým stavem nebyly konzistentní;
- dokud nejsou splněny všechny funkční, vizuální, responzivní, tiskové a design-review podmínky uvedené níže, změna není uzavřená a nesmí být označena za hotovou.

Historii odstraněných nebo nahrazených řešení uchovává git. Aktivní dokumentace nesmí obsahovat paralelní, nejednoznačné nebo „dočasné“ alternativy současného kontraktu.

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

## Backend endpointy a autentizační model

Aktivní API registruje [app/main.py](../app/main.py) z routerů v `app/api/v1/` a z integračního namespace.

- veřejné endpointy zahrnují DB-independent liveness `/api/v1/health` a `/api/health`, databázovou a migrační `/api/v1/readiness`, `/api/version`, `/api/v1/time`, `/api/v1/portal/login`, `/api/v1/portal/reset`, `/api/v1/auth/providers` a `/api/v1/auth/result`;
- zaměstnanecký browser používá HttpOnly Secure SameSite=Lax cookie `dagmar_portal_session`; ne-browser instance klient může nadále použít explicitní bearer `dg_…`. Cookie-auth mutace vyžadují portálový synchronizer token z `/api/v1/portal/csrf`. Doménové endpointy jsou `/api/v1/attendance`, `/api/v1/attendance/employments`, `/api/v1/attendance/events*`, `/api/v1/attendance/day-status`, `/api/v1/shift-plan`, `/api/v1/shift-plan/day-status`, `/api/v1/shift-plan/groups*` a `/api/v1/portal/auth-methods*`;
- administrace používá session cookie `dagmar_admin_session`, CSRF hlavičku `X-CSRF-Token` a `/api/v1/admin/*` endpointy pro login, uživatele, úvazky, docházkové eventy, plán služeb, zámky, exporty, SMTP a integrační klienty;
- integrační API používá bearer tokeny s prefixem `dgi_` a běží na `/api/v1/integration/*`;
- veřejná integrační dokumentace je dostupná na `/integration-api`.

## Scope dat a hlavní doménové invarianty

- docházka, plán služeb, zámky a exporty jsou vedené podle `employment_id`;
- existují pouze typy `WORK_CONTRACT`, `DPP_DPC`, `TASK_SHIFT_BASED` a `EXTERNAL_HOURLY`; všechna časová nastavení patří konkrétnímu `Employment`;
- docházka je neomezená posloupnost chronologických `IN`/`OUT` eventů; intervaly se párují přes půlnoc i hranice měsíců;
- žádný nový UI layout, kompaktní matice, tisk ani export nesmí neomezenou posloupnost eventů redukovat, přepisovat na pevný počet databázových polí nebo zahazovat skryté eventy;
- backend je jedinou autoritou časové matematiky; denní hodnoty se matematicky zaokrouhlují na desetiny a měsíční součty vznikají součtem denních desetin;
- backend synchronizuje `EmploymentDailyTimeMetric` po změně eventu, plánu nebo profilu; běžná mutace přepočítá jen skutečně dotčené měsíce, zatímco změna profilu a provozní backfill pokryjí celou historii;
- aktivní hodinová metrika bez zdrojových faktů má backendovou nulu; frontend, tisky a exporty řídí sloupce pouze pomocí `display_metrics` a dodané hodnoty nepřepočítávají;
- `WORK_CONTRACT` má povinnou celkovou a noční metriku; ostatní zvláštní metriky jsou volitelné. `DPP_DPC` a `EXTERNAL_HOURLY` mají všechny metriky volitelné a `TASK_SHIFT_BASED` nemá hodinové metriky;
- přestávky se při běžném provozu fyzicky vkládají při uzavření nového intervalu; potvrzené adminské „Přidej pauzy“ je idempotentně doplní také do historických uzavřených intervalů bez hromadného undo a započítá přitom délku už existujících ručních pauz;
- zaměstnanecké i adminské měsíční výběry vyžadují aktivního uživatele, aktivní úvazek a překryv období úvazku se zvoleným měsícem;
- docházka a plán služeb mají nezávislé měsíční zámky; celodenní nepřítomnosti podporují dovolenou, nemoc, volno a paragraf;
- noční plán musí být platný a odemčený ve všech dnech a měsících, do kterých zasahuje, a nesmí se překrývat s jinou směnou stejného úvazku;
- všechny časové mutace jednoho úvazku serializuje řádkový databázový zámek; po jeho získání se pod zámkem vlastníka znovu ověří aktivita úvazku i uživatele;
- pokračování z předchozího dne backend označí jako carryover; frontend je nezapisuje jako nový plán následujícího dne a při další nepřekrývající se směně zobrazí oba intervaly i správnou plánovou nápovědu každého relevantního průchodu;
- eventová mutace kontroluje zámky všech měsíců dotčených změnou intervalu a nelze jí vytvořit docházku v dni s celodenní nepřítomností;
- pracovní fond a bilanční porovnávání nejsou aktivní součástí systému;
- browserový login vrací pouze display name, `employment_id` a `available_employments`; credential je vydán výhradně jako HttpOnly cookie a `/api/v1/portal/session` obnovuje bezpečná metadata po reloadu;
- zaměstnanec může pracovat jen s úvazkem, ke kterému má přístup;
- integrační klienti mají endpointové scopes a jednotně vynucený deny-by-default datový rozsah pro seznamy i přímé ID operace;
- externí Google a Apple login slouží jen k ověření již propojeného interního účtu.


## Architektonický kontext a hranice systému

### Účel systému

KájovoDagmar je produkční docházkový a směnový systém pro jednu organizaci. Spravuje zaměstnance, jejich jednotlivé úvazky, skutečnou docházku, plán služeb, celodenní stavy, měsíční zámky, hodinové metriky, tiskové a exportní výstupy, přihlašovací metody, integrační klienty, upozornění a provozní nasazení. Základní datovou hranicí není osoba, ale konkrétní `employment_id`.

### Aktéři

| Aktér | Autentizace | Rozsah |
|---|---|---|
| Nepřihlášený návštěvník | žádná | health, verze, serverový čas, registrace/status zařízení, login/reset, seznam externích providerů, veřejná integrační dokumentace |
| Zaměstnanec | browserová HttpOnly cookie + CSRF pro mutace; explicitní bearer pouze pro non-browser instanci | vlastní dostupné úvazky, docházka, plán, skupinový plán, denní stavy, vlastní externí přihlašovací metody |
| Administrátor | podepsaná admin cookie; u mutací navíc CSRF | uživatelé, úvazky, docházka, plán, skupiny, zámky, exporty, tisky, SMTP, integrace, adminský účet |
| Integrační klient | bearer token `dgi_…` | endpointové scopes a jednotně runtime vynucený deny-by-default datový rozsah |
| Background reminder worker | interní proces backendu | vyhodnocení plánů a chybějících průchodů, odeslání e-mailů, idempotentní evidence |
| Měsíční auto-lock timer | systemd timer / interní skript | jednorázové uzamčení plánu aktivních úvazků v aktuálním měsíci |
| CI/CD | GitHub Actions | úplná validace, sestavení artefaktů a deterministický produkční deploy |

### Zakázané rozšíření scope

- systém není mzdový systém;
- pracovní fond, saldo proti fondu a bilanční porovnávání nejsou aktivní funkcí;
- Google/Apple login nevytváří účty a nemapuje role; ověřuje pouze již propojenou interní identitu;
- skupina úvazků je výhradně sdílení plánu služeb, nikoli společný vlastník docházky nebo oprávnění;
- frontend, tisk ani export nesmějí přepočítávat hodinové metriky;
- žádná UI změna nesmí změnit `employment_id` na implicitní osobní scope.

## Technologický a build kontrakt

### Backend

- Python `>=3.11`;
- FastAPI, Pydantic 2, Uvicorn worker pod Gunicorn;
- SQLAlchemy 2 a Alembic;
- PostgreSQL přes `psycopg`;
- přímé `argon2-cffi` pro nové password/token hashe a přímé `bcrypt` pouze pro ověření a následný rehash historických hesel; `itsdangerous` a HMAC pro podepsané hodnoty, PyJWT a `cryptography` pro OIDC a tajemství;
- `slowapi` a vlastní integrační rate limiting;
- `httpx` pro externí HTTP;
- Pillow pro serverové PDF plánu služeb;
- pytest, Ruff a mypy jako povinné validační nástroje;
- package metadata: `kajovodagmar`, verze `1.0.0`, proprietary license.

### Frontend

- Node.js `>=22`;
- React 18, TypeScript a Vite 7;
- TanStack Query pro server state;
- i18next / react-i18next pro lokalizaci;
- Zod pro validační hranici vybraných API odpovědí;
- Lucide pro ikony;
- lokální webfonty Montserrat a Noto Sans Devanagari;
- Vitest, Testing Library, MSW, Playwright a axe-core;
- build artefaktem je statický adresář `web/dist`.

### Statická kvalita

- Ruff vybírá `E`, `F`, `I`, `B`, `UP`, s maximální šířkou 100 a ignorovaným `E501`;
- mypy používá kontrolu typů aplikace;
- TypeScript build a typecheck nesmějí generovat změny sledovaných souborů;
- branding kontrola zakazuje nepovolené názvy/domény;
- po každém build/test kroku musí být pracovní strom čistý.

## Produkční topologie a runtime

### Síť a procesy

- kanonická veřejná adresa je výhradně `https://dagmar.hcasc.cz`;
- Nginx ukončuje TLS, obsluhuje statický frontend a proxyuje API;
- HTTPS web i API dostávají právě jednu společnou sadu security hlaviček: enforced CSP bez dynamických script zdrojů, roční HSTS, rozšířenou Permissions-Policy, `COOP: same-origin-allow-popups` a `CORP: same-origin`;
- HSTS záměrně nepoužívá `includeSubDomains` ani `preload`, dokud nebude doložené vlastnictví a TLS připravenost všech subdomén `hcasc.cz`; hlavička patří pouze kanonickému HTTPS serveru;
- backend poslouchá pouze na `127.0.0.1:8101`;
- PostgreSQL je publikovaný pouze na `127.0.0.1:5433`;
- backend běží jako systemd služba uživatele a skupiny `dagmar` v `/opt/dagmar/backend`;
- prostředí se načítá z `/etc/dagmar/backend.env`;
- služba používá `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=strict`, ochranu domovských adresářů a zapisuje pouze do explicitně povolených cest;
- limit otevřených souborů je `65535`;
- Gunicorn binduje loopback `8101` a používá Uvicorn worker. Výchozí počet workerů je `max(2, CPU count)`, ale environment override není omezen minimem; výchozí timeout je 60 s, graceful timeout 30 s a keep-alive 5 s;
- proxy hlavičkám se důvěřuje pouze z `127.0.0.1`.

### Čas

- jediná doménová časová zóna je `Europe/Prague`;
- API přijímá timezone-aware timestampy tam, kde je timestamp součástí kontraktu, a normalizuje je do Prahy;
- kalendářní den, měsíc, zámky, svátky, carryover i přihlašovací okna se vyhodnocují v Praze;
- `/api/v1/time` vrací serverový čas v pražské zóně;
- databázové timestampy provozní evidence mohou být uloženy v UTC, ale doménové vyhodnocení probíhá v Praze.

### Konfigurace

Konfigurace se načítá z `/etc/dagmar/backend.env`; již nastavené procesní proměnné mají přednost. Neznámé, prázdné nebo syntakticky chybné `DAGMAR_ENV`, `DAGMAR_COOKIE_SAMESITE`, veřejná URL, CORS origin nebo provider URL zastaví start s názvem chybné proměnné. Následující proměnné a defaulty jsou součástí reprodukčního kontraktu; tajné hodnoty se v SSOT nikdy neuvádějí:

| Proměnná | Povinnost / default | Význam |
|---|---|---|
| `DAGMAR_APP_NAME` | `DAGMAR` | runtime název |
| `DAGMAR_ENV` | `production`; povoleno `production`, `staging`, `development` | prostředí |
| `DAGMAR_PUBLIC_BASE_URL` | `https://dagmar.hcasc.cz` | jediná veřejná URL |
| `DAGMAR_BIND_HOST` / `DAGMAR_BIND_PORT` | `127.0.0.1` / `8101` | aplikační Settings hodnoty; produkční `gunicorn.conf.py` binduje pevně `127.0.0.1:8101` a tyto proměnné nepoužívá |
| `DAGMAR_DATABASE_URL` | povinná | PostgreSQL DSN |
| `DAGMAR_DB_POOL_SIZE` | `5` | SQLAlchemy pool |
| `DAGMAR_DB_MAX_OVERFLOW` | `10` | pool overflow |
| `DAGMAR_DB_POOL_TIMEOUT_SECONDS` | `30` | čekání na connection |
| `DAGMAR_ADMIN_PASSWORD_HASH` | produkčně preferovaná | jediný runtime admin hash |
| `DAGMAR_SESSION_SECRET` | povinná, min. 32 znaků | podpis admin session a související hashování |
| `DAGMAR_SMTP_PASSWORD_SECRET` | volitelná, min. 32; fallback session secret | šifrování SMTP hesla |
| `DAGMAR_ADMIN_SESSION_COOKIE` | `dagmar_admin_session`; kompatibilní fallback `DAGMAR_COOKIE_NAME` | admin cookie |
| `DAGMAR_SESSION_MAX_AGE_SECONDS` | `43200` | 12 hodin |
| `DAGMAR_COOKIE_SECURE` | `true` | Secure cookie |
| `DAGMAR_COOKIE_SAMESITE` | `lax`; povoleno `lax`, `strict` | SameSite |
| `DAGMAR_CORS_ENABLED` | `false` | CORS |
| `DAGMAR_CORS_ALLOW_ORIGINS` | kanonický origin | comma-separated allowlist |
| `DAGMAR_RATE_LIMIT_ENABLED` | `true` | rate limiting |
| `DAGMAR_RATE_LIMIT_DEFAULT_PER_MINUTE` | `120` | obecný limit |
| `DAGMAR_RATE_LIMIT_ADMIN_LOGIN_PER_MINUTE` | načtený default `10`; login decorator má pevně `10/minute` | změna proměnné auditovaný login limit nezmění |
| `DAGMAR_RATE_LIMIT_INSTANCE_STATUS_PER_MINUTE` | načtený default `60`, bez dedikovaného zapojení v public instance routeru | route podléhá obecnému limiteru, nikoli tomuto samostatnému nastavení |
| `DAGMAR_RATE_LIMIT_INSTANCE_CLAIM_PER_MINUTE` | načtený default `30`, bez dedikovaného zapojení v public instance routeru | route podléhá obecnému limiteru, nikoli tomuto samostatnému nastavení |
| `DAGMAR_RATE_LIMIT_INTEGRATION_HEALTH_PER_MINUTE` | `60` | samostatný health bucket |
| `DAGMAR_RATE_LIMIT_INTEGRATION_DATA_PER_MINUTE` | `120` | společný bucket všech datových rout |
| `DAGMAR_RATE_LIMIT_INTEGRATION_OPENAPI_PER_MINUTE` | `10` | samostatný OpenAPI bucket |
| `DAGMAR_INTEGRATION_TOKEN_LENGTH` | `48`; generátor použije nejméně 16 bytů | délka náhodné části integračního tokenu `dgi_` |
| `DAGMAR_GUNICORN_WORKERS` | výchozí `max(2, CPU count)` | počet workerů; aktivní kód nehlídá minimum |
| `DAGMAR_GUNICORN_THREADS` | `1` | Gunicorn threads |
| `DAGMAR_GUNICORN_TIMEOUT` / `DAGMAR_GUNICORN_GRACEFUL_TIMEOUT` / `DAGMAR_GUNICORN_KEEPALIVE` | `60` / `30` / `5` | timeouty procesu |
| `DAGMAR_LIMIT_REQUEST_LINE` / `...FIELDS` / `...FIELD_SIZE` | `8190` / `100` / `8190` | Gunicorn request-size limity |
| `DAGMAR_FORWARDED_ALLOW_IPS` | `127.0.0.1` | důvěryhodné proxy adresy pro Uvicorn |
| `DAGMAR_LOG_LEVEL` | `INFO` v app configu, `info` v Gunicornu | logování |
| `DAGMAR_DISABLE_DOCS` | `true` | FastAPI docs |
| `DAGMAR_INTEGRATION_CONTRACT_VERSION` | `2026-08-11` | integrační kontrakt |
| `DAGMAR_EXTERNAL_AUTH_TRANSACTION_TTL_SECONDS` | `600`, rozsah 120–1800 | OAuth transakce |
| `DAGMAR_EXTERNAL_AUTH_RESULT_TTL_SECONDS` | `120`, rozsah 30–600 | jednorázový SPA výsledek |
| `DAGMAR_EXTERNAL_AUTH_HTTP_TIMEOUT_SECONDS` | `10`, rozsah 2–30 | provider HTTP |
| `DAGMAR_EXTERNAL_AUTH_CLOCK_SKEW_SECONDS` | `30`, rozsah 0–120 | validace tokenů |
| `DAGMAR_GOOGLE_OIDC_ENABLED` | `false` | Google zapnutí |
| `DAGMAR_GOOGLE_OIDC_CLIENT_ID` / `...CLIENT_SECRET` | povinné při zapnutí | Google credentials |
| `DAGMAR_GOOGLE_OIDC_DISCOVERY_URL` | Google well-known HTTPS URL | discovery |
| `DAGMAR_GOOGLE_OIDC_CALLBACK_URL` | volitelná, ale při zadání přesně kanonická | callback |
| `DAGMAR_APPLE_SIGNIN_ENABLED` | `false` | Apple zapnutí |
| `DAGMAR_APPLE_SERVICES_ID`, `...TEAM_ID`, `...KEY_ID`, `...PRIVATE_KEY_PATH` | povinné při zapnutí | Apple credentials/key |
| `DAGMAR_APPLE_ISSUER`, `...AUTHORIZATION_ENDPOINT`, `...TOKEN_ENDPOINT`, `...JWKS_ENDPOINT` | oficiální HTTPS Apple defaulty | Apple OIDC |
| `DAGMAR_APPLE_CALLBACK_URL` | volitelná, ale při zadání přesně kanonická | callback |
| `DAGMAR_DEPLOY_TAG` | automaticky `YYMMDDHHMM`, lze přepsat | identita buildu |

Admin identita je vždy normalizována na `provoz@hotelchodovasc.cz`; runtime ji nesmí změnit libovolnou environment proměnnou. Produkční public URL je strukturálně přesně `https://dagmar.hcasc.cz` bez portu, userinfo, cesty, query nebo fragmentu a produkční CORS allowlist obsahuje pouze stejný origin, i když je CORS vypnuté. Zapnutý provider bez všech povinných hodnot, nečitelný Apple key file nebo nekanonický callback zastaví start aplikace. Google discovery a všechny objevené Google endpointy i pevné Apple endpointy jsou HTTPS URL s přesným oficiálním hostem a cestou; IP adresy, localhost, private/link-local cíle, userinfo, porty a odkloněné redirecty se odmítají před síťovým pokračováním.

Instance token má pevně 32 náhodných bytů a prefix `dg_`. Synchronizer-token CSRF používá náhodný token uložený v oddělené podepsané Starlette session. Délka tokenu ani samostatné CSRF tajemství nejsou falešně konfigurovatelné; podepsaný session store používá výhradně `session_secret`.

## Backendová kompozice a průřezové chování

### FastAPI aplikace

`app/main.py`:

- ověří kanonickou konfiguraci a minimální databázové schéma při startu;
- registruje veřejné instance, zaměstnaneckou docházku, plán, portal auth, externí auth, administraci, exporty, skupiny, SMTP a integrační API;
- přidává rate limiter;
- přidává request middleware, který vytvoří `X-Request-ID`, měří dobu a vrací `X-Request-Duration-Ms`;
- pro integrační namespace vytváří auditní kontext a zapisuje výsledek požadavku;
- mapuje FastAPI/Pydantic request-validation chyby pod `/api/` na status 400; aktivní aplikace však používá několik chybových obálek popsaných níže, nikoli jednu univerzální strukturu;
- skrývá interní detail neošetřených API chyb;
- poskytuje `/api/v1/health`, kompatibilní `/api/health`, `/api/version` a `/api/v1/time`;
- mimo SQLite spouští daemon thread reminder workeru s periodou 60 sekund.

### Skutečný chybový kontrakt a jeho varianty

Na auditovaném SHA neexistuje jediná univerzální chybová obálka. Klient musí reprodukovat a bezpečně zpracovat tyto aktivní varianty:

1. Doménové chyby vyvolané `raise_api_error` používají FastAPI tvar:

```json
{
  "detail": {
    "code": "stabilni_strojovy_kod",
    "message": "lidska_zprava",
    "params": {}
  }
}
```

Pole `params` existuje jen tehdy, jsou-li předána další data.

2. FastAPI/Pydantic request validation pod `/api/`, mimo integration namespace, je globálním handlerem převedena na:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Neplatný požadavek.",
    "details": []
  }
}
```

3. Některé přímo vyhozené `HTTPException` a auth dependency chyby používají standardní FastAPI `{"detail":"text"}` nebo strukturovaný objekt v `detail`.

4. Nové portal cookie/CSRF a admin lockout chyby používají cílovou neintegrační obálku `{"error":{"code":"…","message":"…","request_id":"…"}}`; zbytek neintegračního API bude na tentýž kontrakt převeden centrálně v samostatné změně.

5. Integration namespace má vlastní stabilní `error` obálku, request ID a auditní záznam. Jeho interní chyba nesmí propustit traceback nebo tajemství.

Frontendový `responseError` proto záměrně čte `body.error`, objektový `body.detail` i textový `body.detail`. Sjednocení všech obálek by bylo veřejnou kontraktní změnou a nesmí se provést skrytě v rámci tabulkového UI.

- každá odpověď z request middleware obsahuje `X-Request-ID` a `X-Request-Duration-Ms`, pokud požadavek middleware dokončí;
- `400` označuje syntakticky nebo validačně neplatný vstup;
- `401` chybějící/neplatnou autentizaci;
- `403` nedostatečný scope nebo zakázaný klient/IP;
- `404` nedostupný nebo mimo scope objekt, pokud nesmí být prozrazena jeho existence;
- `409` doménový konflikt, alternaci, překryv, období, stav dne nebo požadavek na potvrzení destrukce;
- `423` zamčený měsíc nebo dočasný portal lockout podle konkrétního endpointu;
- `429` rate limit;
- integrační API zachovává vlastní stabilní kódy, audit a strojovou strukturu.

### Transakční princip

Každá mutace času jednoho úvazku:

1. načte cílový úvazek;
2. získá databázový `SELECT … FOR UPDATE` nad `Employment`;
3. znovu pod zámkem načte a zamkne vlastníka a ověří aktivitu osoby i úvazku;
4. sestaví stav před změnou;
5. aplikuje mutaci v jedné databázové transakci;
6. znovu ověří chronologii, období, stavy, překryvy a všechny dotčené měsíční zámky;
7. určí skutečně dotčené kalendářní dny a měsíce;
8. přepočítá pouze dotčené perzistentní metriky;
9. commitne atomicky; při jakémkoli konfliktu vše vrátí zpět.

Žádný klientský retry nesmí proměnit jednu mutaci ve dva eventy. UI během pending stavu nesmí tutéž hodnotu odeslat duplicitně.

## Datový model a relační invarianty

### Úplný inventář perzistentních entit

Následující seznam je uzavřený inventář aktivních SQLAlchemy entit auditovaného commitu. Generátor nesmí žádnou sloučit, vynechat ani nahradit neperzistentním stavem, pokud tento SSOT výslovně neurčuje migraci.

| Tabulka / entita | Primární klíč | Klíčová data a omezení | Životní cyklus |
|---|---|---|---|
| `instances` / `Instance` | UUID string | client type WEB/ANDROID, fingerprint, device JSON, status, display name, volitelná self-FK profilová instance, token pouze jako hash, activation/revoke/deactivate/last-seen timestamps | veřejná registrace → pending; admin může bezpečně vypsat pending instance a atomicky je aktivovat bez vydání tokenu; admin create-user vytváří active WEB instanci přímo; claim rotuje token; FK používají SET NULL |
| `portal_users` / `PortalUser` | integer | unikátní e-mail, jméno, telefon, jediná role `employee`, password hash nullable, active, samostatný `is_blocked`, volitelná instance | vlastník úvazků; blokace neodebírá profil ani data, ale ruší bearer a reset tokeny; CASCADE na úvazky, reset tokeny a externí identity |
| `employments` / `Employment` | integer | user FK CASCADE, title, enum type, workload, metric flags, afternoon start, period, active, timestamps; DB check constraints profilu | hlavní scope všech doménových dat; CASCADE na docházku, eventy, metriky, plán, zámky, výběry a členství |
| `employment_groups` | integer | case-insensitive unikátní name, timestamps | admin CRUD; samotné odstranění nemaže plány |
| `employment_group_members` | složený `(group_id, employment_id)` | obě FK CASCADE; index na employment | M:N, aplikačně nejméně dva členové |
| `attendance` | integer | unikátní `(employment_id,date)`, instance SET NULL, volitelný status, timestamps | nosič attendance statusu, nikoli časů |
| `attendance_events` | integer | employment FK CASCADE, timezone timestamp, enum type, unikátní `(employment_id,occurred_at)`, timestamps | neomezená chronologická fakta |
| `employment_daily_time_metrics` | složený `(employment_id,metric_date,source)` | minuty i desetiny pro total/afternoon/night/weekend/holiday, nullable neaktivní metriky, calculation revision, updated | atomicky regenerovaný materializovaný výsledek backendové matematiky |
| `shift_plan` | integer | unikátní `(employment_id,date)`, instance SET NULL, arrival/departure strings, status, timestamps | jeden primární plán/status na startovní den; cross-midnight je odvozený interval |
| `shift_plan_month_instances` | integer | unikátní `(year,month,employment_id)`, instance SET NULL | perzistentní adminský výběr úvazků pro měsíc |
| `attendance_locks` | integer | unikátní employment/year/month, instance, locked_at/by | existence = zamčeno |
| `shift_plan_locks` | integer | stejné schéma, samostatná doména | existence = zamčeno |
| `shift_plan_auto_lock_runs` | integer | unikátní year/month, executed_at, locked_count | idempotence automatického měsíčního zamčení |
| `portal_user_reset_tokens` | integer | user FK CASCADE, token hash, expiry, used, `PENDING/SENT/FAILED`, revoked, created; nejvýše jeden aktivní `SENT` token uživatele | serializované vydání, explicitní stav doručení, spotřeba nebo revokace |
| `external_identities` | integer | account type employee/admin s přesně jedním targetem, provider google/apple, issuer+subject, unikátní subject a unikátní provider na účet, maskovatelný e-mail, audit metadata | link/login/unlink; CASCADE pro employee target |
| `oauth_transactions` | string ID | hash state/browser, provider, purpose login/link, portal, safe return path, target, nonce, PKCE, expirace/consume, šifrovaný result payload a result lifecycle | krátce žijící jednorázový browser flow |
| `external_auth_audit_logs` | integer | account ref, provider, event/outcome/reason, subject/IP hash, request ID, timestamp | append-only bezpečnostní audit bez plaintext subject/IP |
| `auth_lockout_state` | integer | actor type, principal, pokusy, first/last failure, locked until, last forgot, timestamps | aktuální lockout agregát |
| `auth_unlock_token` | integer | actor type, principal, purpose, token hash, expiry/used/created | jednorázové unlock/recovery tokeny |
| `attendance_reminder_events` | integer | employment FK CASCADE, instance SET NULL, date, reminder type, sequence, recipient, sent timestamps; unikátní employment/date/type/sequence | idempotence každého reminder pokusu |
| `app_settings` | integer | singleton row ID 1; SMTP host/port/user, šifrované password, security, from data, updated | bezpečné runtime SMTP nastavení |
| `integration_clients` | integer | unikátní name, status, JSON scopes a data scope IDs, mode, include inactive, IP allowlist, expiry, last used, created by/timestamps | admin lifecycle klienta |
| `integration_client_secrets` | integer | client FK CASCADE, hash, prefix, last4, fingerprint, issued/rotated/revoked | nejvýše jeden aktivně používaný secret; plaintext pouze jednorázově |
| `integration_audit_log` | integer | client SET NULL, request ID/time, method/path/query hash/source/user agent, status/error/row count/duration/operation, optional employment/date/before/after | append-only audit každého integračního požadavku |

Databázová schémata enumů mají stabilní názvy `instance_status`, `employment_type`, `attendance_event_type`, `daily_metric_source`, `client_type` a `portal_user_role`. Číselné minutové/metrické hodnoty se ukládají jako integer; velikost úvazku jako `NUMERIC(4,3)`. Všechny vlastnící FK na `employment_id` používají CASCADE, původní zařízení/instance se smí při odstranění odpojit přes SET NULL. Alembic je jediný produkční mechanismus změny této mapy.

### Instance zařízení

`Instance` reprezentuje webovou nebo Android instanci:

- UUID string jako primární identifikátor;
- `client_type` pouze `WEB` nebo `ANDROID`;
- fingerprint, volitelné JSON device info a display name;
- status `PENDING`, `ACTIVE`, `REVOKED` nebo `DEACTIVATED`;
- databáze ukládá pouze hash bearer tokenu, čas vydání a last seen;
- veřejná registrace vytvoří pending instanci; administrační vytvoření zaměstnance naproti tomu atomicky vytvoří již aktivní `WEB` instanci s fingerprintem `user:<normalizovaný e-mail>`;
- status endpoint aktualizuje last seen a display name vrací pouze aktivní instanci;
- claim token je dovolen jen aktivní instanci a vždy token rotuje; přechod `PENDING → ACTIVE` provádí pouze CSRF chráněný admin endpoint, který token ani hash nevrací a změnu auditně loguje.

### PortalUser

- interní zaměstnanecký účet s unikátním normalizovaným e-mailem;
- jméno, telefon, role `employee`, volitelný hash hesla, aktivita a vazba na instanci;
- může mít libovolný počet úvazků;
- přímé administrační nastavení i self-service reset volají jedinou transakční změnu hesla, která zneplatní všechny reset/unlock tokeny i credential instance a vyčistí lockout;
- deaktivovaný účet se nesmí přihlásit ani mutovat data; odstranění osoby smaže její úvazky a účet, ale explicitně nemaže připojený `Instance` řádek. Případný orphan bearer už nelze namapovat na uživatele a portal auth vrací 401;
- login status v administraci rozlišuje aktivní stav, ruční deaktivaci a chybějící úvazek v přihlašovacím okně.

### Employment

Každý úvazek obsahuje:

- vlastní `id`, `user_id`, název, typ, datum začátku, volitelné datum konce a aktivitu;
- `workload_fraction` pouze pro `WORK_CONTRACT`, rozsah `(0, 1]`;
- příznaky `total_hours_enabled`, `automatic_breaks_enabled`, `afternoon_hours_enabled`, `night_hours_enabled`, `weekend_hours_enabled`, `public_holiday_hours_enabled`;
- `afternoon_start_minutes` pouze při aktivní odpolední metrice, rozsah 00:00–21:59;
- typy pouze `WORK_CONTRACT`, `DPP_DPC`, `TASK_SHIFT_BASED`, `EXTERNAL_HOURLY`.

Povinné kombinace:

| Typ | Velikost úvazku | Celkem | Noční | Ostatní metriky | Automatické pauzy |
|---|---:|---:|---:|---|---|
| `WORK_CONTRACT` | povinná | povinné | povinné | volitelné | volitelné |
| `DPP_DPC` | zakázaná | volitelné | volitelné | volitelné | volitelné |
| `EXTERNAL_HOURLY` | zakázaná | volitelné | volitelné | volitelné | volitelné |
| `TASK_SHIFT_BASED` | zakázaná | vypnuto | vypnuto | vše vypnuto | vypnuto |

- změna typu profil deterministicky normalizuje;
- zkrácení období s navázanými daty vrátí 409 s počty a rozsahem; po potvrzení odstraní celé konfliktní intervaly, plány, zámky, výběry a reminders mimo nové období;
- odstranění úvazku je dvoufázové: bez potvrzení vrací souhrn navázaných dat, s potvrzením je odstraní; skupinové vazby se čistí;
- změna časového profilu přepočítá celou historickou množinu dotčených měsíců.

### EmploymentGroup

- skupina má case-insensitive unikátní název;
- členství je M:N mezi skupinou a úvazkem;
- skupina musí mít nejméně dva členy;
- členství slouží jen ke sdílenému plánu služeb;
- seznam zaměstnance obsahuje pouze skupiny, kde je členem některý jeho dostupný úvazek;
- cizí skupina a neexistující skupina vracejí shodné 404;
- odstranění skupiny nemaže žádné směny.

### Docházkový den a eventy

`Attendance` je denní nosič celodenního attendance statusu; skutečné časy jsou výhradně `AttendanceEvent`:

- event obsahuje pouze `employment_id`, timezone-aware `occurred_at`, interní typ `IN` nebo `OUT` a timestamps; `AttendanceEvent` na auditovaném SHA nemá `instance_id` ani jinou přímou evidenci původního zařízení;
- kombinace `(employment_id, occurred_at)` je unikátní;
- neexistuje pevný maximální počet eventů za den;
- nová historie musí začínat `IN`, dále se striktně střídat a smí končit jedním otevřeným `IN`;
- stará importovaná historie smí obsahovat orphan nebo otevřený event; zůstává viditelná, ale pouze platné chronologické `IN`/`OUT` páry vstupují do metrik;
- interval může překročit půlnoc i více měsíců;
- párové vytvoření přijímá začátek a konec, vždy začíná interním `IN` a může atomicky vložit fyzické pauzy;
- měsíční payload vypočítá `deletion_partner_id` jako doporučený sousední pár: `IN` s následujícím `OUT`, případně vnitrodenní pauza `OUT` s následujícím `IN`. Delete endpoint však technicky přijme libovolné jiné ID stejného úvazku a bezpečnost vynucuje validací celé zbývající posloupnosti, nikoli rovností s tímto hintem; UI musí používat pouze serverem dodaný partner;
- párové odstranění musí být atomické a znovu validovat zbývající celou posloupnost;
- zaměstnanec nesmí vytvářet ani posouvat průchod do budoucnosti; admin a integrační API respektují vlastní kontrakt, ale vždy období, stavy, zámky a chronologii;
- změna `employment_id` nebo interního typu existujícího eventu není dovolena běžnou update mutací.

### Plán služby

`ShiftPlan` je nejvýše jeden primární záznam pro `(employment_id, date)`:

- buď obsahuje oba časy, nebo celodenní plan status;
- časy jsou `HH:mm`; pokud je konec `<=` začátku, směna končí následující den;
- směna nesmí překrýt jinou směnu stejného úvazku;
- validují se všechny dny a měsíce, do kterých interval zasahuje;
- carryover je odvozená část plánu předchozího dne, v následujícím dni jen pro čtení;
- pokud v carryover dni začíná další nepřekrývající se směna, zobrazují se obě informace;
- zaměstnanec může editovat jen svůj úvazek, admin podle oprávnění;
- `ShiftPlanMonthInstance` uchovává adminský výběr úvazků pro konkrétní rok/měsíc.

### Celodenní stavy

Podporované stavy:

| Kód | Doména zápisu | Význam |
|---|---|---|
| `HOLIDAY` | plán | dovolená |
| `OFF` | plán | volno |
| `SICKNESS` | docházka | nemoc |
| `PARAGRAPH` | docházka | paragraf |

- efektivní stav dne preferuje docházkový status, jinak plánový;
- stav nemůže koexistovat s konfliktními průchody nebo směnou;
- neconfirmovaná konfliktní změna vrací HTTP 409; přesný tvar se liší podle endpointu: plánové status endpointy mohou vrátit strukturovaný `detail` s `requires_confirmation`, `attendance_exists` a `shift_plan_exists`, zatímco zaměstnanecký attendance status a některé adminské cesty vracejí pouze stabilní `code` a `message`; klient musí potřebu opakování s `confirm_delete_conflicts=true` znát z kontraktu konkrétní operace a nesmí předpokládat univerzální pole;
- confirmovaná změna odstraní všechny eventy a plány, jejichž timestamp nebo interval zasahuje den, včetně přesahů z předchozího dne;
- změna na sickness/paragraph ukládá status do docházky; holiday/off do plánu;
- zrušení prázdného statusového nosiče odstraní prázdný řádek;
- zámek relevantní domény je povinný a kombinovaný adminský status editor musí respektovat oba zámky.

### Měsíční zámky

- docházka a plán mají zcela oddělené tabulky a stav;
- existence řádku znamená zamčeno, odstranění řádku znamená odemčeno;
- unikátní klíč je `employment_id + year + month`;
- zamknout/odemknout lze jeden nebo více úvazků;
- zámek obsahuje původní instanci a `locked_by`;
- eventová mutace kontroluje všechny měsíce dotčené změněným intervalem, nikoli jen měsíc timestampu;
- plánová mutace kontroluje všechny měsíce směny a případně měsíce odstraněných konfliktních plánů;
- zamčená data zůstávají čitelná;
- konflikt vrací HTTP 423 a stabilní kód `attendance_month_locked` nebo `shift_plan_month_locked`.

### Automatický měsíční zámek plánu

- proces je idempotentní po `(year, month)` přes `ShiftPlanAutoLockRun`;
- zpracuje aktuální pražský měsíc;
- zamkne plán všech aktivních úvazků aktivních uživatelů, jejichž období překrývá měsíc;
- `locked_by` je `system:shift-plan-month-autolock`;
- opakovaný běh vrací již uložený počet a nic neduplikuje;
- systemd timer běží persistentně první den každého měsíce v `01:00:00` v zóně `Europe/Prague`; oneshot se spouští jako uživatel/skupina `dagmar` z `/opt/dagmar/backend` příkazem `python -m app.jobs.shift_plan_month_auto_lock`.

### Denní metriky

Perzistentní `EmploymentDailyTimeMetric` je klíčován `employment_id + metric_date + source`, kde source je `ATTENDANCE` nebo `SHIFT_PLAN`.

Pro každou aktivní metriku ukládá:

- přesné celé minuty;
- matematicky zaokrouhlené desetiny hodiny;
- `calculation_revision`, aktuálně `2`.

Algoritmus:

```text
round_minutes_to_tenths(minutes) = (minutes + 3) // 6
hours = tenths / 10
```

- den se vypočte z částí intervalů skutečně ležících v daném kalendářním dni;
- celková metrika je součet minut všech částí;
- odpolední je překryv od nakonfigurovaného začátku do 22:00;
- noční je překryv 00:00–06:00 a 22:00–24:00;
- víkendová je celý total v sobotu/neděli, jinak nula;
- sváteční je celý total v český státní svátek, jinak nula;
- hourly profil bez faktů vrací backendové nuly pro aktivní metriky;
- `TASK_SHIFT_BASED` nevrací hodinové metriky;
- měsíční desetiny jsou součet již zaokrouhlených denních desetin; nesmí se znovu zaokrouhlit součet minut;
- `worked_state` je `empty`, `incomplete` nebo `complete`; historicky neuzavřený den je viditelný, ale otevřená část nepřispívá do metrik;
- `planned_state` je `complete`, má-li plán nenulové metriky, jinak `empty`;
- profilová změna nebo rebuild pokryje celou historii; běžná mutace pouze skutečně dotčené měsíce;
- perzistentní řádky se před rebuildem daného měsíce atomicky nahradí.

### `display_metrics`

Jediný zdroj viditelných hodinových sloupců je backend:

1. `TASK_SHIFT_BASED` → prázdný seznam;
2. `total`, pokud je povolen;
3. `afternoon`, pokud je povolen;
4. `night`, pokud je povolen;
5. `weekend`, pokud je povolen;
6. `public_holiday`, pokud je povolen.

Toto pořadí je závazné pro UI, tisk, CSV, ZIP, PDF i integrační payload, který je nabízí. Chybějící metrika není nula; není součástí prezentace. Aktivní metrika s nulou se prezentuje jako `0,0 h` nebo locale-ekvivalent, nikoli jako chybějící údaj.

### Automatické přestávky

- po nejvýše 360 minutách práce není povinná pauza;
- delší hrubý interval se segmentuje na pracovní bloky nejvýše 360 minut a mezi ně se vkládají fyzické 30minutové pauzy;
- pauza je dvojice interních eventů `OUT` a `IN`, nikoli odečet z metriky;
- při uzavření nového intervalu se vloží automaticky jen pokud to profil povoluje;
- běžné profilové zapnutí není retroaktivní;
- adminská potvrzená akce „Přidej pauzy“ analyzuje historické uzavřené sessions, započte už existující mezery/pauzy, doplní pouze chybějící minuty, je idempotentní a nemá hromadné undo;
- sessions se oddělují mezerou alespoň 30 minut;
- doplnění se nesmí dostat mimo pracovní interval ani porušit alternaci, období, stav nebo zámek.

### Připomínky docházky

Reminder worker:

- běží jednou za 60 s, pouze v ne-SQLite runtime;
- v PostgreSQL používá advisory lock `248613`, aby více workerů neposílalo duplicity;
- čte SMTP konfiguraci z `AppSettings`;
- pro plánovaný příchod bez dnešního eventu začíná 5 minut po plánovaném čase a posílá maximálně 5 pokusů po 10 minutách;
- pro dnešní den začne 2 hodiny po plánovaném konci posílat maximálně 5 pokusů po 10 minutách pouze tehdy, pokud existuje alespoň jeden dnešní interní `IN` a současně žádný dnešní `OUT`; nekontroluje poslední event jako obecnou otevřenou posloupnost;
- pro včerejšek začne dnes v 08:00 posílat maximálně 5 pokusů po 10 minutách pouze tehdy, pokud včerejší kalendářní den obsahuje alespoň jeden `IN` a žádný `OUT`; eventy jsou seskupeny podle data vlastního timestampu, nikoli podle spárovaného intervalu;
- každý pokus je unikátní podle `employment_id`, dne, typu reminderu a sequence number;
- evidence obsahuje cílový e-mail a čas odeslání;
- chyba workeru se zaloguje a nesmí shodit webový backend;
- otevřenou směnu určuje výhradně poslední event úvazku podle stabilního pořadí `(occurred_at,id)` napříč půlnocí; dřívější uzavřený interval ani cross-midnight `OUT` nesmí vytvořit falešný reminder.

## Autentizace, autorizace a bezpečnost

### Admin session

- existuje jediný konfigurovaný administrátor; username/e-mail a hash hesla jsou v runtime konfiguraci;
- vlastní autentizační cookie se jmenuje výchozím názvem `dagmar_admin_session` a je stateless podepsaná; Starlette `SessionMiddleware` současně používá oddělenou store cookie `dagmar_admin_session_store` pro CSRF/session pomocný stav, aby se cookie názvy nikdy nekřížily;
- login přijímá JSON i form data, je omezen výchozím limitem 10/min;
- úspěch vytvoří stateless podepsanou admin cookie: base64url JSON `{u, iat, jti}` + HMAC-SHA256;
- podpis používá `session_secret`; stáří se kontroluje proti 12hodinové životnosti;
- cookie je `HttpOnly`, produkčně `Secure`, `SameSite=Lax` nebo přísnější a path `/`;
- logout cookie odstraní; existuje POST i kompatibilní GET redirect;
- `/api/v1/admin/me` vrací pouze `authenticated` a volitelný `username`; prostředí a deploy tag se čtou odděleně z `/api/version`;
- „zapomenuté heslo“ vždy vrací `{ok:true}` a pouze pro konfigurovaný e-mail může odeslat provozní instrukci; nevytváří adminský reset token.

### CSRF

Adminský i portálový CSRF jsou oddělené od autentizačních cookies:

- Starlette `SessionMiddleware` používá druhou session cookie se suffixem `_store`;
- náhodný token je uložen v session a vrácen pouze v JSON/hlavičce bootstrap endpointu;
- token se rotuje po 120 minutách;
- safe metody CSRF nevyžadují;
- SPA mutace přijímají token z `X-CSRF-Token`; adminské klasické form submit cesty mohou použít explicitní form field;
- porovnání je constant-time;
- frontend před adminskou mutací získá token z `/api/v1/admin/csrf` a před cookie-auth zaměstnaneckou mutací z `/api/v1/portal/csrf`; používá `credentials: include` a nesmí CSRF obejít.

### Zaměstnanecká browserová relace a non-browser bearer

- login používá normalizovaný e-mail a interní heslo;
- lockout se kontroluje před ověřením; tři neúspěšné pokusy v nejvýše hodinovém okně zamknou portal účet na jednu hodinu, úspěšný login nebo adminská akce unlock stav vyčistí a unlock tokeny mají TTL 24 hodin;
- administrátorský lockout má samostatnou politiku: pět chyb během 15 minut uzamkne účet na 15 minut; pokusy během zámku jeho konec neposouvají a úspěch stav vyčistí;
- hash se při úspěchu může rehashovat na aktuální parametrizaci;
- účet musí být aktivní, role employee a mít instanci;
- interní i externí browser login vydává samostatnou podepsanou HttpOnly Secure SameSite=Lax cookie `dagmar_portal_session`, která obsahuje pouze user ID, náhodné session ID a HMAC značku aktuálního password credentialu; více browserových relací může být platných současně, změna hesla je všechny zneplatní a non-browser credential instance se při browser loginu nerotuje;
- frontend při startu odstraní historický `localStorage` klíč `kajovodagmar.portal.session.v1`, credential nečte a neukládá; bezpečná metadata obnovuje z `/api/v1/portal/session`;
- cookie-auth mutace vyžadují CSRF, explicitní Authorization bearer zůstává jen pro non-browser instance kontrakt;
- logout je CSRF chráněná serverová mutace a maže cookie; změna hesla, blokace, deaktivace i odstranění osoby zneplatní serverový credential;
- zaměstnanec může volit jen `available_employments`.

### Přihlašovací okno úvazků

- úvazek je dostupný od jednoho kalendářního měsíce před začátkem do jednoho kalendářního měsíce po konci;
- aktuálně platný úvazek je preferovaný default;
- pokud žádný není aktuální, zvolí se nejbližší budoucí;
- jinak nejnovější nedávno skončený;
- měsíční výběry po loginu jsou přísnější: aktivní osoba, aktivní úvazek a skutečný překryv vybraného měsíce.

### Reset hesla zaměstnance

Adminské přímé nastavení i e-mailový self-service reset končí ve stejné transakční credential operaci: nový Argon2 hash, revokace všech reset/unlock tokenů, vyčištění portálového lockoutu a revokace credentialu instance. Vydání odkazu je serializováno zámkem uživatele napříč stavovým commitem a odesláním; token začíná jako `PENDING`, po doručení je `SENT`, při chybě `FAILED` a revokovaný. Starší aktivní tokeny se revokují a databáze dovolí nejvýše jeden aktivní `SENT` token na uživatele. Reset UI lokalizovaně oznamuje, že všechna zařízení byla odhlášena.

Migrace `2026_08_11_0025` zneplatní nedoložitelně doručené starší reset tokeny, odstraní pouze jednoznačné nereferencované orphan WEB instance a po kontrole referencí zahodí neautoritativní tabulky staré admin auth implementace. Downgrade obnoví pouze reverzibilní reset-token schéma; odstraněné neautoritativní tabulky ani orphan metadata znovu nevytváří. Pokud by je bylo nutné forenzně obnovit, zdrojem je předmigrační databázová záloha, nikoli spuštění starého release proti novému schématu.

- reset je dostupný jen aktivnímu uživateli;
- zablokovaný uživatel se správným heslem dostane `403 portal_account_blocked`, resetovací e-mail se nevytvoří a existující reset tokeny se při blokaci revokují;
- odblokování pouze přepne `is_blocked` zpět; nová browserová relace vznikne při úspěšném přihlášení a nový non-browser bearer pouze explicitním instance flow;
- e-mail obsahuje odkaz na `/reset` a následně login `/app`; řádek se před SMTP uloží jako `PENDING`, při úspěchu přejde na `SENT` a při chybě na revokovaný `FAILED`, takže nedoručený token nikdy není použitelný;
- databáze nikdy neukládá plaintext reset token.

### Externí Google/Apple identita

- provider může být `google` nebo `apple`;
- flow podporuje `login` a `link`, portál `employee` a `admin`;
- OIDC transakce používá náhodný state, browser secret cookie, nonce a PKCE tam, kde jej provider podporuje;
- browser cookie je `HttpOnly`, scoped na `/api/v1/auth`, v secure režimu `SameSite=None`;
- return path prochází allowlist/sanitizací a nesmí být open redirect;
- propojení i odpojení vyžaduje čerstvé ověření interním heslem;
- jedna provider/issuer/subject identita nesmí patřit více interním účtům;
- login uspěje pouze pro již propojenou identitu a aktivní interní účet;
- callback ukládá jen maskovatelný e-mail, verified flag, timestamps a hash subjektu v auditu;
- citlivé hodnoty v OAuth transaction jsou šifrované;
- výsledek pro SPA je jednorázový, krátce žijící a `Cache-Control: no-store`;
- audit neukládá plaintext IP ani subject; používá salted hash.

### Integrační bearer

- token má prefix `dgi_`; plaintext se ukáže pouze po vytvoření nebo rotaci;
- databáze ukládá Argon2 hash, SHA-256 lookup prefix, fingerprint, poslední čtyři znaky, časy vydání/rotace/revokace a `last_used_at` klienta;
- klient musí být `ACTIVE`, neexpirovaný, mít nerevokovaný secret a případně projít IP allowlistem;
- endpointové scope se kontroluje v každém aktivním integračním handleru podle tabulky níže;
- jediná scope služba vynucuje režimy `ALL_EMPLOYMENTS`, `ALL_ACTIVE_EMPLOYMENTS`, `SELECTED_EMPLOYEES` a `SELECTED_EMPLOYMENTS` na SQL seznamech i přímých ID operacích; neznámý režim a prázdný selektivní seznam nepovolí žádný úvazek;
- `SELECTED_EMPLOYEES` respektuje `include_inactive_employments`; `ALL_ACTIVE_EMPLOYMENTS` vždy vyžaduje aktivní úvazek i uživatele a všechny zápisy tuto aktivitu vyžadují bez ohledu na režim;
- IP restriction je buď žádná, nebo server-managed allowlist, který UI nesmí samo vymyslet;
- expirace: žádná, 30, 90, 365 dní nebo custom datum;
- klient lze enable/disable, rotate secret a revoke secret;
- každá integration odpověď prochází audit middlewarem; mutace doplňují row count a vybraná before/after metadata;
- health, všechny datové routy a OpenAPI mají samostatné config-driven buckety podle integračního klienta; globální vypnutí rate limitingu vypne všechny tři.

## API kontrakt

### Společné zásady

- aktivní namespace je `/api/v1/`, kromě kompatibilního `/api/health` a `/api/version`;
- datum je `YYYY-MM-DD`, měsíc `YYYY-MM`, čas `HH:mm`, timestamp ISO 8601 s offsetem;
- seznamy jsou stabilně řazeny podle doménového pořadí a ID jako tie-break;
- objekt mimo oprávnění se prezentuje jako nenalezený, pokud by 403 prozradilo jeho existenci;
- každý write endpoint zachovává transakční a lock pravidla uvedená výše.

### Kanonické doménové DTO

Tyto struktury definují minimální význam polí napříč backendem a frontendem. Interní `event_type` je nutný pro round-trip a chronologickou validaci, ale nesmí se převést na lidský label.

```text
Metric = { minutes:int, tenths:int, hours:number }
TimeMetrics = {
  total:Metric|null,
  afternoon:Metric|null,
  night:Metric|null,
  weekend:Metric|null,
  public_holiday:Metric|null
}
Employment = {
  id:int, user_id?:int, title:string,
  employment_type:WORK_CONTRACT|DPP_DPC|TASK_SHIFT_BASED|EXTERNAL_HOURLY,
  start_date:date, end_date?:date|null, is_active:bool,
  is_current?:bool, label?:string, workload_fraction?:string|null,
  time_profile?:object
}
AttendanceEvent = {
  id:int, employment_id:int, occurred_at:ISO-timestamp,
  event_type:IN|OUT, deletion_partner_id?:int|null
}
AttendanceDay = {
  date, events:AttendanceEvent[],
  attendance_status?, effective_status?,
  planned_arrival_time?, planned_departure_time?, planned_status?,
  planned_is_carryover:bool, planned_carryover_departure_time?,
  next_event_type:IN|OUT,
  calendar_tone:holiday|weekend|work,
  public_holiday_label?, is_within_employment_period:bool,
  worked:TimeMetrics|null, planned:TimeMetrics|null,
  worked_state:string, planned_state:string
}
AttendanceMonth = {
  employment_id, employment_label, display_metrics:MetricKey[],
  days:AttendanceDay[], worked:TimeMetrics|null, planned:TimeMetrics|null,
  attendance_locked:bool, shift_plan_locked:bool
}
PortalLogin = {
  display_name:string,
  employment_id:int|null, available_employments:Employment[]
}
```

`MetricKey` je pouze `total`, `afternoon`, `night`, `weekend`, `public_holiday`. `display_metrics` určuje nejen viditelnost, ale i pořadí všech denních/měsíčních metrik.

Zaměstnanecké mutace:

```text
CreateAttendanceEvent = {
  employment_id:int,
  occurred_at:timestamp,
  event_type:IN|OUT,
  paired_occurred_at?:timestamp|null
}
PortalOrAdminUpdateAttendanceEvent = {
  employment_id:int, occurred_at:timestamp, event_type:IN|OUT,
  paired_occurred_at:null
}
IntegrationPatchAttendanceEvent = { occurred_at:timezone-aware timestamp }
AttendanceDayStatus = {
  employment_id:int, date:YYYY-MM-DD,
  status:HOLIDAY|OFF|SICKNESS|PARAGRAPH|null,
  confirm_delete_conflicts:bool
}
ShiftPlanUpsert = {
  employment_id:int, date:YYYY-MM-DD,
  arrival_time:HH:mm|null, departure_time:HH:mm|null,
  status:HOLIDAY|OFF|null,
  confirm_delete_conflicts:bool
}
```

Portal a admin create/update přijímají stejný plný event payload. Při update musí `employment_id` a `event_type` přesně odpovídat existujícímu eventu a `paired_occurred_at` musí být `null`; mění se jen timestamp. Portal/admin naive timestamp interpretují jako `Europe/Prague`. Integration PATCH naproti tomu přijímá pouze timezone-aware `occurred_at`. Paired create může začít pouze interním `IN`, konec musí být později a po přidání včetně automatických pauz musí celá historie zůstat striktní.

Skupinový plán:

```text
GroupShiftPlanMonth = {
  group_id:int, group_name:string, year:int, month:int,
  rows:[{
    employment_id:int, display_label:string, is_own_employment:bool,
    shift_plan_locked:bool, display_metrics:MetricKey[],
    planned_minutes:int, planned_hours:number, planned:TimeMetrics|null,
    days:[{
      date, arrival_time?, departure_time?, status?, effective_status?,
      is_carryover:bool, carryover_departure_time?,
      is_within_employment_period:bool,
      planned_minutes:int, planned_hours:number,
      planned_state:string, planned:TimeMetrics|null
    }]
  }]
}
```

Adminské měsíční rows přidávají identitu osoby/úvazku, období, active flags a oba lock flags; nikdy nesmějí agregovat několik úvazků stejné osoby do jednoho datového řádku. Error confirmation payload musí zachovat stabilní `code`, lidskou `message`, `requires_confirmation` a doménové počty/rozsah, pokud je backend poskytuje.

### Validační limity a potvrzovací protokoly

| Objekt/operace | Přesná vstupní hranice | Konflikt / potvrzení |
|---|---|---|
| zaměstnanec | jméno 1–160 po trimu; e-mail 3–160, lowercase, musí obsahovat `@` a tečku v doméně; telefon max. 32, po odstranění mezer volitelné `+`, pouze číslice a min. 9 číslic; role pouze `employee`; admin create/direct-set heslo 8–256 | duplicitní e-mail je konflikt; každá změna hesla zneplatní všechny reset/unlock tokeny, credential instance a lockout vazby |
| úvazek | title 1–160; datum ISO; end nesmí být před start; workload 0.001–1.000; afternoon start 00:00–21:59; typ/profil podle DB tabulky | zúžení období nebo delete s navázanými daty vrátí 409 s `requires_confirmation`, počty podle domén a problémový date range |
| skupina | name je povinné, max. 160, whitespace se zkolabuje; create a replace vyžadují nejméně 2 různé existující employment IDs; remove payload nejméně 1 ID a všechna musí být členy | duplicate case-insensitive name 409; remove, po kterém zbývá méně než 2 členů, atomicky smaže celou skupinu a vrátí `group_deleted:true` |
| měsíc | rok 2000–2100, měsíc 1–12 | mimo rozsah `invalid_month` / 400 |
| průchod UI | normalizace podle sekce časového vstupu; serverový portal timestamp může být naive a je interpretován jako Praha | duplicate timestamp, alternace, status, period, future a lock jsou konflikty |
| průchod integration | extra fields zakázaná; timezone offset povinný; employment ≥1 | stejné doménové konflikty, strojové error codes |
| plán | datum ISO, oba časy společně nebo oba null; status pouze HOLIDAY/OFF/null | overlap, carryover/status conflict, period a všechny dotčené zámky |
| attendance status | portal `/attendance/day-status` serverově přijímá HOLIDAY/OFF/SICKNESS/PARAGRAPH/null; běžné UI rozděluje SICKNESS/PARAGRAPH do docházky a HOLIDAY/OFF do plánu; `/shift-plan/day-status` přijímá jen HOLIDAY/OFF/null | existující event/plan vyžaduje explicitní `confirm_delete_conflicts` |
| integration client | name 3–80, Unicode Latin letters U+00C0–U+024F, ASCII letters/digits/space/underscore/hyphen; bez control chars, URL/`www`, HTML a token-like prefixu `dgi_`, `dg_`, `sk-`, `token`, `secret` | nejméně jeden scope a vždy `integration:health`; neznámý nebo unavailable scope 400 |
| integration list | limit 1–500, default 100; date filters ISO | mimo allowed employment nesmí prosáknout objekt |
| reset zaměstnance | token hash, 24h, stav `PENDING/SENT/FAILED`, revoked timestamp; admin direct password 8–256, self-service reset 8–512 | invalid/expired/used/revoked/failed bezpečná chyba; úspěch odhlásí všechna zařízení |

U operací, které skutečně vracejí strukturovaný 409 payload s dopadem, je tento payload autoritou: klient musí zobrazit počty/rozsah a po potvrzení opakovat tutéž mutaci pouze s příslušným confirm flagem. Toto pravidlo se nesmí mechanicky přenést na operace, jejichž aktivní API žádný dvoufázový protokol nemá, například odstranění osoby; tam se zachová samostatné lokalizované frontendové potvrzení a okamžitá serverová mutace.

### Veřejné endpointy

| Metoda | Cesta | Chování |
|---|---|---|
| GET | `/api/health` | kompatibilní health |
| GET | `/api/v1/health` | primární health |
| GET | `/api/v1/readiness` | `SELECT 1` a přesná shoda jediné DB Alembic revision s jediným zabaleným headem; bezpečné 503 bez interních údajů |
| GET | `/api/version` | build/deploy verze a prostředí |
| GET | `/api/v1/time` | aktuální pražský čas |
| POST | `/api/v1/instances/register` | vytvoří pending instanci |
| GET | `/api/v1/instances/{instance_id}/status` | stav a last seen; display name jen active |
| POST | `/api/v1/instances/{instance_id}/claim-token` | rotuje token aktivní instance |
| GET | `/api/v1/admin/instances?status=PENDING` | admin session; bezpečná metadata čekajících instancí bez credentialu |
| POST | `/api/v1/admin/instances/{instance_id}/activate` | admin session + CSRF; pouze `PENDING → ACTIVE`, bez vydání tokenu |
| POST | `/api/v1/portal/login` | interní zaměstnanecký login |
| POST | `/api/v1/portal/reset` | jednorázový reset hesla |
| GET | `/api/v1/auth/providers` | enabled stav Google/Apple |
| POST | `/api/v1/auth/result` | jednorázové převzetí SPA login výsledku |
| GET | `/api/v1/auth/{portal}/{provider}/start` | browser redirect start OIDC |
| GET | `/api/v1/auth/google/callback` | Google callback |
| POST | `/api/v1/auth/apple/callback` | Apple form_post callback |

### Zaměstnanecké endpointy

Všechny přijímají browserovou portal cookie, u mutací s portálovým CSRF, nebo explicitní bearer non-browser instance:

| Metoda | Cesta | Chování |
|---|---|---|
| GET | `/api/v1/attendance?year&month&employment_id` | úplný měsíční docházkový model |
| GET | `/api/v1/attendance/employments?year&month` | aktivní překrývající se úvazky |
| POST | `/api/v1/attendance/events` | single nebo paired event |
| PUT | `/api/v1/attendance/events/{event_id}` | posun timestampu stejného eventu |
| DELETE | `/api/v1/attendance/events/{event_id}` | single nebo atomický paired delete |
| PUT | `/api/v1/attendance/day-status` | sickness/paragraph s conflict confirmation |
| PUT | `/api/v1/shift-plan` | vlastní plánovaný interval |
| PUT | `/api/v1/shift-plan/day-status` | vlastní holiday/off |
| GET | `/api/v1/shift-plan/groups` | dostupné skupiny |
| GET | `/api/v1/shift-plan/groups/{group_id}?year&month` | group month; vlastní editace, ostatní read-only |
| GET | `/api/v1/portal/auth-methods` | metody a stav propojení |
| POST | `/api/v1/portal/auth-methods/{provider}/link` | start link flow po hesle |
| DELETE | `/api/v1/portal/auth-methods/{provider}` | unlink po hesle |

### Admin endpointy

Běžné read endpointy vyžadují admin session a mutace současně CSRF. Login a forgot-password jsou veřejné, CSRF token lze vydat před loginem, logout vyžaduje platný synchronizer token a `/me` nevrací 401, ale `{authenticated:false}`.

| Oblast | Metoda a cesta | Auth | Chování |
|---|---|---|---|
| auth | POST `/api/v1/admin/login` | public + rate limit 10/min | ověří jediný config účet, nastaví auth cookie a vydá CSRF |
| auth | GET `/api/v1/admin/csrf` | public | vytvoří/rotuje CSRF store token; samo o sobě neautentizuje |
| auth | GET `/api/v1/admin/me` | public introspection | vrací authenticated false nebo username |
| auth | POST `/api/v1/admin/logout` | admin session + CSRF | smaže auth cookie; stavová GET varianta neexistuje |
| auth | POST `/api/v1/admin/forgot-password` | public, neenumerující | při přesné shodě config e-mailu a dostupném SMTP pošle pouze help e-mail bez tokenu; vždy `{ok:true}` |
| users | GET/POST `/api/v1/admin/users` | GET session; POST session + CSRF | seznam / vytvoření |
| users | PUT/DELETE `/api/v1/admin/users/{user_id}` | admin session + CSRF | editace / odstranění osoby, úvazků a připojené WEB instance v jedné transakci; případné potvrzení zajišťuje klientské UI |
| users | PUT `/api/v1/admin/users/{user_id}/block` | admin session + CSRF | zapnutí/vypnutí samostatné blokace přihlášení; při zapnutí ruší instance bearer a reset tokeny, administrátorský přístup zůstává |
| instances | GET `/api/v1/admin/instances?status=PENDING`; POST `/api/v1/admin/instances/{instance_id}/activate` | admin session; mutace navíc CSRF | bezpečný provisioning čekající instance bez zpřístupnění tokenu nebo hashe |
| users | GET `/api/v1/admin/users/{user_id}/employments` | admin session | úvazky uživatele |
| users | POST `/api/v1/admin/users/{user_id}/set-password` | admin session + CSRF | přímé heslo |
| users | POST `/api/v1/admin/users/{user_id}/send-reset` | admin session + CSRF | 24h reset odkaz |
| users | POST `/api/v1/admin/users/{user_id}/unlock` | admin session + CSRF | lockout clear |
| employment | POST `/api/v1/admin/users/{user_id}/employments` | admin session + CSRF | vytvoření úvazku |
| employment | PUT/DELETE `/api/v1/admin/employments/{employment_id}` | admin session + CSRF | update / confirmed delete |
| attendance | GET `/api/v1/admin/attendance/month` | admin session | list všech měsíčních sheets |
| attendance | GET/POST `/api/v1/admin/attendance/events` | GET session; POST session + CSRF | list / create |
| attendance | PUT/DELETE `/api/v1/admin/attendance/events/{event_id}` | admin session + CSRF | update / delete |
| attendance | POST `/api/v1/admin/attendance/breaks` | admin session + CSRF | confirmed idempotent historical breaks |
| status | PUT `/api/v1/admin/day-status` | admin session + CSRF | jednotný all-day status editor |
| locks | PUT `/api/v1/admin/locks` | admin session + CSRF | bulk attendance/plan lock state |
| plan | GET/PUT `/api/v1/admin/shift-plan` | GET session; PUT session + CSRF | month model / day upsert |
| plan | PUT `/api/v1/admin/shift-plan/selection` | admin session + CSRF | per-month selected employments |
| groups | GET/POST `/api/v1/admin/employment-groups` | GET session; POST session + CSRF | list / create |
| groups | PUT/DELETE `/api/v1/admin/employment-groups/{group_id}` | admin session + CSRF | rename+update / delete |
| groups | PUT/DELETE `/api/v1/admin/employment-groups/{group_id}/members` | admin session + CSRF | replace/remove members |
| export | GET `/api/v1/admin/export` | admin session | one CSV or bulk ZIP |
| export | POST `/api/v1/admin/export/shift-plan/report` | admin session + CSRF | report JSON |
| export | POST `/api/v1/admin/export/shift-plan/pdf` | admin session + CSRF | server-rendered PDF |
| SMTP | GET/PUT `/api/v1/admin/smtp` | GET session; PUT session + CSRF | safe read / encrypted update |
| SMTP | POST `/api/v1/admin/smtp/test` | admin session + CSRF | test mail |
| integrations | GET/POST `/api/v1/admin/integrations/clients` | GET session; POST session + CSRF | list / create + one-time token |
| integrations | GET `/api/v1/admin/integrations/clients/options` | admin session | complete form metadata |
| integrations | GET/PUT `/api/v1/admin/integrations/clients/{client_id}` | GET session; PUT session + CSRF | detail / update |
| integrations | POST `/api/v1/admin/integrations/clients/{client_id}/rotate` | admin session + CSRF | rotate one-time secret |
| integrations | POST `/api/v1/admin/integrations/clients/{client_id}/disable` | admin session + CSRF | disable |
| integrations | POST `/api/v1/admin/integrations/clients/{client_id}/enable` | admin session + CSRF | enable |
| integrations | POST `/api/v1/admin/integrations/clients/{client_id}/revoke-secret` | admin session + CSRF | revoke active secret |
| account | GET `/api/v1/admin/auth-methods` | admin session | external methods |
| account | POST `/api/v1/admin/auth-methods/{provider}/link` | admin session + CSRF | link with password+CSRF |
| account | DELETE `/api/v1/admin/auth-methods/{provider}` | admin session + CSRF | unlink with password+CSRF |
### Integration API

Vše vyžaduje `dgi_` bearer a audit:

| Metoda | Cesta | Scope | Chování |
|---|---|---|---|
| GET | `/api/v1/integration/health` | `integration:health` | ok, client ID, timezone a verze kontraktu |
| GET | `/api/v1/integration/openapi.json` | `openapi:read` | OpenAPI 3.1 subset aktivních rout |
| GET | `/api/v1/integration/employments` | `employments:read` | scoped employments a time profile |
| GET | `/api/v1/integration/attendance-events` | `attendance:read` | scoped, date-filtered chronological list |
| POST | `/api/v1/integration/attendance-events` | `attendance:create` | single/paired, strict full validation |
| PATCH | `/api/v1/integration/attendance-events/{event_id}` | `attendance:update` | timestamp only |
| DELETE | `/api/v1/integration/attendance-events/{event_id}` | `attendance:delete` | strict post-delete sequence |
| GET | `/api/v1/integration/locks` | `locks:read` | attendance/plan locks pro povolené employment IDs |

Seznamové odpovědi mají `{data, pagination}`; `limit` je 1–500, výchozí 100. Opaque cursor je verzovaný a vázaný na zdroj: úvazky a zámky pokračují podle `id`, eventy podle `(occurred_at,id)`. Poškozený nebo cizí cursor vrací `invalid_cursor`. Každý event payload obsahuje interní typ, timezone `Europe/Prague` a `last_changed_at`, protože integrační API je strojový round-trip a nepodléhá zákazu lidského směrového labelu.

Jediná scope služba vynucuje datový rozsah na SQL dotazech i přímých ID operacích. `ALL_EMPLOYMENTS` povoluje všechny úvazky; `ALL_ACTIVE_EMPLOYMENTS` pouze aktivní úvazky aktivních uživatelů; `SELECTED_EMPLOYEES` vyžaduje neprázdné employee IDs a respektuje include-inactive; `SELECTED_EMPLOYMENTS` vyžaduje neprázdné employment IDs. Neznámý nebo prázdný selektivní režim nepovolí nic. Zápis navíc vždy vyžaduje aktivní úvazek i uživatele.

Aktivní scopes mají invariantně propojenou skutečnou routu. `shift_plan:read`, `punches:read` a `changes:read` jsou nedostupné a nesmí být uloženy. Health, data a OpenAPI používají oddělené, konfigurovatelné rate-limit buckety; globální `rate_limit_enabled=false` je vypne společně.

## Frontendová architektura

### Boot a server state

- `web/src/main.tsx` spouští React `StrictMode`;
- globální QueryClient: query retry 1, bez refetch on window focus, mutation retry false;
- `Root` instaluje BrowserRouter, skip link a lokalizovaný title dokumentu;
- API klient je jediná transportní vrstva pro public, portal a admin mód;
- každá serverová data musí být invalidována přes stabilní query key po úspěšné mutaci;
- síťová chyba se mapuje na offline `ApiError` se statusem 0;
- pokud server vrátí request ID, UI jej může zobrazit pro podporu;
- významné payloady procházejí Zod validací, nesoulad je chyba kontraktu, nikoli tiché pokračování.

### Frontend routy

| Route | Vlastník | Účel |
|---|---|---|
| `/` | `App.tsx` | redirect na `/app` |
| `/app` | `EmployeePage.tsx` | login nebo zaměstnanecká aplikace |
| `/reset` | `AuthPages.tsx` | reset hesla |
| `/integration-api` | `IntegrationDocsPage.tsx` | veřejná integrační dokumentace |
| `/admin/login` | `AuthPages.tsx` | admin login |
| `/admin` | `App.tsx` | redirect na `/admin/prehled` |
| `/admin/prehled` | `AdminOverviewPage.tsx` | dashboard |
| `/admin/users` | `AdminUsersPage.tsx` | osoby a úvazky |
| `/admin/dochazka` | `AdminMatrixPages.tsx` | hromadná docházka |
| `/admin/plan-sluzeb` | `AdminMatrixPages.tsx` | hromadný plán |
| `/admin/skupiny-uvazku` | `AdminEmploymentGroupsPage.tsx` | skupiny |
| `/admin/export` | `AdminOperationsPages.tsx` | CSV/ZIP |
| `/admin/tisky` | `AdminOperationsPages.tsx` | výběr tisku |
| `/admin/tisky/preview` | `AdminOperationsPages.tsx` | náhled a tisk/PDF |
| `/admin/settings` | `AdminOperationsPages.tsx` | vysvětlení umístění časových nastavení |
| `/admin/ucet` | `AdminAccountPage.tsx` | externí metody admina |
| `/admin/integrace` | `AdminOperationsPages.tsx` | informační integrační plocha; plný klientský management existuje v admin API, nikoli v auditovaném UI |
| `*` | `AuthPages.tsx` | lokalizované 404 |

### Session a lokální stav zaměstnance

- historický storage key `kajovodagmar.portal.session.v1` se při startu pouze odstraní a nesmí obsahovat aktivní credential ani metadata relace;
- login response a `selected_employment_id` existují pouze v paměťovém stavu aktuální SPA; po reloadu se metadata znovu získají z `/api/v1/portal/session`;
- při načtení se kontroluje array dostupných úvazků;
- změna úvazku se drží pouze v paměti aktuálního tabu;
- po načtení měsíčních možností se nedostupný selected ID nahradí prvním dostupným nebo `null`;
- clear odstraní historický storage klíč; serverový logout maže HttpOnly cookie i při následné lokální síťové chybě;
- cookie ani bearer se nesmí logovat, vkládat do URL ani zobrazovat.

### Lokalizace

- podporované core/admin jazyky: `cs`, `en`, `sk`, `de`;
- zaměstnanecká plocha a reset navíc podporují `hi`;
- locale map: `cs-CZ`, `en-GB`, `sk-SK`, `de-DE`, `hi-IN`;
- default je čeština;
- inicializace: uložený jazyk aktuální plochy → podporovaný browser language → čeština;
- core a employee mají oddělené localStorage keys;
- `document.documentElement.lang` se aktualizuje při změně;
- employee plocha používá skutečný Noto Sans Devanagari pro hindi;
- žádný uživatelský string, aria label, chyba, tiskový text nebo exportní hlavička nesmí být hardcoded jen v jednom jazyce po dokončení cílové změny;
- směr eventu se nesmí objevit ani v accessible name; používá se neutrální pojem a pořadí průchodu.

## Design systém a vizuální kontrakt

### Základní identita

- produktový název `KájovoDagmar`, podtitul `DOCHÁZKOVÝ SYSTÉM`;
- dark-first vzhled;
- Montserrat 400/700, pro devanágarský text Noto Sans Devanagari 400/700;
- základní barevné tokeny:
  - `--bg: #06100e`;
  - `--elevated: #0a1815`;
  - `--surface: #0d211c`;
  - `--surface-2: #112a24`;
  - `--line: #25443b`;
  - `--line-strong: #376659`;
  - `--text: #f4faf7`;
  - `--muted` minimálně kontrastní světlá zelenošedá; cílový sjednocený token `#abc7bd`;
  - `--accent: #27d7a6`;
  - `--accent-strong: #7af2cf`;
  - `--accent-ink: #052019`;
  - `--danger: #ff766d`;
  - `--warning: #f6bd5d`;
  - informační modrá `#6fc8ff`;
- radii 7 / 12 / 18 px;
- focus ring je nejméně 3 px a má být viditelný na všech površích;
- čísla časů a metrik používají tabular numerals;
- `prefers-reduced-motion` redukuje animace a přechody téměř na nulu.

### Shell

Admin:

- desktop sidebar 244 px;
- topbar 54 px;
- obsah maximálně 1600 px;
- sidebar je hlavní navigace, na mobilu drawer s overlay a korektním focus/close chováním;
- shell zobrazuje brand, jazyk, produkční prostředí, datum a logout;
- aktivní route je vizuálně i přes `aria-current` rozpoznatelná.

Zaměstnanec:

- kompaktní topbar, brand, jazyk, účet/odhlášení;
- sticky nebo dosažitelný switch docházka / vlastní plán / skupinový plán;
- výběr měsíce a úvazku je vždy spojen s právě načtenými daty;
- mobilní safe-area padding se respektuje.

### Primitiva

Normativní sada zahrnuje:

- `Button` varianty primární, quiet a danger;
- `Panel` s header/body;
- `Field` s label a hint;
- `StatusMessage` pro loading, empty, success, warning, error;
- `Modal` jen pro skutečně destruktivní nebo konfliktní akce;
- `ClockInput` jako jediný editor času;
- data table s sticky head, horizontálním wrapperem a data-label fallbackem tam, kde je schválen;
- badge, metric card, action row, filter/selection panel;
- žádná stránka nesmí zavést vlastní nekonzistentní kopii těchto stavů.

### Responzivní baseline a cílová změna

Aktuální baseline obsahuje breakpointy kolem 900, 760, 390 a 340 px a v některých docházkových plochách převádí denní tabulku na karty. Cílový stav tuto část výslovně nahrazuje:

- detail zůstává jeden den / jeden tabulkový řádek na všech šířkách;
- hromadná matice zůstává jeden člověk / jeden řádek;
- používá se horizontální scroll, sticky identita, sticky datum/den a dosažitelný denní total;
- dotykový target editovatelné buňky je nejméně 44 px na výšku, ale nesmí zvětšit celý řádek tak, že se ztratí měsíční přehled;
- žádná hodnota nesmí být oříznuta bez dostupného posunu nebo detailu;
- mobilní design musí být designérem schválen na skutečném renderu, nikoli automaticky odvozen CSS fallbackem.

## Obrazovková a funkční specifikace

### Zaměstnanecký login `/app`

Stav bez session:

- e-mail, heslo, submit;
- externí login tlačítka jen pro enabled providery;
- loading blokuje duplicitní submit;
- chyba je lokalizovaná a zachová e-mail, ne heslo;
- úspěch uloží portal session a zobrazí aplikaci bez reload závislosti;
- safe návrat z externího loginu spotřebuje jednorázový result a odstraní citlivý query stav.

Stav se session:

- ověří dostupné úvazky pro měsíc;
- pokud token selže 401, session se vymaže a vrátí login;
- změna měsíce nebo úvazku invaliduje správné query;
- account methods jsou dosažitelné z účtové plochy zaměstnance.

### Zaměstnanec — vlastní docházka

Datový model obrazovky:

- jméno/úvazek, měsíc, samostatné attendance a shift-plan lock badges;
- měsíční metriky pouze podle `display_metrics`;
- každý kalendářní den včetně prázdných dnů;
- datum, den týdne, calendar tone, svátek, status, všechny eventy, plánové hinty, denní metriky a employment period flag;
- mimo období je řádek čitelný, ale needitovatelný;
- attendance lock blokuje průchody a attendance statuses, shift-plan lock plánové statuses;
- celodenní stav může vyžadovat potvrzení odstranění konfliktů;
- plánová nápověda mapuje každému chronologickému průchodu odpovídající plánový čas, včetně carryover a druhé směny;
- všechny cílové layout a editace se řídí sekcí `PRŮCHOD` níže.

### Zaměstnanec — vlastní plán

- stejný kalendář, úvazek, měsíc a metriky;
- jeden interval začínající v daném dni a volitelný holiday/off;
- carryover předchozí směny se zobrazuje read-only;
- pokud existuje effective attendance status nebo carryover konflikt, editory se blokují dle kontraktu;
- změna statusu při existujících časech vyžaduje potvrzení a časy odstraní;
- změna plánového času okamžitě obnoví denní a měsíční planned metrics.

### Zaměstnanec — skupinový plán

- seznam dostupných skupin;
- vybraná skupina, měsíc a řádky všech aktivních členů s překryvem období;
- každý řádek identifikuje osobu a úvazek;
- zaměstnanec edituje pouze vlastní `employment_id`, ostatní jsou read-only;
- vlastní zámek se vyhodnocuje po řádku;
- cizí detail se nesmí zpřístupnit změnou URL nebo payloadu;
- kanonický cílový layout je matice člověk × den se dvěma buňkami `PRŮCHOD`.

### Reset `/reset`

- přijme token z URL;
- formulář vyžaduje nové heslo a jeho shodné zopakování; auditovaný frontend kontroluje minimálně 8 znaků a shodu, backend přijímá 8–512 znaků a aktivní hashovací služba kromě neprázdnosti a horního limitu nevynucuje další komplexitu;
- neplatný, expirovaný nebo použitý token vrací bezpečnou lokalizovanou chybu;
- úspěch atomicky revokuje všechny reset/unlock tokeny i credential instance, označí spotřebovaný token jako použitý a nabídne nové přihlášení `/app` s informací o odhlášení všech zařízení;
- heslo se nikdy neloguje ani neponechává v URL.

### Veřejná integrační dokumentace `/integration-api`

- veřejný shell s brandem, jazykem a odkazy na employee/admin;
- vysvětluje namespace, token `dgi_`, timezone a employment scope;
- tabulka podporovaných endpointů;
- příklad bearer hlavičky;
- příklad list response a stavů 401/403/409/422/429;
- odkaz na autentizovaný `/api/v1/integration/openapi.json`;
- dokumentace nesmí tvrdit endpoint nebo scope, který aktivní API nemá.

### Admin login

- e-mail/username a heslo;
- interní i enabled externí login;
- `next` je safe interní path;
- úspěch přesměruje do admin shellu;
- session guard na každé admin route ověří `/admin/me`; na login přesměruje při chybě query libovolného statusu nebo při `authenticated:false`;
- CSRF se nezískává jako náhrada loginu, ale po session.

### Admin přehled

- počty všech/aktivních zaměstnanců;
- počty všech/aktivních integračních klientů;
- backend verze a prostředí;
- rychlé odkazy na hlavní agendy;
- technický panel nesmí zobrazit secret ani citlivou konfiguraci.

### Admin uživatelé a úvazky

Seznam osob:

- vyhledávání podle jména/e-mailu;
- selected detail;
- stav aktivní, locked, login status, has password a pole `last_login_at`; toto pole je ve skutečnosti `Instance.last_seen_at`, nastavuje se už při vytvoření uživatele a může jej měnit i jiná aktivita instance, takže není spolehlivým auditním časem posledního loginu;
- create: jméno 1–160, validní e-mail, volitelný telefon, volitelné heslo min. 8;
- edit: jméno, e-mail, telefon, aktivita;
- akce: uložit, aktivovat/deaktivovat, unlock, nastavit heslo, poslat reset a smazat. Smazání osoby je v API okamžitá CSRF chráněná CASCADE operace bez serverového confirm payloadu; případné potvrzení je frontendový bezpečnostní krok a nesmí být vydáváno za backendový dvoufázový protokol;
- e-mail je case-normalized a unikátní;
- telefon dovoluje český nebo mezinárodní tvar, nejméně 9 číslic po odstranění mezer a `+`.

Úvazky:

- list všech úvazků osoby v chronologii start date/ID;
- create/edit všech polí profilu;
- typové povinnosti se projeví v disabled/mandatory controls a současně serverové validaci;
- změna období s konflikty zobrazí počty docházky, plánů, zámků, selections a reminders a vyžádá explicitní druhý submit;
- delete obdobně vyžaduje potvrzení related data;
- UI nesmí rozhodnout, že data „nejsou vidět“, a proto je lze odstranit bez serverového souhrnu.

### Admin hromadná docházka

Baseline poskytuje výběr aktivních sheets, filtr, separátní sekci úvazku, měsíční zámky, přidání pauz, denní statusy, všechny eventy a metriky. Cílový stav mění kompozici na jednu společnou matici podle níže uvedených invariantů, ale zachovává:

- výběr a filtr úvazků;
- attendance a shift-plan lock každého úvazku;
- confirmed „Přidej pauzy“ s počtem vložených párů/eventů;
- všechny doménové kontroly a statusy;
- denní i měsíční metriky;
- úplnou editaci všech eventů přes kanonický detail.

### Admin hromadný plán

- rok/měsíc, filtr a per-month persistent selection;
- selection disabled pro úvazek mimo měsíc;
- per-employment shift-plan lock;
- day interval/status, carryover, effective status a planned metrics;
- confirmed replacement časy ↔ celodenní stav;
- cílový layout je společná člověk × den matice, ne série samostatných tabulek.

### Admin skupiny úvazků

- vytvoření s názvem a nejméně dvěma vybranými úvazky;
- dostupné volby jsou lidské labely `jméno – typ – název`;
- list existujících skupin a členů;
- backendové update názvu a replace/remove members musí zůstat funkční. Auditovaný frontend nabízí hlavně create/delete; doplnění plného UI pro rename/replace/remove je samostatný produktový scope a nesmí být přidáno jen proto, že endpoint existuje;
- delete potvrzuje, že plány zůstávají;
- po změně skupiny se invaliduje employee group list.

### Admin export

- měsíc je povinný `YYYY-MM`;
- jedna volba úvazku → CSV;
- bez volby + `bulk=true` → ZIP s jedním CSV na relevantní aktivní úvazek aktivní osoby;
- filename je bezpečný slug lidského labelu a měsíc;
- encoding UTF-8;
- relevance: start před koncem měsíce, end není před začátkem měsíce, osoba i úvazek aktivní;
- cílový human exportní formát `PRŮCHOD 1..N` je níže normativní a nahrazuje baseline `pruchody` s `IN/OUT:timestamp`;
- status a plánové časy zůstávají exportovány neutrálně a metriky pouze podle `display_metrics`.

### Admin tisky

Výběrová stránka:

- typ docházka / plán;
- pro docházku varianta summary/detail, pokud cílový kontrakt obě zachovává;
- měsíc;
- explicitní výběr úvazků, select all / clear;
- preview route nese měsíc, typ, variantu a ID; server vždy znovu ověří dostupnost.

Docházka:

- browser print používá stejná data jako preview;
- cílový detail je jeden `employment_id` × měsíc × jedna A4 v níže definované kapacitní obálce; data nad obálkou nesmějí být zkrácena;
- baseline čtyřsloupcový výpis `IN/OUT čas +N` je nahrazen čistými časy `PRŮCHOD`.

Plán:

- report JSON i server PDF používají společný `ShiftPlanReport`;
- výběr zachová pořadí ID a odstraní duplicity;
- každý neexistující/neaktivní/mimo měsíc úvazek je error;
- baseline serverový souhrnný report má nejvýše 5 úvazků na A4 landscape page, 200 DPI, 2339×1654 px, margin 72×56 px, label column 420 px, summary 118 px;
- denní buňka obsahuje interval/carryover/status a planned metrics;
- tato souhrnná víceosobová tisková forma může zůstat jako samostatný report, ale nesmí nahrazovat povinný detail jedné osoby na jednu A4.

### Admin nastavení a SMTP

- auditované UI `/admin/settings` je informační plocha vysvětlující, že časový profil patří konkrétnímu úvazku; není obecným editorem aplikačních settings;
- SMTP je plně implementovaný a zachovávaný adminský API kontrakt `/api/v1/admin/smtp` a `/test`, ale auditovaný frontend pro něj nemá samostatný plnohodnotný formulář; generátor nesmí bez nové schválené změny takovou obrazovku vymyslet;
- API ukládá host, port, username, šifrované heslo, SSL/STARTTLS/none, from name a from email;
- read nikdy nevrací plaintext heslo, pouze bezpečná pole a příznak existence;
- update bez nového hesla zachová původní;
- test odešle kontrolní e-mail a vrátí bezpečnou chybu bez secretu.

### Admin účet

- zobrazuje Google a Apple, enabled/linked/not linked/not configured;
- zobrazuje maskovaný identifikátor a data link/last login;
- current password je povinný pro link/unlink;
- po start linku následuje browser redirect;
- po návratu se zobrazí success/error a query se invaliduje.

### Admin integrační klienti

Auditovaný stav má dvě odlišné vrstvy, které se nesmějí zaměnit:

1. `/admin/integrace` je pouze informační stránka s odkazem na veřejnou integrační dokumentaci; auditovaný frontend neobsahuje CRUD formulář integračních klientů.
2. Adminský backend má úplný management API kontrakt pro klienty, options, detail, create/update, enable/disable, rotate a revoke. Tento backend je součástí reprodukovaného systému a musí zůstat funkční, i když jej aktuální UI přímo neobsluhuje.

Backendový kontrakt zahrnuje:

- list: name, status/label, scopes/summary, data scope, IP restriction, expiry, last used, created/updated/by, secret fingerprint/last4, dostupné akce;
- create/update jméno s povolenými písmeny, čísly, mezerami, pomlčkou a podtržítkem; zákaz URL, HTML a tajemství;
- scopes a permission profiles;
- data-scope konfiguraci active-only / selected employees / selected employments / all, kterou runtime jednotně vynucuje deny-by-default;
- include inactive jen tam, kde jej režim podporuje;
- server-managed IP mode pouze pokud už technický allowlist existuje;
- expiry option;
- create/rotate vrací plaintext token právě jednou; žádný klient jej později nezíská;
- detail obsahuje audit summary, poslední error, source IP summary a cestu;
- enable, disable, rotate, revoke;
- API nikdy nevrací hash ani dřívější plaintext.

Vytvoření plného klientského management UI je nový produktový scope a bez explicitní změny tohoto SSOT je zakázané. Pokud bude později schváleno, musí použít výše uvedený backend, chráněný one-time secret panel a kompletní design gate.

## Exportní a tiskové datové kontrakty

### Human CSV/ZIP — cílový formát

Minimální stabilní sloupce každého CSV:

1. `zamestnanec`;
2. `uvazek`;
3. `typ_uvazku`;
4. `datum`;
5. `stav_dne`;
6. skutečná docházka používá `PRŮCHOD 1` až `PRŮCHOD N` podle maximálního počtu eventů v exportované množině;
7. plánové hranice používají samostatnou skupinu hlaviček `PLÁN – PRŮCHOD 1` až `PLÁN – PRŮCHOD M`, vždy v chronologickém pořadí. Carryover nemá zvláštní směrový ani „přesahový“ časový název; je pouze další chronologickou hodnotou;
8. aktivní metriky v pořadí `display_metrics`.

- každá průchodová hodnota je jen `HH:mm` nebo prázdná;
- žádné `IN`, `OUT`, příchod, odchod ani směrový ekvivalent;
- CSV je UTF-8 human export: skutečné sloupce mají přesné hlavičky `PRŮCHOD N`, plánové sloupce `PLÁN – PRŮCHOD N`. Žádný časový název nesmí obsahovat příchod, odchod, `IN`, `OUT`, `PŘESAH` ani směrový ekvivalent;
- počet sloupců je v rámci jednoho CSV stabilní;
- dny bez faktů lze vynechat stejně jako baseline, ale den s nulovou aktivní metrikou a jiným faktem se zachová;
- CSV používá UTF-8, čárkový delimiter a standardní quoting;
- ZIP pouze obaluje jednotlivé identické CSV kontrakty.

### Tisková čitelnost

- browser preview a výsledný browser PDF mají shodnou DOM kompozici;
- serverový PDF musí používat font pokrývající všechny tištěné znaky; žádné přibalené fontové soubory se nesmějí exportovat uživateli samostatně;
- weekend/holiday tone je sekundární a nesmí být jediným nositelem informace;
- stránkování, columns a font size jsou deterministické;
- žádný overflow nesmí v tichosti skrýt den, průchod nebo aktivní metriku;
- cílové detailní A4 pravidlo má přednost před baseline browser auto-layoutem.

## CI/CD, migrace a provozní uzavření

### CI backend

Na PostgreSQL 17 a Pythonu 3.12:

1. instalace přes hashovaný `requirements-dev.lock` s `pip==26.0`;
2. compileall;
3. Ruff;
4. mypy;
5. přesně jeden Alembic head;
6. upgrade čisté databáze na head;
7. pytest;
8. rebuild daily metrics v apply a následně check režimu;
9. repo invarianty;
10. current-state manifest `--check`;
11. čistý git diff/status.
12. build aplikačního wheelu, kompletního Linux wheelhouse a offline instalační smoke stejného artefaktu.

Python 3.12 locky generuje výhradně `scripts/update_python_locks.py` pomocí
`pip-tools==7.6.0`; `scripts/check_python_lock.py` ověřuje jejich vazbu na `pyproject.toml`,
úplné připnutí a SHA-256 hashe. Produkční dependency kontrakt je
`requirements-prod.lock`, vývojový a CI kontrakt `requirements-dev.lock`.

### CI frontend

Na Node 22 s reálným backendem a PostgreSQL 17:

1. backend install/migrate/seed/start;
2. `npm ci`;
3. branding;
4. lint;
5. typecheck;
6. Vitest;
7. Vite build;
8. zákaz `.map` souborů a `sourceMappingURL` v produkčním artefaktu;
9. Playwright Chromium E2E včetně browser, accessibility a visual projektů;
10. čistý git diff/status;
11. zabalení přesného web artefaktu.

Povinný security job před merge i deployem navíc provádí Python a npm dependency audit,
Bandit, CodeQL pro Python a JavaScript/TypeScript, secret scan a validaci centrálního
registry `.security/audit-exceptions.yml`. Security kroky nejsou warning-only a každá
GitHub Action je připnuta na plný commit SHA.

### Produkční deploy

- běží pouze po úspěšném security+backend+web jobu při push na `main` a po uzavření všech P0/P1 v implementační matici;
- release je immutable adresář identifikovaný přesným SHA;
- používá deployment lock;
- před změnou schématu ověřuje dostatek místa a případné serverové `.git/config` bez vložených credentialů; server nepoužívá Git jako zdroj release;
- backend se zastaví před migrací;
- Alembic upgrade a daily-metric rebuild apply/check proběhnou před aktivací release;
- po zahájení změny schématu nesmí žádná chybová větev znovu spustit starý backend;
- symlinky backendu a webu se přepnou atomicky;
- systemd a Nginx konfigurace se validují;
- po lokální readiness a verzi ověřuje samostatný GitHub runner veřejné HTTPS readiness, verzi, bezpečnostní hlavičky, frontend commit a anonymní Chromium shell bez console/network chyb;
- neúspěšná veřejná validace vrátí webový symlink; starý backend se vrátí a spustí pouze při prokázané shodě DB revision před a po deployi, jinak backend zůstane zastavený;
- release se označí jako úspěšný teprve po veřejném smoke a až potom se bezpečným skriptem zachová přesně pět úspěšných release včetně chráněného current/previous targetu; neznámé adresáře a symlinky se nesledují ani nemažou;
- nasazený frontend a backend musí být z jednoho commitu;
- backend je nasazován pouze z CI vytvořeného wheelu a přibaleného wheelhouse s ověřeným SHA-256 manifestem; produkční server nestahuje balíčky z indexu ani nesestavuje runtime z Git checkoutu.

### Alembic

- databázové schéma je výhradně verzované migracemi;
- CI vynucuje jeden head;
- nové modelové omezení bez odpovídající migrace je neuzavřená změna;
- destructive migrace musí mít explicitní data migration/backup strategii;
- žádný runtime `create_all` nesmí nahrazovat Alembic v produkci.

## Známé baseline asymetrie a autoritativní výklad

Tyto nesoulady byly nalezeny mezi aktivními vrstvami. Pro reprodukci platí výklad v pravém sloupci:

| Nesoulad | Nález | Autoritativní chování |
|---|---|---|
| manifest auth mode vs router dependencies | generátor rekurzivně čte skutečné FastAPI dependencies a používá malou explicitní mapu pouze pro bootstrap cesty | změna dependency musí změnit generovaný manifest a jeho contract test |
| frontend `Instance` typ vs backend | historický TS interface používá numerické/odlišné fields | backend UUID `Instance` je autorita; dormant interface se nesmí použít jako nový kontrakt |
| běžné API error envelope | všechna neintegrační API selhání používají `{error:{code,message,details?,request_id}}`; integrační API zachovává vlastní verzovaný envelope | frontend používá jediný parser neintegrační obálky a interní výjimky se klientovi nevracejí |
| public instance activation | register vytváří `PENDING`, admin list/activate provede auditovaný přechod a claim vyžaduje `ACTIVE` | aktivační odpověď nikdy neobsahuje token ani hash; token vzniká až explicitním claim/rotate flow |
| `last_login_at` v admin users | hodnota pochází z `Instance.last_seen_at` a je nastavena už při vytvoření | prezentovat jako poslední aktivitu instance, ne auditně přesný login |
| reminder „otevřená směna“ | worker načítá poslední event každého úvazku SQL pořadím `(occurred_at DESC,id DESC)` | reminder vznikne pouze když je poslední event `IN`; testy pokrývají IN/OUT/IN, cross-midnight i více uzavřených intervalů |
| portal/admin event update DTO | update přijímá plný create-like payload a kontroluje immutable employment/type; integration PATCH jen timestamp | klient nesmí zjednodušit portal/admin payload na `{occurred_at}` bez kompatibilní změny API |
| bind settings vs production Gunicorn | app Settings načte host/port, `gunicorn.conf.py` binduje pevně loopback 8101 | produkční reprodukce používá Gunicorn fakt; změna bindu vyžaduje úpravu jeho konfigurace |
| SMTP a integration admin UI vs API | backend CRUD existuje, auditované routes jsou informační | reprodukovat API i informační UI; nevymýšlet plný editor bez schváleného scope |
| current human export/print vs schválený cíl | baseline propouští směrové typy a overflow | cílový `PRŮCHOD` kontrakt níže je normativní a baseline prezentaci nahrazuje |

## Baseline → cílový stav: povinné rozdíly

Tato tabulka zabraňuje tomu, aby generátor slepě reprodukoval části auditovaného UI, které jsou tímto SSOT nahrazené.

| Oblast | Baseline na SHA `39db1556` | Cílový stav |
|---|---|---|
| Employee attendance | denní karty, event grid a samostatný add editor | jeden den = jeden tabulkový řádek, editace jen v cílových buňkách |
| Employee plan | karty a samostatná arrival/departure pole | stejný jednodenní tabulkový model `PRŮCHOD` |
| Group plan | paralelně cards a table | jediná matice člověk × den |
| Admin attendance | jedna samostatná denní tabulka na úvazek | společná hromadná matice člověk × den; úplný detail zůstává dostupný |
| Admin plan | jedna tabulka na úvazek | společná matice člověk × den |
| Přidávání eventu | pomocný „nový průchod/pár“ blok | přímá prázdná buňka v kanonickém řádku |
| Viditelné směry | některé labely/aria/tisk obsahují IN/OUT/Příchod/Odchod | všude pro člověka pouze `PRŮCHOD` a čas |
| Docházkový tisk | čtyři eventy, typ před časem, overflow `+N` | všechny časy bez typu, úplně auditovatelné, jeden člověk/měsíc/A4 |
| CSV | jeden `pruchody` string s `TYPE:timestamp` | chronologické `PRŮCHOD 1..N`, hodnoty pouze `HH:mm` |
| Mobile | část detailů se mění na cards | tabulka zůstává tabulkou, horizontální scroll/sticky |
| Design review | vizuální testy, ale bez povinné nekonečné design smyčky | blokující iterativní design gate podle tohoto SSOT |

Vše ostatní z baseline je zachováno, dokud tento dokument neurčuje jinak.

## Reprodukční akceptační scénáře

Následující scénáře jsou minimální behaviorální fingerprint systému:

1. **Prázdný WORK_CONTRACT měsíc:** `display_metrics = [total, night]`; denní i měsíční hodnoty jsou backendové `0,0`, nikoli chybějící.
2. **Zaokrouhlení:** 8 h 3 min → 8,1 h za den; měsíční součet je součet denních desetin.
3. **Přes půlnoc:** 31. 7. 22:00–1. 8. 02:00 vytvoří 2 h v červenci a 2 h v srpnu; oba dny jsou complete.
4. **Dlouhý interval přes celý měsíc:** interval 30. 6.–1. 8. vytvoří perzistentní denní řádek pro každý červencový den, i když v červenci není endpoint event.
5. **Otevřený event:** trailing event je viditelný, day state incomplete a nepřidává neuzavřený čas do metrik.
6. **Profilová retroaktivita:** zapnutí afternoon/weekend přepočítá historické dny a změní `display_metrics` bez změny eventů.
7. **TASK_SHIFT_BASED:** žádná hodinová metrika ani automatic breaks.
8. **Stav dne:** potvrzená sickness uprostřed vícedenního intervalu odstraní oba jeho endpoint eventy a konfliktní plán.
9. **Zámek přes hranici:** posun nebo vytvoření intervalu zasahujícího dva měsíce selže, je-li zamčen kterýkoli z nich.
10. **Plan carryover:** noční směna ukáže konec následující den read-only a současně případnou novou nepřekrývající se směnu.
11. **Automatic break:** uzavřený dlouhý interval vloží fyzické eventy; opakované admin backfill nic neduplikuje.
12. **Group scope:** zaměstnanec čte kolegy ve své skupině, ale write na cizí `employment_id` selže.
13. **Login window:** účet bez eligible úvazku se nepřihlásí, i když je osoba aktivní.
14. **External login:** nepropojený provider subject nevytvoří účet a vrátí bezpečnou chybu.
15. **Integration scope:** klient bez scope nebo mimo allowed employment nedostane data ani nemutuje.
16. **CSV target:** žádný human CSV cell/header neobsahuje směrový typ; všechny průchody jsou jednotlivé chronologické `HH:mm`.
17. **A4 detail:** 31 dní, maximální metriky a nejvýše čtyři průchody denně se vejdou na jednu čitelnou A4; data nad schválenou kapacitou vyvolají `print_capacity_exceeded`, nikoli ztrátu hodnot.
18. **Inline edit:** blur/Tab/Shift+Tab/Enter commit; Escape cancel; Delete+Enter po vstupu smaže; po pohybu caret maže znak.
19. **Server acknowledgment:** zelený flash až po úspěšné odpovědi; konflikt zachová draft a nezobrazí success.
20. **Locale parity:** stejné chování cs/en/sk/de/hi podle plochy, bez rozbití tabulky a bez viditelného směru eventu.
21. **Reset lifecycle:** nový reset revokuje starší odkazy; použití platného `SENT` odkazu v jedné transakci změní heslo, revokuje všechny reset/unlock tokeny i non-browser instance bearer a okamžitě zneplatní všechny browserové relace navázané na předchozí password credential.
22. **Integration data-scope baseline:** explicitní `allowed_employment_ids` omezuje data; samotný `SELECTED_EMPLOYEES` nebo `ALL_ACTIVE_EMPLOYMENTS` bez naplněného seznamu employment IDs aktivní router neomezí.
23. **Error envelope:** frontend zpracuje jedinou neintegrační obálku `{error:{code,message,details?,request_id}}`; integrační envelope zůstává verzovaný odděleně.
24. **Pagination truth:** každé `has_more=true` obsahuje neprázdný `next_cursor`; cizí nebo poškozený cursor vrací `invalid_cursor`.
25. **Update DTO compatibility:** portal/admin update odmítne změněný `employment_id`, změněný `event_type` nebo nenulový `paired_occurred_at`; integration PATCH přijme pouze timestamp.
26. **Instance lifecycle:** public register vytvoří pending instanci, admin ji s CSRF aktivuje a claim teprve poté vydá rotovaný token; admin create-user vytvoří active WEB instanci přímo.
27. **Reminder chronology:** IN–OUT–IN zůstává otevřený podle posledního eventu; cross-midnight OUT směnu uzavírá a stabilní tie-breaker je `id`.
28. **Human plan CSV:** carryover a běžné plánové hranice jsou očíslované `PLÁN – PRŮCHOD N`; žádná hlavička neobsahuje `PŘESAH`.
29. **Lockout:** třetí chybný portal login v hodinovém okně uzamkne účet na hodinu; pátý chybný admin login v 15minutovém okně uzamkne admin identitu na 15 minut bez prodlužování dalšími pokusy. Úspěšné přihlášení příslušný stav vyčistí.

## Forenzní mapa zdrojů

| Specifikační oblast | Primární zdroje auditu |
|---|---|
| kompozice backendu | `app/main.py`, `app/config.py` |
| datový model | `app/db/models.py`, `alembic/versions/*` |
| attendance API | `app/api/v1/attendance.py`, `app/api/v1/admin_attendance.py`, `app/services/attendance_events.py`, `attendance_mutations.py` |
| plán a skupiny | `app/api/v1/shift_plan.py`, `admin_shift_plan.py`, `admin_employment_groups.py`, `time_intervals.py` |
| stavy dne | `app/services/day_status.py` |
| metriky | `app/services/time_metrics.py`, `daily_metrics.py`, `month_summary.py` |
| úvazky | `app/api/v1/admin_employments.py`, `app/services/employment_access.py` |
| uživatelé/reset | `app/api/v1/admin_users.py`, `portal_auth.py`, security password/lockout modules |
| admin auth/CSRF | `app/api/v1/admin_auth.py`, `app/security/sessions.py`, `csrf.py` |
| externí auth | `app/api/v1/external_auth.py`, `app/services/external_auth.py` |
| integrations | `app/api/v1/integration.py`, `admin_integrations.py`, integration security/admin services |
| exporty/tisky | `app/api/v1/admin_export.py`, `app/services/shift_plan_reports.py`, `web/src/pages/AdminOperationsPages.tsx` |
| reminders | `app/services/attendance_reminders.py` |
| auto-lock | `app/services/shift_plan_auto_lock.py`, systemd timer/service |
| frontend routing | `web/src/App.tsx`, `Root.tsx` |
| frontend transport/state | `web/src/api/client.ts`, `api/types.ts`, `state/portalSession.ts` |
| employee UI | `web/src/pages/EmployeePage.tsx` |
| admin UI | `AdminShell.tsx`, `AdminOverviewPage.tsx`, `AdminUsersPage.tsx`, `AdminMatrixPages.tsx`, `AdminOperationsPages.tsx`, `AdminEmploymentGroupsPage.tsx`, `AdminAccountPage.tsx` |
| design | `web/src/styles.css`, komponenty v `web/src/components/*` |
| i18n | `web/src/i18n.ts`, `i18n/language.ts`, `i18n/resources.ts` |
| test contract | `tests/*`, `web/tests/*` |
| CI/deploy | `.github/workflows/ci-cd.yml`, `ops/*`, `gunicorn.conf.py` |
| generovaný inventář | `docs/current-state-manifest.yaml` |

## Forenzní uzavření úplnosti

Implementátor před zahájením změn a znovu před předáním provede:

1. vygenerování current-state manifestu a diff proti endpointům/routám v tomto dokumentu; zvlášť se ověří bootstrap auth cesty `admin/login`, `admin/csrf`, `admin/me`, `admin/logout` a `admin/forgot-password`, protože auditovaný generovaný manifest jejich auth mode klasifikoval přísněji než skutečné router dependencies;
2. inventuru všech SQLAlchemy modelů, tabulkových názvů, enumů, FK/unique/check omezení a Alembic headu proti datovým sekcím;
3. inventuru všech React rout, navigačních položek, modalů a tiskových ploch proti obrazovkové specifikaci;
4. hledání produkčních výskytů `IN`, `OUT`, `Příchod`, `Odchod` a lokalizovaných směrových ekvivalentů; interní strojové výskyty se whitelistují, human výskyty jsou blocker;
5. hledání všech časových inputů mimo sdílený `ClockInput`; každý je blocker nebo explicitně zdůvodněný ne-docházkový input;
6. hledání cards/side/modal add editorů nahrazeného docházkového layoutu;
7. mapování každého API write na lock, period, activity recheck, status conflict a metric sync;
8. mapování každé aktivní metriky na backend payload, UI, tisk, CSV a test;
9. kontrolu všech jazyků a viewportů;
10. kontrolu testů, CI, manifestu, README, AGENTS a deploye.

SSOT je považován za reprodukčně uzavřený pouze tehdy, když žádný aktivní route, endpoint, tabulka, background proces, export, tisk, auth flow nebo hlavní UI stav není bez normativního vlastníka a akceptačního důkazu.

## Závazný prezentační model docházky a plánu služeb

### Společný princip

Docházka a plán služeb používají napříč zaměstnaneckým rozhraním, administrací, skupinovými pohledy, responzivními variantami a tiskem jednotný tabulkový model. Nesmí existovat několik vzájemně odlišných způsobů zadávání stejného údaje.

Ruční zadávání a editace časů v běžném uživatelském rozhraní probíhají výhradně živě přímo v buňkách kanonických tabulek. Zakázané jsou zejména:

- boční editory, boční panely a formuláře s časem mimo příslušnou tabulku;
- samostatné formuláře typu „zadej průchod a následně jej přenes do tabulky“;
- pomocné přidávací řádky nebo karty, které nejsou přímou součástí cílového denního řádku či denní buňky;
- modální dialogy určené k samotnému zadávání času;
- druhý paralelní způsob editace téhož času.

Dialog nebo potvrzení je povolené pouze pro skutečně destruktivní, konfliktní nebo hromadné operace. Nesmí se stát běžným mezikrokem při uložení jedné časové buňky. Integrační API, importy, provozní backfilly a potvrzené hromadné doplnění přestávek nejsou ručním UI zadáváním a tento zákaz je neruší.

### Povinný prezentační kontrakt PRŮCHOD

Tento kontrakt je blokující a platí bez výjimky pro všechna zaměstnanecká a administrátorská UI, mobilní, tabletové a desktopové varianty, skupinové a hromadné matice, tiskové náhledy, PDF a fyzické tisky a lidsky čitelné CSV/ZIP exporty:

- žádný lidsky čitelný výstup nesmí zobrazit text, zkratku, ikonu, šipku, prefix, suffix ani jinou značku vyjadřující směr eventu; zakázané jsou zejména viditelné hodnoty nebo popisky `IN`, `OUT`, `Příchod`, `Odchod` a jejich jazykové ekvivalenty;
- každý viditelný časový sloupec nebo pole má neutrální záhlaví `PRŮCHOD`; v ostatních jazycích se použije jediný lokalizovaný neutrální ekvivalent téhož pojmu, nikdy dvojice významově rozlišující vstup a výstup;
- pokud médium vyžaduje rozlišení více sloupců, používá se pouze pořadí, například accessible name nebo CSV hlavička `PRŮCHOD 1`, `PRŮCHOD 2`, `PRŮCHOD 3`; viditelný UI a tiskový nadpis může opakovat samotné `PRŮCHOD`;
- obsah časové buňky, tiskového pole a exportní hodnoty je pouze kanonický čas `HH:mm`, případně prázdná hodnota; nesmí obsahovat směr, typ eventu ani vysvětlující text;
- význam a párování eventů určuje výhradně jejich chronologické pořadí a interní doménový kontrakt, nikoli lidsky zobrazená značka;
- interní backendové a databázové typy eventů se tímto pravidlem neruší, ale nesmějí prosáknout do lidského UI, tisku, PDF ani CSV/ZIP exportu;
- integrační API je strojový kontrakt, nikoli lidský export. Smí zachovat interní typ eventu nutný pro bezpečný round-trip, avšak nesmí být použito jako zdroj viditelných `IN`/`OUT` popisků v aplikaci nebo reportech.

Porušení kteréhokoli bodu je blocker pro merge i deploy.

### Detail jednoho úvazku: jeden den je jeden řádek

V detailu docházky nebo plánu služeb jednoho `employment_id` platí na desktopu, tabletu, mobilu i v tiskovém náhledu:

- jeden kalendářní den je vždy přesně jeden vizuální řádek;
- řádek se nesmí převádět na kartu, rozbalovat do více vertikálních řádků ani měnit výšku podle počtu eventů;
- základní pořadí sloupců je `Datum`, `Den`, časové eventy nebo plánované časy, celodenní stav a denní metriky podle `display_metrics`;
- standardní časová část rezervuje nejméně čtyři po sobě jdoucí sloupce s viditelným záhlavím `PRŮCHOD`; jejich chronologické pořadí je interně a pro přístupnost číslováno 1 až N;
- počet časových sloupců je jednotný pro celou právě zobrazenou měsíční tabulku: `max(4, nejvyšší počet eventů v jediném dni načteného měsíce)`. Každý den používá stejné pozice; pátý a další event dostane další chronologický sloupec `PRŮCHOD`. Řádek zůstává jediný a tabulka používá horizontální posun;
- obsazená buňka je vždy svázána se stabilním event ID. Z prázdných chronologických pozic je pro vytvoření aktivní pouze první pozice bezprostředně za posledním eventem; pozdější mezery jsou disabled, aby nevznikala nejednoznačná posloupnost. Backendové `next_event_type` určuje interní typ nového eventu, ale UI jej člověku nezobrazuje;
- v plánovém detailu se stejná čtyřsloupcová geometrie zachová, ale baseline model perzistuje nejvýše jeden interval začínající v daném dni. Chronologické hranice plánu/carryover obsadí dostupné pozice a zbývající buňky jsou prázdné a read-only; nesmějí se vydávat za podporu druhého nezávislého plánového intervalu. Taková podpora by vyžadovala samostatnou změnu schématu a API;
- editace stávající buňky mění pouze timestamp příslušného event ID. Vytvoření nebo smazání se nesmí simulovat přepsáním jiného eventu;
- celodenní stav je zobrazen kompaktně v témže řádku a nesmí rozbít jeho jednotnou výšku;
- denní součty jsou vždy viditelné v témže řádku pouze pro metriky uvedené v `display_metrics`;
- měsíční součty stejných metrik jsou v samostatném pevném souhrnném řádku pod posledním dnem;
- součty dodává backend a frontend je pouze formátuje.

### Nápověda plánu v docházce

V docházce se u relevantní chronologické pozice zobrazuje plánovaná hodnota daného úvazku a dne jako neinteraktivní nápověda:

- nápověda je typograficky sekundární, například šedá kurzíva nad nebo vedle editované hodnoty;
- nesmí být zaměnitelná s uloženou docházkou a nesmí se automaticky zapisovat do eventu;
- backend nebo prezentační adapter sestaví pro kalendářní den chronologický seznam plánových hranic: nejprve případný carryover konec z předchozího dne, poté začátek a konec směny začínající v daném dni. Hodnoty se po pořadí mapují na odpovídající `PRŮCHOD` pozice; při souběžném carryover a nové směně se žádná hranice nesmí přepsat;
- chybějící plán nezobrazuje falešnou nulu ani výchozí čas;
- nápověda obsahuje pouze čas `HH:mm`, nikdy směrový text nebo symbol.

### Hromadná adminská matice a zaměstnanecký skupinový plán

V hromadném adminském zpracování docházky, hromadném plánu služeb a zaměstnaneckém skupinovém plánu platí:

- jeden konkrétní `employment_id` je jeden pevný vizuální řádek. Jméno osoby a název úvazku jsou jeho label; dva úvazky stejné osoby jsou dva samostatné řádky;
- první pevný sloupec obsahuje jméno a označení úvazku;
- každý kalendářní den je jeden sloupec;
- v každé denní buňce jsou přesně dvě kompaktní časové editační buňky nad sebou, každá o přibližně polovině výšky řádku;
- u docházky horní buňka zobrazuje čas prvního chronologického eventu dne a dolní čas posledního chronologického eventu dne. Má-li den právě jeden event, zobrazí se jednou pouze nahoře a dolní buňka zůstane prázdná; hodnota se nesmí duplikovat;
- obě pole spadají pod neutrální označení `PRŮCHOD` a nesmějí zobrazit ani naznačit typ či směr eventu;
- mezilehlé eventy se zachovávají beze změny a indikátor je přesně `+N`, kde `N = max(0, počet_eventů_dne - 2)`; indikátor je navigační informace, nikoli náhrada úplného detailu;
- pokud je posloupnost neúplná, UI zobrazí pouze skutečně dostupný čas v jeho chronologické pozici; nesmí domýšlet chybějící event;
- editace horní nebo dolní buňky mění pouze stabilní ID konkrétního zobrazeného eventu; skryté mezilehlé eventy nesmí být změněny ani odstraněny;
- úplná posloupnost a její mezilehlé eventy se upravují v detailním jednodenním řádku stejné kanonické tabulky, nikoli v bočním nebo modálním editoru;
- u plánu služeb horní buňka zobrazuje první a dolní druhou chronologickou hranici intervalu začínajícího v daném dni. Carryover z předchozího dne je jasně odlišen jako read-only kontext, avšak bez směrového popisku;
- administrátor může editovat všechny úvazky, pro které má oprávnění, pouze pokud to dovolují zámky a doménové kontroly;
- zaměstnanec může ve skupinovém pohledu editovat pouze svůj vlastní `employment_id`; ostatní řádky jsou pouze ke čtení;
- uzamčená buňka zůstává čitelná, ale není editovatelná;
- matice zachovává jeden řádek na `employment_id` také na mobilu a tabletu; používá horizontální posun a pevný sloupec identity, nikoli převod na karty.

## Přímá editace časové buňky

### Životní cyklus editace a ukládání

- aktivace buňky myší, dotykem nebo klávesnicí zahájí editaci přímo v dané buňce;
- opuštění změněné buňky kliknutím mimo ni, klávesou `Tab`, `Shift+Tab` nebo potvrzením klávesou `Enter` okamžitě odešle změnu k uložení;
- `Enter` uloží hodnotu a přesune fokus na logicky následující buňku podle jednotného tabulkového pořadí;
- `Tab` a `Shift+Tab` uloží hodnotu a zachovají standardní pořadí klávesnicové navigace;
- `Escape` zruší neuloženou změnu, obnoví poslední serverem potvrzenou hodnotu a nic neodešle;
- pro běžnou změnu jedné buňky neexistuje samostatné tlačítko Uložit;
- po dobu síťového požadavku má buňka jednoznačný, ale nerušivý stav ukládání a nesmí odeslat duplicitní mutaci téže hodnoty;
- `onCommit` musí mít awaitovatelný kontrakt nebo ekvivalentní parent acknowledgment. Krátké zelené probliknutí či přístupný stav úspěchu se spustí až po vyřešeném úspěchu serverové mutace, nikdy bezprostředně po zavolání callbacku ani optimisticky před odpovědí;
- vizuální potvrzení úspěchu je krátké, neblokující a není jediným nositelem informace; stav musí být rozpoznatelný i bez vnímání barvy;
- při lokálně neplatném vstupu, serverové chybě, konfliktu nebo zamčeném období se zelené potvrzení nezobrazí a rozepsaný draft zůstane v buňce, dokud jej uživatel neopraví, nezruší přes `Escape` nebo nedojde k úspěšnému refetchi po explicitní akci;
- auditovaný `ClockInput` dnes neplatný draft vrací na serverovou hodnotu a success spouští bez čekání na server; cílová implementace toto baseline chování musí odstranit;
- změna se po úspěšném uložení promítne do denních i měsíčních metrik načtených z backendu.

### Mazání hodnoty klávesou Delete

Každá editovatelná časová buňka používá tento závazný model:

- bezprostředně po vstupu do buňky je její stávající hodnota v režimu celé buňky;
- pokud uživatel před pohybem kurzoru nebo jinou editací stiskne `Delete` a následně `Enter`, odstraní se celý obsah buňky a uloží se prázdná hodnota nebo odpovídající odstranění eventu;
- stejné chování může platforma nabídnout klávesou `Backspace`, pokud je to její standardní mapování mazání celé vybrané hodnoty;
- jakmile uživatel pohne textovým kurzorem, změní výběr nebo začne hodnotu psát, `Delete` a `Backspace` se chovají standardně po znacích podle polohy kurzoru;
- mazání eventu musí nadále respektovat `deletion_partner_id`/`paired_event_id`, chronologii, zámky, celodenní stavy a všechny backendové konflikty;
- pokud samostatné odstranění poruší alternaci, UI nesmí event tiše smazat; musí použít backendem dovolený párový delete nebo zobrazit konflikt;
- potvrzení dopadu se používá pouze tam, kde server skutečně poskytuje strukturovaný potvrzovací protokol.

### Normalizace časového vstupu

Dvojtečka není povinná. Parser je jednotný ve všech tabulkách, jazycích a zařízeních:

- `1` se uloží jako `01:00`;
- `10` se uloží jako `10:00`;
- `930` se uloží jako `09:30`;
- `0124` se uloží jako `01:24`;
- `1234` se uloží jako `12:34`;
- `1:24` a `01:24` se uloží jako `01:24`;
- jedna tečka může být přijata jako alternativní oddělovač a normalizována na dvojtečku;
- okolní mezery se ignorují;
- jedna až dvě číslice znamenají hodinu a nulové minuty;
- tři číslice znamenají `HMM` a čtyři číslice `HHMM`;
- platný rozsah je `00:00` až `23:59`;
- neplatná hodnota se nesmí tiše opravit na jiný čas, nesmí se uložit a musí vyvolat lokalizovaný chybový stav v buňce;
- výsledná serverová hodnota a hodnota zobrazená po uložení mají kanonický formát `HH:mm`.

## Responzivita a jazykové varianty

- detail jednoho úvazku zachovává jeden den na jednom řádku na mobilu, tabletu i desktopu;
- hromadná a skupinová matice zachovává jeden `employment_id` na jednom řádku na mobilu, tabletu i desktopu;
- zmenšení viewportu nesmí převést tabulku na denní nebo zaměstnanecké karty;
- tabulka smí použít horizontální posun, sticky hlavičku, sticky sloupce `Datum`/`Den` nebo identitu úvazku a sticky hlavní denní součet;
- denní celková metrika, pokud je v `display_metrics`, musí zůstat dosažitelná a jednoznačně spojená s příslušným dnem i při horizontálním posunu;
- dotykové ovládání nesmí odstranit přímou editaci buňky a musí mít aktivní výšku nejméně 44 px bez zbytečného zvětšení celého řádku;
- žádný viewport nesmí skrývat hodnoty bez dostupné horizontální navigace nebo je ořezávat bez možnosti přečtení;
- chování editace, ukládání, mazání, zámků, nápovědy a potvrzení úspěchu je shodné ve všech jazykových variantách;
- veškeré nové texty, aria popisy, chyby, stavové zprávy, tiskové nadpisy a indikátory musí být lokalizované;
- pravidla číselného zadání času jsou nezávislá na jazyku a locale;
- administrace musí být ověřena v `cs`, `en`, `sk`, `de`; zaměstnanecké pohledy navíc v `hi`;
- delší překlady nesmí změnit informační hierarchii, způsob editace ani rozbít tabulku.

## Tiskové výstupy

### Detail jednoho úvazku

Pro tisk docházky i plánu služeb platí:

- jeden `employment_id` za jeden měsíc je jedna stránka A4 na šířku; stránka obsahuje všechny dny, název osoby, název úvazku, typ výstupu, měsíc, denní data a měsíční součty;
- každý kalendářní den je přesně jeden řádek;
- časové hodnoty jsou pouze `HH:mm` pod neutrálním záhlavím `PRŮCHOD`; žádný směr ani interní typ se netiskne;
- základní a povinně automaticky testovaná kapacitní obálka je 28–31 dní, nejvýše čtyři průchody v jednom dni, všech pět aktivních metrik, dlouhé jméno, dlouhý název úvazku a všechny podporované jazyky. V této obálce musí být výstup vždy právě jedna čitelná A4 bez druhé stránky, ořezu nebo překryvu;
- datový model zůstává neomezený. Pro den s více než čtyřmi eventy se další časy skládají chronologicky do téže časové části stejného řádku, bez `+N` jako náhrady skutečných hodnot;
- neomezený počet eventů a současně absolutní garance jedné čitelné fyzické A4 jsou matematicky neslučitelné. Pokud konkrétní data překročí schválenou tiskovou kapacitu i při minimální povolené velikosti písma a spacingu, systém nesmí vytvořit lossy, oříznutý ani nečitelný tisk. Náhled musí vrátit explicitní lokalizovaný stav `print_capacity_exceeded`, označit dotčený úvazek/dny a nabídnout úplný lidský CSV/ZIP export; rozšíření tiskového formátu je před dalším deployem produktový blocker a podléhá design gate;
- minimální velikost běžného tiskového textu i časů/součtů je 7 pt; pod tuto hranici se layout nesmí automaticky zmenšovat;
- měsíční součty všech aktivních `display_metrics` jsou v pevném souhrnu dole na stejné stránce;
- šířky sloupců, řádkování, fonty a mezery jsou deterministické a verzované v tiskovém layoutu;
- tisk respektuje všechny podporované jazyky a delší překlady;
- tiskový náhled a skutečný browser tisk/PDF používají stejný datový kontrakt a shodnou kompozici;
- serverový souhrnný PDF plánu může zůstat samostatným víceosobovým reportem, ale nenahrazuje tento detailní A4 kontrakt.

### Souhrnné a hromadné tisky

Souhrnné tisky mohou mít více úvazků, ale musí zachovat:

- konzistentní označení úvazku a měsíce;
- stejný význam denních a měsíčních metrik jako v detailu;
- žádné frontendové přepočítávání backendových hodnot;
- čitelné a auditovatelné zobrazení chronologických časů, zámků a stavů podle účelu konkrétního reportu; časové hodnoty jsou vždy pouze `HH:mm` pod neutrálním záhlavím `PRŮCHOD`, bez směrových popisků.

## Povinná iterativní design gate

### Kdy je design gate povinná

Design gate je blokující podmínkou pro každou změnu, která ovlivňuje alespoň jednu z těchto oblastí:

- layout, rozměry, pořadí nebo viditelnost prvků;
- tabulky, buňky, řádky, sloupce, sticky oblasti nebo horizontální posun;
- přímou editaci, klávesnicovou nebo dotykovou interakci;
- barvy, typografii, spacing, ikony nebo vizuální stav ukládání a chyb;
- mobilní, tabletovou nebo desktopovou responzivitu;
- tiskový náhled, PDF nebo fyzický tisk;
- lokalizovaný text, pokud může ovlivnit zalomení, rozměry nebo čitelnost layoutu.

Čistě backendová změna bez jakéhokoli vizuálního nebo interakčního dopadu plnou design gate nevyžaduje. Jakmile ale mění data, stavy nebo texty zobrazované v UI, musí být vizuální dopad prověřen.

### Povinný průběh iterací

1. Před implementací se designerovi předloží přesný návrh změny, její rozsah, dotčené pohledy, datové stavy a responzivní pravidla.
2. Připomínky designera se zapracují do návrhu před uzavřením implementačního směru.
3. Po implementaci se designerovi předloží skutečné rendery z běžící aplikace s reálnými komponentami a realistickými daty. Wireframe, Figma návrh, statický mock nebo ručně nakreslený obraz není důkazem hotové implementace.
4. Povinné rendery pokrývají všechny dotčené obrazovky na mobilu, tabletu a desktopu a skutečný tiskový náhled nebo vyrenderované PDF, pokud je dotčen tisk.
5. Povinné rendery pokrývají všechny jazyky dostupné na dotčené ploše, nikoli jen vybraný vzorek. Hindi se ověřuje skutečným devanágarským fontem.
6. Designer vrátí komentáře, implementace se upraví a celý dotčený soubor reálných renderů se předloží znovu.
7. Smyčka `render → komentář → úprava → nový render` se opakuje bez limitu, dokud designer výslovně nepotvrdí, že všechny dotčené varianty jsou v pořádku.
8. Částečné schválení jedné šířky, jednoho jazyka nebo jednoho pohledu není schválením ostatních variant.
9. Nevyřešená připomínka designera je blocker. Změna se nesmí mergovat, označit za hotovou ani nasadit do produkce.

### Minimální sada design-review důkazů

Pro tabulkové změny docházky a plánu musí každá finální iterace obsahovat alespoň:

- mobilní viewport přibližně 390 × 844;
- tabletový viewport přibližně 768 × 1024;
- desktopový viewport přibližně 1440 × 900;
- detail docházky jednoho úvazku;
- detail plánu služeb jednoho úvazku;
- adminskou hromadnou docházku;
- adminský hromadný plán služeb;
- zaměstnanecký skupinový plán;
- zamčený i odemčený měsíc;
- ukládání, potvrzený úspěch a chybový stav buňky;
- den se dvěma intervaly, den s více než dvěma intervaly, neúplnou posloupnost a interval přes půlnoc;
- úvazek s maximálním počtem aktivních `display_metrics`;
- dlouhé jméno a dlouhý název úvazku;
- všechny relevantní jazykové varianty;
- tisk docházky a plánu s 31 dny a nejvýše čtyřmi průchody denně fitnutý na jednu A4 a samostatný důkaz bezpečného `print_capacity_exceeded` nad touto obálkou.

Důkazy a finální souhlas designera musí být dohledatelné v pull requestu, navázaném issue nebo verzovaném design-review záznamu. Pouhé ústní potvrzení bez dohledatelného artefaktu nestačí.

## Přístupnost a interakční kvalita

- všechny časové buňky mají jednoznačný lokalizovaný accessible name obsahující úvazek, datum, neutrální pojem `Průchod` a chronologické pořadí; accessible name nesmí obsahovat ani odvozovat směr eventu;
- klávesnicová navigace je úplná a pořadí fokusu odpovídá vizuálnímu pořadí tabulky;
- focus indikátor je vždy viditelný a nesmí být překryt sticky oblastí;
- stav ukládání, úspěchu, chyby a zamčení je dostupný čtečkám obrazovky;
- zelené nebo červené zvýraznění není jediným prostředkem rozlišení stavu;
- při síťové chybě se rozepsaná hodnota neztratí;
- dotyková editace nesmí vyžadovat přesné trefení do malého textu;
- vizuální kompaktnost nesmí snížit čitelnost pod schválené minimum.

## Hlavní komponenty

- `app/main.py` skládá aplikaci, middleware, health a version endpointy a registruje routery;
- `app/config.py` drží runtime konfiguraci a doménové invarianty;
- `app/services/attendance_reminders.py` zajišťuje background připomínky;
- `app/services/external_auth.py` zajišťuje Google a Apple auth toky;
- `app/services/time_metrics.py` a související služby jsou autoritou časových metrik;
- `web/src/api/client.ts` je sdílený frontendový HTTP klient;
- `web/src/components/ClockInput.tsx` je sdílená implementace přímé editace časové buňky a nesmí mít pohledově rozdílné paralelní náhrady;
- `web/src/utils/timeInput.ts` je jediná frontendová normalizace ručního časového vstupu;
- `web/src/pages/EmployeePage.tsx` obsluhuje zaměstnaneckou docházku, vlastní plán a skupinový plán;
- `web/src/pages/AdminOverviewPage.tsx`, `web/src/pages/AdminUsersPage.tsx`, `web/src/pages/AdminMatrixPages.tsx`, `web/src/pages/AdminOperationsPages.tsx`, `web/src/pages/AdminEmploymentGroupsPage.tsx` a `web/src/pages/AdminAccountPage.tsx` obsluhují administraci;
- `web/src/pages/IntegrationDocsPage.tsx` obsluhuje veřejnou integrační dokumentaci.

## Úplná matice závazných ploch a konzumentů

Následující matice je normativní inventář. Implementátor nesmí rozhodovat, zda některou plochu vynechá. Pokud se konkrétní funkce v aktuálním kódu nachází v jiné komponentě, upraví se skutečný vlastník funkce a současně se opraví tato dokumentace a manifest; požadovaná plocha se však nesmí redukovat.

| Plocha | Docházka / plán | Požadovaný layout | Editace | Zámky a oprávnění | Tisk |
|---|---|---|---|---|---|
| Zaměstnanec – vlastní docházka | docházka | jeden den = jeden řádek; `Datum`, `Den`, čtyři chronologické sloupce `PRŮCHOD`, stav, aktivní denní metriky | přímo v buňkách | pouze vlastní přístupný úvazek, respektovat docházkový zámek | detail jednoho úvazku / měsíce na jedné A4 v definované kapacitní obálce |
| Zaměstnanec – vlastní plán | plán | stejný jednodenní řádek a stejné principy kompaktnosti | přímo v buňkách | pouze vlastní přístupný úvazek, respektovat plánový zámek | detail jednoho úvazku / měsíce na jedné A4 v definované kapacitní obálce |
| Zaměstnanec – skupinový plán | plán | jeden `employment_id` = jeden řádek, jeden den = jeden sloupec, dvě časové buňky nad sebou | pouze vlastní řádek | ostatní pouze ke čtení; vlastní řádek podle zámku | podle stávajícího účelu reportu, bez změny významu dat |
| Administrátor – detail docházky | docházka | shodný jednodenní řádek jako zaměstnanec | přímo v buňkách | podle admin oprávnění a docházkového zámku | detail jednoho úvazku / měsíce na jedné A4 v definované kapacitní obálce |
| Administrátor – detail plánu | plán | shodný jednodenní řádek jako zaměstnanec | přímo v buňkách | podle admin oprávnění a plánového zámku | detail jednoho úvazku / měsíce na jedné A4 v definované kapacitní obálce |
| Administrátor – hromadná docházka | docházka | jeden `employment_id` = jeden řádek, jeden den = jeden sloupec, dvě časové buňky nad sebou | přímo v buňkách | podle admin oprávnění a docházkového zámku | beze ztráty eventů a metrik |
| Administrátor – hromadný plán | plán | jeden `employment_id` = jeden řádek, jeden den = jeden sloupec, dvě časové buňky nad sebou | přímo v buňkách | podle admin oprávnění a plánového zámku | beze ztráty plánů a metrik |
| Tiskový náhled docházky | docházka | jeden den = jeden řádek | bez editace | zobrazuje potvrzená data | jeden `employment_id` + jeden měsíc = jedna A4 v definované kapacitní obálce; mimo ni explicitní `print_capacity_exceeded` |
| Tiskový náhled plánu | plán | jeden den = jeden řádek | bez editace | zobrazuje potvrzená data | jeden `employment_id` + jeden měsíc = jedna A4 v definované kapacitní obálce; mimo ni explicitní `print_capacity_exceeded` |
| CSV/ZIP lidský export | docházka / plán | chronologické sloupce `PRŮCHOD 1..N`; hodnoty pouze `HH:mm`, bez směru nebo typu | bez UI editace | stávající scope a filtry | nesmí být datově redukován a nesmí obsahovat `IN`/`OUT`, příchod/odchod ani jejich ekvivalenty |
| Integrační API | docházka / plán | strojový kontrakt, nikoli lidské zobrazení | bez UI editace | stávající scope a filtry | zachovává interní typy nutné pro round-trip; nesmí určovat viditelné popisky UI, tisku nebo lidského exportu |

Pro každou řádku matice musí existovat konkrétní implementace a odpovídající ověření. Neexistence testu nebo screenshotu pro některou řádku znamená neuzavřenou změnu.

## Deterministická reprezentace eventů

Aby implementátor nemusel dělat produktová rozhodnutí, platí:

1. Datový model zůstává neomezenou chronologickou posloupností interních `IN`/`OUT`; prezentační vrstva nikdy den nepřepisuje na čtyři databázová pole.
2. Měsíční detail vypočte jediný table-wide počet průchodových sloupců `max(4, max(event_count_per_day))`. Všechny denní řádky mají stejné sloupce a obsazené hodnoty jsou chronologicky zleva doprava.
3. Každá obsazená buňka drží stabilní event ID. Pro append je editovatelná pouze první prázdná pozice za posledním eventem; další prázdné pozice jsou disabled. Interní typ nového eventu dodá backendové `next_event_type`, ale nesmí se zobrazit člověku.
4. Editace existující buňky mění pouze timestamp jejího event ID. Pokud změna poruší chronologii, alternaci, období, status nebo zámek, server ji atomicky odmítne a UI zachová draft.
5. Hromadná a skupinová matice má dvě buňky: nahoře první a dole poslední chronologický event dne. Při jediném eventu je čas pouze nahoře; při nule jsou obě prázdné. Indikátor mezilehlých eventů je `+max(0,count-2)` a není směrovou značkou.
6. Editace horní/dolní matice mění jen příslušný krajní event ID. Mezilehlé eventy se nesmějí posunout, přepsat ani smazat. Úplná editace je dostupná navigací do kanonického detailu, nikoli alternativním editorem.
7. Plán má chronologické hranice bez směrových labelů. Pro den se seznam sestaví jako případný carryover konec a poté začátek/konec plánu startujícího v daném dni; mapuje se po pořadí do `PRŮCHOD` pozic.
8. Lidské CSV/ZIP exporty jsou úplnou bezeztrátovou reprezentací: počet sloupců `PRŮCHOD 1..N` odpovídá maximu eventů v exportované množině a hodnoty jsou pouze `HH:mm` nebo prázdné.
9. Detailní tisk je úplný v definované A4 kapacitní obálce. Nad ní nesmí dojít k tichému zkrácení; aktivuje se explicitní `print_capacity_exceeded` a úplný CSV/ZIP výstup.
10. Interní typy zůstávají zachované v databázi, aplikačních DTO a integračním API pro round-trip a validaci, ale jsou zakázaným lidským prezentačním údajem.

## Implementační pracovní balíky v závazném pořadí

Implementátor postupuje v následujícím pořadí. Přeskakování balíku je povolené pouze tehdy, pokud je doloženo, že aktuální stav již celý balík splňuje a příslušné testy projdou.

### Balík 1 – kontrakty a inventura

- zmapovat skutečné DTO, Zod schéma, API metody a komponenty pro všechny řádky matice ploch;
- potvrdit stabilní identifikátory jednotlivých eventů a oddělené zámky docházky a plánu;
- doplnit nebo upravit kontrakt pouze tam, kde UI nedostává úplnou posloupnost, plánové hinty, carryover, aktivní metriky nebo stav zámku;
- nevytvářet druhý paralelní endpoint pro nový layout, pokud stávající endpoint lze rozšířit kompatibilně.

### Balík 2 – sdílený editor času

- uzavřít `ClockInput` a `normalizeTimeInput` jako jedinou implementaci parsování a životního cyklu časové buňky;
- implementovat režim celé buňky po vstupu, rozlišení `Delete` před a po pohybu kurzoru, commit při blur/Tab/Shift+Tab/Enter, cancel přes Escape a saving/success/error/locked stavy; `onCommit` musí být awaitovatelný a success vzniká až po server acknowledgment;
- všechny pohledy musí sdílenou komponentu skutečně používat, nikoli kopírovat její logiku.

### Balík 3 – detaily jednoho úvazku

- převést zaměstnaneckou docházku, zaměstnanecký plán, admin detail docházky a admin detail plánu na jeden den v jednom řádku;
- odstranit běžné boční, kartové, pomocné a potvrzovací zadávání času;
- zachovat plánovou nápovědu v docházce, stavy, carryover, zámky a denní i měsíční metriky.

### Balík 4 – hromadné a skupinové matice

- zavést jeden řádek na `employment_id` a jeden sloupec na den; jméno a název úvazku jsou pevný řádkový label;
- uvnitř denní buňky zavést dvě vertikálně rozdělené časové buňky;
- zachovat sticky identitu, horizontální posun, vlastní editaci zaměstnance a read-only ostatních;
- zajistit, že editace krajního eventu nezmění skryté mezilehlé eventy.

### Balík 5 – responzivita, lokalizace a přístupnost

- ověřit a opravit mobil, tablet, desktop, všechny dostupné jazyky, klávesnici, dotyk, čtečku obrazovky a dlouhé hodnoty;
- žádná responzivní varianta nesmí zavést odlišný editační model nebo karty místo tabulky.

### Balík 6 – tisk a lidské exporty

- sjednotit tiskový a lidský exportní datový kontrakt s interaktivním detailem;
- vytvořit deterministické šířky sloupců, tiskové CSS a jednoznačné chronologické CSV/ZIP hlavičky `PRŮCHOD 1..N`;
- odstranit ze všech UI, tisků, PDF a lidských exportů viditelné `IN`, `OUT`, příchod, odchod, směrové ikony, šipky a jiné směrové kódy;
- ověřit docházku i plán pro 28, 29, 30 a 31 dní, maximální aktivní metriky, dlouhá jména, dlouhý název úvazku, všechny relevantní jazyky a nula až čtyři průchody denně;
- v této kapacitní obálce musí být jeden úvazek / jeden měsíc přesně jedna A4 bez druhé stránky; zvláštní fixture s více než čtyřmi eventy musí prokázat buď čitelné jedno-A4 zobrazení, nebo deterministický `print_capacity_exceeded` bez ztráty dat;
- CSV/ZIP vzorky musí prokázat, že všechny časové hlavičky jsou `PRŮCHOD 1..N` a všechny neprázdné hodnoty jsou pouze `HH:mm`.

### Balík 7 – odstranění nahrazeného řešení

- odstranit nepoužité formuláře, komponenty, styly, překlady, selektory a testy starého způsobu zadávání;
- repo nesmí obsahovat aktivní feature flag, skrytý fallback nebo paralelní produkční cestu ke starému editoru;
- git historie je jediným archivem nahrazeného řešení.

### Balík 8 – důkazy, design gate a uzavření

- spustit všechny automatické kontroly;
- vygenerovat reálné rendery předepsané design gate;
- opakovat připomínkovou smyčku až do písemného finálního souhlasu designera;
- aktualizovat SSOT, manifest, README, AGENTS a další aktivní dokumentaci podle skutečně dokončeného stavu;
- teprve potom je změna způsobilá k merge a deployi.

## Zakázaná implementační rozhodnutí a kompromisy

Implementátor nesmí bez změny tohoto SSOT:

- snížit rozsah na jediný pohled, jediný jazyk nebo jediný viewport;
- nahradit tabulku kartami na mobilu;
- ponechat starý editor „dočasně“ jako fallback;
- uložit změnu pouze lokálně a synchronizovat ji později bez viditelného chybového stavu;
- zobrazit zelený úspěch před potvrzením backendu;
- skrýt další eventy bez možnosti jejich úplného zobrazení a editace v detailu nebo vytvořit lossy/nečitelný tisk místo explicitního překročení kapacity;
- zobrazit v jakémkoli lidském UI, tiskovém výstupu, PDF nebo CSV/ZIP exportu `IN`, `OUT`, `Příchod`, `Odchod`, jejich překlady, směrové ikony, šipky, barvy nebo jiné kódy určující směr eventu;
- použít pro časové pole nebo sloupec jiné viditelné označení než neutrální `PRŮCHOD` nebo jeho jediný lokalizovaný neutrální ekvivalent;
- měnit mezilehlé eventy při editaci první nebo poslední buňky v matici;
- dopočítávat metriky ve frontendu, tisku nebo exportu;
- zavést pracovní fond nebo bilanční porovnání;
- obejít zámky, oprávnění, období úvazku, celodenní stav nebo serializační zámek;
- použít mock, placeholder, demo data nebo statický obrázek jako důkaz funkční implementace;
- prohlásit změnu za hotovou bez celé validační a design-review evidence.

## Povinný předávací balík implementátora

Výstup implementace musí obsahovat vše následující; chybějící položka je blocker:

1. úplný seznam změněných a odstraněných souborů;
2. mapování každého řádku matice ploch na konkrétní komponentu, API kontrakt a test;
3. mapování každého akceptačního kritéria na automatický test nebo ruční důkaz;
4. výsledky backendových, frontendových, E2E, accessibility, visual a tiskových kontrol;
5. reálné rendery všech předepsaných viewportů, stavů a jazyků;
6. dohledatelný seznam připomínek designera, jejich vypořádání a finální souhlas;
7. ukázkové vyrenderované PDF docházky a plánu pro 31denní měsíc v kapacitní obálce, ukázku `print_capacity_exceeded` nad obálkou a úplné CSV/ZIP exporty;
8. potvrzení, že nebyl zaveden paralelní editor, feature flag, mock, placeholder ani scope reduction;
9. potvrzení, že neomezená posloupnost eventů, přestávky, přesahy přes půlnoc, zámky, stavy, skupiny, exporty a integrační API zůstaly funkční;
10. aktualizovaný `docs/current-state-manifest.yaml`, `README.md`, `AGENTS.md` a tento SSOT, odpovídající skutečně implementovanému stavu.

Implementátor nepřipravuje nový produktový návrh a nevolí alternativní rozsah. Jeho úlohou je mechanicky uvést všechny uvedené konzumenty do souladu s tímto kontraktem, doložit výsledek a zastavit se na skutečném blockeru. Nejasnost se nesmí řešit redukcí scope, paralelním řešením ani improvizovaným kompromisem.

## Povinné implementační uzavření

Změna tabulkového a tiskového modelu není pouze frontendový restyling. Musí být uzavřena napříč všemi dotčenými artefakty:

- backendové DTO musí dodat úplnou chronologickou posloupnost eventů, plánové nápovědy, carryover, `display_metrics`, zámky a jednoznačné identifikátory mutovaných eventů;
- frontend nesmí pro kompaktní matice ztratit nebo přepsat skryté mezilehlé eventy;
- zaměstnanecké, adminské, skupinové, tiskové a lidské exportní pohledy musí používat stejnou chronologii a stejnou normalizaci času; všechny lidské výstupy používají pouze neutrální `PRŮCHOD` a hodnotu `HH:mm`;
- odstraní se všechny produkční boční nebo pomocné editory času a jejich nepoužité komponenty, styly, testy, překlady a dokumentace;
- aktualizují se backendové a frontendové kontrakty, typy, Zod schémata, testy, E2E selektory, vizuální snapshoty, tiskové styly, překlady, manifest, README a AGENTS;
- změna nesmí zavést nový pracovní fond, bilanční porovnávání ani frontendový přepočet hodin;
- před commitem se forenzně ověří, že nezmizela podpora interní neomezené posloupnosti `IN`/`OUT` eventů, automatických přestávek, intervalů přes půlnoc, celodenních stavů, zámků, skupin úvazků, exportů ani integračního API; současně se ověří, že interní typy nikde neprosákly do lidského UI, tisku, PDF nebo CSV/ZIP exportu.

## Povinné testy a akceptační kritéria

### Unit a komponentové testy

Musí existovat regresní testy alespoň pro:

- normalizaci `1 → 01:00`, `10 → 10:00`, `930 → 09:30`, `0124 → 01:24`, `1234 → 12:34`, vstupy s dvojtečkou a vstupy s tečkou;
- odmítnutí neplatných hodin a minut;
- `Delete` bezprostředně po vstupu do buňky a následný `Enter` odstraní celou hodnotu;
- `Delete` po pohybu kurzoru maže pouze znak;
- uložení při blur, `Tab`, `Shift+Tab` a `Enter`;
- zrušení přes `Escape` bez API mutace;
- zelené potvrzení pouze po úspěšné serverové odpovědi;
- zachování rozepsané hodnoty a lokalizované chyby při neúspěchu;
- zamčené období znemožní editaci, ale zachová čitelnost;
- detailní řádek zachová jeden den na jednom řádku i při více než čtyřech eventech;
- kompaktní buňka změní pouze první nebo poslední chronologický event a zachová mezilehlé eventy;
- zaměstnanec ve skupině může editovat pouze svůj úvazek;
- všechny hodinové sloupce vznikají pouze z `display_metrics`;
- všechny viditelné časové hlavičky v UI a tisku používají pouze neutrální `PRŮCHOD` a žádná buňka ani accessible name neobsahuje směrový popisek;
- lidský CSV/ZIP export používá pouze hlavičky `PRŮCHOD 1..N`, prázdné hodnoty nebo `HH:mm` a neobsahuje směrové typy ani symboly.

### E2E, vizuální a tiskové testy

Musí existovat automatizované nebo auditovatelně opakovatelné kontroly alespoň pro:

- zaměstnaneckou docházku, vlastní plán a skupinový plán;
- adminskou docházku a adminský plán služeb;
- mobil, tablet a desktop;
- všechny relevantní jazyky;
- horizontální posun a sticky oblasti;
- zamčené a odemčené měsíce;
- úspěšné uložení, konflikt, offline stav a serverovou chybu;
- více intervalů, neúplnou posloupnost, automatickou pauzu a přesah přes půlnoc;
- skutečný tiskový náhled a vyrenderované PDF docházky i plánu;
- jeden úvazek, 31denní měsíc, nejvýše čtyři průchody denně a všechny aktivní metriky přesně na jedné A4 bez ořezu a bez druhé stránky; samostatně data nad kapacitní obálkou musí vrátit `print_capacity_exceeded` a nesmí vytvořit zkrácený výstup;
- vizuální regresi všech výše uvedených kanonických viewportů;
- textovou kontrolu DOM, tiskového náhledu a vyrenderovaného PDF, že se v časových polích nevyskytují `IN`, `OUT`, `Příchod`, `Odchod` ani jejich lokalizované směrové ekvivalenty;
- kontrolu CSV/ZIP exportu, že hlavičky časů jsou pouze `PRŮCHOD 1..N` a hodnoty pouze prázdné nebo `HH:mm`.

## Povinné kontroly

Backend a repozitář:

```bash
python -m compileall -q app
ruff check app tests scripts
mypy app
test "$(alembic heads | wc -l)" -eq 1
python scripts/create_e2e_schema_baseline.py
alembic upgrade head
alembic current
pytest -q
python scripts/rebuild_daily_time_metrics.py --apply
python scripts/rebuild_daily_time_metrics.py --check
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
npm run test:a11y
npm run test:visual
git diff --exit-code
git status --short
```

Po vizuální změně se k automatickým kontrolám přidává dokončená design gate s dohledatelným finálním souhlasem designera. Bez tohoto souhlasu není validační sada úplná.

## Deploy invarianty

- deploy zastaví starý backend před migrací, provede Alembic upgrade, backfill denních metrik a čistý `--check`, a až potom atomicky aktivuje nový release;
- po zahájení změny schématu žádná chybová větev nespustí starý backend, pokud se DB revision změnila; při neúspěchu zůstane služba zastavená, dokud není dostupný kompatibilní release;
- UI změna podléhající design gate se nesmí nasadit bez dohledatelného finálního schválení všech dotčených variant;
- nasazený frontend a backend musí pocházet ze stejného ověřeného commitu a po nasazení se ověří veřejná readiness, verze, frontend shell bez console errors, hlavní docházkový tok, plán služeb, zámky a tiskový náhled.


## Forenzní trasovatelnost uživatelských požadavků

Tato tabulka uzavírá význam požadavků a určuje jejich normativní umístění. Slouží pro kontrolu úplnosti, nikoli jako náhrada detailních pravidel výše.

| Dohodnutý požadavek | Normativní sekce |
|---|---|
| jeden den = jeden rovný řádek v detailu docházky i plánu | Závazný prezentační model; Detail jednoho úvazku |
| datum a den v týdnu jako první sloupce | Detail jednoho úvazku; matice ploch |
| chronologická řada průchodů se čtyřmi základními sloupci a zachováním dalších eventů | Povinný kontrakt PRŮCHOD; Detail jednoho úvazku; Deterministická reprezentace eventů |
| denní a měsíční součty pouze podle definice úvazku | Scope dat; Detail jednoho úvazku; Tiskové výstupy |
| plán jako šedá/kurzivní nápověda v docházce | Nápověda plánu v docházce |
| živé zadávání výhradně přímo v buňce | Společný princip; Přímá editace časové buňky |
| zákaz bočních editorů, přenosových formulářů a paralelního zadávání | Společný princip; Zakázaná implementační rozhodnutí |
| commit při opuštění buňky, Tab, Shift+Tab nebo Enter | Životní cyklus editace |
| zelené probliknutí až po skutečném uložení | Životní cyklus editace; Přístupnost |
| `Delete`, potom `Enter` ihned po vstupu smaže celou hodnotu | Mazání hodnoty klávesou Delete |
| po pohybu kurzoru Delete maže standardně znak | Mazání hodnoty klávesou Delete |
| vstupy `1`, `10`, `0124`, vstupy bez dvojtečky i s dvojtečkou | Normalizace časového vstupu |
| stejné chování ve všech jazycích | Responzivita a jazykové varianty |
| stejné chování na mobilu, tabletu a desktopu | Responzivita; matice ploch |
| hromadná/adminská/skupinová matice: člověk v řádku, den ve sloupci, dvě buňky nad sebou | Hromadná adminská matice; matice ploch |
| zaměstnanec ve skupině edituje jen sebe | Hromadná adminská matice |
| respektování oddělených zámků docházky a plánu | Scope dat; matice ploch |
| tisk detailu: jeden člověk, jeden měsíc, jedna A4 v běžné čtyřprůchodové kapacitní obálce; nad ní bez ztráty dat | Tiskové výstupy |
| název úvazku, denní i měsíční součty v tisku | Tiskové výstupy |
| ve všech UI, tiscích, PDF a lidských CSV/ZIP exportech pouze neutrální záhlaví `PRŮCHOD` a čas `HH:mm`, nikdy `IN`/`OUT`, příchod/odchod ani směrový ekvivalent | Povinný prezentační kontrakt PRŮCHOD; Tiskové výstupy; Deterministická reprezentace eventů; Povinné testy |
| povinné iterace s designerem nad skutečnými rendery | Povinná iterativní design gate |
| opakování design smyčky až do spokojenosti designera | Povinný průběh iterací |
| bez znalosti konverzace a bez produktového rozhodování implementátora | Implementační pracovní balíky; Zakázaná rozhodnutí; Povinný předávací balík |


## Forenzní verifikační matice dokumentu

Tato matice je součástí SSOT, nikoli externí auditní příloha. Výsledný soubor byl strukturálně porovnán s auditovanými zdrojovými oblastmi; „popsáno“ neznamená, že byl runtime při tvorbě dokumentu spuštěn.

Strukturální kontrola tohoto vydání explicitně inventarizuje aktivní perzistentní entity, frontendové routy, endpointové rodiny, background procesy, lidské exporty, tisky a behaviorální fingerprint scénáře. Závěrečný adversariální průchod odstranil nedoložené počty a opravil zejména lifecycle reset tokenů, runtime integrační data scope, pagination, chybové obálky, neúčinné config hodnoty, přesný obsah `/admin/me`, původ eventu, potvrzovací protokoly a neomezenou tiskovou kapacitu.

| Oblast | Zdrojová evidence | Normativní uzavření v SSOT | Implementační důkaz |
|---|---|---|---|
| runtime/topologie | config, main, systemd, Gunicorn, CI deploy | síť, secrets, proces, čas, start guard, deploy | health/version + systemd/Nginx validace |
| perzistence | všechny SQLAlchemy modely + Alembic | úplný entity inventory, FK, uniqueness, lifecycle | Alembic single head + schema tests |
| auth | admin/portal/OIDC/integration security moduly | čtyři oddělené auth režimy, token lifecycle, CSRF, audit | auth a negative-scope testy |
| docházka | attendance API + mutation/services | strict new sequence, historical tolerance, paired changes, statuses, locks | backend regression + E2E |
| plán | shift plan API/services | cross-midnight, overlap, carryover, groups, locks | unit/API/E2E |
| metriky | interval, metrics, daily persistence, month summary | přesné algoritmy a rounding | known-value tests + rebuild `--check` |
| reminders/auto-lock | background služby | časování, dedupe, advisory/idempotence | deterministic clock tests |
| API | current-state manifest + přímo čtené router dependencies + DTO | endpoint inventory, skutečné auth výjimky, integrační scope/cursor/rate-limit kontrakt a více chybových obálek | manifest generation `--check` + targeted contract tests |
| frontend | routes, API client, pages, components, state | route ownership, screen states, query/session behavior | component + Playwright |
| design/i18n/a11y | styles, resources, visual/a11y tests | tokeny, breakpoints, language surface, target table rules | renders, axe, visual snapshots, designer sign-off |
| export/tisk | admin export, reports, print UI | PRŮCHOD target, bezeztrátový CSV a explicitní A4 kapacitní hranice | CSV/PDF fixtures, one-A4 assertions a capacity-exceeded test |
| CI/CD | workflow a ops | exact validation/deploy order | successful clean pipeline |
| uživatelská dohoda | nahraný předchozí SSOT | všechny schválené UI/print/export/design invarianty zachovány | trasovací tabulka + design gate |

Závěr úplnosti je omezen poctivou hranicí auditu: zdrojový kód byl staticky čten na pevném SHA, ale nebyl v tomto prostředí checkoutnut a spuštěn. Proto tento dokument nesmí být použit jako náhrada povinného provedení testů; je však úplným normativním vstupem pro implementaci a pro následné ověření.

## Stav tohoto dokumentu po forenzní rekonstrukci

- dokument je jeden samostatný normativní soubor;
- rekonstruovaný baseline je vázán na commit `39db1556f035139bd680676509d49d6e2d89a6aa`;
- schválené cílové UI změny jsou od baseline výslovně odděleny;
- dokument neoznačuje cílové UI za již implementované;
- technická, doménová, bezpečnostní, provozní, designová, uživatelská a testovací pravidla jsou uzavřena v tomto souboru včetně výslovně pojmenovaných baseline asymetrií a tiskové kapacitní hranice;
- žádný implementátor nesmí nahradit zde uvedený detail odkazem na původní konverzaci;
- pokud se při implementaci objeví skutečný rozpor mezi dvěma normativními body tohoto dokumentu, práce se zastaví jako blocker a dokument se opraví před změnou kódu; nesmí vzniknout kompromisní třetí chování.

## Revize závěrečného adversariálního běhu

- revize: `FORENSIC-FINAL-2026-08-03`;
- zdroj: auditovaný commit `39db1556f035139bd680676509d49d6e2d89a6aa` a vstupní kanonický SSOT;
- stav ověření: statické forenzní čtení přes GitHub konektor a strukturální kontrola tohoto Markdownu; lokální checkout, runtime a testy nebyly v auditním prostředí spuštěny;
- žádný nalezený rozpor nebyl skrytě vyřešen domněnkou: je opraven jako přesný baseline fakt, vymezen jako samostatná změna, nebo formalizován jako blocker/kapacitní stav.
