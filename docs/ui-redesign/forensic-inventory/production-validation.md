# Produkční read-only validace

Datum validace: 2026-07-14
Host: `https://dagmar.hcasc.cz`

## Ověřené endpointy mimo browser

- `GET https://dagmar.hcasc.cz/api/v1/health` -> `{"ok":true}`
- `GET https://dagmar.hcasc.cz/api/version` -> `{"backend_deploy_tag":"4adfbf1","environment":"production"}`

## Ověřené browser scénáře

Použit byl in-app browser podle browser skillu.

### Veřejné routy

- `/app` načte přihlašovací obrazovku zaměstnance
- `/admin/login` načte přihlašovací obrazovku administrace

### Zaměstnanec

Proveden minimální bezpečný smoke test s hodnotami z lokálního `.env` bez vypsání tajemství:

1. otevření `/app`
2. přihlášení zaměstnance
3. ověření landing page na `/app`
4. odhlášení a návrat na login

Pozorované chování:

- login vede na zaměstnanecký měsíční docházkový list
- aktivní kontext zahrnuje vybraný `employment_id` a měsíc
- akce `Plán směn`, `Teď`, `Obnovit`, navigace měsíců a `Odhlásit` jsou přítomné

### Administrace

Proveden minimální bezpečný smoke test s hodnotami z lokálního `.env` bez vypsání tajemství:

1. otevření `/admin/login`
2. přihlášení administrátora
3. ověření landing page `/admin/prehled`

Pozorované chování:

- login vede na `/admin/prehled`
- shell obsahuje levé menu a horní akce `Nastavení`, `Zařízení`, `Odhlásit`
- dashboard zobrazuje metriky účtů a zařízení i provozní panely

## Zjištění

- Produkce odpovídá historické struktuře monorepa, nikoli ještě cílové restrukturalizaci.
- Přihlášení zaměstnance i administrace je funkční a odpovídá očekávaným routám.
- Screenshot po samotném `goto` někdy zachytil mezistav spinneru, ale DOM snapshoty i následná interakce potvrdily správné načtení obou login obrazovek.
