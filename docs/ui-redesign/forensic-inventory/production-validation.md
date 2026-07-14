# Produkční validace generační náhrady

Datum validace: 2026-07-14
Host: `https://dagmar.hcasc.cz`
Validovaný aplikační merge: `43d0280263ca696e765411e4e23b1bae090de48e`

Validace byla provedena po atomickém nasazení čisté generační náhrady. Použité
účty pocházely z ignorovaného lokálního `.env`; přihlašovací údaje, tokeny,
cookies ani osobní data nebyly uloženy do repozitáře nebo auditních artefaktů.
Produkční doménová data nebyla změněna.

## CI a nasazení

- GitHub Actions run `29327658737` uspěl pro joby `backend`, `web` a `deploy`.
- Backend prošel kompilací, Ruff, mypy, Alembic řetězcem, testy a kontrolou
  čisté generace proti hranici `f2edd6979e6646ba8f630be2da93f85d9430a6c3`.
- Web prošel brandingem, ESLintem, TypeScriptem, Vitestem, buildem a Playwright
  testy proti skutečnému backendu a PostgreSQL, včetně accessibility a visual
  regression scénářů.
- Deploy nainstaloval verzovaný backend i web, spustil `alembic upgrade head`,
  ověřil `nginx -t`, atomicky přepnul oba symlinky, restartoval backend a
  ověřil health i shodný commit backendu a frontendu.

## Veřejné kontroly

- `GET /api/v1/health` vrátil `{"ok":true}`.
- `GET /api/version` po aplikačním merge vrátil commit `43d0280` a prostředí
  `production`.
- Všechny veřejné, zaměstnanecké a admin SPA routy vrátily HTTP 200.
- Root dokument má `no-store`; otiskované assety mají `immutable` cache.
- Root, assety i API vracejí HSTS, `nosniff`, `strict-origin-when-cross-origin`,
  `DENY` frame policy a zakázaná nepotřebná browser permissions.
- Nginx konfigurace prošla syntaktickou kontrolou. Existující upozornění pro
  jiné virtuální hosty nejsou způsobena ani měněna tímto projektem.

## Browser scénáře

In-app Browser a nativní Google Chrome ověřily následující read-only scénáře:

- zaměstnanecké přihlášení bearer tokenem, aktivní `employment_id`, měsíční
  docházku, online stav a odhlášení;
- admin přihlášení session cookie a CSRF bootstrapem, landing
  `/admin/prehled`, všech deset chráněných admin pohledů a odhlášení;
- veřejné pohledy `/`, `/reset`, `/integration-api` a `/admin/login`;
- mobilní viewport 390 x 844 bez horizontálního overflow;
- prázdnou browser konzoli bez errorů a warningů během admin průchodu;
- živý tiskový náhled, otevření nativního Chrome dialogu a jeho zrušení bez
  tisku nebo uložení souboru.

## Výsledek

- Produkce používá cílovou strukturu s backendem v kořeni a novým webem z
  `web/`; pracovní adresáře `backend/` a `frontend/` v repozitáři neexistují.
- Oprava databázové enum hodnoty `EMPLOYEE` je kompatibilní s existující
  produkční databází a přihlášení zaměstnance je funkční.
- Kontrola čisté generace prošla proti uloženému tree hashi
  `a3903fc2a1f7fa31683ff6cbfdd77ec1e061cf10` a nenašla historické odkazy.
- Audit nenašel otevřenou funkční, bezpečnostní ani deploy blokaci.

Rollback zůstává párový: vrátit oba předchozí release symlinky a restartovat
`dagmar-backend`. Deploy workflow tuto cestu provede automaticky při selhání
post-switch health kontroly.
