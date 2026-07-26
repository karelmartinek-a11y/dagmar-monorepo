# DAGMAR – API kontrakt

Verze: 2026-06-12  
Base path: `/api/v1`

Tento kontrakt je sdílený mezi backendem a frontendem. Docházka, plán služeb, zámky i exporty jsou vedené podle `employment_id`. Klient po přihlášení pracuje s Bearer tokenem a dostupnými úvazky; interní `instance_id` se do login response nevrací, ale autorizační bearer `instance_token` ano.

## 1) Portal auth

### POST `/api/v1/portal/login`
Request:
```json
{ "email": "user@example.com", "password": "string" }
```

Response 200:
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

Pravidla přihlášení:
- účet musí mít `is_active = true`,
- role musí být `employee`,
- zaměstnanec musí mít alespoň jeden úvazek v přihlašovacím okně `-1 kalendářní měsíc / +1 kalendářní měsíc`,
- bez dostupného úvazku je login zamítnut.

### POST `/api/v1/portal/reset`
Request:
```json
{ "token": "string", "password": "string" }
```

Response 200:
```json
{ "ok": true }
```

## 2) Evidence docházky zaměstnance

Bearer:
- `Authorization: Bearer <instance_token>`

### GET `/api/v1/attendance?employment_id=17&year=2026&month=3`
Response 200:
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
Request:
```json
{
  "employment_id": 17,
  "date": "2026-03-01",
  "arrival_time": "08:00",
  "departure_time": "16:00"
}
```

Response 200:
```json
{ "ok": true }
```

Backend odmítne zápis mimo období vybraného úvazku.

## 3) Admin – Users

### GET `/api/v1/admin/users`
Response 200:
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

## 4) Admin – Employments

### GET `/api/v1/admin/users/{user_id}/employments`
### POST `/api/v1/admin/users/{user_id}/employments`
### PUT `/api/v1/admin/employments/{employment_id}`
### DELETE `/api/v1/admin/employments/{employment_id}`

Při zkrácení období může backend vrátit `409` s `employment_period_conflict`. Frontend musí zobrazit potvrzovací dialog v češtině a po souhlasu zopakovat požadavek s `confirm_delete_out_of_range: true`.

## 5) Admin – Evidence docházky

### GET `/api/v1/admin/attendance?employment_id=17&year=2026&month=3`
### PUT `/api/v1/admin/attendance`
### POST `/api/v1/admin/attendance/lock`
### POST `/api/v1/admin/attendance/unlock`

Request pro zápis:
```json
{
  "employment_id": 17,
  "date": "2026-03-01",
  "arrival_time": "08:00",
  "departure_time": "16:00"
}
```

Lock/unlock:
```json
{ "employment_id": 17, "year": 2026, "month": 3 }
```

### PUT `/api/v1/admin/locks`

Hromadné zamknutí nebo odemknutí z administračních matic docházky a plánu služeb.

```json
{
  "lock_type": "attendance",
  "locked": true,
  "employment_ids": [17, 18],
  "months": [
    { "year": 2026, "month": 3 },
    { "year": 2026, "month": 4 }
  ]
}
```

Endpoint aplikuje změnu jen na ty kombinace `employment_id × měsíc`, které skutečně leží v období platnosti daného úvazku. Pokud ve zvoleném rozsahu neleží žádný vybraný úvazek, vrací `409 employment_period_mismatch`.

## 6) Admin – Shift plan

### GET `/api/v1/admin/shift-plan?year=2026&month=3`
Response 200:
```json
{
  "year": 2026,
  "month": 3,
  "selected_employment_ids": [17],
  "available_employments": [
    {
      "id": 17,
      "user_id": 1,
      "user_name": "Jan Novák",
      "title": "Recepce",
      "employment_type": "HPP",
      "display_label": "Jan Novák – HPP – Recepce",
      "start_date": "2025-01-01",
      "end_date": null
    }
  ],
  "rows": [
    {
      "employment_id": 17,
      "user_name": "Jan Novák",
      "title": "Recepce",
      "employment_type": "HPP",
      "display_label": "Jan Novák – HPP – Recepce",
      "days": []
    }
  ]
}
```

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

## 7) Skupiny úvazků a skupinový plán směn

Skupina je trvalý vztah M:N nad `employment_id`; obsahuje nejméně dva různé úvazky. Jeden úvazek může být v libovolném počtu skupin. Pokud odebrání nebo smazání úvazku sníží skupinu pod dva členy, skupina se v téže transakci odstraní.

Administrátorské endpointy používají administrátorskou session a CSRF:

- `GET /api/v1/admin/employment-groups`
- `POST /api/v1/admin/employment-groups` s `{ "name": "Ranní tým", "employment_ids": [17, 18] }`
- `PUT /api/v1/admin/employment-groups/{group_id}` pro přejmenování
- `PUT /api/v1/admin/employment-groups/{group_id}/members` pro atomickou náhradu členů
- `DELETE /api/v1/admin/employment-groups/{group_id}/members` pro odebrání členů; odpověď obsahuje `group_deleted`
- `DELETE /api/v1/admin/employment-groups/{group_id}`

Zaměstnanecké endpointy používají bearer token. `GET /api/v1/shift-plan/groups` vrací pouze skupiny, ve kterých má aktuální uživatel vlastní úvazek. `GET /api/v1/shift-plan/groups/{group_id}?year=2026&month=3` vrací výhradně plán směn členů skupiny, bez docházky nebo interních údajů. Neoprávněná a neexistující skupina vracejí shodně `404 group_not_found`.

Zápis směny nadále probíhá jediným kanonickým endpointem `PUT /api/v1/shift-plan`; backend ověřuje vlastnictví `employment_id`, aktivitu a platnost úvazku a zámek plánu směn. Stejný endpoint používá i editace vlastního řádku ve skupinovém pohledu. Členství ve skupině proto neopravňuje k úpravě směny kolegy a žádná zápisová operace nemění stav zámku.

## 8) Admin – Export

### GET `/api/v1/admin/export?month=2026-03&employment_id=17`
Vrací CSV pro konkrétní úvazek.

### GET `/api/v1/admin/export?month=2026-03&bulk=true`
Vrací ZIP pro všechny relevantní úvazky v měsíci.

### POST `/api/v1/admin/export/shift-plan/report`
Vstup:
```json
{
  "year": 2026,
  "month": 7,
  "employment_ids": [17, 18, 19]
}
```

Vrací normalizovanou tiskovou sestavu plánu směn pro náhled v administraci. Výběr je vázaný na `employment_id`, vyžaduje administrátorskou session a CSRF a stránkuje deterministicky po nejvýše pěti úvazcích na stranu.

### POST `/api/v1/admin/export/shift-plan/pdf`
Používá stejný request body jako `report` endpoint a vrací skutečný soubor `application/pdf` s názvem `plan_smen_YYYY-MM.pdf`.
