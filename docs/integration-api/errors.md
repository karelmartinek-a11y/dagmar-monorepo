# Chybové odpovědi

Integrační API používá vlastní stabilní envelope:

```json
{
  "error": {
    "code": "invalid_cursor",
    "message": "Cursor není platný.",
    "request_id": "…"
  }
}
```

`X-Request-ID` odpovídá poli `request_id` a lze jej použít při řešení auditního záznamu.

| HTTP | Typické kódy | Význam |
|---|---|---|
| `400` | `invalid_request`, `invalid_cursor` | Neplatný vstup nebo cursor. |
| `401` | `invalid_token` | Chybějící nebo neplatný bearer. |
| `403` | `insufficient_scope`, `ip_not_allowed` | Scope nebo datový rozsah operaci nepovoluje. |
| `404` | `not_found` | Aktivní zapisovatelný objekt neexistuje. |
| `409` | `employment_period_mismatch`, `attendance_event_conflict`, `attendance_event_alternation_conflict`, `attendance_day_status_conflict` | Doménový konflikt. |
| `423` | `attendance_month_locked` | Dotčený měsíc je uzamčený. |
| `429` | `rate_limited` | Překročený bucket klienta. |
| `500` | `internal_error` | Interní chyba bez úniku detailu. |
