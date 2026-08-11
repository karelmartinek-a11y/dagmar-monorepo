# SSOT — atomická implementační a důkazní matice

Tato matice je současný ověřovací kontrakt. Stav `splněno` smí být nastaven pouze po
úspěchu uvedeného regresního testu nebo gate a kontrole souvisejících dokumentů.
Výchozím vlastníkem remediation je `karelmartinek-a11y`; výjimky jsou evidovány výhradně
v `.security/audit-exceptions.yml`.

Normativním zdrojem je `docs/SSOT_CURRENT.md`. Dynamický lidský kontrakt `PRŮCHOD 1..N`
a explicitní tiskový stav `print_capacity_exceeded` zůstávají povinné; otevřený řádek
nebo chybějící důkaz je blocker, nikoli částečné splnění.

| ID | Požadovaný stav | Stav | Owner | Implementační celek | Ověřovací test / gate | Exception ID |
|---|---|---|---|---|---|---|
| DAG-P0-001 | Audit-clean hashovaný Python lock | splněno | karelmartinek-a11y | A — supply chain | CI run `31522955074`: `pip-audit` 0 advisories | — |
| DAG-P0-002 | Runtime enforcement integračního data scope | otevřeno | karelmartinek-a11y | C — integration API | negativní scope testy | — |
| DAG-P0-003 | Reset revokuje všechny credentials | splněno | karelmartinek-a11y | B — auth lifecycle | CI `31530934021`: reset/race/atomicity testy | — |
| DAG-P0-004 | Povinné security a secret CI gate | splněno | karelmartinek-a11y | A — supply chain | CI run `31522955074`: security/CodeQL/gitleaks | — |
| DAG-P1-001 | Frontend lock bez moderate/high advisory | splněno | karelmartinek-a11y | A — supply chain | CI run `31522955074`: npm audit 0 advisories | — |
| DAG-P1-002 | Přesná kanonická production doména | otevřeno | karelmartinek-a11y | D — production | parametrické config testy | — |
| DAG-P1-003 | Odstraněný neúčinný CSRF secret | splněno | karelmartinek-a11y | B — auth lifecycle | CI `31530934021`: invariant + CSRF testy | — |
| DAG-P1-004 | Odstraněná falešná token-length volba | splněno | karelmartinek-a11y | B — auth lifecycle | CI `31530934021`: token-format invariant | — |
| DAG-P1-005 | Reset token má delivery/revocation lifecycle | splněno | karelmartinek-a11y | B — auth lifecycle | CI `31530934021`: SMTP failure testy | — |
| DAG-P1-006 | Nejvýše jeden aktivní reset token | splněno | karelmartinek-a11y | B — auth lifecycle | CI `31530934021`: souběžný issuance test | — |
| DAG-P1-007 | Auditovaná admin aktivace instance | otevřeno | karelmartinek-a11y | E — backend | register→activate→claim test | — |
| DAG-P1-008 | Delete uživatele uklidí jeho WEB instanci | splněno | karelmartinek-a11y | B — auth lifecycle | CI `31530934021`: lifecycle + migrace 0025 | — |
| DAG-P1-009 | Reminder správně páruje eventy přes půlnoc | otevřeno | karelmartinek-a11y | E — backend | reminder chronology testy | — |
| DAG-P1-010 | Oddělené integrační rate-limit buckety | otevřeno | karelmartinek-a11y | C — integration API | 429 parametrické testy | — |
| DAG-P1-011 | Časově omezený admin account lockout | splněno | karelmartinek-a11y | B — auth lifecycle | CI `31530934021`: admin lockout testy | — |
| DAG-P1-012 | Veřejný build bez sourcemap | otevřeno | karelmartinek-a11y | D — production | artifact sourcemap gate | — |
| DAG-P1-013 | Enforced production CSP | otevřeno | karelmartinek-a11y | D — production | Nginx header/browser test | — |
| DAG-P1-014 | Deploy bez credentialu v Git remote | otevřeno | karelmartinek-a11y | D — production | deploy preflight | — |
| DAG-P1-015 | Bezpečná retence release | otevřeno | karelmartinek-a11y | D — production | cleanup script unit testy | — |
| DAG-P1-016 | DB a revision readiness | otevřeno | karelmartinek-a11y | D — production | readiness dependency testy | — |
| DAG-P2-001 | Manifest odvozuje skutečný auth režim | otevřeno | karelmartinek-a11y | E — backend | manifest route testy | — |
| DAG-P2-002 | Stabilní opaque cursor pagination | otevřeno | karelmartinek-a11y | C — integration API | cursor continuity testy | — |
| DAG-P2-003 | Pouze routami vynucené scopes jsou dostupné | otevřeno | karelmartinek-a11y | C — integration API | scope-route invariant | — |
| DAG-P2-004 | Jediná neintegrační error envelope | otevřeno | karelmartinek-a11y | E — backend | error contract testy | — |
| DAG-P2-005 | External auth URL bez SSRF odchylek | otevřeno | karelmartinek-a11y | D — production | URL/redirect negativní testy | — |
| DAG-P2-006 | Neplatné environment hodnoty fail-fast | otevřeno | karelmartinek-a11y | D — production | config testy | — |
| DAG-P2-007 | Neplatné SameSite hodnoty fail-fast | otevřeno | karelmartinek-a11y | D — production | config testy | — |
| DAG-P2-008 | Žádný produkční validační `assert` | otevřeno | karelmartinek-a11y | E — backend | repo invariant | — |
| DAG-P2-009 | User listing nepolyká data chyby | otevřeno | karelmartinek-a11y | E — backend | integrity-error test | — |
| DAG-P2-010 | Deploy-tag fallback je auditovatelný | otevřeno | karelmartinek-a11y | E — backend | logging test | — |
| DAG-P2-011 | Calendar fetch pouze bezpečné HTTPS cíle | splněno | karelmartinek-a11y | A — supply chain prerequisite | CI run `31522955074`: 8 URL/redirect/size testů + Bandit | — |
| DAG-P2-012 | Reprodukovatelný Python build | splněno | karelmartinek-a11y | A — supply chain | CI run `31522955074`: `check_python_lock.py` | — |
| DAG-P2-013 | Actions připnuté na full SHA | splněno | karelmartinek-a11y | A — supply chain | CI run `31522955074`: `check_security_policy.py` | — |
| DAG-P2-014 | Shodný připnutý pip/build toolchain | splněno | karelmartinek-a11y | A — supply chain | CI run `31522955074`: pinned toolchain artifact build | — |
| DAG-P2-015 | Hermetický backend artifact | splněno | karelmartinek-a11y | A — supply chain | CI run `31522955074`: offline wheelhouse + provenance | — |
| DAG-P2-016 | Veřejný HTTPS post-deploy smoke | otevřeno | karelmartinek-a11y | D — production | production smoke | — |
| DAG-P2-017 | Roční production HSTS | otevřeno | karelmartinek-a11y | D — production | exact header test | — |
| DAG-P2-018 | Title pro skupiny úvazků | otevřeno | karelmartinek-a11y | F — frontend | route-title test | — |
| DAG-P2-019 | `/app` title reaguje na navigaci/jazyk | otevřeno | karelmartinek-a11y | F — frontend | navigation title test | — |
| DAG-P2-020 | Kompletní lokalizace lidského UI | otevřeno | karelmartinek-a11y | F — frontend | literal gate + language E2E | — |
| DAG-P2-021 | Přístupný potvrzovací dialog | otevřeno | karelmartinek-a11y | F — frontend | focus/keyboard/a11y testy | — |
| DAG-P2-022 | Plně klávesová kontextová menu | otevřeno | karelmartinek-a11y | F — frontend | menu Playwright testy | — |
| DAG-P2-023 | Neomezené dynamické průchody v UI | otevřeno | karelmartinek-a11y | F — frontend | 0/1/4/5/8 event testy | — |
| DAG-P2-024 | Zod validace všech JSON kontraktů | otevřeno | karelmartinek-a11y | F — frontend | negativní contract testy | — |
| DAG-P2-025 | Browser auth pouze HttpOnly cookie | splněno | karelmartinek-a11y | B — auth lifecycle | CI `31530934021`: cookie/CSRF/storage + design `SCHVÁLENO` | — |
| DAG-P2-026 | Jediná admin session implementace | splněno | karelmartinek-a11y | B — auth lifecycle | CI `31530934021`: auth-source invariant | — |
| DAG-P2-027 | Config je jediný admin password source | splněno | karelmartinek-a11y | B — auth lifecycle | CI `31530934021`: admin login source test | — |
| DAG-P2-028 | Povinný backend suite má 0 skipped | otevřeno | karelmartinek-a11y | E — backend | pytest strict/zero-skip | — |
| DAG-P3-001 | Explicitní Alembic path separator | splněno | karelmartinek-a11y | B — auth prerequisite | CI `31530934021`: Alembic bez warningu | — |
| DAG-P3-002 | Testy bez deprecation warnings | splněno | karelmartinek-a11y | B — auth lifecycle | CI `31530934021`: pytest `-W error` | — |
| DAG-P3-003 | Žádné auditované nepoužité `cls` | otevřeno | karelmartinek-a11y | G — governance | Vulture gate | — |
| DAG-P3-004 | Textové configy končí LF | otevřeno | karelmartinek-a11y | G — governance | newline invariant | — |
| DAG-P3-005 | Čitelné formátované TS/TSX | otevřeno | karelmartinek-a11y | G — governance | Prettier gate | — |
| DAG-P3-006 | Čitelné source CSS | otevřeno | karelmartinek-a11y | G — governance | Stylelint + Prettier | — |
| DAG-P3-007 | ESLint zakazuje explicitní `any` | otevřeno | karelmartinek-a11y | G — governance | ESLint gate | — |
| DAG-P3-008 | Frontend CI toleruje 0 warningů | otevřeno | karelmartinek-a11y | G — governance | lint `--max-warnings=0` | — |
| DAG-P3-009 | Backend/frontend format gate | otevřeno | karelmartinek-a11y | G — governance | format checky | — |
| DAG-P3-010 | Branding nemá druhý `app_name` zdroj | otevřeno | karelmartinek-a11y | G — governance | branding invariant | — |
| DAG-P3-011 | Provisioning komentáře odpovídají runtime | otevřeno | karelmartinek-a11y | G — governance | repo search | — |
| DAG-P3-012 | Standardní dotenv parser | otevřeno | karelmartinek-a11y | G — governance | dotenv syntax testy | — |
| DAG-P3-013 | Security headers nejsou duplicitní | otevřeno | karelmartinek-a11y | D — production | Nginx/curl test | — |
| DAG-P3-014 | Explicitní HSTS subdomain rozhodnutí | otevřeno | karelmartinek-a11y | D — production | docs invariant | — |
| DAG-P3-015 | Minimální Permissions-Policy | otevřeno | karelmartinek-a11y | D — production | header/browser smoke | — |
| DAG-P3-016 | COOP a CORP chrání production | otevřeno | karelmartinek-a11y | D — production | OAuth/same-origin smoke | — |
| DAG-P3-017 | Admin logout má UI error stav | otevřeno | karelmartinek-a11y | F — frontend | logout failure test | — |
| DAG-P3-018 | CSRF replay pouze pro `csrf_invalid` | otevřeno | karelmartinek-a11y | F — frontend | request-count test | — |
| DAG-P3-019 | Bezpečný RFC 5987 filename parser | otevřeno | karelmartinek-a11y | F — frontend | filename parser testy | — |
| DAG-P3-020 | Zod chyby jsou bezpečný `ApiError` | otevřeno | karelmartinek-a11y | F — frontend | invalid-contract test | — |
| DAG-P3-021 | Explicitní browser support a ES2020 | otevřeno | karelmartinek-a11y | F — frontend | build/compat smoke | — |
| DAG-P3-022 | Browser a viewport testovací matice | otevřeno | karelmartinek-a11y | F — frontend | Playwright projects | — |
| DAG-P3-023 | Strojově vynucený design gate | otevřeno | karelmartinek-a11y | F — frontend | `check_design_gate.py` | — |
| DAG-P3-024 | Vizuální pokrytí kritických ploch | otevřeno | karelmartinek-a11y | F — frontend | visual snapshots | — |
| DAG-P3-025 | Návrhové binárky jsou LFS pointery | otevřeno | karelmartinek-a11y | G — governance | LFS invariant | — |
| DAG-P3-026 | Normalizované názvy podkladů | otevřeno | karelmartinek-a11y | G — governance | repo search + index | — |
| DAG-P3-027 | Bez zbytečného Alembic `.gitkeep` | otevřeno | karelmartinek-a11y | G — governance | absence invariant | — |
| DAG-P3-028 | Explicitní nevratná migrace a restore runbook | otevřeno | karelmartinek-a11y | E — backend | downgrade-boundary test | — |
| DAG-P3-029 | Migrace `0002` nepolyká DB chyby | otevřeno | karelmartinek-a11y | E — backend | migration postcondition test | — |
| DAG-P3-030 | Broad exceptions jen na procesních hranicích | otevřeno | karelmartinek-a11y | E — backend | `check_broad_exceptions.py` | — |
| DAG-P3-031 | Řídicí artefakty nemaskují otevřené nálezy | otevřeno | karelmartinek-a11y | G — governance | matrix/invariant check | — |
