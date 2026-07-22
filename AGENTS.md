# AGENTS.md

## Rozsah

Agent pracuje pouze v repozitáři `karelmartinek-a11y/dagmar-monorepo`.
Tento monorepozitář je jediný pracovní cíl a produkční zdroj pravdy pro KájovoDagmar.

## Pořadí zdrojů pravdy

Autorita má toto pořadí:

1. aktuální zdrojový kód v tomto repozitáři
2. aktivní backendový kontrakt a databázové invarianty
3. skutečné produkční chování na `https://dagmar.hcasc.cz`
4. migrace, testy, CI/CD, deploy a provozní konfigurace
5. aktuální dokumentace
6. komentáře, docstringy, poznámky a příklady
7. git historie pouze jako forenzní reference

Pokud se dokumentace, komentáře, testy nebo manifest rozcházejí s funkčním kódem, nejprve ověř aktivní kódovou cestu a potom oprav neaktuální doprovodný artefakt. Funkční produkční kód se nesmí měnit jen proto, aby odpovídal starému textu.

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
- zaměstnanecká část používá bearer token
- integrační API používá samostatné bearer tokeny s prefixem `dgi_`
- docházka, plán služeb, zámky a exporty jsou vedené podle `employment_id`
- časová autorita je `Europe/Prague`
- reverse proxy a TLS obsluhuje Nginx

## Povinná disciplína změn

- Před úpravou najdi všechny implementace dotčené funkce, endpointu, komponenty, schématu, služby nebo konfigurace.
- Před úpravou sdílené části najdi všechny konzumenty v backendu, frontendu, testech, skriptech a dokumentaci.
- Nezjednodušuj scope, nenahrazuj produkční logiku mocky, placeholdery, demo daty ani dočasnými zkratkami.
- Široké přepisy souborů prováděj jen s konkrétním důvodem a následnou regresní validací.
- Buildy, generátory a skripty nesmí zanechat neočekávané změny ve verzovaných souborech.
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
