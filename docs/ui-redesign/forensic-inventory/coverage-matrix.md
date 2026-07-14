# Clean frontend coverage matrix

| Brief / capability | Route | Target feature | Backend authority | Acceptance test |
|---|---|---|---|---|
| EMP-01 login | `/app` | employee access board | `POST /api/v1/portal/login` | valid/invalid login, lockout, token expiry |
| EMP-02 month attendance | `/app` | responsive attendance ledger and inspector | `GET/PUT /api/v1/attendance` | one/multiple employments, locked/read-only, time validation |
| EMP-03 day status | `/app` | status editor and conflict dialog | `PUT /api/v1/shift-plan/day-status` | status conflict, offline replay |
| EMP-04 summaries | `/app` | monthly totals and plan comparison | attendance response calculations | Prague dates, holiday/weekend/afternoon totals |
| EMP-05 offline | `/app` | queue banner and sync panel | ordered replay of employee mutations | disconnect, reconnect, auth failure, conflict stop |
| AUTH-01 reset | `/reset` | neutral reset form | `POST /api/v1/portal/reset` | valid/invalid input and enumeration-safe response |
| ADM-01 login | `/admin/login` | admin access board | admin CSRF/login/me/logout | session expiry, safe next, CSRF failure |
| ADM-02 overview | `/admin/prehled` | operational dashboard | aggregate admin resources | partial failure and empty state |
| ADM-03 users | `/admin/users` | users and employment inspector | admin users/employments | CRUD, reset, unlock, employment consequences |
| ADM-04 attendance | `/admin/dochazka` | sticky monthly matrix and detail inspector | admin attendance/locks | inline edit, lock/unlock, conflict |
| ADM-05 shift plan | `/admin/plan-sluzeb` | plan matrix and bulk selection | admin shift plan/status/selection | keyboard selection, bulk edit, conflicts |
| ADM-06 export | `/admin/export` | export parameter workspace | `GET /api/v1/admin/export` | employment/date selection, CSV/ZIP response |
| ADM-07 prints | `/admin/tisky` | print configuration | attendance/plan data | preview navigation and validation |
| ADM-08 preview | `/admin/tisky/preview` | printable/PDF document | browser print/PDF pipeline | A4 layout, native print, download |
| ADM-09 settings | `/admin/settings` | deployment and SMTP diagnostics | admin settings/SMTP, `/api/version` | save, partial diagnostics, no email send in prod audit |
| ADM-10 instances | `/admin/instances` | device lifecycle workspace | admin instances | rename/template/merge/revoke/deactivate/delete confirmations |
| ADM-11 integrations | `/admin/integrace` | scoped client management | admin integrations | create/edit/rotate/disable/enable/revoke with one-time secret |
| NAV-01 shell | all protected admin routes | sidebar, topbar, responsive navigation | admin session | keyboard, mobile drawer, logout |
| PUB-01 API docs | `/integration-api` | public integration reference | integration OpenAPI | endpoint/scopes/pagination/error examples |

All rows require loading, empty, error, success and permission-aware states where relevant. Visual acceptance uses 1920, 1440, 1280, 1024, 768, 390 and 360 pixel viewports.
