# DAGMAR backend AGENTS

## Kontext

- Tento adresář patří do monorepa `karelmartinek-a11y/dagmar-monorepo`.
- Backend je FastAPI aplikace v `backend/app`.
- Produkční backend běží za Nginx na kanonické doméně `https://dagmar.hcasc.cz`.
- Aplikační proces se váže na `127.0.0.1:8101`.
- PostgreSQL je očekávána přes `DAGMAR_DATABASE_URL`, v produkci publikovaná jen na `127.0.0.1:5433`.
- Frontend stejné aplikace je v sousedním adresáři `frontend/` uvnitř stejného monorepa, ne v separátním checkoutu.

## Zdroj pravdy

- Za zdroj pravdy považuj aktuální kód v `backend/app`, migrace v `backend/app/db/migrations`, workflow v `.github/workflows` a aktivní skripty v `backend/scripts`.
- Neopírej se o README, staré reporty, komentáře ani testy, pokud odporují aktuální implementaci.

## Runtime a kontrakty

- API běží pod `/api/v1/`.
- Veřejné pomocné endpointy mimo routery jsou v `app/main.py`: `GET /api/v1/health`, `GET /api/health`, `GET /api/version`, `GET /api/v1/time`.
- Admin část používá session cookie a CSRF:
  - session validuje `app/security/sessions.py`,
  - CSRF validuje `app/security/csrf.py`,
  - stav měnící admin endpointy mají mít `Depends(require_csrf)`.
- Zaměstnanecká část používá bearer token instance přes `Authorization: Bearer ...`.
- Integrační API používá vlastní bearer tokeny a auditní logiku v `app/api/integration_common.py` a `app/security/integration_tokens.py`.

## Datové invariants

- Docházka, plán směn, zámky a exporty jsou vedené primárně přes `employment_id`.
- `instance_id` je pomocná vazba na zařízení nebo původ zápisu, ne hlavní doménový identifikátor docházky.
- Při zásazích do attendance, shift planu, locků a připomínek drž vazby konzistentní s `Employment`, nevracej se k historickému modelu postavenému jen na `instance_id`.
- Měsíční zámek docházky nesmí být jen UI konvence, ale serverově vynucené omezení.

## Bezpečnostní pravidla

- Nesmí se vracet ani tolerovat zakázaná historická doména; kanonická doména je pouze `dagmar.hcasc.cz`.
- Nepřidávej nové admin mutace bez CSRF guardu.
- Nepřidávej nové zaměstnanecké endpointy bez bearer autentizace přes `require_portal_user_auth` nebo `require_instance_auth`.
- Změny schématu dělej pouze migracemi Alembicu.

## Praktický postup

- Před změnami vždy projdi `app/main.py`, dotčené routery, modely a služby, ne jen jeden soubor.
- Když měníš kontrakt endpointu, ověř i frontend v `frontend/src/api` a odpovídající stránky v `frontend/src/pages`.
- Po backend změnách standardně ověř `pytest`, `ruff check app` a `mypy app`, pokud prostředí dovolí.
