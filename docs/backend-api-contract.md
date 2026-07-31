# Aktivní API kontrakt

Backend používá namespace `/api/v1/` a je jedinou autoritou časových výpočtů.

## Úvazek

`employment_type` má jednu z hodnot `WORK_CONTRACT`, `DPP_DPC`, `TASK_SHIFT_BASED` nebo `EXTERNAL_HOURLY`. Profil konkrétního úvazku obsahuje `workload_fraction` a přepínače `automatic_breaks_enabled`, `afternoon_hours_enabled`, `afternoon_start_minutes`, `night_hours_enabled`, `weekend_hours_enabled` a `public_holiday_hours_enabled`.

## Docházkové eventy

Zaměstnanecké endpointy jsou `POST /api/v1/attendance/events` a `DELETE /api/v1/attendance/events/{event_id}`. Administrace používá `POST`, `PUT` a `DELETE /api/v1/admin/attendance/events...`.

```json
{
  "employment_id": 123,
  "occurred_at": "2026-07-31T18:00:00+02:00",
  "event_type": "IN"
}
```

Eventy jsou chronologické, střídají `IN` a `OUT` a párují se i přes půlnoc a hranice měsíců.

## Časové metriky

Denní a měsíční odpovědi používají sady `worked` a `planned` s klíči `total`, `afternoon`, `night`, `weekend` a `public_holiday`. Každá aktivní hodnota má tvar:

```json
{"minutes": 450, "tenths": 75, "hours": 7.5}
```

Neaktivní metrika je `null`. Denní desetiny používají matematické zaokrouhlení na nejbližší desetinu hodiny; měsíční hodnoty jsou součtem denních desetin. Frontend, tisk a exporty hodnoty pouze formátují.
