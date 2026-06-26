# DAGMAR frontend AGENTS

## Kontext

- Tento adresář patří do monorepa `karelmartinek-a11y/dagmar-monorepo`.
- Frontend je Vite + React + TypeScript aplikace v `frontend/src`.
- Produkce běží na `https://dagmar.hcasc.cz`.
- Backend stejné aplikace je v `../backend`, ne v samostatném repozitáři.

## Zdroj pravdy

- Za zdroj pravdy považuj aktuální kód v `src/`, API klienty v `src/api/`, routy v `src/App.tsx`, build konfiguraci v `package.json` a `vite.config.ts` a workflow v `.github/workflows`.
- README, auditní artefakty, screenshoty a testy nejsou závazný popis runtime, pokud se rozcházejí s implementací.

## Routy a auth

- Hlavní routy jsou:
  - `/app` zaměstnanecký portál,
  - `/reset` reset hesla zaměstnance,
  - `/admin/login` login administrace,
  - `/admin/*` administrace,
  - `/integration-api` veřejná stránka integrační dokumentace.
- Admin používá session cookie a CSRF token:
  - session stav se ověřuje přes `/api/v1/admin/me`,
  - CSRF token se obnovuje přes `/api/v1/admin/csrf`,
  - stav měnící admin volání mají jít přes `ensureCsrfToken` nebo `withCsrf`.
- Zaměstnanecký portál používá bearer token vrácený z `/api/v1/portal/login`.

## API a kontrakty

- Všechna aktivní webová API volání musí mířit na existující backend pod `/api/v1/`.
- Docházka, plán směn, exporty a zaměstnanecké volby musí pracovat s `employment_id`.
- Při změně formuláře nebo tlačítka vždy zkontroluj odpovídající funkci v `src/api/` i backend router.
- Nezaváděj UI akce bez skutečně existujícího backend endpointu nebo runtime assetu.

## Produkční pravidla

- Kanonická doména je pouze `dagmar.hcasc.cz`.
- Nepřidávej odkazy, fallbacky ani branding na zakázanou historickou doménu; používej jen `dagmar.hcasc.cz`.
- `vite.config.ts` v dev režimu proxyruje `/api` na `http://127.0.0.1:8101`; produkce je same-origin přes Nginx.

## Scope a historické větve

- Android nativní strom byl z monorepa odstraněn jako historická, webem nepoužívaná větev.
- Pokud narazíš na další Android-only nebo demo/fake UI stopy, nejprve ověř, zda mají reálný backendový nebo deploy spotřebitelský řetězec.

## Praktický postup

- Před změnami vždy projdi:
  - `src/App.tsx`,
  - dotčenou stránku v `src/pages`,
  - odpovídající API klient v `src/api`,
  - případně související utilitu nebo stav v `src/utils` a `src/state`.
- Po frontend změnách standardně ověř `npm run build`, `npm run typecheck`, `npm run lint` a `npm test`, pokud konfigurace existuje.
