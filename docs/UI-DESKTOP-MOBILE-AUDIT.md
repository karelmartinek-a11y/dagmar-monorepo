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

## Doplňující audit administrace a osobního přehledu

| Desktopový vstup | Podklady, validace a operace |
| --- | --- |
| Docházka vlastního úvazku | Seznam platných úvazků a výpočet měsíce vrací `attendance/employments` a `attendance`. Přidání a úprava chronologického průchodu používají POST a PUT na `attendance/events`; DELETE může nést `paired_event_id`. Duplicitní průchody, uzamčené období a práce mimo platnost úvazku odmítá backend. Hodinové metriky se zobrazují z výsledku backendu, včetně měsíčních součtů po desetinném zaokrouhlení a doložených celodenních stavů. |
| Docházkové listy správce | `admin/attendance/month` vrací stejné metriky všech dostupných úvazků. Administrace používá vlastní varianty změn průchodů a denních stavů. Zámky používají `admin/locks`. Doplnění historických pauz vyžaduje potvrzení a `admin/attendance/breaks` s úvazkem a obdobím. Po zápisu se čte kanonický stav. |
| Můj plán a administrace plánů | Zobrazení drží identitu obou uložených časů i samostatného časového pole. `shift-plan` má date, employment_id, arrival_time, departure_time a status. Zadaný konec musí být po začátku a ve stejném dni. Členská oprávnění se omezují na vlastní úvazky. Výběr administrace lze uložit pro období. Celkový plánový součet poskytuje server i u úvazku bez metriky total. |
| Přehled a integrační informace | Vlastník čte stav sekce a nativní integrační cesty. Oprávnění klientů oddělují lidskou relaci CML od integračních oprávnění. Dokumentace a dostupnost jednotlivých režimů se řídí skutečným katalogem. |
| Export a tisk | Export vybraného úvazku nebo správcovského rozsahu se váže na konkrétní období. Náhledy plánu a docházky používají serverová data, dlouhé identity, oddělené dny a plánové stavy. Párování denních časů a hodin se v prohlížeči nepočítá. PDF a ZIP/CSV mají formátový limit a samostatné potvrzené stažení. |
| Přístup a jazyk | Podepsaný kontext CML identifikuje skutečnou roli a úvazky. Nativní identita dodává dostupné jazyky a manifest viditelné agendy. Souhlas k MCP vyžaduje identitu vlastníka a jednorázovou žádost; čtení rozsahu a schválení se provádějí samostatně přes `oauth/consent`. |
