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
- docházka používá neomezené chronologické časové eventy bez směrového typu; výpočet páruje 1.–2., 3.–4. čas každého dne a nikdy nepáruje časy mezi dvěma kalendářními dny
- backend je jediná autorita časových intervalů, kategorií a výpočtů; docházkové časy páruje od prvního času každého lokálního dne bez použití interního směru, lichý konec zůstává nezapočítaný a následující den vždy začíná nové párování, takže historický orphan neposune další dny; denní hodnoty se matematicky zaokrouhlují na desetiny a měsíc je součet denních desetin
- automatické přestávky jsou fyzicky vložené, neretroaktivní průchody bez vlastní souhrnné metriky
- změny profilu retroaktivně přepočítávají odvozené metriky bez ohledu na zámky
- běžná změna eventu, plánu nebo stavu synchronizuje pouze skutečně dotčené měsíce; úplný historický přepočet je vyhrazen změně profilu a provoznímu backfillu
- `WORK_CONTRACT` vyžaduje celkovou a noční metriku; odpolední, víkendová a sváteční jsou volitelné. `DPP_DPC` a `EXTERNAL_HOURLY` mají všechny metriky včetně celkové a noční volitelné; `TASK_SHIFT_BASED` nemá hodinové metriky
- viditelné metriky určuje výhradně backendové `display_metrics` podle aktuálního profilu konkrétního úvazku, retroaktivně i pro starší období
- zaměstnanecké a adminské měsíční výběry obsahují pouze aktivního uživatele a úvazek platný podle `start_date`/`end_date`, jehož období se překrývá se zvoleným měsícem; úvazek nemá samostatný ruční přepínač aktivity
- adminské „Přidej pauzy“ je potvrzovaný idempotentní historický backfill dvojic časových hranic fyzických pauz bez hromadného undo; započítává délku existujících ručních pauz a doplní pouze chybějící zákonnou délku
- všechny mutace eventů, plánů a celodenních stavů stejného úvazku se serializují databázovým `SELECT FOR UPDATE`; po získání zámku se pod zámkem vlastníka znovu ověří aktivita úvazku i uživatele. Mutace eventu ověřuje unikátní chronologický čas, zámek každého měsíce, jehož interval nebo metriky by změnila, a průchod nesmí překrýt den s celodenní nepřítomností. Historický uzavřený interval se vkládá atomicky pomocí `paired_occurred_at` a prostřední interval nebo fyzická pauza se odstraňuje atomicky pomocí `paired_event_id`
- potvrzení změny plánového času i přechod klávesnice do další buňky čekají na dokončení kanonického načtení po zápisu. Obě časová pole stejného dne jsou do té doby `readOnly`, zachovávají focus a potvrzenou serverovou hodnotu; jiné dny zůstávají editovatelné a souběžné zápisy mají samostatné počitadlo podle `(employment_id,date)`
- editor plánu zachovává identitu uloženého časového pole i při zobrazení jediného času; osamocený čas lze upravit a smazat. Zaměstnanecký i adminský plán vždy zobrazují backendový měsíční součet `planned_hours` za každý úvazek, včetně `TASK_SHIFT_BASED` a vypnuté metriky `total`; neúplný plán ani celodenní stav do součtu nevstupují
- úplný časový plán směny smí obsahovat pouze interval se začátkem a pozdějším koncem ve stejném kalendářním dni; přeshraniční plán, carryover ani přeshraniční výpočet nejsou součástí kontraktu
- pracovní fond a bilanční porovnávání s fondem nebo plánem nejsou aktivní kontrakt
- databáze, API, lidské UI, screen-reader texty, tisky, PDF a CSV/ZIP vedou docházku výhradně jako neutrální chronologické `PRŮCHOD` časy bez směrového typu
- skupinový plán zachovává skutečné tabulkové `th`/`td` buňky; grid je pouze ve vnitřních obalech identity a souhrnu. Dlouhé identity se zalamují uvnitř sticky sloupce a jeho neprůhledné pozadí nesmí při horizontálním posunu propouštět časová pole
- scrollovací obal zaměstnaneckých tabulek i skupinového plánu ukotvuje absolutní přístupnostní statusy časových polí (`position:relative`), aby ani plán bez hodinových sloupců neroztahoval celou mobilní stránku
- nativní souhrnné PDF plánu má nejvýše pět úvazků na A4 landscape; den zůstává jediným sloupcem a jeho neutrální průchody jsou uvnitř buňky svisle. Plné identity, metriky a legenda se zalamují podle měřené šířky i výšky bez ořezu; nečitelný obsah vrací `409 print_capacity_exceeded`. Měsíční plánový součet je uveden i bez celkové hodinové metriky.
- docházkové a plánové detaily zachovávají jeden den v jednom řádku; hromadné pohledy zachovávají jeden `employment_id` v jednom řádku a den v jednom sloupci
- `ClockInput` je jediný editor ručně zadávaných časů a `timeInput.ts` jediný parser; běžné zadávání času nesmí používat boční editor, formulář, kartu ani modal
- přímé nastavení i self-service reset hesla používají jednu transakční credential operaci, která revokuje všechny reset/unlock tokeny i credential instance a vyčistí lockout; reset delivery má stav `PENDING/SENT/FAILED` a nejvýše jeden aktivní `SENT` token na uživatele

## Povinná disciplína změn

- Před úpravou najdi všechny implementace dotčené funkce, endpointu, komponenty, schématu, služby nebo konfigurace.
- Před úpravou sdílené části najdi všechny konzumenty v backendu, frontendu, testech, skriptech a dokumentaci.
- Nezjednodušuj scope, nenahrazuj produkční logiku mocky, placeholdery, demo daty ani dočasnými zkratkami.
- Široké přepisy souborů prováděj jen s konkrétním důvodem a následnou regresní validací.
- Buildy, generátory a skripty nesmí zanechat neočekávané změny ve verzovaných souborech.
- Bezpečnostní minimum pro OIDC/PDF je `PyJWT>=2.15.1` a `Pillow>=13.0.0`; frontendový schema parser používá `Zod>=4.6.7`. Závislosti se aktualizují spolu s oběma hashovanými Python locky a npm lockem a oba audity musí projít bez potlačení nálezů.
- Nginx runtime test kopíruje skutečné konfigurace přes Docker API do izolovaného kontejneru; nespoléhá na bind mount hostitelských cest. Migrační regrese ověřuje odmítnutí nevratného downgradu z headu a zachování revision i eventů.
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
python scripts/check_broad_exceptions.py
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

## Webová integrace CML

- Nový samostatně napsaný frontend `app/web_ui/` používá název KájovoDocházka a kontrakt `kajovo-web-ui/1`; nepřebírá původní UI. Původní API doména a neveboví klienti zůstávají kompatibilní; browserový vstup vede výhradně přes CML.
- `/cml-web/` vyžaduje podepsanou CML žádost s audience `dochazka`; nativní identita a přístup k úvazku se ověřují v tomto backendu. Jednorázovost podpisu patří do sdílené DB, nikoli do paměti workeru.
- Kvalifikační host `tests/cml_local_server.py` používá skutečné backendové routy a syntetickou místní DB; vyžaduje explicitní `CML_LOCAL_QUALIFICATION=1` a nikdy není součástí produkčního UI artefaktu.
- Aktuální stav integrace popisuje `docs/CML_WEB_CANDIDATE.md`. Nezaměňovat místní funkční průchod za úplné grafické schválení nebo nasazení.
- Centrální správa účtů a úvazků přes CML vyžaduje hlavní účet a pro zápis čerstvé podepsané ověření. Nativní credentials tímto tokem neměnit. `end_date: null` znamená úvazek bez konce; vynechané datum ponechává stávající hodnotu. Generátor manifestu musí importovat vlastní checkout i při cizím editable prostředí/PYTHONPATH.

- Nové pracovní profily zakládá jen hlavní účet přes podepsaný CML kontrakt
  `kajovo-profile-provision/1`, s čerstvým reauth a neměnnými UUID operace/účtu.
  Migrace `2026_10_31_0030` přidává trvalou účtenku. Uživatel, aktivní WEB
  Instance a účtenka jsou jedna transakce; heslo ani úvazek se nevytváří.
  Profil omezuje jméno na skutečných 128 znaků Instance bez zkracování; dlouhý
  e-mail má fingerprint s digestem místo překročení jejího 128znakového sloupce.
  E-mailový konflikt neznamená sloučení. Běžné centrální vytvoření přes
  `/api/v1/admin/users` je odmítnuté, původní nativní API zůstává kompatibilní.
  Čtecí účtenka nikdy znovu nevytváří odstraněný profil; účtenka přežije rollback.
  PostgreSQL souběh vyžaduje `CML_PROFILE_TEST_DATABASE_URL` s místní `_test` DB
  a používá pouze vlastní izolované schéma, nikoli existující zaměstnance.

- Frontendový lint má záměrný přesný override `minimatch: 11.0.1` pro
  GHSA-g3hv-75wg-m249; nevracet zranitelné vnořené verze. Změna tohoto
  override vyžaduje npm audit, skutečný lint, typy, unit testy a build.
  Python lock se audituje na CI Pythonu 3.12; jeho připnuté závislosti mají
  vlastní minimální verzi Pythonu. Neřešit chybně zvolený auditní interpreter
  snížením bezpečnostních verzí závislostí.

- Nginx `/cml-web/` musí předat plnou cestu a podpis původnímu backendu; nesmí
  vrátit SPA index nebo veřejná data místo ověření. Samotná proxy nepřihlašuje.
  Cesta má vlastní jedinou sadu bezpečnostních hlaviček, no-store a 8m limit;
  statický i skutečný Docker Nginx test ověřují její směrování.

- Kandidát přesouvá všechny browserové vstupy na pevné HTTPS CML
  `/#dochazka`; tato výslovně zadaná integrace je oprávněné použití domény
  `kajovocml.hcasc.cz`. Vlastní API doména zůstává `dagmar.hcasc.cz`.
  `/api/` a podepsané `/cml-web/` se nevracejí do SPA a zachovávají nativní
  kontrakty. CI distribuuje pouze zdrojově vázaný CML entry marker podle
  `scripts/package_cml_entry.py`; nové UI se dodává v backend wheelu.
  Nepřidávat původní frontend bundle jako fallback. Veřejný smoke je
  `web/scripts/cml-production-smoke.mjs`, autentizovaná přejímka a design
  gate zůstávají samostatné.

- První použitelné vydání má podle přímého zadání z 1. 11. 2026 přednost
  před úplnou vizuální přejímkou. Kosmetika a úplné méně používané stavy,
  překlady/tisk/přístupnost jsou ODLOŽENO PO PRVNÍM NASAZENÍ, ne PASS.
  Vynucení autorizace a zachování dat/nativních klientů zůstává povinné.
- `CML_BROWSER_ENTRY_ONLY=1` při koordinovaném cutoveru zavře původní
  browserové cookies pro obchodní API i administraci. Podepsaný CML stav
  a původní nativní instance/integration tokeny jsou oddělené profily.
  Browserové Fetch Metadata/Origin se nesmějí použít k nativnímu bearer
  přístupu. Flag má jen hodnoty 0/1; chyba konfigurace zastaví start.
  Výchozí 0 slouží přípravě kompatibilního backendu před cutoverem,
  nikoli jako důkaz výhradního webového vstupu v produkci.

Koordinované nasazení přes přímé SSH používá trailer `CML-Coordinated-Cutover: true`.
CI a tvorba artefaktů dále běží; pouze automatický produkční job pro tento
commit nepřepne portál mimo řízené nasazení. Publikovaný otestovaný artefakt
se v tomto režimu nasazuje přímým SSH z Codexu. Ostatní commity zachovávají
původní automatizační pravidlo. Tato výjimka nevypíná testy.

Nový CML plán služeb přijímá odpovědi jen z aktuální generace načtení.
Změna období/skupiny nesmí připojit staré řádky ani starou chybu do nového
pohledu. Skupina musí patřit do právě načteného seznamu; prázdný adminský
výběr úvazků zůstává prázdný. Izolované browserové regrese spouští
`npm run test:cml-periods` z `web/` (CI Chromium; lokálně také
`CML_BROWSER_ENGINES=chromium,webkit npm run test:cml-periods`).

Dokončení souběžných zápisů různých dnů v novém CML editoru musí každý
výsledek kanonicky znovu načíst v aktuálním období. Obnova jiným zápisem
není navigace a nesmí druhé potvrzení zahodit. Po skutečné změně období
se starý pohled neobnovuje. Enter zachovává focus; Tab čeká na read-back.

CML adminský plán má měsíční listy jednotlivých vybraných úvazků a funkční
zámek/odemčení; skupinový plán zachovává matici úvazků a dnů. Plánové
celodenní stavy používají PUT `/api/v1/admin/shift-plan` nebo
`/api/v1/shift-plan`, nikoli docházkový `day-status`. Časy jsou výslovně
null. Neprázdný stav vyžaduje potvrzení; clear bez původního plánového
stavu je neaktivní. Serverový konflikt se neopakuje automaticky.

Vlastní CML plán musí umožnit zvolit každý dostupný úvazek a odmítnout
opožděná data předchozího výběru. Denní plánové metriky řídí backendové
`display_metrics`; měsíční plánované hodiny jsou viditelné i bez denních
hodinových sloupců. Součty se ve frontendu nevypočítávají. Efektivní stav
z vlastní docházky nesmí plánový editor nabídnout jako prázdné časové buňky.

Měsíční souhrn skutečné docházky zalamuje všechny backendové metriky
uvnitř panelu i na 390/320 px. Zarovnání nesmí vytlačit první hodnoty
mimo viditelnou plochu; lokální browserový runner ověřuje také dlouhá čísla.

PDF plánu a hromadný CSV/ZIP používají ve vloženém UI stávající typované
stahování CML, nikoli navigaci na blob URL neprůhledného rámce. Manifest
deklaruje pouze PDF do 50 000 000 B a ZIP do 16 MiB; autoritu dat stále
ověřují původní exportní routy. CML přijme soubor jen po aktuálním gestu.
Po jeho vypršení zůstává jediný připravený soubor pouze v paměti rámce;
další kliknutí znovu neposílá exportní požadavek. ACK musí pocházet z parent,
správného originu, prefixu a UUID. `npm run test:cml-downloads` z `web/`
ověřuje binární přenos, odmítnuté předání a poškozený soubor; integrace
s původními routami a skutečným stažením běží v CML checkoutu.

- Tiskový výběr v CML je místní a nemění persistentní výběr plánu. Detailní docházka zachovává všechny chronologické průchody a jediný den na řádku; souhrnná varianta zobrazuje měsíční metriky. Náhledy čtou původní admin attendance/month DTO, včetně `planned_hours` úkolových úvazků; frontend nepočítá hodiny. Export samostatného úvazku používá `employment_id`, hromadný `bulk=true`, nikdy obojí. CSV/PDF/ZIP používají deklarovaný CML transport a limit; NUL v CSV je odmítnut. Regrese nových obrazovek: `npm run test:cml-prints` (také `CML_BROWSER_ENGINES=chromium,webkit`).

- Přehled CML zobrazuje skutečné počty původních users/integration clients API a skutečný liveness; nedostupný nebo nepovolený seznam znamená N/A, nikdy nulu. Čtecí výjimka podepsané Docházky je přesně GET `/api/version`; ostatní metody i jiné `/api/*` cesty zůstávají odmítnuté. Informační integrační stránky nepřebírají webovou identitu pro chráněné integrační API ani nevydávají tokeny. Regrese: `npm run test:cml-admin-info`.

- CML časové buňky přijímají H, HH, HMM, HHMM a H:MM. Enter i opuštění
  uloží, Tab čeká na kanonické načtení a teprve pak přejde dál. Delete
  vymaže celý údaj, Escape zahodí rozepsanou změnu. Chyba blikne červeně
  a drží fokus; úspěch blikne zeleně až po read-backu. Přijatý zápis
  s chybným následným čtením se neposílá znovu; obnova je pouze čtecí.
  Neověřený zámek nedovolí editaci, dokud uživatel neobnoví stav.
