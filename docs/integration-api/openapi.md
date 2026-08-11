# Chráněný OpenAPI kontrakt

`GET /api/v1/integration/openapi.json` vyžaduje bearer s `openapi:read` a podléhá samostatnému OpenAPI rate-limit bucketu. Pole `info.version` odpovídá `DAGMAR_INTEGRATION_CONTRACT_VERSION`, aktuálně `2026-08-11`.

Dokument obsahuje pouze aktivní endpointy. Každý dostupný scope má v invariantní kontrole nejméně jednu skutečnou routu se stejným runtime enforcementem. Nedostupné scopes se v chráněném OpenAPI nevystavují.
