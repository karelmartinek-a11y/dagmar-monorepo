# KájovoDocházka v CML – aktuální integrace

První verze běží od 1. 11. 2026 jako sekce
`https://kajovocml.hcasc.cz/#dochazka`. Výchozí nasazený zdroj je
`cd42151c5930b4d1b90168b007f12789209b1227`; přesnou aktuální verzi vrací
`https://dagmar.hcasc.cz/api/version`. Nové samostatně napsané UI
`app/web_ui/` se dodává v backend wheelu a používá původní endpointy,
výpočty a data. Původní frontendový kód nebyl převzat.

## Vstup a nativní klienti

`CmlWebBoundary` vyžaduje veřejný klíč v `CML_WEB_JWKS_PATH` a na každém
`/cml-web/` požadavku ověřuje issuer `https://kajovocml.hcasc.cz`, audience
`dochazka`, metodu, přesnou cestu s query, hash těla a desetisekundovou
platnost. Replaye blokuje sdílená DB tabulka `cml_web_nonce`, nikoli paměť
workeru. Jen ověřený ASGI state může nést centrální identitu a roli.
Zaměstnanecký požadavek se znovu váže na aktivní `PortalUser` a `Instance`;
původní kontroly úvazku a zámků zůstávají autoritou.

Produkční `CML_BROWSER_ENTRY_ONLY=1` odmítá původní browserové cookies pro
obchodní API i administraci. Nativní instance/integration tokeny zůstávají
odděleným profilem. Browserový požadavek s Fetch Metadata/Origin nemůže
použít nativní bearer. Flag přijímá jen 0/1; 0 je pouze přípravný režim,
nikoli důkaz uzavřeného vstupu. Nesprávná konfigurace zastaví start.

Původní browserové dokumenty/assety vracejí pevné 302 do CML s no-store,
bez přenosu původních query/reset tokenů. `/api/`, `/cml-web/`, health a
stávající soubory nativních klientů zachovává skutečná Nginx konfigurace.
Podepsaná gateway se nevrací do SPA. CI balí pouze deterministický
`cml-entry.json`; původní frontend bundle není produkční fallback.

## Účty a úvazky

Sdílené identity byly importovány podle schváleného pravidla shodného
e-mailu a hesla z Docházky. Původní nativní účty a credentials se nemění.
Centrální detail účtu používá původní adminské endpointy úvazků; vyžaduje
hlavního vlastníka a pro zápis čerstvé podepsané reauth. `end_date: null`
ruší konec platnosti, vynechané pole jej zachovává. Zúžení období nadále
vyžaduje původní kontrolu a potvrzení navázaných dat.

Atomický kontrakt `kajovo-profile-provision/1` přijímá na POST
`/cml-web/api/profiles` operation ID, centrální UUID a původní profilová
pole bez hesla či nativního ID. GET se stejným ID čte účtenku a aktuální
profil. Jedinečné operace, vazba a profil vznikají jednou transakcí.
Změna argumentů stejného ID či konflikt e-mailu vrací konflikt; cizí účet
se nepřebírá. Smazání profilu nemaže účtenku ani nepovoluje nové založení
opakovaným požadavkem. Nejistý výsledek se nejprve čte, automaticky neopakuje.

Nový profil má `PortalUserRole.EMPLOYEE`, vlastní aktivní WEB Instance,
žádný automatický úvazek ani nativní heslo. CML správce je ověřená centrální
role. Limity původních sloupců jsou 128 znaků jména a 160 znaků e-mailu.
CML potvrdí vazby/granty až po read-backu; pozvánka patří konečné revizi.

## Průběžná kvalifikace

První vydání prošlo cílenými backendovými kontrolami autorizace, importu
identit a zachování native přístupů i skutečným CI `ci-cd.yml` nad zdrojem
`cd42151`. Živé ověření zahrnulo 302 do CML, 401 bez podpisu, readiness,
verzi a autorizované čtení skutečných profilů. Vlastník potvrdil reálné
centrální přihlášení včetně svého zachovaného MFA. To není úplná přejímka
všech zaměstnaneckých a zapisovacích stavů.

Následná oprava plánu odmítá opožděné odpovědi i chyby po změně období
nebo skupiny. Dotaz používá zachycené období a skupinu dostupnou v novém
seznamu. Prázdný adminský výběr zůstává prázdný při uložení i načtení.
`CML_BROWSER_ENGINES=chromium,webkit npm run test:cml-periods` z `web/`
ověřuje šest scénářů na desktopu a telefonu v obou enginech (24 případů).
Veškeré odpovědi a jediný testovací zápis jsou izolované adaptéry bez
přístupu na produkční backend. CI spouští stejný runner v Chromium.

`tests/cml_local_server.py` je oddělený loopback host se skutečnými
backendovými routami a syntetickou DB, explicitně zapínaný pomocí
`CML_LOCAL_QUALIFICATION=1`. Není produkční artefakt. Veřejný smoke
`web/scripts/cml-production-smoke.mjs` nenahrazuje autentizovanou přejímku.

Úplná vizuální matice, méně používané stavy, překlady, tisk a úplná
přístupnost jsou **ODLOŽENO PO PRVNÍM NASAZENÍ**, nikoli PASS. Předloha
zůstává cílem. Autorizace, zachování dat a hlavní funkce se tím neodkládají.

## Publikace a nasazení

Koordinovaný SSH release používá trailer `CML-Coordinated-Cutover: true`.
CI a bezpečnostní gate běží beze změny; automatický produkční job se pro
tento commit nepřepne mimo řízené nasazení. Dodává se skutečný CI wheel a
hashovaný offline wheelhouse, ověřuje se SHA a veřejné HTTPS. UI oprava
bez databázové změny nevyžaduje migraci ani přepočet skutečných metrik.
Návrat kódu neobnovuje živou DB ze zálohy. Ostatní commity zachovávají
standardní automatizační pravidla.
