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
ověřuje 23 scénářů na desktopu a telefonu v obou enginech (92 případů).
Po souběžných zápisech různých dnů se každý výsledek znovu načte, i když
jiný zápis již obnovil stejný pohled. Dokončení starého zápisu nevrací UI
do opuštěného měsíce. Enter zachová focus buňky; Tab přejde až po potvrzeném
read-backu. Adminský plán tvoří měsíční listy vybraných úvazků se skutečným
zámkem; společná matice patří skupinovému plánu. Nabídka plánovaného dne
používá původní PUT `/api/v1/admin/shift-plan` nebo `/api/v1/shift-plan`
s nulovými časovými hranicemi. Nepoužívá docházkovou změnu stavu.
Neprázdný plánový stav vyžaduje potvrzení, prázdný stav nelze znovu mazat
a konfliktní odpověď nevyvolá automatické opakování. Vlastní plán nabízí
všechny dostupné úvazky. Denní sloupce i měsíční metriky zobrazuje pouze
z původních backendových hodnot a `display_metrics`; úkolový úvazek má
měsíční plánované hodiny i bez denních hodinových sloupců. Veškeré odpovědi a testovací zápisy jsou izolované adaptéry bez
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

## Stažení tiskových exportů

Nové UI předává PDF plánu, samostatný CSV a hromadný CSV/ZIP přes stávající typovaný CML
transport. Přímé blob stažení z opaque rámce ve WebKitu nevyvolalo download,
přestože původní backend vracel platné PDF 200. Exportní backend, jeho
oprávnění, výpočty a původní souborové bajty se nemění. Deklarace formátu,
limit a aktuální uživatelské gesto nadále ověřuje CML.

Při odmítnutém předání se zobrazí pokyn k dalšímu kliknutí na stejné tlačítko;
připravený soubor je pouze v paměti rámce a druhé gesto neopakuje POST.
Změna parametrů exportu předchozí paměťový soubor nahradí. Není to nová
strojová identita, úložiště ani oprávnění. Kvalifikace transportu je
`npm run test:cml-downloads` (místně také `CML_BROWSER_ENGINES=chromium,webkit`).
Reálné UI/gateway průchody v CML používají původní routery a syntetickou DB,
nikoli produkční data či zápisy.

Úplná přejímka tisku zůstává **ODLOŽENO PO PRVNÍM NASAZENÍ**. Původní
backendové PDF je rastrové a zachovává starší značku KájovoDagmar; toto
není nový vizuálně převzatý frontend ani potvrzení plné přístupnosti PDF.

Měsíční souhrn skutečné docházky používá zalamování metrik, aby dlouhé
hodnoty nezmizely za levým okrajem mobilního panelu. `test:cml-periods`
kontroluje obdélníky všech metrik také na 390/320 px; čísla a součty nadále
pocházejí výhradně z backendu.


## Výběr a náhledy sestav

`app/web_ui/printing.js` je nově napsané UI podle dodané předlohy. Nabízí
výběr docházky / plánu, detailní / souhrnné docházky, měsíce a úvazků.
Výchozí výběr obsahuje všechny dostupné aktivní úvazky; explicitní prázdný
výběr zůstává prázdný. Změna typu či měsíce nabídku znovu načte. Tento
výběr nezapisuje uloženou adminskou volbu plánu služeb.

Bílé náhledy čtou původní `GET /api/v1/admin/attendance/month`, zobrazují
kanonické `display_metrics`, denní/měsíční hodnoty a `planned_hours`, včetně
úkolových úvazků bez hodinových sloupců. Detail má jeden den na řádku a
zachovává všechny průchody, i více než osm. Případný celodenní stav neskrývá existující průchody. Souhrn neobsahuje denní tabulku.
Plán zobrazuje plánované časy a plánové stavy. Chybějící vybraný úvazek je
chyba, nikoli tichý neúplný dokument. Tisk lze otevřít až po načtení dat.
Původní backendové PDF plánu zůstává samostatně dostupné a beze změny.

Export má vlastní navigační položku a volbu všech úvazků (ZIP) nebo jednoho
úvazku (CSV). Používá původní export GET s `month` a právě jedním z
`employment_id` / `bulk=true`; nemění události, zámky ani plán.
Transport odmítá prázdné/nadměrné soubory, neplatnou PDF/ZIP hlavičku a NUL
v CSV. Při opožděném souboru zůstává druhé gesto bez dalšího exportního POST.

`CML_BROWSER_ENGINES=chromium,webkit npm run test:cml-prints` ověřuje nové
selektory, rozdíl obou variant, deset průchodů, úkolové hodiny, neplatný měsíc,
CSV/ZIP, tiskové styly a odmítnutí běžného uživatele na 1440/768/390 px.
Samostatný renderer používá izolované odpovědi. Test v CML repozitáři navíc
čte původní routery přes podepsanou gateway a stahuje skutečné exporty ze
syntetické DB. Nejde o hotelové produkční zápisy ani úplnou přejímku tisku.
Úplná vizuální, tisková a přístupnostní matice zůstává
**ODLOŽENO PO PRVNÍM NASAZENÍ**.


## Přehled a informace o integraci

Přehled správce čte původní seznam uživatelů a integračních klientů, počítá
položky a jejich původní `is_active` / `status=ACTIVE`; neoznačuje je za
přihlášené uživatele. Nepovolený nebo nedostupný seznam zůstává N/A a ostatní
karty se mohou načíst samostatně. Systém odpovídá pouze po úspěšném skutečném
liveness GET. Provozní odkazy otevřou existující docházku, plán a export.

Podepsaná CML hranice dovoluje vedle původního namespace přesně GET
`/api/version` pro zobrazení skutečné verze a prostředí. Zachovává ověření
identity, audience, originu, metody, cesty, podpisu a jednorázovosti. Není to
obecná výjimka pro `/api/*`, nové přihlášení ani přístup k integracím.

Integrace a doprovodná dokumentace zobrazují skutečné cesty a vymezení
samostatného tokenu. Chráněné `GET /api/v1/integration/openapi.json` zůstává
pod původním ověřením tokenu a jeho scope. Odchylka od ilustračního tlačítka
v předloze: web nesbírá token a nestahuje schema pomocí cizího přístupu;
zobrazuje přesný požadovaný endpoint a důvod omezení. Nejsou zde vymyšlené
formuláře pro správu tokenů. Uživatelská dokumentace je uvnitř CML dostupná
i běžnému uživateli; administrativní přehled a integrace zůstávají správcům.

`CML_BROWSER_ENGINES=chromium,webkit npm run test:cml-admin-info` ověřuje
počty, skutečný/odmítnutý liveness, N/A, obnovení, provozní odkaz, dokumentaci
a běžného uživatele na 1440/768/390 px. Test hranice samostatně odmítá jiné
metody i sousední cesty technického metadata endpointu. Kvalifikační server
používá původní users a integrations routery; jeho verze a liveness výslovně
popisují izolovaný testovací host. Původ produkční verze se ověřuje zvlášť.
Úplná matice stavů, jazyků a design gate zůstává
**ODLOŽENO PO PRVNÍM NASAZENÍ**.

## Časové buňky a potvrzení změn

Nové zadávání sdílí plán, skupinový plán i skutečná docházka. Podporuje
`8 → 08:00`, `1120 → 11:20`, `800 → 08:00`, `16 → 16:00`. Enter a
opuštění buňky ukládají; Tab přejde na následující čas až po potvrzení.
Delete maže celý údaj, Escape ruší rozepsanou změnu. Neplatná hodnota
ani chyba uložení nesmí přesunout fokus. Zelený lem následuje až po
kanonickém čtení; červený značí chybu. Ztracené potvrzení se neopakuje
zápisem a lze opustit pomocí Escape a obnovit čtením.

Zámky zachovávají původní API a rozsah úvazku. Při neověřeném výsledku
se buňky zablokují do čerstvého načtení. Tisky nadále přebírají metriky
z backendu. Regrese `test:cml-clock`, `test:cml-periods`, `test:cml-prints`.

Místní kvalifikace: nový editor v Chromiu/WebKitu ověřuje převody, Enter,
Tab, Delete, Escape, blokování přesunu fokusu a ztrátu následného čtení
bez druhého zápisu. Plánové regrese pokrývají souběh, období, zámky
a chybu read-backu; tisky a exporty zachovávají původní backendová data.
Lint, typecheck, unit testy a build prošly. Produkční přijímací kontrola
neprovádí testovací zápisy do skutečné docházky.

Při kontrole logu kvalifikace byl odhalen neúspěšný test, který starší shellová
pipeline nezohlednila v návratovém kódu. Backendový krok nyní používá Bash
s pipefail. Závislost správce dostává stejné nastavení aplikace jako login;
regrese ověřuje odlišný výchozí klíč procesu bez oslabení autentizace.
Původní běh 41349280391 není použit jako úspěšná kvalifikace ani nasazen.
