# Cursor stránkování a limity

## Odpověď seznamu

```json
{
  "data": [],
  "pagination": {
    "limit": 100,
    "has_more": false,
    "next_cursor": null
  }
}
```

`limit` je 1–500. Server čte `limit + 1` řádků, vrátí nejvýše `limit` a při pokračování vyplní `next_cursor`. Klient cursor nesmí dekódovat ani upravovat; předá jej beze změny v dalším parametru `cursor`.

Cursor je base64url JSON s verzí, zdrojem a klíčem. `employments` a `locks` používají klíč `id`; `attendance-events` používá dvojici `(occurred_at, id)`. Cursor z jiného endpointu, jiné verze nebo s poškozeným obsahem vrací HTTP `400` a `invalid_cursor`.

Datový rozsah a všechny filtry se aplikují před cursor podmínkou. To zabraňuje mezerám, duplicitám i průniku nepovolených záznamů.

## Oddělené rate-limit buckety

- `/health`: `DAGMAR_INTEGRATION_HEALTH_RATE_LIMIT`;
- datové endpointy: `DAGMAR_INTEGRATION_DATA_RATE_LIMIT`;
- `/openapi.json`: `DAGMAR_INTEGRATION_OPENAPI_RATE_LIMIT`.

Buckety jsou oddělené podle klienta a účelu. `DAGMAR_RATE_LIMIT_ENABLED=false` je vypne společně. Překročení vrací HTTP `429`.
