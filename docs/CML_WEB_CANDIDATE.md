# KájovoDocházka v CML – vývojový kandidát

Webové UI `app/web_ui/` je nové a používá existující docházkové endpointy i výpočty. Není přepnuté do produkce. Původní pracovní kopie s jiným rozpracovaným redesignem nebyla změněna.

`CmlWebBoundary` obsluhuje `/cml-web/` jen při explicitním veřejném klíči v `CML_WEB_JWKS_PATH`. Každý požadavek ověřuje přes issuer `https://kajovocml.hcasc.cz`, audience `dochazka`, metodu, přesnou cestu s query, hash těla a desetisekundovou platnost. Replaye blokuje tabulka `cml_web_nonce`, která vzniká Alembic migrací `2026_10_30_0029`. Veřejný JWKS není credentials jiného MCP.

Podepsaný stav se vkládá výhradně do ASGI state po úspěšném ověření a spotřebování nonce. Browserová hlavička nemůže nastavit `cml_admin`, `cml_user_id` ani `cml_web_claims`. Zaměstnanecké požadavky se znovu vážou na původní aktivní `PortalUser` a `Instance`; endpointové kontroly úvazku a zámků zůstávají zachované. Stávající cookie, integrační a nativní přístupy nejsou tímto kandidátem odstřižené.

Společné logo, font a piktogramy načítá vložené UI z veřejných brand assets CML. Žádná původní frontendová komponenta nebyla převzata. `tests/cml_local_server.py` je výslovně zapínaný loopback kvalifikační host s izolovanou syntetickou DB a skutečnými backendovými routami; není produkční aplikace ani doklad živých produkčních účinků.

Neuzavřeno zůstává úplné pokrytí předloh a jazyků, část provozní administrace, centrální správa úvazků, převod identit a jejich hesel, uzavření přímých browserových vstupů, design gate, publikace na main a produkční nasazení. Není přípustné tyto části vydávat za dokončené na základě testu několika nových obrazovek.

Centrální CML detail účtu spravuje úvazky přes původní `/api/v1/admin/users/{id}/employments` a `/api/v1/admin/employments/{id}`. Podepsané routy účtů a úvazků připouštějí jen hlavního správce; zápisy vyžadují aktuální `reauthUntil`. Lokální heslové a resetovací toky jsou pro tuto cestu odmítnuté. Explicitní `end_date: null` ruší konec platnosti, vynechané pole jej zachovává. Nejasná odpověď nesmí sama vyvolat nový zápis. Při zúžení období zůstává původní kontrola a samostatné potvrzení navázaných dat.

Generátor manifestu vždy preferuje vlastní checkout před jinou editable instalací nebo cizím PYTHONPATH. CLI kontrola to ověřuje ze samostatného pracovního adresáře. Kvalifikační host zahrnuje skutečné administrační routy; nevytváří náhradní výpočty.
