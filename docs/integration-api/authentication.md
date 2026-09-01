# Autentizace, scopes a datový rozsah

## Bearer token

```http
Authorization: Bearer dgi_jednorazove_predany_token
```

Server ukládá pouze hash tajné části tokenu. Chybějící, neplatný, expirovaný, deaktivovaný nebo IP pravidlu nevyhovující token vrací integrační error envelope a HTTP `401` nebo `403`.

## Dostupné scopes

| Scope | Endpoint |
|---|---|
| `integration:health` | `GET /health` |
| `openapi:read` | `GET /openapi.json` |
| `employments:read` | `GET /employments` |
| `attendance:read` | `GET /attendance-events` |
| `attendance:create` | `POST /attendance-events` |
| `attendance:update` | `PATCH /attendance-events/{event_id}` |
| `attendance:delete` | `DELETE /attendance-events/{event_id}` |
| `locks:read` | `GET /locks` |

Scopes `shift_plan:read`, `punches:read` a `changes:read` nejsou v kontraktu `2026-08-11` dostupné, nelze je uložit do nového klienta a migrace `0026` je odstraňuje z existujících klientů.

## Datový rozsah

Jediná backendová služba aplikuje stejný SQL predicate na všechny seznamy i přímé ID operace:

- `ALL_EMPLOYMENTS`: všechny úvazky;
- `ALL_ACTIVE_EMPLOYMENTS`: pouze úvazky platné k dnešnímu pražskému datu aktivních uživatelů;
- `SELECTED_EMPLOYEES`: úvazky osob z neprázdného `allowed_employee_ids`; neaktivní úvazky se zahrnou jen při `include_inactive_employments=true`;
- `SELECTED_EMPLOYMENTS`: úvazky z neprázdného `allowed_employment_ids`.

Neznámý režim nebo prázdný seznam u selektivního režimu nepovolí žádný úvazek. Zápisové endpointy bez ohledu na režim odmítnou úvazek mimo jeho `start_date`/`end_date` nebo neaktivního uživatele.
