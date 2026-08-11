# Endpointy

Všechny cesty mají prefix `/api/v1/integration` a vyžadují bearer `dgi_…`.

## Technické endpointy

### `GET /health`

Scope `integration:health`. Vrací `ok`, název služby, `api_version`, `contract_version`, `client_id` a `timezone`. Nekontroluje databázovou připravenost celé aplikace.

### `GET /openapi.json`

Scope `openapi:read`. Vrací chráněný OpenAPI 3.1 popis pouze aktivních integračních rout a aktuální verzi kontraktu.

## `GET /employments`

Scope `employments:read`. Parametry `limit` (1–500, výchozí 100) a `cursor`. Vrací úvazky povolené datovým rozsahem klienta, včetně `employment_id`, `employee_id`, období, aktivity a časového profilu.

## `GET /attendance-events`

Scope `attendance:read`. Parametry:

- volitelný `employment_id`;
- volitelné ISO datum `date_from` a `date_to` včetně;
- `limit` a `cursor`.

Filtry i datový rozsah se aplikují před stránkováním. Pořadí je stabilní podle `(occurred_at, id)`. Event obsahuje interní `event_type` `IN`/`OUT`, protože jde o strojový kontrakt.

## `POST /attendance-events`

Scope `attendance:create`. JSON:

```json
{
  "employment_id": 42,
  "occurred_at": "2026-08-11T08:00:00+02:00",
  "event_type": "IN",
  "paired_occurred_at": "2026-08-11T16:00:00+02:00"
}
```

`paired_occurred_at` je volitelné atomické vložení uzavřeného intervalu a je platné pouze pro počáteční `IN`. Endpoint zachovává chronologii, zámky měsíců, celodenní stavy a přepočet dotčených metrik.

## `PATCH /attendance-events/{event_id}`

Scope `attendance:update`. Přijímá pouze nový čas s časovým pásmem:

```json
{"occurred_at":"2026-08-11T08:15:00+02:00"}
```

## `DELETE /attendance-events/{event_id}`

Scope `attendance:delete`. Volitelný query parametr `paired_event_id` odstraní dva související eventy atomicky. Výsledná historie musí zůstat platná.

## `GET /locks`

Scope `locks:read`. Povinné parametry `year` a `month`, dále `limit` a `cursor`. Pro každý povolený `employment_id` vrací `attendance_locked` a `shift_plan_locked`.
