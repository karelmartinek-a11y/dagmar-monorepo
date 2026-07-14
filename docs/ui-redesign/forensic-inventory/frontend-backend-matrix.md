# Matice frontend–backend vazeb

První uzavřený průřez mezi dnešními routami a aktuálním backendovým kontraktem.

| ID | Route | Frontend odpovědnost | Backend autorita | Klíčové endpointy |
| --- | --- | --- | --- | --- |
| EMP-01 | `/app` login | sběr e-mailu a hesla, lokální zobrazení chyb, uložení tokenu | validace účtu, lockout, dostupný úvazek, vydání tokenu | `POST /api/v1/portal/login` |
| EMP-02 | `/app` hlavička kontextu | volba `employment_id`, přepínání měsíce a režimu, indikace online/offline | dostupné úvazky a default employment při loginu | `POST /api/v1/portal/login`, `GET /api/v1/time` |
| EMP-03 | `/app` docházka | načtení měsíce, editace dne, lokální validace formátu času, offline fronta | období úvazku, zámek měsíce, zákaz budoucích a historicky měněných časů | `GET /api/v1/attendance`, `PUT /api/v1/attendance` |
| EMP-04 | `/app` plán a status dne | přepínání view, potvrzení konfliktů, vysvětlení stavů | day status, konflikt s docházkou/plánem, zaměstnanecká oprávnění | `PUT /api/v1/shift-plan/day-status`, data z `GET /api/v1/attendance` |
| AUTH-01 | `/reset` | reset formulář, validace hesla, stav odeslání | token resetu, expirace, uložení hesla | `POST /api/v1/portal/reset` |
| ADM-01 | `/admin/login` | login formulář, CSRF bootstrap | admin credential, session, CSRF cookie | `GET /api/v1/admin/csrf`, `POST /api/v1/admin/login`, `GET /api/v1/admin/me` |
| ADM-02 | `/admin/prehled` | agregační zobrazení, partial error handling | seznam uživatelů, zařízení, SMTP, settings | `GET /api/v1/admin/users`, `GET /api/v1/admin/instances`, `GET /api/v1/admin/smtp`, `GET /api/v1/admin/settings` |
| ADM-03 | `/admin/users` | CRUD uživatelů, reset hesla, unlock, CRUD úvazků, potvrzení konfliktů | uživatelé, zaměstnanci, reset tokeny, období úvazku, navázaná data | `/api/v1/admin/users*`, `/api/v1/admin/employments/*` |
| ADM-04 | `/admin/dochazka` | velká měsíční matice, inline editace, filtry, lock/unlock, context menu | měsíční docházka podle `employment_id`, zámky, day status konflikty | `/api/v1/admin/attendance*`, `/api/v1/admin/day-status` |
| ADM-05 | `/admin/plan-sluzeb` | výběr zaměstnanců do plánu, tabulková editace, day status konflikty | plán směn, měsíční výběry úvazků | `/api/v1/admin/shift-plan*`, `/api/v1/admin/day-status` |
| ADM-06 | `/admin/export` | sestavení export dotazu a výběr úvazků | generování CSV/ZIP exportů | `GET /api/v1/admin/export` |
| ADM-07 | `/admin/tisky` | výběr typu dokumentu, měsíce a úvazků, otevření preview | samotný generátor tiskových dat | `GET /api/v1/admin/users`, preview query parametry |
| ADM-08 | `/admin/tisky/preview` | render stavu generování a stažení PDF | tiskové podklady a výsledný PDF tok | navázáno na preview routu a backendový generátor |
| ADM-09 | `/admin/settings` | formuláře provozních pravidel a SMTP | app settings a SMTP konfigurace | `GET/PUT /api/v1/admin/settings`, `GET/PUT /api/v1/admin/smtp` |
| ADM-10 | `/admin/instances` | správa zařízení a instancí | aktivace, přejmenování, revoke, merge, deactivation | `/api/v1/admin/instances*`, veřejné `/api/v1/instances/*` pro bootstrap zařízení |
| ADM-11 | `/admin/integrace` | CRUD klientů, scope výběr, jednorázové zobrazení tokenu, rotace | integrační klienti, bezpečné uložení secretů, scopy a datový rozsah | `/api/v1/admin/integrations/clients*` |
| PUB-01 | `/integration-api` | veřejná dokumentace, neinteraktivní vysvětlení API | skutečný integrační kontrakt a error kódy | `/api/v1/integration/*` |

## Průřezové invarianty

- zaměstnanecký tok je vázán na `employment_id`, nikoli jen na osobu
- admin akce jsou chráněné session a CSRF
- integrační tok používá oddělené bearer tokeny a samostatný namespace
- nový frontend musí zachovat českou textaci a stavy `loading`, `empty`, `error`, `success`, `read-only`, `locked`, `conflict`, `offline`

## Body vyžadující zvláštní pozornost při přepisu do `web/`

1. Offline chování zaměstnanecké části nesmí předstírat úspěšné uložení bez následné synchronizace.
2. Tabulkové moduly `dochazka` a `plan-sluzeb` jsou výkonově a ergonomicky kritické a musí respektovat sticky oblasti a klávesnicové ovládání popsané v design manuálu.
3. Admin preview tisků je samostatný tok a nesmí být degradován na pouhé stažení bez diagnostiky stavu.
4. Jednorázové zobrazení plaintext integračního tokenu je bezpečnostně citlivý stav, který musí být v novém UI explicitně zachován.
