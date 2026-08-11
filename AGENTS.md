# AGENTS.md

## Rozsah

Agent pracuje pouze v repozitáři `karelmartinek-a11y/dagmar-monorepo`.
Tento monorepozitář je jediný pracovní cíl a produkční zdroj pravdy pro KájovoDagmar.

## Pořadí zdrojů pravdy

Autorita má toto pořadí:

1. `docs/SSOT_CURRENT.md` pro kanonický požadovaný cílový stav
2. aktuální vykonávaný zdrojový kód a aktivní backendový/databázový kontrakt pro baseline fakta, která SSOT výslovně nenahrazuje
3. skutečné produkční chování na `https://dagmar.hcasc.cz`
4. migrace, testy, CI/CD, deploy a provozní konfigurace
5. README, manifest a další aktivní dokumentace
6. komentáře, docstringy, poznámky a příklady
7. git historie pouze jako forenzní reference

Pokud se baseline kódu a cílový stav SSOT rozcházejí, jde o implementační mezeru, kterou je nutné uzavřít; SSOT se nesmí oslabit označením požadavku za historický nebo neaktivní. Pokud se dokumentace, komentáře, testy nebo manifest rozcházejí s aktivní cestou či SSOT, oprav neaktuální artefakt. Historii nahrazených řešení uchovává pouze Git.

## Aktuální struktura repozitáře

- `app/` FastAPI backend
- `alembic/` Alembic migrace
- `tests/` backendové a repozitářové regresní testy
- `scripts/` validační, generační a provozní skripty
- `web/` Vite, React a TypeScript frontend
- `web/tests/` frontendové unit a E2E testy
- `docs/` aktuální technická a provozní dokumentace
- `.github/workflows/` GitHub CI/CD a produkční deploy
- `ops/` Nginx a systemd konfigurace

Žádný agent nesmí vydávat historické top-level rozdělení na samostatný backend a frontend za současnou aktivní strukturu monorepa.

## Runtime invarianty

- kanonická doména je `https://dagmar.hcasc.cz`
- aktivní API namespace je `/api/v1/` a endpointy jsou registrované pod `/api/v1/...`
- backend interně naslouchá na `127.0.0.1:8101`
- PostgreSQL je publikovaná pouze na `127.0.0.1:5433`
- administrace používá session cookie a CSRF
- zaměstnanecký browser používá samostatnou podepsanou HttpOnly Secure SameSite=Lax cookie `dagmar_portal_session`, jejíž platnost je navázaná na aktuální password credential, a synchronizer CSRF pro mutace; souběžné browserové relace se při loginu navzájem neruší a explicitní bearer instance zůstává pouze pro non-browser klienty
- integrační API používá samostatné bearer tokeny s prefixem `dgi_`
- integrační API používá jedinou deny-by-default scope službu pro seznamy i přímá ID: `ALL_EMPLOYMENTS`, `ALL_ACTIVE_EMPLOYMENTS`, neprázdné `SELECTED_EMPLOYEES` a neprázdné `SELECTED_EMPLOYMENTS`; zápisy navíc vyžadují aktivní úvazek i uživatele
- integrační seznamy používají verzovaný opaque cursor (`id`, u eventů `(occurred_at,id)`) a health/data/OpenAPI mají oddělené konfigurovatelné rate-limit buckety
- docházka, plán služeb, zámky a exporty jsou vedené podle `employment_id`
- skupiny úvazků jsou vztah M:N nad `employment_id`, mají nejméně dva členy a sdílejí pouze plán směn
- časová autorita je `Europe/Prague`
- backend je jediná autorita hodin: denní `*_tenths` používají matematické half-up zaokrouhlení `floor((denní_minuty + 3) / 6)` a denní `*_hours` jsou `*_tenths / 10`; měsíční hodnoty jsou součtem již zaokrouhlených denních desetin a frontend, tisky i exporty je pouze zobrazují
- reverse proxy a TLS obsluhuje Nginx
- produkční public URL a CORS jsou přesně `https://dagmar.hcasc.cz`; chybné prostředí, SameSite nebo URL konfigurační hodnoty selžou při startu, externí OAuth síťové cíle jsou omezené na přesné oficiální HTTPS hosty a cesty
- `/api/v1/health` a `/api/health` jsou DB-independent liveness; `/api/v1/readiness` ověřuje databázové spojení a přesnou shodu jediné DB Alembic revision s jediným zabaleným headem
- úvazky mají pouze typy `WORK_CONTRACT`, `DPP_DPC`, `TASK_SHIFT_BASED` a `EXTERNAL_HOURLY`; profilová nastavení patří konkrétnímu `Employment`
- docházka používá neomezené chronologické `IN`/`OUT` eventy, včetně intervalů přes půlnoc a hranice měsíců
- backend je jediná autorita časových intervalů, kategorií a výpočtů; denní hodnoty se matematicky zaokrouhlují na desetiny a měsíc je součet denních desetin
- automatické přestávky jsou fyzicky vložené, neretroaktivní průchody bez vlastní souhrnné metriky
- změny profilu retroaktivně přepočítávají odvozené metriky bez ohledu na zámky
- běžná změna eventu, plánu nebo stavu synchronizuje pouze skutečně dotčené měsíce; úplný historický přepočet je vyhrazen změně profilu a provoznímu backfillu
- `WORK_CONTRACT` vyžaduje celkovou a noční metriku; odpolední, víkendová a sváteční jsou volitelné. `DPP_DPC` a `EXTERNAL_HOURLY` mají všechny metriky včetně celkové a noční volitelné; `TASK_SHIFT_BASED` nemá hodinové metriky
- viditelné metriky určuje výhradně backendové `display_metrics` podle aktuálního profilu konkrétního úvazku, retroaktivně i pro starší období
- zaměstnanecké a adminské měsíční výběry obsahují pouze aktivního uživatele a aktivní úvazek, jehož období se překrývá se zvoleným měsícem
- adminské „Přidej pauzy“ je potvrzovaný idempotentní historický backfill fyzických `OUT`/`IN` eventů bez hromadného undo; započítává délku existujících ručních pauz a doplní pouze chybějící zákonnou délku
- všechny mutace eventů, plánů a celodenních stavů stejného úvazku se serializují databázovým `SELECT FOR UPDATE`; po získání zámku se pod zámkem vlastníka znovu ověří aktivita úvazku i uživatele. Mutace eventu zachovává posloupnost začínající `IN`, ověřuje zámek každého měsíce, jehož interval nebo metriky by změnila, a průchod nesmí překrýt den s celodenní nepřítomností. Historický uzavřený interval se vkládá atomicky pomocí `paired_occurred_at` a prostřední interval nebo fyzická pauza se odstraňuje atomicky pomocí `paired_event_id`; databáze nikdy nepersistuje přechodně neplatnou posloupnost
- přeshraniční plán se validuje a zamyká ve všech dotčených dnech a měsících, nesmí se překrývat s jiným plánem stejného úvazku; carryover v následujícím dni je v DTO explicitní a časová pole samotného carryover jsou v UI pouze ke čtení. Pokud ve stejném dni začíná další nepřekrývající se směna, DTO, UI i report zobrazí oba intervaly
- pracovní fond a bilanční porovnávání s fondem nebo plánem nejsou aktivní kontrakt
- lidské UI, screen-reader texty, tisky, PDF a CSV/ZIP používají pouze neutrální lokalizovaný pojem `PRŮCHOD`; interní `IN`/`OUT` zůstávají pouze strojovým kontraktem
- docházkové a plánové detaily zachovávají jeden den v jednom řádku; hromadné pohledy zachovávají jeden `employment_id` v jednom řádku a den v jednom sloupci
- `ClockInput` je jediný editor ručně zadávaných časů a `timeInput.ts` jediný parser; běžné zadávání času nesmí používat boční editor, formulář, kartu ani modal
- přímé nastavení i self-service reset hesla používají jednu transakční credential operaci, která revokuje všechny reset/unlock tokeny i credential instance a vyčistí lockout; reset delivery má stav `PENDING/SENT/FAILED` a nejvýše jeden aktivní `SENT` token na uživatele

## Povinná disciplína změn

- Před úpravou najdi všechny implementace dotčené funkce, endpointu, komponenty, schématu, služby nebo konfigurace.
- Před úpravou sdílené části najdi všechny konzumenty v backendu, frontendu, testech, skriptech a dokumentaci.
- Nezjednodušuj scope, nenahrazuj produkční logiku mocky, placeholdery, demo daty ani dočasnými zkratkami.
- Široké přepisy souborů prováděj jen s konkrétním důvodem a následnou regresní validací.
- Buildy, generátory a skripty nesmí zanechat neočekávané změny ve verzovaných souborech.
- Python dependency kontrakt tvoří hashované `requirements-prod.lock` a `requirements-dev.lock`; CI i deploy používají `pip==26.0` a nesmějí řešit široké rozsahy za běhu.
- Produkční backend se nasazuje pouze z CI vytvořeného wheelu a lokálního wheelhouse po ověření SHA-256 manifestu; produkční server nesmí stahovat balíčky ani sestavovat runtime z Git checkoutu.
- Všechny GitHub Actions jsou připnuté na plný commit SHA a dependency audit, Bandit, CodeQL a secret scan jsou povinné gate bez `continue-on-error`.
- Před commitem zkontroluj celý diff a potvrď, že nezmizela nesouvisející funkčnost.

Každá změna, včetně malé opravy, musí být před commitem uzavřena napříč všemi dotčenými artefakty. Přidané chování musí být přidáno do relevantních testů, CI kontrol, dokumentace, komentářů, poznámek, manifestů a trvalých pravidel v AGENTS.md. Odstraněné chování musí být ze stejných míst skutečně odstraněno. Nestačí starý text označit jako historický nebo neaktivní. Přejmenování a změna kontraktu musí nahradit všechny staré výskyty. Git historie je jediným místem pro historii odstraněných funkcí.

## Přidání, odstranění a změna funkcí

- Při přidání funkce uprav současně implementaci, konzumenty, testy, CI, dokumentaci, manifest a podle potřeby `AGENTS.md`.
- Při odstranění funkce odstraň i všechny konzumenty, nepoužité typy, schémata, fixture, překlady, dokumentaci, komentáře a staré testy; pokud hrozí nechtěné obnovení, přidej regresní test absence.
- Při přejmenování nebo změně kontraktu nahraď všechny staré výskyty; starý alias smí zůstat jen při prokázané kompatibilní potřebě a musí být otestovaný a zdokumentovaný jako současný kontrakt.
- Každá změna musí být uzavřená ve všech dotčených artefaktech před commitem, ne až v navazující opravě.

## Povinnost průběžně kontrolovat AGENTS.md

- `AGENTS.md` se při každé změně forenzně zkontroluje.
- Pokud změna ovlivňuje trvalý kontrakt, architekturu, cesty, invarianty, validační příkazy nebo pracovní postup agenta, `AGENTS.md` musí být věcně aktualizován.
- Neprováděj prázdné nebo formální úpravy `AGENTS.md`, časová razítka ani falešné zápisy bez věcného dopadu.
- Pokud změna `AGENTS.md` nevyžaduje, závěrečný report musí uvést, co bylo zkontrolováno a proč jeho znění zůstává přesné.

## Zákaz historických aktivních artefaktů

- Aktivní repozitář nesmí obsahovat historické zadání, audit nebo migrační report vydávaný za současný stav.
- Odstraněné funkce, staré názvy cest, komponent, endpointů, služeb, domén a repozitářů se v aktivní dokumentaci ani komentářích nenechávají jako „legacy“ poznámky.
- Historii uchovává git; nevytvářej dokumentační hřbitov.

## Backendová pravidla

- Zachovej sdílený JSON kontrakt chybových odpovědí.
- Nepropouštěj interní výjimky přímo ke klientovi.
- Zachovej request ID, auditní logování integrací, rate limiting a bezpečnostní kontroly.
- Ověřuj `employment_id` na všech relevantních hranicích backendu.
- Při změně API současně ověř frontendového konzumenta, autentizaci, oprávnění, validaci a chybové stavy.
- Externí Google a Apple přihlášení zůstávají jen volitelným ověřením již propojeného interního účtu.

## Frontendová pravidla

- Zachovej správné české copy a pojmenování KájovoDagmar.
- Respektuj aktuální backendový kontrakt a nepřetvářej API podle pohodlí UI.
- Zachovej loading, empty, success, error, locked, conflict, offline a destructive-confirm stavy tam, kde jsou relevantní.
- Zachovej focus management, klávesovou přístupnost, čitelné chyby a testovací selektory.
- Ověř desktop i mobil, zejména overflow, sticky oblasti a velké docházkové a plánovací matice.

## Databáze a migrace

- Schéma měň pouze přes Alembic migrace.
- U změny databázového kontraktu aktualizuj backend, frontend, testy, manifest a dokumentaci v jednom logickém celku.
- Respektuj existující databázové invarianty a aktivní produkční data.

## Bezpečnostní pravidla

- Tajné údaje čti jen z ignorovaných lokálních `.env` souborů nebo z autorizovaných serverových environment souborů.
- Nikdy nevypisuj tajné hodnoty do odpovědí, commitů, logů ani dokumentace.
- Produkční data, firewall ani secret konfiguraci neměň bez explicitní potřeby a ověření.
- Používej pouze kanonickou doménu `dagmar.hcasc.cz` v kódu, dokumentaci, testech i konfiguraci.

## Validace

### Design gate

- Finální vizuální posouzení provádí designový agent v tomto workspace; jeho písemný verdikt `SCHVÁLENO` je povinný důkaz uzavření design gate.
- Důkazem jsou skutečné lokální rendery z reálného lokálního backendu a frontendu, uložené mimo repozitář; produkční screenshoty nejsou požadované a produkce se při design review nesmí měnit.
- Rendery musí pokrýt všechny dotčené role a plochy, desktop 1440×900, tablet 768×1024, mobil 390×844, relevantní jazyky a tiskový náhled. Samotný build nebo unit test design gate neuzavírá.
- Pokud designový agent uvede P0/P1 nález nebo chybí některá požadovaná evidence, stav zůstává blokovaný a implementace se nesmí vydávat za dokončenou.

Spusť relevantní kontroly pro dotčenou oblast a v závěrečném reportu uveď přesné příkazy, které byly skutečně spuštěny.

Backend a repozitář:

```bash
python -m compileall -q app
ruff check app tests scripts
mypy app
alembic heads
pytest -q
python scripts/check_repo_invariants.py
python scripts/generate_current_state_manifest.py --check
python scripts/check_python_lock.py
python scripts/check_security_policy.py
pip-audit -r requirements-prod.lock
bandit -r app scripts -ll
```

Frontend z `web/`:

```bash
npm ci
npm audit --package-lock-only --audit-level=moderate
npm run check:branding
npm run lint
npm run typecheck
npm test
npm run test:a11y
npm run test:visual
npm run build
npm run test:e2e
```

Po generačních a build krocích ověř čistý strom:

```bash
git diff --exit-code
git status --short
```

## Commit, push, deploy a produkční validace

- Před commitem zkontroluj diff, staging a nepřítomnost tajných údajů.
- Commit message musí být věcná a popisovat skutečný logický celek změny.
- Po pushi ověř GitHub Actions a případné selhání oprav bez přenášení práce na uživatele.
- Pokud GitHub Actions nebo GitHub deploy právě běží, není to blocker a práce se nesmí ukončit v tomto mezistavu; je nutné počkat na dokončení a podle výsledku pokračovat dle těchto instrukcí a konkrétní situace.
- Produkční backend se zastaví ještě před Alembic migrací a zůstane zastavený po dobu povinného backfillu i následné konzistenční kontroly, aby migrace nemohla souběžně přijmout zápis starého kontraktu a mezi `--check` a aktivací release nevznikly nesynchronizované zápisy. Po zahájení migrace se při chybě nikdy znovu nespouští starý release proti novému schématu; backend zůstane zastavený do bezpečné opravy nebo spuštění kompatibilního release.
- Při nasazení ověř cílový commit, průběh deploye, health endpoint, version endpoint a relevantní uživatelské scénáře.
- Produkční validaci prováděj jen v mezích dostupných oprávnění; interní serverové kroky musí být podložené autorizovaným přístupem nebo důkazy z deploy workflow.

## Povinný závěrečný report

Závěrečný report musí obsahovat:

1. výchozí a výsledný commit
2. změněné a odstraněné soubory
3. upravenou dokumentaci
4. upravené komentáře, docstringy a poznámky
5. změny testů, CI a invariantních kontrol
6. změny manifestu a `AGENTS.md`
7. přesné spuštěné příkazy
8. výsledky validací
9. informace o commitu, pushi, GitHub Actions, deployi a produkční validaci
10. potvrzení, že staré názvy a historické artefakty nezůstaly aktivně přítomné, nebo doložený blocker
