# AGENTS.md

## Účel a rozsah

Tento soubor je provozní a vývojová instrukce pro Codex a další automatizované agenty pracující v repozitáři `dagmar-monorepo`.

Repozitář je produkční monorepo docházkového systému DAGMAR. Obsahuje:

- `backend/` — FastAPI aplikaci v Pythonu 3.11+, SQLAlchemy/Alembic a PostgreSQL;
- `frontend/` — React 18, TypeScript a Vite;
- `.github/workflows/` — CI a produkční nasazení;
- `docs/` — provozní, migrační a integrační dokumentaci.

Změny prováděj konzervativně. Nezaváděj mocky, placeholdery, demo režimy ani skryté obcházení produkčních pravidel.

## Zdroj pravdy

Před změnou vždy prostuduj alespoň:

1. tento `AGENTS.md`;
2. root `README.md`;
3. `docs/monorepo-migration.md`;
4. `backend/README.md` a relevantní backendové moduly;
5. `frontend/package.json`, `frontend/src/App.tsx` a relevantní frontendové moduly;
6. dotčené workflow, migrace, testy a provozní dokumentaci.

Pokud se dokumentace rozchází s implementací, nehádej. Popiš rozpor a ověř aktuální produkční chování před změnou kontraktu.

## Produkční invarianty

Bez výslovného zadání neměň:

- kanonickou webovou i produkční doménu `https://dagmar.hcasc.cz`;
- produkční hostname `dagmar.hcasc.cz`;
- API prefix `/api/v1/`;
- backend bind `127.0.0.1:8101`;
- PostgreSQL publikovanou pouze na `127.0.0.1:5433`;
- admin autentizaci přes session cookie a CSRF;
- zaměstnaneckou autentizaci přes bearer token;
- oddělení integračních tokenů od zaměstnaneckých tokenů;
- produkční umístění backendu `/opt/dagmar/backend/`;
- produkční build frontendu nasazovaný z `frontend/dist/`.

Doména systému byla, je a zůstává `dagmar.hcasc.cz`. Nepoužívej žádnou jinou variantu domény v kódu, dokumentaci, testech, konfiguraci, SSH instrukcích ani výstupech.

Backend nesmí vytvářet chybějící databázové struktury během request flow. Schéma měň výhradně verzovanou Alembic migrací a migraci spusť před startem nové verze aplikace.

## Funkční mapa

### Zaměstnanecká část

- webová aplikace: `/app`;
- přihlášení zaměstnance e-mailem a heslem;
- bearer token pro zaměstnanecké API;
- evidence příchodu a odchodu po dnech;
- zobrazení a respektování plánu služeb a stavů dnů;
- reset přístupu: `/reset`.

### Administrace

- přihlášení: `/admin/login`;
- přehled: `/admin/prehled`;
- uživatelé: `/admin/users`;
- docházkové listy: `/admin/dochazka`;
- plán služeb: `/admin/plan-sluzeb`;
- exporty: `/admin/export`;
- tisky a náhled: `/admin/tisky`, `/admin/tisky/preview`;
- nastavení a diagnostika nasazení: `/admin/settings`;
- instance/úvazky: `/admin/instances`;
- integrační klienti: `/admin/integrace`.

### Integrace

- veřejná dokumentace: `/integration-api`;
- API namespace: `/api/v1/integration`;
- integrační bearer tokeny mají vlastní formát a scope;
- list endpointy zachovávají kontrakt `data` + `pagination`;
- časově omezené endpointy musí respektovat maximální povolené období;
- plaintext integrační token nikdy neukládej ani neloguj, v databázi zůstává pouze hash a bezpečné identifikátory.

## Architektura backendu

Hlavní aplikace je v `backend/app/main.py`. Routery jsou členěné v `backend/app/api/v1/` podle domén, zejména:

- attendance a shift plan;
- portal auth;
- admin auth, users, employments/instances, attendance, shift plan, export, settings, SMTP a integrations;
- externí integration API.

Při změně backendu:

- zachovej jednotný JSON error kontrakt;
- nevracej interní výjimky klientovi;
- zachovej request ID a audit integračních požadavků;
- respektuj rate limiting;
- neoslabuj cookie, session, CSRF, CORS ani tokenové kontroly;
- datumy a čas interpretuj podle existujících pražských časových pravidel;
- databázové změny doplň migrací a testy.

## Architektura frontendu

Frontend používá React Router. Centrální mapa tras je v `frontend/src/App.tsx`.

Při změně frontendu:

- zachovej české uživatelské texty a jednotné názvosloví DAGMAR;
- zachovej přístupnost formulářů, focus stavů, popisků, chyb a klávesnicového ovládání;
- neměň API kontrakt jen kvůli pohodlí UI;
- zkontroluj mobilní rozvržení a overflow;
- respektuj oddělení zaměstnanecké a admin části;
- po změně spusť branding kontrolu, lint, typecheck, testy a build.

## Lokální ověření

### Backend

```bash
cd backend
python -m pip install -e '.[dev]'
pytest
ruff check app
mypy app
```

Při změně migrací navíc:

```bash
cd backend
alembic upgrade head
```

### Frontend

```bash
cd frontend
npm ci
npm run check:branding
npm run lint
npm run typecheck
npm test
npm run build
```

Produkční E2E test spouštěj pouze proti autorizovanému prostředí a pouze tehdy, když je změna bezpečná pro produkční data:

```bash
cd frontend
npm run test:e2e:prod
```

Nikdy netvrď, že testy proběhly, pokud nebyly skutečně spuštěny. Do výstupu uveď přesné příkazy, výsledky a případná omezení.

## GitHub a práce s větvemi

GitHub je pro Codex dostupný přes autorizované prostředí. Přístup k repozitáři a operacím GitHubu používej pouze prostřednictvím již autorizovaného prostředí; nevyžaduj ani nevypisuj osobní access token.

- Nepracuj přímo na chráněné produkční větvi, pokud zadání výslovně nepožaduje přímý commit.
- Preferuj samostatnou větev a pull request.
- Před zápisem ověř aktuální default branch a stav cílového souboru.
- Nerozbíjej historii `git subtree` ani původ backendu a frontendu.
- Commit musí být malý, popisný a bez generovaných či citlivých souborů.
- Před dokončením zkontroluj diff, CI a změněné produkční kontrakty.

## Produkční server a SSH

Produkční server DAGMAR má IP adresu `89.221.222.92` a obsluhuje doménu `dagmar.hcasc.cz`. GitHub i produkční server jsou pro Codex dostupné přes autorizované prostředí SSH. Použij existující autorizovanou SSH identitu; nevyžaduj, nevypisuj ani nekopíruj soukromý SSH klíč.

Před prvním zásahem ověř identitu cíle:

```bash
ssh 89.221.222.92 'hostname; id; pwd'
```

Na serveru postupuj nejprve read-only:

```bash
hostname
pwd
git status --short --branch
systemctl status dagmar-backend --no-pager
curl -fsS http://127.0.0.1:8101/api/v1/health
```

Pro diagnostiku používej zejména:

```bash
journalctl -u dagmar-backend -n 200 --no-pager
ss -lntp | grep 8101
ss -lntp | grep 5433
docker ps
```

Bez výslovného souhlasu:

- nerestartuj služby;
- nespouštěj migrace;
- neměň `/etc/dagmar/backend.env`;
- nemaž ani neupravuj produkční data;
- nenasazuj build;
- neměň Nginx, systemd, firewall ani databázovou konfiguraci.

Před každým produkčním zásahem popiš rollback. Po nasazení ověř health endpoint, verzi backendu, frontendovou verzi a relevantní uživatelský tok.

## Přihlašovací údaje a `.env`

Přístupové údaje pro testování přihlášení do portálu `https://dagmar.hcasc.cz` jsou Codexu dostupné v souboru `.env` v autorizovaném pracovním prostředí.

Soubor `.env` je lokální tajný konfigurační soubor. Nesmí být přidán do Gitu, commitnut, vložen do issue nebo pull requestu ani zahrnut do logu, screenshotu, trace, videa či výsledného artefaktu. Před prací ověř, že je ignorován přes `.gitignore`.

Codex smí načíst přihlašovací údaje z `.env` pro automatizovaný webový test, ale nesmí jejich hodnoty vypsat. Ověřuj pouze existenci potřebných proměnných.

Očekávané názvy proměnných:

```text
DAGMAR_E2E_BASE_URL=https://dagmar.hcasc.cz
DAGMAR_E2E_USER_EMAIL
DAGMAR_E2E_USER_PASSWORD
DAGMAR_E2E_ADMIN_EMAIL
DAGMAR_E2E_ADMIN_PASSWORD
```

Příklad bezpečného načtení pro lokální proces:

```bash
set -a
. ./.env
set +a
```

Před načtením ověř oprávnění souboru. Doporučené oprávnění je `0600`:

```bash
chmod 600 .env
```

Heslo neposílej v CLI argumentu, který může být viditelný v historii procesů. Pokud proměnné chybí, test přihlášení přeskoč s jasným hlášením. Nevytvářej náhradní účet a neměň produkční heslo.

## Bezpečné webové testování

Při testování produkčního webu:

- používej pouze účty a tajemství načtené z autorizovaného `.env`;
- nejprve proveď read-only smoke test;
- nevytvářej, neupravuj ani nemaž produkční záznamy bez výslovného zadání;
- neodesílej e-maily, nerotuj integrační tokeny a nespouštěj bulk export bez potřeby;
- po testu se odhlas a ukonči browser context;
- v reportu anonymizuj osobní údaje a neukládej odpovědi API obsahující zaměstnanecká data.

Minimální bezpečný smoke test:

1. načíst `/app` a `/admin/login`;
2. ověřit stavové kódy statických zdrojů;
3. ověřit `/api/v1/health` a `/api/version`;
4. přihlásit se pouze pomocí hodnot z autorizovaného `.env`;
5. po přihlášení ověřit pouze očekávanou landing page a následně se odhlásit.

## Definice hotové změny

Změna je hotová pouze když:

- je doložena konkrétními soubory a chováním;
- neporušuje produkční invarianty;
- má odpovídající testy nebo zdůvodněnou mezeru;
- projde relevantním lintem, typecheckem, testy a buildem;
- databázová změna obsahuje bezpečnou migraci;
- neobsahuje tajemství ani osobní data;
- dokumentace odpovídá výslednému chování;
- je popsán dopad, ověření a případný rollback.
