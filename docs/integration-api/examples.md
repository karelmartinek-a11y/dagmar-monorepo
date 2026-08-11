# Příklady

```bash
curl --fail-with-body \
  --oauth2-bearer "$DAGMAR_INTEGRATION_TOKEN" \
  https://dagmar.hcasc.cz/api/v1/integration/health
```

```bash
curl --fail-with-body \
  --oauth2-bearer "$DAGMAR_INTEGRATION_TOKEN" \
  'https://dagmar.hcasc.cz/api/v1/integration/attendance-events?employment_id=42&date_from=2026-08-01&date_to=2026-08-31&limit=100'
```

Další stránka používá přesně vrácené `next_cursor`:

```bash
curl --fail-with-body \
  --oauth2-bearer "$DAGMAR_INTEGRATION_TOKEN" \
  'https://dagmar.hcasc.cz/api/v1/integration/attendance-events?limit=100&cursor=VRACENY_OPAQUE_CURSOR'
```

Atomický uzavřený interval:

```bash
curl --fail-with-body -X POST \
  --oauth2-bearer "$DAGMAR_INTEGRATION_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"employment_id":42,"occurred_at":"2026-08-11T08:00:00+02:00","event_type":"IN","paired_occurred_at":"2026-08-11T16:00:00+02:00"}' \
  https://dagmar.hcasc.cz/api/v1/integration/attendance-events
```
