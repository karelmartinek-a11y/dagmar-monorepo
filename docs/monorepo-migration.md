# Migrace Dagmar do monorepa

Tento dokument popisuje pouze strukturální změny nezbytné pro přesun do monorepa. Funkční chování aplikace se tímto dokumentem nemění.

## Výsledná struktura

- `backend/` obsahuje původní repozitář `dagmar-backend`
- `frontend/` obsahuje původní repozitář `dagmar-frontend`

## Zachování historie

Historie obou původních repozitářů byla zachována pomocí `git subtree` bez squashování.

## Nezbytné úpravy cest

### 1. Backend workflow

Původní backend workflow pracovalo s checkoutem repozitáře `dagmar-backend` v jeho kořeni. V monorepu:

- build běží z `backend/`
- deploy čte repozitář `dagmar-monorepo`
- rsync do `/opt/dagmar/backend/` kopíruje pouze `backend/`

Výsledné produkční umístění backendu se nemění.

### 2. Frontend workflow

Původní frontend workflow pracovalo s checkoutem repozitáře `dagmar-frontend` v jeho kořeni. V monorepu:

- build běží z `frontend/`
- deploy čte repozitář `dagmar-monorepo`
- do webrootu se rsyncuje pouze `frontend/dist/`

Výsledné produkční umístění frontendu se nemění.

### 3. Backend verze nasazení

Backend doplnil čtení `backend-version.json` i z monorepo checkoutu na serveru, aby `/api/version` dál vracelo produkční commit bez změny API kontraktu.

### 4. Backend test zakázané domény

Test `backend/tests/test_forbidden_domain.py` nově umí najít frontend jak v původním sourozeneckém checkoutu `../dagmar-frontend`, tak v monorepu `../frontend`. Jde pouze o úpravu testovací cesty.
