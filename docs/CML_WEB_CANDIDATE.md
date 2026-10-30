# KájovoDocházka v CML – vývojový kandidát

Webové UI `app/web_ui/` je nové a používá existující docházkové endpointy i výpočty. Není přepnuté do produkce. Původní pracovní kopie s jiným rozpracovaným redesignem nebyla změněna.

`CmlWebBoundary` obsluhuje `/cml-web/` jen při explicitním veřejném klíči v `CML_WEB_JWKS_PATH`. Každý požadavek ověřuje přes issuer `https://kajovocml.hcasc.cz`, audience `dochazka`, metodu, přesnou cestu s query, hash těla a desetisekundovou platnost. Replaye blokuje tabulka `cml_web_nonce`, která vzniká Alembic migrací `2026_10_30_0029`. Veřejný JWKS není credentials jiného MCP.

Podepsaný stav se vkládá výhradně do ASGI state po úspěšném ověření a spotřebování nonce. Browserová hlavička nemůže nastavit `cml_admin`, `cml_user_id` ani `cml_web_claims`. Zaměstnanecké požadavky se znovu vážou na původní aktivní `PortalUser` a `Instance`; endpointové kontroly úvazku a zámků zůstávají zachované. Stávající cookie, integrační a nativní přístupy nejsou tímto kandidátem odstřižené.

Společné logo, font a piktogramy načítá vložené UI z veřejných brand assets CML. Žádná původní frontendová komponenta nebyla převzata. `tests/cml_local_server.py` je výslovně zapínaný loopback kvalifikační host s izolovanou syntetickou DB a skutečnými backendovými routami; není produkční aplikace ani doklad živých produkčních účinků.

Neuzavřeno zůstává úplné pokrytí předloh a jazyků, část provozní administrace, centrální správa úvazků, převod identit a jejich hesel, uzavření přímých browserových vstupů, design gate, publikace na main a produkční nasazení. Není přípustné tyto části vydávat za dokončené na základě testu několika nových obrazovek.
