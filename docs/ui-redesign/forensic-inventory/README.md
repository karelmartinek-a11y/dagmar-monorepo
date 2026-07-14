# Forenzní inventura UI redesignu

Tento adresář zachycuje výchozí stav systému před čistou generační náhradou UI.

## Aktuální stav checkoutu při zahájení inventury

- repozitář: `karelmartinek-a11y/dagmar-monorepo`
- větev: `main`
- remote: `git@github.com:karelmartinek-a11y/dagmar-monorepo.git`
- pracovní strom při načtení nebyl čistý: změněn byl root `AGENTS.md`
- struktura checkoutu byla při inventuře historická:
  - backend v `backend/`
  - frontend v `frontend/`
  - workflow v `.github/workflows/`

## Obsah katalogu

- [backend-endpoints.md](/Users/karelmartinek/Developer/dagmar-monorepo/docs/ui-redesign/forensic-inventory/backend-endpoints.md)
- [frontend-routes.md](/Users/karelmartinek/Developer/dagmar-monorepo/docs/ui-redesign/forensic-inventory/frontend-routes.md)
- [frontend-backend-matrix.md](/Users/karelmartinek/Developer/dagmar-monorepo/docs/ui-redesign/forensic-inventory/frontend-backend-matrix.md)
- [production-validation.md](/Users/karelmartinek/Developer/dagmar-monorepo/docs/ui-redesign/forensic-inventory/production-validation.md)
- [roles-states-validations.md](/Users/karelmartinek/Developer/dagmar-monorepo/docs/ui-redesign/forensic-inventory/roles-states-validations.md)
- [coverage-matrix.md](/Users/karelmartinek/Developer/dagmar-monorepo/docs/ui-redesign/forensic-inventory/coverage-matrix.md)
- [boundary.json](/Users/karelmartinek/Developer/dagmar-monorepo/docs/ui-redesign/forensic-inventory/boundary.json)

## Důležité závěry z úvodní kontroly

- Nové `AGENTS.md` už explicitně povoluje jednorázovou restrukturalizaci do cílového stavu `app/` v kořeni a nového frontendu v `web/`.
- CI a deploy jsou sjednocené v `.github/workflows/ci-cd.yml` a oba artefakty vážou na jeden commit.
- Backend i frontend už dnes obsahují prvky forenzně řízeného redesignu, ale zdrojový strom stále odpovídá historickému uspořádání.
- Produkční kontrakty, které nelze bez důkazu měnit: `dagmar.hcasc.cz`, `/api/v1/`, `127.0.0.1:8101`, PostgreSQL na `127.0.0.1:5433`, admin session + CSRF, zaměstnanecký bearer token.

## Uzavření inventury

- Forenzní hranice je formálně vyhlášena v `boundary.json`; starý pracovní frontend byl odstraněn.
- Nový frontend vznikl pouze v `web/` a CI kontroluje shodu proti historickému stromu.
- Stav produkčního nasazení a audit se průběžně zapisují do `production-validation.md`.
