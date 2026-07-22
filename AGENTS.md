# AGENTS.md

## Scope

Agent works only in `karelmartinek-a11y/dagmar-monorepo`.
This repository is the production source of truth for KájovoDagmar.

## Source Of Truth

Authority order:

1. current source code in this repository
2. active backend contract and database invariants
3. current production behavior on `https://dagmar.hcasc.cz`
4. tests, migrations, workflows and deploy configuration
5. repository documentation

When documentation, comments or tests differ from code, verify the active code path and update the non-code artifact to match the code. Do not change working production code only to satisfy a document.

## Active Repository Layout

- `app/` FastAPI application
- `alembic/` Alembic migration chain
- `tests/` backend and repository regression tests
- `scripts/` maintenance and validation scripts
- `web/` Vite, React and TypeScript frontend
- `docs/` current technical and operational documentation
- `.github/workflows/` CI and production deploy
- `ops/` runtime Nginx and systemd configuration

## Runtime Invariants

- canonical domain: `https://dagmar.hcasc.cz`
- API base path: `/api/v1/`
- backend bind: `127.0.0.1:8101`
- PostgreSQL publish address: `127.0.0.1:5433`
- admin authentication: session cookie plus CSRF
- employee authentication: bearer token
- integration authentication: dedicated `dgi_` bearer tokens
- attendance, shift plan, locks and exports are scoped by `employment_id`
- timezone authority: `Europe/Prague`
- reverse proxy and TLS terminate in Nginx

## Required Change Discipline

- Find every implementation of the affected function before editing.
- Find every consumer before editing shared components, shared helpers or shared schemas.
- Verify backend, frontend, authentication mode, permissions and error states before changing an API contract.
- Keep working features working. Do not replace production logic with mocks, placeholders, demo data or simplified substitutes.
- Use only the current monorepo as the working target.
- Use only the canonical domain `dagmar.hcasc.cz` in code, docs, config and tests.
- Wide file rewrites require a concrete reason and post-change regression verification.
- Build or generation steps must not leave unexpected source changes behind.
- Review the full diff before commit and confirm that unrelated features did not disappear.

## Backend Rules

- Keep the shared JSON error contract stable.
- Do not leak internal exceptions to clients.
- Preserve request IDs, integration audit logging, rate limiting and security checks.
- Validate `employment_id` at every relevant boundary.
- Change schema only through Alembic migrations.
- Update frontend, tests and docs in the same logical change when API behavior changes.

## Frontend Rules

- Keep Czech copy and KájovoDagmar naming accurate.
- Respect current backend contracts instead of shaping API behavior around UI convenience.
- Implement and preserve loading, empty, error, success, locked, conflict, offline and destructive-confirm states where relevant.
- Preserve focus handling, keyboard access and readable error messages.
- Verify desktop and mobile layouts for overflow, sticky areas and large attendance matrices.

## Validation

Run the relevant checks for the touched area and report the exact commands you actually ran.

Backend:

```bash
python -m pip install -e '.[dev]'
pytest
ruff check app tests scripts
mypy app
alembic heads
```

Frontend:

```bash
cd web
npm ci
npm run check:branding
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Repository invariants:

```bash
python scripts/check_repo_invariants.py
python scripts/generate_current_state_manifest.py --check
```

## Production Safety

- Read secrets only from the local ignored `.env` or authorized server environment files.
- Never print secret values.
- Do not change production data, firewall or secret configuration without explicit need.
- Before deploy or production validation, confirm the target commit and verify health, logs and affected user scenarios.
