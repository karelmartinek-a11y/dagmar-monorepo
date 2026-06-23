# DAGMAR – frontend kontrakt

Verze: 2026-06-12  
Base path: `/api/v1`

Frontend očekává, že evidence docházky, plán služeb, zámky i exporty jsou vázané na `employment_id`. Po přihlášení si ukládá pouze Bearer token a pracovní stav UI; historický autentizační identifikátor instance už z login response nepřebírá.

## Portal login

### POST `/api/v1/portal/login`
Response:
```json
{
  "instance_token": "string",
  "display_name": "Jan Novák",
  "employment_id": 17,
  "available_employments": [
    {
      "id": 17,
      "title": "Recepce",
      "employment_type": "HPP",
      "start_date": "2025-01-01",
      "end_date": null,
      "is_active": true,
      "is_current": true,
      "label": "Jan Novák – HPP – Recepce"
    }
  ],
  "afternoon_cutoff": "17:00"
}
```

Frontend:
- uloží `instance_token`,
- uloží dostupné úvazky,
- použije `employment_id` jako výchozí volbu,
- při více úvazcích nabídne přepnutí.

## Employee evidence

### GET `/api/v1/attendance?employment_id=17&year=2026&month=3`
### PUT `/api/v1/attendance`

Request:
```json
{
  "employment_id": 17,
  "date": "2026-03-01",
  "arrival_time": "08:00",
  "departure_time": "16:00"
}
```

## Admin users

### GET `/api/v1/admin/users`
### POST `/api/v1/admin/users`
### PUT `/api/v1/admin/users/{user_id}`
### DELETE `/api/v1/admin/users/{user_id}`
### POST `/api/v1/admin/users/{user_id}/send-reset`
### POST `/api/v1/admin/users/{user_id}/unlock`

## Admin employments

### GET `/api/v1/admin/users/{user_id}/employments`
### POST `/api/v1/admin/users/{user_id}/employments`
### PUT `/api/v1/admin/employments/{employment_id}`
### DELETE `/api/v1/admin/employments/{employment_id}`

Při zkrácení období může přijít `409` s `employment_period_conflict`. Frontend musí zobrazit potvrzovací dialog v češtině a po souhlasu zopakovat požadavek s `confirm_delete_out_of_range: true`.

## Admin evidence docházky

### GET `/api/v1/admin/attendance?employment_id=17&year=2026&month=3`
### PUT `/api/v1/admin/attendance`
### POST `/api/v1/admin/attendance/lock`
### POST `/api/v1/admin/attendance/unlock`

Lock:
```json
{ "employment_id": 17, "year": 2026, "month": 3 }
```

## Admin shift plan

### GET `/api/v1/admin/shift-plan?year=2026&month=3`
Response obsahuje:
- `selected_employment_ids`,
- `available_employments`,
- `rows[].employment_id`,
- `rows[].display_label`.

### PUT `/api/v1/admin/shift-plan`
```json
{
  "employment_id": 17,
  "date": "2026-03-01",
  "arrival_time": "08:00",
  "departure_time": "16:00",
  "status": null
}
```

### PUT `/api/v1/admin/shift-plan/selection`
```json
{
  "year": 2026,
  "month": 3,
  "employment_ids": [17, 18]
}
```

## Export

### GET `/api/v1/admin/export?month=2026-03&employment_id=17`
Jednotlivý CSV export pro úvazek.

### GET `/api/v1/admin/export?month=2026-03&bulk=true`
ZIP pro všechny relevantní úvazky v měsíci.
