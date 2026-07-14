# Role, state and validation catalog

The forensic boundary is commit `f2edd6979e6646ba8f630be2da93f85d9430a6c3`. This catalog is the implementation authority after the historical `frontend/` directory is removed.

## Roles and authorization

| Actor | Authentication | Scope | Forbidden behavior |
|---|---|---|---|
| Anonymous visitor | none | public configuration, health/version, integration documentation, login and reset forms | employee/admin records and integration secrets |
| Employee | portal bearer token | own employments, attendance and supported day status operations | another person's employment, admin endpoints and integration tokens |
| Administrator | HttpOnly session cookie plus CSRF on mutations | users, employments, attendance, plans, locks, exports, prints, settings, SMTP, devices and integrations | bypassing CSRF or exposing plaintext stored secrets |
| Integration client | scoped integration bearer token | only granted read/write resources and bounded time windows | portal/admin namespaces and scopes not granted to the client |

Every attendance, plan, lock, selection, export and print operation uses `employment_id`; a person or instance identifier is never an implicit substitute.

## Required UI states

| State | Required presentation and behavior |
|---|---|
| Loading | labelled progress, stable geometry, no duplicate submission |
| Empty | explains why no rows exist and offers only supported next actions |
| Error | Czech message, retry where safe, request ID when returned, no internal exception |
| Success | concise confirmation linked to the completed operation; never optimistic after a failed response |
| Read-only | values remain legible and focusable; editing controls are absent or explicitly disabled with reason |
| Locked | lock owner/period context and no mutation controls |
| Conflict | preserved user input, backend explanation and explicit resolution path |
| Offline | persistent banner, queued-operation count and ordered retry; conflicts stop synchronization |
| Destructive confirmation | names the affected entity and irreversible/reversible consequence; default focus is cancel |
| Unauthorized/expired | clears the relevant client state and returns to the matching login without crossing auth realms |

## Validation authority

- Email, password presence, dates, times and required identifiers are validated before submission and again by the backend.
- Time inputs accept canonical `HH:MM`, preserve blank values, and never infer a second punch or day status.
- Employment start/end dates, employment type, active state and monthly boundaries are rendered from backend data in `Europe/Prague`.
- Attendance writes reject malformed sequences, future/locked periods and status conflicts according to backend errors.
- Shift-plan selection and bulk edits send explicit `employment_id` lists and date ranges; empty selections are not submitted.
- Admin mutations require a fresh CSRF token and use the session cookie; a 401/403 cannot be presented as success.
- Integration list pagination preserves `data` and `pagination`; date ranges are bounded before requests.
- Integration secrets are displayed only from create/rotate responses and are never persisted in browser storage or logs.
- Reset and SMTP flows use neutral messages that do not reveal whether an email account exists.

## Destructive consequences

- Deleting a user can affect linked employments and is always confirmed with the backend-provided consequence.
- Deleting or shortening an employment can remove or detach domain data; the returned impact object is shown before completion.
- Day-status conflicts may remove attendance or plan values only after a specific confirmation.
- Instance merge/revoke/deactivate/delete and pending-instance cleanup each use a dedicated confirmation; merge identifies source and target.
- Integration secret rotation invalidates the previous secret immediately; revoke/disable effects are stated before submission.
- Unlock and lock actions identify month and employment and refresh all dependent queries after success.

## Offline workflow

Only employee attendance/day-status writes are queueable. Each record contains operation kind, `employment_id`, payload, creation time, attempt count and last error. Entries replay FIFO after connectivity returns. Authentication failures pause the queue pending login; conflicts pause it pending user resolution; successful entries are removed only after a confirmed 2xx response.
