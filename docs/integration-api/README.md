# KájovoDagmar Integration API

Aktivní strojové rozhraní je dostupné výhradně pod `https://dagmar.hcasc.cz/api/v1/integration`. Aktuální verze veřejného kontraktu je `2026-09-01`.

Každý požadavek používá samostatný bearer token s prefixem `dgi_`, explicitní scope a auditní záznam. Token zaměstnaneckého portálu ani administrátorská cookie nejsou pro integraci platné.

## Aktivní endpointy

- `GET /health`
- `GET /openapi.json`
- `GET /employments`
- `GET /attendance-events`
- `POST /attendance-events`
- `PATCH /attendance-events/{event_id}`
- `DELETE /attendance-events/{event_id}`
- `GET /locks`

Seznamové endpointy používají neprůhledný cursor a datový rozsah klienta. Přímé operace nad `employment_id` procházejí stejným deny-by-default rozsahem; zápisy navíc vyžadují úvazek platný k aktuálnímu dni podle `start_date`/`end_date` i aktivního uživatele.

Podrobnosti:

- [Autentizace, scopes a datový rozsah](authentication.md)
- [Endpointy](endpoints.md)
- [Cursor stránkování a limity](pagination-and-limits.md)
- [Chybové odpovědi](errors.md)
- [Příklady](examples.md)
- [Chráněný OpenAPI kontrakt](openapi.md)
- [Administrace klientů](admin-operations.md)
