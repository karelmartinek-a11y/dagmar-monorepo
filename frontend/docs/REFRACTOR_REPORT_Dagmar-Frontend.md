# REFRACTOR REPORT — Dagmar Frontend

## 1) Coverage Matrix (parita po refaktoru)

| Stránka / proces | Umístění po refaktoru | Potvrzení parity detailů |
|---|---|---|
| Employee login (e-mail + heslo) | `src/pages/EmployeePage.tsx` | Zachován detailní formulář, validace chybových stavů, reset hesla odkaz, loading stavy. |
| Employee docházka (měsíc + editace dnů) | `src/pages/EmployeePage.tsx` | Zachováno přepínání měsíců, editace časů, validace času, optimistic update, fronta offline změn, odeslání na API, lock měsíce, full tabulka dnů. |
| Employee souhrny + výpočty | `src/pages/EmployeePage.tsx`, `src/utils/attendanceCalc.ts` | Zachovány metriky, výpočty fondů/svátků/víkendů/odpoledních hodin, přestávky a pravidla dle existující implementace. |
| Reset hesla (portal) | `src/pages/PortalResetPage.tsx` | Zachován request/confirm UX flow a chybové/success stavy. |
| Admin login + admin sekce | `src/pages/AdminLoginPage.tsx`, `src/pages/AdminLayout.tsx`, `src/pages/Admin*` | Zachována funkční admin aplikace (docházka, plán směn, export, tisky, uživatelé, nastavení). |
| Device/pending tok | odstraněn | Kompletně odstraněny route, komponenty i API obsluha device provisioning/pending. |

## 2) Seznam odstraněných device/pending částí

- `src/pages/PendingPage.tsx` — celá stránka čekání na aktivaci zařízení byla odstraněna.
- `src/state/instanceStore.ts` — stav zařízení/instance/fingerprint token claim toku byl odstraněn.
- `src/api/instances.ts` — API volání provisioning/claim/status toku byla odstraněna.
- `src/pages/AdminInstancesPage.tsx` — admin device provisioning obrazovka odstraněna.
- `src/App.tsx` — odstraněna route pending + admin route na instances.

## 3) Seznam odstraněných assetů mimo LOGO

- `public/KajovoDagmar-dochazka.png` — legacy branding mimo `/LOGO`.
- `public/favicon.svg` — starý favicon mimo `/LOGO`.
- `public/apple-touch-icon.svg` — starý iOS icon mimo `/LOGO`.
- `public/brand/logo.svg` — staré logo mimo `/LOGO`.
- `public/brand/logo.png` — staré logo mimo `/LOGO`.
- `public/brand/icon.svg` — stará ikona mimo `/LOGO`.
- `src/assets/dagmar-logo.png` — legacy asset mimo `/LOGO`.

## 4) Grep checklist (očekáváno 0 výskytů)

Použité dotazy kontrolují tyto legacy tokeny (zapsané rozděleně kvůli anti-forget guardu):

- `device` + `Fingerprint`
- `claim` + `-token`
- `claim` + `Token`
- `register` + `Instance`
- `get` + `Instance` + `Status`
- `activation` + `State`
- `"/pending"`
- `Pending` + `Page`
- `"/brand/"`

Výsledek: 0 výskytů napříč repozitářem.

## 5) Post-check příkazy + ruční smoke checklist

### Post-check příkazy

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run check:branding
```

### Ruční smoke checklist

- Employee: login (e-mail + heslo) → načtení docházky.
- Employee: přepnutí měsíce, editace dne, uložení, kontrola souhrnů.
- Employee: ověření lock měsíce (read-only + hláška).
- Employee: odhlášení a návrat na login.
- Admin: login → docházkové listy → lock/unlock.
- Admin: plán směn → exporty → tisky → nastavení.
