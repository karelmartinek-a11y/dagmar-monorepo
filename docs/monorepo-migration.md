# Restrukturalizace produkčního monorepa

## Generační hranice

Historická struktura `backend/` + `frontend/` byla uzavřena nad commitem `f2edd6979e6646ba8f630be2da93f85d9430a6c3`. Přesný strom původního frontendu, počet souborů a zákaz převzetí zdrojového kódu jsou v `docs/ui-redesign/forensic-inventory/boundary.json`.

Nová implementace vznikla v prázdném adresáři `web/`. Reprodukovatelná kontrola `scripts/check_clean_frontend_generation.py` porovnává nové soubory přímo se starým stromem v git historii pomocí SHA-256 a normalizovaných tokenových oken.

## Cílová struktura

- `app/` — produkční FastAPI balíček;
- `alembic/` a `alembic.ini` — migrace spouštěné z kořene;
- `tests/` a `scripts/` — backendové ověření a provozní nástroje;
- `web/` — jediný frontend, React/TypeScript/Vite;
- `ops/` — verzované referenční konfigurace systemd a Nginx;
- `docs/` — integrační, provozní a forenzní dokumentace.

Adresáře `backend/` a `frontend/` v cílovém commitu neexistují. Historie jejich obsahu zůstává dohledatelná v gitu.

## CI a deploy

Workflow `.github/workflows/ci-cd.yml` ověřuje backend a web paralelně. Deploy může začít pouze po úspěchu obou větví a používá jeden git SHA pro backend i `frontend-version.json`.

Produkce používá neměnné release adresáře `/opt/dagmar/releases/<sha>-<run-attempt>` a `/var/www/dagmar/releases/<sha>-<run-attempt>`. Stabilní cesty `/opt/dagmar/backend` a `/var/www/dagmar/frontend` jsou atomicky přepínané symlinky. První deploy přesune historické adresáře do release označeného `legacy-<timestamp>`. Před přepnutím se ověří migrace i `nginx -t`; při neúspěšném health checku workflow atomicky vrátí oba předchozí cíle a restartuje původní backend.

Webová větev CI používá izolovaný PostgreSQL, aplikuje Alembic, bezpečně seeduje pouze databázi s názvem obsahujícím `e2e` a spouští skutečný FastAPI server. Playwright tak vedle veřejných a vizuálních kontrol ověřuje zaměstnanecký bearer tok, admin session/CSRF, zápis docházky, offline frontu, export a tiskový náhled bez zásahu do produkčních dat.

Backend zůstává na `127.0.0.1:8101`, PostgreSQL na `127.0.0.1:5433` a Nginx obsluhuje pouze `dagmar.hcasc.cz`.
