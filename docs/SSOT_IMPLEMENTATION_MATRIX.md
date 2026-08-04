# SSOT — implementační a důkazní matice

Tento dokument je aktuální předávací matice implementace uloženého `docs/SSOT_CURRENT.md`. Není historickým auditem ani alternativní specifikací; u každé oblasti uvádí současného vlastníka a skutečný stav ověření.

| SSOT oblast | Aktivní vlastník | Implementace / změna | Automatický důkaz | Stav |
|---|---|---|---|---|
| Kanonický dokument | `docs/SSOT_CURRENT.md` | Přesná příloha, 1 998 řádků, revize `FORENSIC-FINAL-2026-08-03` | SHA-256 `4624b5b06590b1009b5062e6c67e055cd18bd5cffa2ac0ccf01f8443dabfa0e9` | splněno |
| Autorita dokumentace | `AGENTS.md`, `README.md`, `scripts/generate_current_state_manifest.py` | SSOT je normativní cílový stav; manifest obsahuje revizi, počet řádků a hash | `generate_current_state_manifest.py --check`, repo invarianty | splněno |
| Časový parser | `web/src/utils/timeInput.ts` | Jeden parser pro všechny časové buňky; zachována normalizace bez povinné dvojtečky | `web/tests/clock-input.test.tsx` | splněno |
| Editor času | `web/src/components/ClockInput.tsx` | Awaitovatelný commit, saving/saved/error, Escape, Delete celé buňky před pohybem kurzoru, zachování draftu při chybě | `web/tests/clock-input.test.tsx` | splněno |
| Prezentace eventů | `web/src/utils/presentationAdapters.ts` | Jednotná geometrie sloupců, chronologické hrany, plánové hranice, neutrální hlavičky, tisková kapacita | `web/tests/presentation-adapters.test.ts` | splněno |
| Zaměstnanecká docházka | `web/src/pages/EmployeePage.tsx` | Aktivní detail je jedna tabulka, jeden den = jeden řádek, dynamické `PRŮCHOD` sloupce, metriky z backendu | frontend typecheck, lint, unit testy | splněno |
| Zaměstnanecký plán | `web/src/pages/EmployeePage.tsx` | Aktivní detail je stejný tabulkový model, carryover zůstává read-only | frontend typecheck, lint, unit testy | splněno |
| Adminská docházka | `web/src/pages/AdminMatrixPages.tsx` | Aktivní společná matice `employment_id × den`, dvě krajní buňky a `+N` pro mezilehlé eventy | frontend typecheck, lint, unit testy | splněno |
| Adminský plán a skupinový plán | `web/src/pages/AdminMatrixPages.tsx`, `web/src/pages/EmployeePage.tsx` | Tabulkové matice zůstávají aktivní; staré paralelní skupinové karty byly odstraněny | frontend typecheck, lint, unit testy | částečně — nutná cílená E2E validace |
| Lidský CSV/ZIP | `app/api/v1/admin_export.py` | Stabilní metadata, dynamické `PRŮCHOD 1..N`, `PLÁN – PRŮCHOD 1..M`, hodnoty `HH:mm` | `tests/test_attendance_refactor.py -k 'csv or export'` | splněno |
| Browser tisk attendance | `web/src/pages/AdminOperationsPages.tsx`, `web/src/styles.css` | Jeden úvazek na jednu A4, neutrální chronologické časy, dynamický počet sloupců, explicitní `print_capacity_exceeded` | `web/tests/admin-print.test.tsx`, lokální design capture | částečně — A4 oddělení opraveno, čeká vizuální re-review |
| Serverový shift-plan PDF | `app/services/shift_plan_reports.py` | Zachován jako samostatný souhrnný report | backend testy a manifest | zachováno |
| Lokalizace | `web/src/i18n/` a dotčené stránky | Dotčené nové popisky používají neutrální `PRŮCHOD` | `web/tests/i18n-resources.test.ts` | částečně — nutná kontrola všech jazykových renderů |
| Backendové invarianty | `app/`, `alembic/`, `tests/` | Bez změny employment scope, zámků, serializace, metrik a interního `IN`/`OUT` kontraktu | `compileall`, Ruff, mypy, pytest, repo invarianty | splněno |
| Úplná a11y/E2E/visual sada | `web/tests/e2e/`, `web/playwright.config.ts` | Stávající sada je zachována, nové scénáře ještě nejsou plně uzavřeny | typecheck/lint/unit prošly | blocker |
| Design gate | designový agent + lokální reálné rendery | Vyžaduje mobil 390×844, tablet 768×1024, desktop 1440×900, všechny dotčené jazyky, print a písemný finální souhlas; produkční screenshot není podmínka | `/tmp/dagmar-design-evidence-final.*` obsahuje 105 reálných PNG; agent potvrdil P0 tiskové kapacity a P1 lokalizace/mobilního overflow; P0 opraven, re-review ještě neproběhl | blokováno P1 review |

## Závěr

Kódové a dokumentační změny jsou ověřeny dostupnými lokálními kontrolami. Implementace nesmí být označena za úplně uzavřenou ani nasazena, dokud nebude doplněna cílená E2E/a11y/visual/print evidence a dohledatelný finální souhlas designera podle SSOT.
