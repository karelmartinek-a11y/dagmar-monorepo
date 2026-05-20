# DAGMAR – API Contract

Verze: 2026-05-20  
Base path: `/api/v1`

Frontend očekává, že evidence docházky, plán služeb, zámky i exporty jsou vázané na `employment_id`. `instance_id` zůstává jen pro přihlašovací token a legacy provisioning.

## Portal login

### POST `/api/v1/portal/login`
Response:
```json
{
  "instance_id": "uuid",
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
Response:
```json
{
  "employment_id": 17,
  "employment_label": "Jan Novák – HPP – Recepce",
  "days": [
    {
      "date": "2026-03-01",
      "arrival_time": "08:00",
      "departure_time": "16:00",
      "planned_arrival_time": "08:00",
      "planned_departure_time": "16:00",
      "planned_status": null,
      "is_within_employment_period": true
    }
  ]
}
```

### PUT `/api/v1/attendance`
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
Response:
```json
{
  "users": [
    {
      "id": 1,
      "name": "Jan Novák",
      "email": "jan@example.cz",
      "phone": "+420123456789",
      "role": "employee",
      "has_password": true,
      "is_active": true,
      "is_locked": false,
      "locked_until": null,
      "login_status": "ACTIVE",
      "login_status_reason": null,
      "employments": [
        {
          "id": 17,
          "user_id": 1,
          "title": "Recepce",
          "employment_type": "HPP",
          "start_date": "2025-01-01",
          "end_date": null,
          "is_active": true,
          "label": "Jan Novák – HPP – Recepce"
        }
      ]
    }
  ]
}
```

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

Při zkrácení období může přijít `409` s:
```json
{
  "detail": {
    "code": "employment_period_conflict",
    "attendance_count": 2,
    "shift_plan_count": 1,
    "attendance_lock_count": 0,
    "shift_plan_selection_count": 1,
    "reminder_count": 0,
    "problem_range_start": "2026-03-01",
    "problem_range_end": "2026-04-30",
    "requires_confirmation": true
  }
}
```

Frontend musí zobrazit potvrzovací dialog v češtině a po souhlasu zopakovat požadavek s `confirm_delete_out_of_range: true`.

## Admin evidence docházky

### GET `/api/v1/admin/attendance?employment_id=17&year=2026&month=3`
### PUT `/api/v1/admin/attendance`
### POST `/api/v1/admin/attendance/lock`
### POST `/api/v1/admin/attendance/unlock`

Request:
```json
{
  "employment_id": 17,
  "date": "2026-03-01",
  "arrival_time": "08:00",
  "departure_time": "16:00"
}
```

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
