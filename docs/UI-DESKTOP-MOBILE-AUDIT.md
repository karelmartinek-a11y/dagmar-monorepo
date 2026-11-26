# Inventura desktopu pro mobilní KájovoDocházku

K ověření sloužilo webové UI v `app/web_ui/`. Běžící backend měl zdroj `d6b9091a9363`. Hash souborů `app.js` a `api.js` odpovídal ověřované kopii. Pro každý zápis platí podepsaný kontext CML a autorizace backendu.

| Pohled | Prvky a pravidla | Vazba na službu |
| --- | --- | --- |
| `dochazka.day-menu` | Položky docházky jsou dovolená, nemoc, paragraf, volno a vymazání. Plán nabízí dovolenou, volno a vymazání. V plánu se změna potvrzuje, vymazání je dostupné pouze pro existující stav. Uzamčený den a den bez platného pracovního poměru jsou neaktivní. | Denní editace docházky posílá samostatný PUT přes `app/web_ui/api.js`. Plán odesílá plánovaný den jinou operací a vede vlastní stav. |
| `dochazka.employee.group-plan` | Nabídka skupin, měsíc a přehled plánovaných směn. Zpřístupní pouze skupinu s vlastním povoleným pracovním poměrem platným ve zvoleném měsíci. Členský plán je pouze ke čtení a chybějící záznamy mají prázdný stav. Historický `?view=group-plan` vede na dnešní pohled `?view=groups`. | `GET /api/v1/shift-plan/groups`, `GET /api/v1/shift-plan/groups/{id}`. Backend vynucuje rozsah i při přímém čtení konkrétní skupiny. |
| `dochazka.employment-selection` | Administrátor vidí dostupné a vybrané pracovní poměry v měsíci. Uložením se změní výběr a znovu se načte plán. Výběr je omezen na platné položky v daném měsíci. | `GET /api/v1/admin/shift-plan`, `PUT /api/v1/admin/shift-plan/selection`. |
| `dochazka.group-editor` | Název, volba pracovních poměrů a uložení či zrušení. Při editaci se předvyplní název a členské poměry. Název se normalizuje, má nejvýše 160 znaků a musí být unikátní. Skupina potřebuje nejméně dva různé kladné identifikátory. | Vytvoření přes `POST /api/v1/admin/employment-groups`. Editace názvu a nahrazení členů používají oddělené PUT na `/{id}` a `/{id}/members`. Existující desktopová editace tedy může obdržet dva různé výsledky. |

## Ověření

Osm izolovaných snímků zachytilo čtyři pohledy. Prohlížečový průchod ověřil změnu typu docházky a opětovné načtení uloženého výběru proti testovacímu backendu. Obě varianty editoru skupiny se otevřely se správnými vstupy. Uložení skupiny v tomto průchodu nebylo provedeno.

Projektové prohlížečové sady pro období a čas prošly v Chromiu a WebKitu. Třináct backendových testů v `tests/test_cml_browser_entry.py` a `tests/test_attendance_mcp.py` pokrylo také omezení členského plánu na oprávněné skupiny a ochranu při zastaralém rozsahu oprávnění. Prohlížečový editor skupin v tomto vydání nepoužívá parametr verze změny členství z MCP kontraktu.

Lokální index `outputs/cml-mobile-20261125/attendance-desktop-fixture/index.json` má SHA-256 `d140a0465f11d642eef47a75f07ae106dd046a98de03e934fe79d53b32d3dbd3`.
