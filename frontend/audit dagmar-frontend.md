# Forenzní audit – auth kontrakt a identifikátory klienta

Datum: 2026-06-12  
Rozsah: frontend web, přibalený Android klient a sdílené kontraktové poznámky v tomto repozitáři.

## Závěr

Aktuální webový frontend autentizuje zaměstnance Bearer tokenem a data načítá nebo zapisuje podle `employment_id`, který backend proti tokenu autorizuje. Historické stopy autentizace nebo klientské identity podle interního ID instance byly nalezené hlavně v těchto místech:

- starý login kontrakt a interní poznámky zmiňovaly `instance_id` jako součást běžného login response,
- Android auth store ukládal `profileId`, i když jej současné klientské toky nepotřebují,
- Android admin DTO stále popisovala staré payloady podle `instance_id` a `selected_instance_ids`,
- komentáře v API klientu stále tvrdily, že se na klientu může perzistovat `instance_id`.

## Stav po opravě

- Webový login kontrakt počítá jen s `instance_token`, `employment_id`, `available_employments`, `display_name` a `afternoon_cutoff`.
- Webový admin typ `AdminInstance` už nepublikuje interní `profile_instance_id`, protože UI jej nepotřebuje.
- Android auth store už neukládá historické `profileId`.
- Android síťové DTO byly přepsané tak, aby nešířily staré identifikátory instance jako součást autentizačního nebo admin kontraktu.
- Kontraktové dokumenty a poznámky už nepopisují `instance_id` jako součást běžného přihlášení.

## Zbytkové interní vazby, které zůstávají záměrně

Některé tabulky backendu stále nesou `instance_id` jako auditní nebo provozní provenance:

- `attendance.instance_id`
- `shift_plan.instance_id`
- `attendance_locks.instance_id`
- `shift_plan_month_instances.instance_id`
- `attendance_reminder_events.instance_id`

Tyto sloupce po této revizi neslouží jako klientská autentizační identita. Jsou to interní provozní stopy pro audit, merge instancí a dohledání zdroje zápisu.
