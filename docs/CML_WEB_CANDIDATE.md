# KájovoDocházka v CML – vývojový kandidát

Webové UI `app/web_ui/` je nové a používá existující docházkové endpointy i výpočty. Není přepnuté do produkce. Původní pracovní kopie s jiným rozpracovaným redesignem nebyla změněna.

`CmlWebBoundary` obsluhuje `/cml-web/` jen při explicitním veřejném klíči v `CML_WEB_JWKS_PATH`. Každý požadavek ověřuje přes issuer `https://kajovocml.hcasc.cz`, audience `dochazka`, metodu, přesnou cestu s query, hash těla a desetisekundovou platnost. Replaye blokuje tabulka `cml_web_nonce`, která vzniká Alembic migrací `2026_10_30_0029`. Veřejný JWKS není credentials jiného MCP.

Podepsaný stav se vkládá výhradně do ASGI state po úspěšném ověření a spotřebování nonce. Browserová hlavička nemůže nastavit `cml_admin`, `cml_user_id` ani `cml_web_claims`. Zaměstnanecké požadavky se znovu vážou na původní aktivní `PortalUser` a `Instance`; endpointové kontroly úvazku a zámků zůstávají zachované. Stávající cookie, integrační a nativní přístupy nejsou tímto kandidátem odstřižené.

Společné logo, font a piktogramy načítá vložené UI z veřejných brand assets CML. Žádná původní frontendová komponenta nebyla převzata. `tests/cml_local_server.py` je výslovně zapínaný loopback kvalifikační host s izolovanou syntetickou DB a skutečnými backendovými routami; není produkční aplikace ani doklad živých produkčních účinků.

Neuzavřeno zůstává úplné pokrytí předloh a jazyků, část provozní administrace, centrální správa úvazků, převod identit a jejich hesel, uzavření přímých browserových vstupů, design gate, publikace na main a produkční nasazení. Není přípustné tyto části vydávat za dokončené na základě testu několika nových obrazovek.

Centrální CML detail účtu spravuje úvazky přes původní `/api/v1/admin/users/{id}/employments` a `/api/v1/admin/employments/{id}`. Podepsané routy účtů a úvazků připouštějí jen hlavního správce; zápisy vyžadují aktuální `reauthUntil`. Lokální heslové a resetovací toky jsou pro tuto cestu odmítnuté. Explicitní `end_date: null` ruší konec platnosti, vynechané pole jej zachovává. Nejasná odpověď nesmí sama vyvolat nový zápis. Při zúžení období zůstává původní kontrola a samostatné potvrzení navázaných dat.

Generátor manifestu vždy preferuje vlastní checkout před jinou editable instalací nebo cizím PYTHONPATH. CLI kontrola to ověřuje ze samostatného pracovního adresáře. Kvalifikační host zahrnuje skutečné administrační routy; nevytváří náhradní výpočty.

Nový atomický kontrakt `kajovo-profile-provision/1` vytváří vlastní pracovní
profil z centrálního CML průvodce. Podepsaný POST `/cml-web/api/profiles` přijímá
`operation_id`, `central_user_id` a původní profilová pole bez hesla/ID. Vyžaduje
hlavního vlastníka a čerstvé reauth; GET se stejným ID pouze čte účtenku a
aktuální profil. Pole navíc jsou odmítnutá. Účtenka obsahuje původní fingerprint,
centrální UUID a skutečné nativní ID, nikdy heslo. Jedinečné operace a centrální
UUID spolu s profilem vznikají jednou transakcí. Konflikt e-mailu nevytvoří
vazbu k cizímu účtu; změna argumentů stejného ID vrací konflikt. Smazání
pracovního profilu nemaže jeho účtenku a opakování jej nevytváří znovu.

CML nejprve trvale uloží rozepsaný neaktivní účet, poté vytvoří profily a po
nezávislém read-backu potvrdí vazby/granty. Pozvánku vydává až nad konečnou
revizí. Původní nativní credentials a neveboví klienti se nemění; tento kontrakt
nevolá původní nativní onboarding. Obnova nejisté žádosti nejprve čte původní
ID a případné pokračování je výslovné, nad stejným DB-only atomickým kontraktem.

Docházka tímto tokem zakládá `PortalUserRole.EMPLOYEE`, aktivní vlastní WEB
Instance a žádný úvazek nebo nativní heslo. CML správce Docházky je ověřená
centrální role; nevzniká nový nativní enum. Maximální jméno je 128 znaků podle
skutečného sloupce Instance; e-mail maximálně 160. Nevebové přihlášení, reset
a zaměstnanecké výpočty zůstávají původní.

Místní kvalifikace nových profilů zahrnuje devět testů včetně skutečného
PostgreSQL souběhu a celou backendovou sadu 249 PASS / 0 skipped, mypy 69
souborů, Ruff, kontrolu invariantů, migrací, manifestu, hashovaných locků
a bezpečnostní politiky. Audit produkčního Python locku z Pythonu 3.12 nemá
známý nález; Bandit na požadované úrovni nezjistil problém. Frontendová sada
má 84 PASS; lint, typy a build prošly. Původní prohlížečové regrese s reálným
izolovaným PostgreSQL backendem mají 25 PASS, pět volitelných design captures
bylo přeskočeno. To nenahrazuje design gate nového CML frontendu.

Povinný npm audit zachytil GHSA-g3hv-75wg-m249. Připnutý override
`minimatch: 11.0.1` a odpovídající lock odstranily všechny npm nálezy. Původní
ESLint a jeho pravidla zůstávají; skutečný lint ověřil kompatibilní rozhraní
použitých konzumentů. Neproběhlo potlačení advisory nebo oslabení gate.
Zdroj: https://github.com/advisories/GHSA-g3hv-75wg-m249 .

Kandidátní Nginx snippet směruje `/cml-web/` na tentýž vlastní backend 8101
bez přepisu cesty, s no-store a samostatnou sadou bezpečnostních hlaviček.
Nesmí se vracet původní SPA index. Samotná proxy nepřijímá uživatele: podpis
a nativní stav nadále ověřuje backend. Produkční konfigurace se tímto místním
krokem nezměnila; přímé staré browserové vstupy čekají na úplný cutover.

## Výhradní CML vstup – místní kandidát 31. 10. 2026

Nginx již nepoužívá původní `try_files` nebo SPA index. Každý browserový
dokument/asset mimo vyhrazené `/api/` a podepsané `/cml-web/` vrací pevné
302 do `https://kajovocml.hcasc.cz/#dochazka`, s no-store a jedinou sadou
bezpečnostních hlaviček. Původní query nebo resetový token se do CML
nepřenáší. Nativní API, callbacky a výpočty se touto routovací změnou nemění.

CI dále kvalifikuje historický frontend pro regresi, do nového web release
ale balí pouze nový deterministický `cml-entry.json` s přesným Git SHA.
Původní JS/CSS/HTML se nedistribuuje; nové vlastní UI `app/web_ui/` je
v backend wheelu za podepsanou gateway. Symlink web release zůstává
kompatibilním technickým krokem pro rollback, nikoli veřejným SPA hostem.
Nový veřejný smoke kontroluje pevný CML vstup, skutečný backend SHA/readiness,
401 bez podpisu a skutečnou anonymní login stránku CML. Přihlášená funkční
přejímka má samostatný společný gate; veřejné 302/200 ji nenahrazuje.

Sedm místních kontrol prošlo: skutečný Docker Nginx/HTTPS bez vnějšího
následování redirectů, zachování obou API cest, odstranění starého
browserového vstupu a přesný reprodukovatelný balíček bez původního UI.
Produkční smoke zatím nebyl spuštěný. Úplné designové/jazykové/tiskové
řady, nezávislý designový verdikt, GitHub a koordinované nasazení zůstávají
otevřené. Produkční Nginx, účty, úvazky a relace se tímto krokem nezměnily.

Po portu publikačních kontrol prošla úplná backendová suite: 251 PASS,
bez skipů. Ruff nad app/tests/scripts, mypy (69 souborů), compileall,
repo invarianty, generovaný current-state manifest a frontend lint prošly.
Plný pytest vyžaduje obě proměnné `DAGMAR_DATABASE_URL` a
`CML_PROFILE_TEST_DATABASE_URL` na vlastním local-only PostgreSQL prostředí
s ovladačem `postgresql+psycopg`; migrační regrese není volitelný skip.
Nový produkční smoke se zatím kvalifikoval syntaxí a odpovídajícími lokálními
Nginx/CML průchody, nikoli spuštěním na produkci.
