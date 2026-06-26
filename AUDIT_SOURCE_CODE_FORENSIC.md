# Forenzní audit zdrojového kódu DAGMAR monorepa

Datum auditu: 2026-06-26

Rozsah:
- `backend/` včetně `app/`, migrací, aktivních skriptů a runtime konfigurace
- `frontend/` včetně `src/`, build konfigurace a produkčních skriptů
- `.github/workflows/`
- aktivní deploy souvislosti odvoditelné z workflow a runtime kódu

Metoda:
- Zdroj pravdy tvoří výhradně aktuální zdrojový kód v tomto monorepu.
- Dokumentace, README, komentáře, staré reporty a testy nebyly použity jako autorita pro stav aplikace.
- Testy a build kroky slouží jen jako podpůrná kontrola.

## Souhrn nálezů

- Kritická: 1
- Vysoká: 5
- Střední: 4
- Nízká: 3

## Nálezy

### 1. Portálový lockout je v login flow fakticky vypnutý

- Závažnost: kritická
- Typ: bezpečnost
- Dotčená část: backend autentizace zaměstnance
- Soubory a symboly:
  - `backend/app/api/v1/portal_auth.py`
  - `backend/app/security/lockout.py`
- Skutečný stav z kódu:
  - `portal_login()` před každým ověřením hesla volal `clear_user_lockout(...)` a `db.commit()`.
  - V `portal_auth.py` se nikde nevolalo `record_failed_login(...)`.
  - Důsledkem bylo, že `AuthLockoutState` nebyl použit k blokaci opakovaných neplatných pokusů.
- Očekávaný konzistentní stav:
  - Lockout se má kontrolovat před ověřením, při neúspěchu inkrementovat a při úspěchu teprve vyčistit.
- Dopad na produkční chování:
  - Opakované hádání hesla proti zaměstnaneckému portálu nebylo serverově brzděno lockoutem.
- Návrh řešení:
  - Kontrolovat `is_locked(...)` na vstupu do loginu a na neplatných pokusech zapisovat `record_failed_login(...)`.
- Důsledek navrženého řešení:
  - Lockout začne odpovídat datovému modelu i admin UI.
- Riziko neřešení:
  - Oslabení ochrany proti brute-force útokům.
- Stav v této práci:
  - Opraveno.
- Vhodnost:
  - Okamžitá oprava.

### 2. Bulk smazání pending instancí obcházelo CSRF ochranu

- Závažnost: vysoká
- Typ: bezpečnost
- Dotčená část: backend admin instance API
- Soubory a symboly:
  - `backend/app/api/v1/admin_instances.py`
  - endpoint `DELETE /api/v1/admin/instances/pending`
- Skutečný stav z kódu:
  - `delete_pending_instances()` měnil stav databáze přes cookie-based admin session, ale neměl `Depends(require_csrf)`.
  - Ostatní destruktivní admin mutace CSRF guard používají.
- Očekávaný konzistentní stav:
  - Každá stav měnící admin operace přes session cookie musí vyžadovat CSRF token.
- Dopad na produkční chování:
  - Endpoint šlo volat v kontextu přihlášeného admina bez CSRF hlavičky.
- Návrh řešení:
  - Doplnit `Depends(require_csrf)`.
- Důsledek navrženého řešení:
  - Sjednocení bezpečnostního režimu všech admin mutací.
- Riziko neřešení:
  - CSRF útok proti cleanupu pending registrací.
- Stav v této práci:
  - Opraveno.
- Vhodnost:
  - Okamžitá oprava.

### 3. Měsíční zámek docházky nebyl serverově vynucen u admin zápisů

- Závažnost: vysoká
- Typ: data, robustnost
- Dotčená část: backend admin attendance a admin day-status API
- Soubory a symboly:
  - `backend/app/api/v1/admin_attendance.py`
  - `backend/app/api/v1/admin_shift_plan.py`
  - endpointy `PUT /api/v1/admin/attendance` a `PUT /api/v1/admin/day-status`
- Skutečný stav z kódu:
  - UI načítá `locked` stav měsíce a tváří se read-only.
  - Backend dříve při admin zápisu neověřoval `AttendanceLock`.
  - Zaměstnanecké endpointy takovou kontrolu mají.
- Očekávaný konzistentní stav:
  - Uzamčený měsíc musí být blokovaný serverově, ne jen vizuálně.
- Dopad na produkční chování:
  - Přímé API volání mohlo měnit administrativně uzamčenou docházku nebo stav dne.
- Návrh řešení:
  - Přidat kontrolu `AttendanceLock` do admin mutací.
- Důsledek navrženého řešení:
  - Read-only režim odpovídá skutečnému serverovému invariant.
- Riziko neřešení:
  - Tiché narušení uzávěrky měsíce.
- Stav v této práci:
  - Opraveno pro admin attendance zápis a admin day-status zápis.
- Vhodnost:
  - Okamžitá oprava.

### 4. Bearer token zaměstnance je trvale ukládán do `localStorage`

- Závažnost: vysoká
- Typ: bezpečnost
- Dotčená část: frontend autentizace zaměstnance
- Soubory a symboly:
  - `frontend/src/state/portalAuthStore.ts`
  - `frontend/src/pages/EmployeePage.tsx`
- Skutečný stav z kódu:
  - `portal_login` vrací `instance_token`.
  - Frontend ho persistuje pod klíčem `dagmar_portal_auth_v2` do `localStorage`.
  - Offline fronta se také ukládá do `localStorage`.
- Očekávaný konzistentní stav:
  - Bearer token by neměl být dlouhodobě uložen v úložišti dostupném skriptům bez explicitního threat modelu a dodatečných XSS guardů.
- Dopad na produkční chování:
  - Při XSS nebo kompromitovaném klientském skriptu lze bearer token snadno exfiltrovat.
- Návrh řešení:
  - Přesunout token minimálně do `sessionStorage` nebo ideálně přejít na jiný auth model s menším expozičním povrchem.
- Důsledek navrženého řešení:
  - Může se změnit perzistence přihlášení mezi restartem prohlížeče.
- Riziko neřešení:
  - Zneužití zaměstnaneckého bearer tokenu.
- Stav v této práci:
  - Nález ponechán pro samostatné rozhodnutí.
- Vhodnost:
  - Vyžaduje produktové a bezpečnostní rozhodnutí.

### 5. Web zobrazoval Android APK banner s neexistujícím runtime cílem

- Závažnost: vysoká
- Typ: UX, mrtvý kód
- Dotčená část: frontend zaměstnanecký portál
- Soubory a symboly:
  - `frontend/src/pages/EmployeePage.tsx`
  - `frontend/src/components/AndroidDownloadBanner.tsx`
  - `frontend/index.html`
- Skutečný stav z kódu:
  - Portál renderoval banner pro Android s odkazem na `/download/dochazka.apk`.
  - V monorepu není žádný backend endpoint, asset ani deploy konfigurace, která by tento soubor obsluhovala.
- Očekávaný konzistentní stav:
  - UI nesmí nabízet akci bez skutečné backendové nebo statické implementace.
- Dopad na produkční chování:
  - Portál obsahoval nefunkční akci a historickou Android-only větev.
- Návrh řešení:
  - Banner a navázaný komponent odstranit, dokud neexistuje skutečný runtime spotřebitel.
- Důsledek navrženého řešení:
  - Portál přestane nabízet nefunkční APK stažení.
- Riziko neřešení:
  - Falešná funkčnost a matoucí UI.
- Stav v této práci:
  - Opraveno odstraněním banneru a komponenty.
- Vhodnost:
  - Okamžitá oprava.

### 6. Produkční ověřovací skript kontroluje `/health`, ale backend tento endpoint v monorepu nedefinuje

- Závažnost: vysoká
- Typ: deploy, spolehlivost
- Dotčená část: frontend produkční smoke script
- Soubory a symboly:
  - `frontend/scripts/e2e-production.mjs`
  - `backend/app/main.py`
- Skutečný stav z kódu:
  - Skript vyžaduje `GET ${baseUrl}/health` a očekává tělo `ok`.
  - Backend v monorepu vystavuje jen `GET /api/v1/health` a `GET /api/health`.
  - Žádná Nginx konfigurace pro `/health` v tomto monorepu není.
- Očekávaný konzistentní stav:
  - Smoke skript má validovat jen endpointy doložitelné z aktuálního runtime kódu nebo z Nginx šablony v repu.
- Dopad na produkční chování:
  - Ověření může failovat nebo být závislé na mimo-repo ruční konfiguraci.
- Návrh řešení:
  - Buď skript přepnout na `/api/v1/health`, nebo do repa doplnit skutečnou reverse-proxy konfiguraci pro `/health`.
- Důsledek navrženého řešení:
  - Menší závislost na tichých serverových ručních úpravách.
- Riziko neřešení:
  - Falešně červené nebo falešně zelené deploy smoke.
- Stav v této práci:
  - Nález ponechán pro samostatné rozhodnutí.
- Vhodnost:
  - Vyžaduje rozhodnutí podle reálné Nginx vrstvy.

### 7. Admin session je čistě stateless signed cookie, bez serverové revokace

- Závažnost: střední
- Typ: bezpečnost
- Dotčená část: backend admin autentizace
- Soubory a symboly:
  - `backend/app/security/sessions.py`
  - `backend/app/api/v1/admin_auth.py`
- Skutečný stav z kódu:
  - `set_admin_session()` vydává jen podepsaný cookie payload `{u, iat}`.
  - `get_admin_session()` ověřuje podpis a expiraci, ale neexistuje server-side session store ani blacklist.
  - Komentáře v souboru mluví o server-side session row, ale aktivní login flow ji nepoužívá.
- Očekávaný konzistentní stav:
  - Buď jasně přiznat stateless režim, nebo zavést skutečnou server-side revokovatelnou session.
- Dopad na produkční chování:
  - Ukradený cookie zůstává platný do expirace, i když admin mezitím změní heslo nebo se odhlásí jinde.
- Návrh řešení:
  - Rozhodnout mezi skutečným server-side session store a explicitně dokumentovaným stateless modelem.
- Důsledek navrženého řešení:
  - Server-side varianta zvýší komplexitu, ale umožní revokaci.
- Riziko neřešení:
  - Omezená schopnost okamžité revokace session.
- Stav v této práci:
  - Nález ponechán pro samostatné rozhodnutí.
- Vhodnost:
  - Vyžaduje bezpečnostní rozhodnutí.

### 8. Ve webovém frontendu nejsou spotřebitelé pro veřejné instance endpointy

- Závažnost: střední
- Typ: mrtvý kód, údržba
- Dotčená část: backend public instance API
- Soubory a symboly:
  - `backend/app/api/v1/public_instances.py`
  - endpointy:
    - `POST /api/v1/instances/register`
    - `GET /api/v1/instances/{instance_id}/status`
    - `POST /api/v1/instances/{instance_id}/claim-token`
- Skutečný stav z kódu:
  - V `frontend/src` ani `frontend/scripts` neexistuje žádné volání těchto endpointů.
  - Endpointy pracují s `client_type` včetně `ANDROID`.
- Očekávaný konzistentní stav:
  - Buď mít doložitelný webový nebo produkční runtime spotřebitelský řetězec, nebo větev oddělit jako historickou.
- Dopad na produkční chování:
  - Backend drží aktivní povrch bez současného webového spotřebitele.
- Návrh řešení:
  - Prověřit skutečný produkční provoz a případně tyto endpointy izolovat nebo odstranit.
- Důsledek navrženého řešení:
  - Menší API povrch a menší údržbová zátěž.
- Riziko neřešení:
  - Historický povrch bude dál maskovaný jako živá část produktu.
- Stav v této práci:
  - Nález ponechán, mazání bez provozního důkazu by bylo rizikové.
- Vhodnost:
  - Vyžaduje samostatné rozhodnutí.

### 9. Backend endpoint pro ruční nastavení hesla nemá webový frontendový spotřebitel

- Závažnost: střední
- Typ: mrtvý kód, údržba
- Dotčená část: backend admin users API
- Soubory a symboly:
  - `backend/app/api/v1/admin_users.py`
  - endpoint `POST /api/v1/admin/users/{user_id}/set-password`
- Skutečný stav z kódu:
  - Endpoint existuje.
  - Ve `frontend/src` neexistuje žádné volání `set-password`.
  - Web používá jen `PUT /api/v1/admin/users/{user_id}` s volitelným `password`.
- Očekávaný konzistentní stav:
  - Jedna webem používaná mutace pro změnu hesla.
- Dopad na produkční chování:
  - Duplicitní povrch API bez frontendového spotřebitele.
- Návrh řešení:
  - Sloučit na jednu podporovanou cestu a druhou odstranit nebo výslovně vyhradit pro neveřejné použití.
- Důsledek navrženého řešení:
  - Jednodušší kontrakt admin API.
- Riziko neřešení:
  - Drift mezi nevyužitým endpointem a skutečně používaným flow.
- Stav v této práci:
  - Nález ponechán.
- Vhodnost:
  - Vyžaduje samostatné rozhodnutí.

### 10. Frontend při 401 na zaměstnanecké docházce zkouší neautorizovaný fallback bez bearer tokenu

- Závažnost: nízká
- Typ: robustnost, údržba
- Dotčená část: frontend zaměstnanecký API klient
- Soubory a symboly:
  - `frontend/src/api/attendance.ts`
  - `fetchAttendanceWithPortalFallback(...)`
- Skutečný stav z kódu:
  - Po `401` frontend opakuje stejné volání bez `instanceToken`.
  - Backend endpointy `/api/v1/attendance` a `/api/v1/shift-plan/day-status` ale vždy vyžadují bearer autentizaci.
- Očekávaný konzistentní stav:
  - Po 401 má následovat obsluha expirace tokenu nebo odhlášení, ne druhý beznadějný request.
- Dopad na produkční chování:
  - Zbytečné síťové volání a méně čitelný auth flow.
- Návrh řešení:
  - Fallback odstranit a řešit 401 explicitně v UI.
- Důsledek navrženého řešení:
  - Čistší klientský auth flow.
- Riziko neřešení:
  - Šum v síťové komunikaci a horší diagnostika.
- Stav v této práci:
  - Nález ponechán.
- Vhodnost:
  - Malá technická úprava, ale není kritická.

### 11. Frontend při výpadku serverového času odchází na veřejné externí time API

- Závažnost: nízká
- Typ: spolehlivost, údržba
- Dotčená část: frontend časový fallback
- Soubory a symboly:
  - `frontend/src/api/time.ts`
- Skutečný stav z kódu:
  - Po neúspěchu `GET /api/v1/time` se volá `worldtimeapi.org` a `timeapi.io`.
- Očekávaný konzistentní stav:
  - Produkční časová logika by měla být plně pod kontrolou vlastního backendu, nebo explicitně označená jako best-effort.
- Dopad na produkční chování:
  - Dodatečná externí závislost a únik IP adresy klienta třetí straně.
- Návrh řešení:
  - Rozhodnout, zda stačí server time endpoint plus browser fallback bez třetích stran.
- Důsledek navrženého řešení:
  - Menší externí závislost.
- Riziko neřešení:
  - Nepředvídatelné chování při výpadku cizích služeb.
- Stav v této práci:
  - Nález ponechán.
- Vhodnost:
  - Vyžaduje rozhodnutí podle provozních priorit.

### 12. Monorepo stále nese historické samostatné git remotes a starou backend deploy fallback cestu

- Závažnost: nízká
- Typ: deploy, údržba
- Dotčená část: git/deploy kontext
- Soubory a symboly:
  - lokální git remotes `backend` a `frontend`
  - `backend/app/main.py` funkce `_deployed_backend_tag`
- Skutečný stav z kódu:
  - Checkout má vedle `origin` ještě remotes `backend` a `frontend`.
  - `_deployed_backend_tag()` ještě čte i historickou cestu `/srv/hcasc/_repos/dagmar-backend/backend-version.json`.
- Očekávaný konzistentní stav:
  - Monorepo by mělo odkazovat primárně na vlastní checkout a deploy layout.
- Dopad na produkční chování:
  - Forenzní čtení deploy stavu je zbytečně zatížené historickými fallbacky.
- Návrh řešení:
  - Po potvrzení produkční reality odstranit staré remotes a historický fallback path.
- Důsledek navrženého řešení:
  - Jednoznačnější deploy diagnóza.
- Riziko neřešení:
  - Další drift mezi starým a aktuálním layoutem.
- Stav v této práci:
  - Nález ponechán.
- Vhodnost:
  - Vyžaduje provozní potvrzení.

### 13. Android nativní strom nebyl připojený na webový build ani deploy

- Závažnost: nízká
- Typ: mrtvý kód
- Dotčená část: frontend historické Android artefakty
- Soubory a symboly:
  - celý adresář `frontend/ANDROID/`
  - `frontend/build.gradle.kts`
- Skutečný stav z kódu:
  - `package.json`, `vite.config.ts` ani `.github/workflows/frontend-ci-cd.yml` tento strom nepoužívají.
  - Šlo o oddělenou Android-only větev bez vazby na současný webový build.
- Očekávaný konzistentní stav:
  - Webové monorepo nemá držet nepoužívaný nativní strom bez produkčního spotřebitele.
- Dopad na produkční chování:
  - Zbytečný šum v repozitáři a auditní zátěž.
- Návrh řešení:
  - Strom odstranit.
- Důsledek navrženého řešení:
  - Menší a čitelnější frontend checkout.
- Riziko neřešení:
  - Pokračující míchání historického Android scope do webového repa.
- Stav v této práci:
  - Opraveno odstraněním `frontend/ANDROID/` a `frontend/build.gradle.kts`.
- Vhodnost:
  - Okamžitá oprava.

## Backend–frontend křížová kontrola

### Nejdůležitější rozpory

- Webový portál nabízel Android APK download bez backendového nebo statického targetu.
- Produkční smoke skript validuje `/health`, ale backend kód v repu takový endpoint nevystavuje.
- Admin UI prezentovalo uzamčený měsíc jako read-only, ale backend původně lock neinvariant nevynucoval u části admin mutací.
- Webový frontend nepoužívá `POST /api/v1/admin/users/{user_id}/set-password`.
- Webový frontend nepoužívá veřejné instance endpointy v `public_instances.py`.

### Backend endpointy bez současného webového spotřebitele

- `POST /api/v1/instances/register`
- `GET /api/v1/instances/{instance_id}/status`
- `POST /api/v1/instances/{instance_id}/claim-token`
- `POST /api/v1/admin/users/{user_id}/set-password`
- `GET /api/health` je kompatibilní alias bez webového spotřebitele v `src/`

### Frontendové divadlo nebo neúplné akce

- Android APK banner na `/download/dochazka.apk` byl nefunkční a odstraněn.
- 401 fallback bez bearer tokenu v `frontend/src/api/attendance.ts` je nefunkční retry větev.

## Cleanup provedený v této práci

- odstraněn historický Android-only strom `frontend/ANDROID/`
- odstraněn Android-only root soubor `frontend/build.gradle.kts`
- odstraněn nefunkční webový APK banner a komponenta
- doplněny serverové guardy pro lockout, CSRF a month lock
- nahrazen `backend/AGENTS.md`
- přidán nový `frontend/AGENTS.md`

## Změněné soubory

- `backend/app/api/v1/portal_auth.py`
- `backend/app/api/v1/admin_attendance.py`
- `backend/app/api/v1/admin_shift_plan.py`
- `backend/app/api/v1/admin_instances.py`
- `backend/AGENTS.md`
- `frontend/AGENTS.md`
- `frontend/index.html`
- `frontend/src/pages/EmployeePage.tsx`
- odstraněno `frontend/src/components/AndroidDownloadBanner.tsx`
- odstraněno `frontend/ANDROID/`
- odstraněno `frontend/build.gradle.kts`
