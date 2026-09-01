# Aktivní API kontrakt

Backend používá namespace `/api/v1/` a je jedinou autoritou časových výpočtů.

## Chybové odpovědi

Všechna neintegrační API selhání používají jedinou obálku
`{"error":{"code":"…","message":"…","details":…,"request_id":"…"}}`; `details` je
volitelné a interní výjimky se do odpovědi nepromítají. Integrační namespace zachovává
svou samostatnou verzovanou obálku.

## Úvazek

`employment_type` má jednu z hodnot `WORK_CONTRACT`, `DPP_DPC`, `TASK_SHIFT_BASED` nebo `EXTERNAL_HOURLY`. Profil konkrétního úvazku obsahuje `workload_fraction` a přepínače `total_hours_enabled`, `automatic_breaks_enabled`, `afternoon_hours_enabled`, `afternoon_start_minutes`, `night_hours_enabled`, `weekend_hours_enabled` a `public_holiday_hours_enabled`.

- `WORK_CONTRACT`: celková a noční metrika jsou povinné; odpolední, víkendová a sváteční jsou volitelné.
- `DPP_DPC` a `EXTERNAL_HOURLY`: celková i všechny zvláštní metriky jsou volitelné.
- `TASK_SHIFT_BASED`: žádná hodinová metrika není aktivní.

Profil patří konkrétnímu `Employment` a jeho změna se retroaktivně projeví ve všech obdobích. Měsíční výběr vyžaduje aktivního uživatele a platnost úvazku podle `start_date`/`end_date` s překryvem se zvoleným měsícem; aktivita úvazku se neřídí samostatným příznakem. Zaměstnanecký výběr poskytuje `GET /api/v1/attendance/employments?year=...&month=...`.

## Docházkové eventy

Zaměstnanecké endpointy jsou `POST /api/v1/attendance/events` a `PUT`/`DELETE /api/v1/attendance/events/{event_id}`. Administrace používá `GET /api/v1/admin/attendance/month` pro měsíční docházkové listy a `POST`, `PUT` a `DELETE /api/v1/admin/attendance/events...` pro správu průchodů. Typ existujícího průchodu a jeho `employment_id` jsou neměnné; backend ověřuje vlastnictví, chronologii, budoucí čas, období a zámek. Volitelné `paired_occurred_at` atomicky vloží uzavřený pár `IN`/`OUT`; volitelný query parametr `paired_event_id` u `DELETE` atomicky odstraní prostřední pracovní interval nebo fyzickou pauzu. Stejný kontrakt používají adminské a integrační eventové endpointy.

```json
{
  "employment_id": 123,
  "occurred_at": "2026-07-31T18:00:00+02:00",
  "event_type": "IN"
}
```

Eventy jsou chronologické, střídají `IN` a `OUT` a párují se i přes půlnoc a hranice měsíců. Mutace ověřuje zámek každého měsíce, jehož interval nebo metriky by změnila, a odmítne průchod překrývající den s celodenní nepřítomností.

Den měsíční odpovědi obsahuje také `planned_arrival_time`, `planned_departure_time`, `planned_status`, backendem odvozený `next_event_type`, denní stavy a kompletní denní metriky. Oba měsíční zámky jsou na kořeni odpovědi jako `attendance_locked` a `shift_plan_locked`. Celodenní stavy `HOLIDAY`, `SICKNESS`, `OFF` a `PARAGRAPH` zapisuje sjednocený `PUT /api/v1/attendance/day-status`; potvrzená změna fyzicky odstraní konfliktní docházku nebo plán.

Potvrzený `POST /api/v1/admin/attendance/breaks` přijímá jeden `employment_id`, rok a měsíc. Idempotentně doplní chybějící fyzické páry `OUT`/`IN` do uzavřených intervalů překrývajících měsíc, respektuje existující ruční pauzy a neimplementuje hromadné undo.

## Časové metriky

Denní a měsíční odpovědi používají sady `worked` a `planned` s klíči `total`, `afternoon`, `night`, `weekend` a `public_holiday`. Každá aktivní hodnota má tvar:

```json
{"minutes": 450, "tenths": 75, "hours": 7.5, "clock": "7:30"}
```

Neaktivní metrika je `null`. `clock` je backendem formátovaný údaj pro zobrazení v `H:mm`, zatímco `minutes`, `tenths` a `hours` zůstávají strojově čitelné hodnoty. Aktivní hodinová metrika v měsíci bez zdrojových faktů má backendovou nulovou hodnotu, aby prázdný měsíc zachoval stejný vizuální kontrakt jako před eventovou migrací. `display_metrics` je seřazený backendový seznam jedině viditelných intervalových sloupců pro aktuální profil konkrétního úvazku. Denní desetiny používají matematické half-up zaokrouhlení `floor((minuty + 3) / 6)`; měsíční hodnoty jsou součtem denních desetin. Celodenní `HOLIDAY`, `SICKNESS` a `PARAGRAPH` navíc dodávají samostatný `status_metrics` kredit 480 minut (8:00) na hodinovém úvazku; `OFF` a `TASK_SHIFT_BASED` kredit nemají. `status_metrics` je součástí denního i měsíčního attendance/shift-plan DTO a nesmí se směšovat s `worked` nebo `planned`. `EmploymentDailyTimeMetric` je provozní cache synchronizovaná po změnách, ale čtecí endpointy a reporty vždy počítají z aktuálních zdrojových faktů, aby stale cache nemohla změnit součty. Frontend, tisk, CSV, ZIP a PDF čísla ani kategorie neodvozují a hodnoty pouze lokalizují.

Nové zápisy docházky začínají `IN` a dále striktně střídají `OUT`/`IN`; editace ani mazání nesmí toto pořadí porušit. Výpočet metrik ale používá aktuální chronologicky seřazené časy a páruje je po dvojicích, aby historicky nekonzistentní směrový typ nemohl zahodit uložený čas; započítá pouze kladné intervaly kratší než 24 hodin. Všechny mutace eventů, plánů a stavů jednoho úvazku se serializují řádkovým databázovým zámkem; po jeho získání se pod zámkem vlastníka znovu ověří aktivita úvazku i uživatele. Přeshraniční plán se kontroluje proti období úvazku, celodenním stavům, jiným směnám stejného úvazku a zámkům ve všech dotčených dnech a měsících. Denní DTO označuje samostatný carryover příznakem `planned_is_carryover` (docházka) nebo `is_carryover` (plán a skupinový plán). Pole `planned_carryover_departure_time` a `carryover_departure_time` zachovají přesah i tehdy, když v témže dni začíná další nepřekrývající se směna; frontend ani report jej nesmí zakrýt nebo zapsat jako nový plán. První `OUT` nápověda takového dne používá carryover odchod a další `OUT` nápověda odchod přímé směny.

## Adminský tisk docházky

`/admin/tisky/preview?type=attendance` vykresluje pro každý vybraný `employment_id` a měsíc jednu A4 stránku podle počtu průchodů: nejvýše čtyři průchody na výšku, pět až osm průchodů na šířku podle osmi-průchodové předlohy. Náhled i browserové uložení do PDF používají stejnou DOM kompozici: jméno zaměstnance bez popisku, titul pouze s měsícem a rokem, identifikační mřížku pouze s typem úvazku, platností úvazku a názvem úvazku, jeden řádek na kalendářní den, chronologické časové sloupce `PRŮCHOD` a pevnou masku pěti intervalových metrik v pořadí backendového kontraktu. Neaktivní metriky jsou v masce výslovně označené jako nerelevantní, nikoli skryté. Spodní souhrn obsahuje stejnou pevnou masku, relevantní statusové kredity a měsíční plán z pole `planned` dodaného backendem; chybějící backendová hodnota zůstává `—`, nikoli falešná nula. Podpisová pole se netisknou; zápatí obsahuje lokalizovaný text KájovoDagmar a čas generování. Frontend ani tisk žádnou hodnotu nedopočítává a nedostupné údaje se nevymýšlejí.
