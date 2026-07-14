# AGENTS.md

## Účel a rozsah

Tento soubor je závazná provozní a vývojová instrukce pro Codex a další automatizované agenty pracující v repozitáři `karelmartinek-a11y/dagmar-monorepo`.

Repozitář je produkční zdroj pravdy docházkového systému KájovoDagmar. Agent pracuje výhradně v tomto jednom repozitáři. Historické repozitáře `dagmar-backend` a `dagmar-frontend` nejsou pracovní cíl a smí být použity pouze jako výslovně odůvodněná forenzní reference.

Změny prováděj přímo v produkčním kódu. Nezaváděj mocky, placeholdery, demo režimy, nefunkční ovládací prvky, skryté obcházení pravidel ani dočasné paralelní implementace.

## Zdroj pravdy

Pořadí autority:

1. aktuální zdrojový kód v `dagmar-monorepo`;
2. skutečný backendový kontrakt a databázové invarianty;
3. produkční chování na `dagmar.hcasc.cz`;
4. testy, migrace, workflow a deploy konfigurace;
5. dokumentace v repozitáři;
6. historické zdroje pouze pro forenzní porovnání.

Pokud se dokumentace nebo komentáře rozcházejí s implementací, nehádej. Ověř kód, testy, konfiguraci a skutečné produkční chování. Dokumentaci následně oprav tak, aby odpovídala výslednému stavu.

## Stav a cílová struktura repozitáře

Repozitář může během řízené restrukturalizace existovat ve dvou stavech.

### Výchozí historická struktura

- `backend/` — FastAPI/Python aplikace;
- `frontend/` — původní React/TypeScript/Vite frontend;
- `.github/workflows/` — CI a produkční deploy;
- `docs/` — dokumentace.

### Cílová struktura

Po dokončení schválené restrukturalizace:

- backendová aplikace je přímo v kořeni repozitáře, zejména `app/`, `alembic/`, `tests/`, `scripts/`, `pyproject.toml` a `alembic.ini`;
- nový frontend je v `web/`;
- původní pracovní adresář `frontend/` neexistuje;
- zbytečný obalový adresář `backend/` neexistuje;
- dokumentace je v `docs/`;
- workflow zůstávají v `.github/workflows/`.

Před každým příkazem nejprve zjisti skutečný stav checkoutu. Nepředpokládej automaticky ani starou, ani cílovou strukturu. Používej cesty odpovídající aktuálnímu commitu.

## Výslovně povolená jednorázová restrukturalizace

Je-li zadání zaměřeno na čistou generační náhradu UI a restrukturalizaci monorepa, je výslovně povoleno:

- přesunout obsah `backend/` do kořene repozitáře;
- odstranit prázdný obalový adresář `backend/`;
- vytvořit nový frontend od nuly v `web/`;
- po uzavření forenzní inventury odstranit původní `frontend/`;
- aktualizovat workflow, Docker, Alembic, testy, README, AGENTS, deploy skripty, systemd pracovní adresáře, Nginx návaznosti a produkční cesty;
- nahradit historické subtree uspořádání jednodušší kořenovou strukturou.

Tato výjimka ruší pro daný úkol zákaz narušení historické `git subtree` struktury. Git historie však musí zůstat dohledatelná. Nepoužívej force push a nepřepisuj existující sdílenou historii.

Před přesuny:

1. zaznamenej výchozí commit, branch a čistotu pracovního stromu;
2. zmapuj všechny odkazy na `backend/` a `frontend/`;
3. zmapuj CI, deploy, systemd, Nginx, Docker, Alembic, testy a dokumentaci;
4. stanov rollback;
5. proveď přesuny v logických commitech;
6. po každém celku spusť relevantní kontroly.

## Zákaz převzetí původního frontendu

Původní `frontend/` smí být před stanovenou forenzní hranicí použit pouze k inventuře:

- rout;
- API volání;
- autentizačních toků;
- validací;
- klientské business logiky;
- stavů;
- oprávnění;
- exportních a tiskových vazeb;
- offline chování;
- uživatelských scénářů.

Jakmile je inventura uzavřena, nesmí se z původního frontendu do `web/` převzít, přesunout, přejmenovat, transformovat ani odvodit žádný zdrojový soubor nebo jeho část. Zákaz zahrnuje JSX/TSX, TypeScript, CSS, testy, stores, hooky, API klienty, komponenty, assety, SVG, ikony, build výstupy a konfiguraci vzniklou pouhým kopírováním.

Běžné názvy doménových entit, endpointů, veřejných rout a nezbytné české textace se mohou shodovat. Implementace a struktura kódu se shodovat nesmějí.

Nový frontend musí vzniknout v čistém adresáři `web/` bez použití starého `node_modules`, buildu nebo cache. Původní frontend se nearchivuje jako zdrojový strom v jiné části pracovního repozitáře; zůstává dostupný v git historii.

## Produkční invarianty

Bez výslovného zadání neměň:

- kanonickou doménu `https://dagmar.hcasc.cz`;
- produkční hostname `dagmar.hcasc.cz`;
- API prefix `/api/v1/`;
- backend bind `127.0.0.1:8101`;
- PostgreSQL publikovanou pouze na `127.0.0.1:5433`;
- admin autentizaci přes session cookie a CSRF;
- zaměstnaneckou autentizaci přes bearer token;
- oddělení integračních tokenů od zaměstnaneckých tokenů;
- vazbu docházky, plánu služeb, zámků, výběrů a exportů na `employment_id`;
- českou lokalizaci a časovou autoritu `Europe/Prague`;
- reverse proxy a TLS přes Nginx.

Doména `dochazka.hcasc.cz` je zakázaná v kódu, konfiguraci, dokumentaci, testech, příkladech i výstupech.

Backend nesmí vytvářet chybějící databázové struktury během request flow. Schéma měň výhradně verzovanou Alembic migrací a migraci spusť před startem nové verze aplikace.

## Funkční mapa

### Zaměstnanecká část

- aplikace: `/app`;
- přihlášení e-mailem a heslem;
- zaměstnanecký bearer token;
- volba úvazku podle `employment_id`;
- měsíční docházka;
- plán služeb a status dne;
- měsíční zámky a období úvazku;
- offline fronta a synchronizace, pokud je podporována aktuálním kontraktem;
- reset přístupu: `/reset`.

### Administrace

- přihlášení: `/admin/login`;
- přehled: `/admin/prehled`;
- uživatelé a úvazky: `/admin/users`;
- docházka: `/admin/dochazka`;
- plán služeb: `/admin/plan-sluzeb`;
- exporty: `/admin/export`;
- tisky a náhled: `/admin/tisky`, `/admin/tisky/preview`;
- nastavení a diagnostika: `/admin/settings`;
- zařízení a instance: `/admin/instances`;
- integrační klienti: `/admin/integrace`.

### Integrace

- veřejná dokumentace: `/integration-api`;
- API namespace: `/api/v1/integration`;
- integrační bearer tokeny mají vlastní formát a scope;
- list endpointy zachovávají kontrakt `data` + `pagination`, pokud aktuální kód neurčuje jinak;
- plaintext integrační token nikdy neukládej ani neloguj; v databázi zůstává pouze hash a bezpečné identifikátory.

## Architektura backendu

V historické struktuře je hlavní aplikace v `backend/app/main.py`. V cílové struktuře je v `app/main.py`.

Routery jsou členěné pod `app/api/v1/` podle domén, zejména:

- attendance;
- shift plan;
- portal auth;
- admin auth;
- users a employments/instances;
- admin attendance a shift plan;
- exporty a tisky;
- settings a SMTP;
- integrations;
- externí integration API.

Při změně backendu:

- zachovej jednotný JSON error kontrakt;
- nevracej interní výjimky klientovi;
- zachovej request ID a audit integračních požadavků;
- respektuj rate limiting;
- neoslabuj cookie, session, CSRF, CORS ani tokenové kontroly;
- interpretuj datumy a časy podle pražských pravidel;
- ověř `employment_id` na každé relevantní hranici;
- databázové změny doplň migrací a testy;
- při změně API uprav nový frontend, testy a dokumentaci ve stejném logickém celku.

## Architektura nového frontendu

Nový frontend je v `web/` a používá Vite, React a TypeScript.

Při změně frontendu:

- zachovej české texty a přesné názvosloví KájovoDagmar;
- respektuj přiložený grafický a produktový manuál uložený v `docs/`;
- zachovej oddělení zaměstnanecké, admin a veřejné integrační části;
- neměň API kontrakt jen kvůli pohodlí UI;
- implementuj session, CSRF a bearer režimy přesně podle backendu;
- implementuj loading, empty, error, success, read-only, locked, conflict, offline a destructive-confirm stavy podle relevance;
- stav nesděluj pouze barvou;
- zachovej focus, popisky, klávesnicové ovládání a čitelné chyby;
- ověř mobilní rozvržení, overflow, sticky oblasti a výkon velkých matic;
- nepoužívej nefunkční tlačítka, makety ani statická produkční data;
- nedoplňuj frontendovou schopnost, kterou backend nepodporuje, bez současné řádné změny backendu.

## Designové podklady

Závazné podklady pro generační náhradu UI ukládej pod `docs/ui-redesign/source-materials/` a verzuj je společně s indexem.

Podklady jsou autoritou pro cílový vzhled, informační hierarchii, komponentový systém, stavovou sémantiku a responzivní chování. Aktuální backend a forenzní katalog jsou autoritou pro funkce, data, oprávnění a důsledky operací.

Nevkládej do repozitáře fontové soubory získané z operačního systému, interního prostředí nebo jiného neověřeného zdroje.

## Lokální ověření

Nejprve zjisti, zda checkout používá historickou nebo cílovou strukturu.

### Backend v historické struktuře

```bash
cd backend
python -m pip install -e '.[dev]'
pytest
ruff check app
mypy app
```

Při změně migrací:

```bash
cd backend
alembic upgrade head
```

### Backend v cílové struktuře

```bash
python -m pip install -e '.[dev]'
pytest
ruff check app
mypy app
```

Při změně migrací:

```bash
alembic upgrade head
```

### Původní frontend během forenzní fáze

Původní frontend nespouštěj za účelem dalšího vývoje. Příkazy použij pouze k ověření výchozího stavu před jeho odstraněním, pokud to zadání vyžaduje.

```bash
cd frontend
npm ci
npm run check:branding
npm run lint
npm run typecheck
npm test
npm run build
```

### Nový frontend

Použij skutečné skripty definované v `web/package.json`. Typicky:

```bash
cd web
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

Spusť také relevantní E2E, visual-regression a accessibility testy. Produkční E2E test spouštěj pouze proti autorizovanému prostředí a způsobem bezpečným pro produkční data.

Nikdy netvrď, že kontrola proběhla, pokud nebyla skutečně spuštěna. Uveď přesné příkazy, výsledky a omezení.

## GitHub a práce s větvemi

GitHub používej pouze přes autorizované prostředí. Nevyžaduj ani nevypisuj osobní access token.

- Ověř default branch, remote, tracking a stav vůči GitHubu.
- Nezahazuj cizí změny.
- Preferuj samostatnou větev a pull request, pokud zadání výslovně nepožaduje přímý commit.
- Při rozsáhlé restrukturalizaci používej logické, dohledatelné commity.
- Nepoužívej force push a nepřepisuj sdílenou historii.
- Před dokončením zkontroluj diff, CI, migrace a produkční kontrakty.
- Přesuny souborů nesmějí skrýt nechtěné převzetí původního frontendového kódu.
- Dokumentační a binární podklady přidávej pouze tehdy, když jsou součástí zadání a neobsahují tajemství nebo osobní data.

## Produkční server a SSH

Produkční server má IP `89.221.222.92` a obsluhuje `dagmar.hcasc.cz`. Použij existující autorizovanou SSH identitu. Nevyžaduj, nevypisuj ani nekopíruj soukromý SSH klíč.

Před prvním zásahem ověř identitu cíle:

```bash
ssh 89.221.222.92 'hostname; id; pwd'
```

Na serveru začni read-only kontrolou:

```bash
hostname
pwd
systemctl status dagmar-backend --no-pager
curl -fsS http://127.0.0.1:8101/api/v1/health
journalctl -u dagmar-backend -n 200 --no-pager
ss -lntp | grep 8101
ss -lntp | grep 5433
docker ps
```

Produkční pracovní cesty nejprve forenzně zjisti. Historické umístění může být `/opt/dagmar/backend/` a historický frontend mohl být nasazován z `frontend/dist/`. Po schválené restrukturalizaci je povoleno tyto cesty změnit, ale pouze společně s workflow, deploy skripty, systemd, Nginx konfigurací, rollbackem a produkční validací.

Před produkčním zásahem:

1. popiš rollback;
2. ověř zálohu a stav migrací podle relevance;
3. ověř nasazovaný commit;
4. proveď pouze změny odpovídající repozitáři;
5. po nasazení ověř health, verzi backendu, frontendové assety, logy a konkrétní uživatelský scénář.

Bez výslovného zadání neměň produkční data, firewall, databázovou konfiguraci ani tajné env hodnoty. Standardní deploy, migrace, restart dotčené služby a nezbytná aktualizace Nginx/systemd jsou povoleny, pokud jsou výslovnou součástí zadaného implementačního a deploy úkolu.

## Přihlašovací údaje a `.env`

Přístupové údaje pro autorizované testování jsou dostupné v lokálním `.env`.

Soubor `.env`:

- nikdy necommituj;
- nevkládej do issue, PR, logu, screenshotu, trace ani artefaktu;
- nevypisuj jeho hodnoty;
- před použitím ověř, že je ignorován;
- načítej pouze do lokálního procesu.

Očekávané proměnné:

```text
DAGMAR_E2E_BASE_URL=https://dagmar.hcasc.cz
DAGMAR_E2E_USER_EMAIL
DAGMAR_E2E_USER_PASSWORD
DAGMAR_E2E_ADMIN_EMAIL
DAGMAR_E2E_ADMIN_PASSWORD
```

Bezpečné načtení:

```bash
set -a
. ./.env
set +a
```

Doporučené oprávnění:

```bash
chmod 600 .env
```

Hesla neposílej jako CLI argument. Pokud údaj chybí, nejprve ověř seed, projektové skripty a bezpečný testovací postup. Nevytvářej náhradní produkční účet a neměň produkční heslo bez výslovného zadání.

## Bezpečné webové testování

Při testování produkce:

- používej pouze autorizované účty z `.env`;
- začni read-only smoke testem;
- mutační scénáře prováděj pouze tehdy, když jsou výslovně součástí zadané validace a jsou bezpečně reverzibilní;
- neodesílej e-maily, nerotuj integrační tokeny a nespouštěj hromadné exporty bez potřeby;
- po testu se odhlas a ukonči browser context;
- anonymizuj osobní údaje;
- neukládej odpovědi API obsahující zaměstnanecká data.

Minimální smoke test:

1. načti `/app` a `/admin/login`;
2. ověř statické assety;
3. ověř `/api/v1/health` a `/api/version`;
4. přihlas se pomocí `.env`;
5. ověř očekávaný landing a auth režim;
6. odhlas se.

Při úplné generační náhradě UI proveď navíc všechny bezpečně testovatelné scénáře katalogizované ve forenzní inventuře a všechny briefy uložené v dokumentaci.

## Deploy po restrukturalizaci

Deploy mechanismus musí odpovídat aktuální struktuře repozitáře.

Po přechodu na cílovou strukturu ověř zejména:

- backendové příkazy běží z kořene repozitáře;
- Alembic běží z kořene;
- nový frontend se buildí z `web/`;
- nasazuje se pouze `web/dist/` nebo skutečný výstup určený konfigurací;
- žádný krok neodkazuje na odstraněné `backend/` nebo `frontend/`;
- systemd používá správný pracovní adresář;
- Nginx obsluhuje správný frontendový build a `/api/v1/` proxy;
- produkční artefakt neobsahuje původní frontend;
- deploy ověřuje konkrétní commit;
- rollback je proveditelný.

## Definice hotové změny

Změna je hotová pouze tehdy, když:

- je doložena konkrétními soubory a chováním;
- neporušuje produkční invarianty;
- má odpovídající testy nebo přesně zdůvodněnou mezeru;
- projde relevantním lintem, typecheckem, testy a buildem;
- databázová změna obsahuje bezpečnou migraci;
- neobsahuje tajemství ani osobní data;
- dokumentace odpovídá výslednému chování;
- CI a deploy používají skutečnou aktuální strukturu;
- produkční server běží na očekávaném commitu;
- byl ověřen relevantní uživatelský scénář;
- je popsán dopad, ověření a rollback;
- při generační náhradě UI byl odstraněn původní pracovní frontend, nový frontend vznikl v `web/` od nuly a kontrola neodhalila převzetí původního zdrojového kódu.
