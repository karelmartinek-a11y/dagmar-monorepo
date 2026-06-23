# Interní správa integračních klientů

Tento soubor je interní provozní dokumentace. Není určený pro veřejné vystavení bez dalšího očištění.

## Kde se klienti spravují

Primární cesta:

- admin web `https://dagmar.hcasc.cz/admin/integrace`

Fallback:

- CLI skript `python scripts/manage_integrations.py`

## Co umí admin web

Admin sekce `/admin/integrace` aktuálně podporuje:

- přehled všech integrací se stavem, lidsky čitelnými oprávněními, rozsahem dat, IP režimem, expirací a posledním použitím
- detail integrace rozdělený na základní údaje, oprávnění, rozsah dat, bezpečnost, token a auditní informace
- vytvoření nové integrace, kde správce ručně píše pouze název integrace
- validovaný výběr oprávnění pomocí checkboxů
- předpřipravené profily oprávnění pro typické read-only scénáře
- validovaný výběr datového rozsahu:
  - všechny aktivní úvazky
  - kompatibilitní režim pro všechny úvazky
  - vybraní zaměstnanci
  - vybrané úvazky
- zobrazení, že docházka, plán služeb a zámky se vždy vážou na `employment_id`
- validovaný výběr IP režimu bez volného textového pole
- validovaný výběr expirace včetně date pickeru pro vlastní datum
- zobrazení fingerprintu a `last4`
- zobrazení plaintext tokenu pouze jednou po vytvoření nebo rotaci
- rotaci tokenu
- deaktivaci klienta
- opětovnou aktivaci klienta
- revokaci aktivního tokenu
- auditní přehled posledního použití, poslední chyby, poslední cesty a bezpečně zkrácené IP

## Vytvoření klienta v admin UI

1. Přihlaste se do adminu.
2. Otevřete `/admin/integrace`.
3. Vyplňte název integrace.
4. Volitelně vyberte profil oprávnění nebo ručně zaškrtněte potřebné checkboxy.
5. Vyberte datový rozsah ze schválených možností.
6. Pokud je rozsah omezený na zaměstnance nebo úvazky, vyberte konkrétní položky ze seznamu.
7. Vyberte režim IP omezení.
8. Vyberte režim expirace a případně datum expirace.
9. Odešlete formulář.
10. Zobrazený plaintext token bezpečně předejte partnerovi. Později už se v UI znovu neukáže.

## Oprávnění a profily

Admin UI nepřijímá ručně psané raw scope stringy. Každé oprávnění má český název, nápovědu a popis rizika.

Aktuálně používané scope:

- `integration:health`
- `employments:read`
- `shift_plan:read`
- `attendance:read`
- `punches:read`
- `locks:read`
- `openapi:read`

Scope `changes:read` zůstává v seznamu jen jako nedostupná budoucí volba. UI ji neumožní uložit, protože endpoint `/api/v1/integration/changes` není implementovaný.

## Rozsah dat

Klient může být omezený jedním z těchto režimů:

- `ALL_ACTIVE_EMPLOYMENTS`: dynamicky zahrne všechny aktivní úvazky
- `ALL_EMPLOYMENTS`: kompatibilitní režim pro starší klienty, zahrne i neaktivní úvazky
- `SELECTED_EMPLOYEES`: jen vybraní zaměstnanci, volitelně včetně neaktivních úvazků těchto osob
- `SELECTED_EMPLOYMENTS`: jen přesně vybrané úvazky

Poznámky:

- docházka, plán služeb i zámky jsou v API vždy vedené podle `employment_id`
- rozdíl mezi osobou a úvazkem musí být v UI zachovaný
- při výběru úvazků se používají lidské popisky odvozené z jména, typu úvazku a názvu úvazku

## IP omezení

Admin UI nepovoluje ruční psaní IP adres do hlavního formuláře.

Dostupné režimy:

- `NONE`: bez IP omezení
- `SERVER_MANAGED`: technický správce drží allowlist mimo tuto obrazovku

Pokud klient už má technicky nastavený allowlist, detail ukáže, že IP omezení je spravované mimo UI. Pro běžné správce se allowlist přímo needituje.

## Expirace

Admin UI nabízí:

- bez expirace
- 30 dní
- 90 dní
- 1 rok
- vlastní datum přes date picker

Backend výběr vždy znovu validuje. Vlastní datum musí ležet v budoucnosti.

## Rotace tokenu

Rotace v implementaci znamená:

- všechny dosud aktivní secrety klienta dostanou `revoked_at` a `rotated_at`
- vygeneruje se nový plaintext token
- partner musí začít používat nový token
- starý token se pak na API projeví jako `401 invalid_token`

## Deaktivace klienta

Akce `Deaktivovat` mění status klienta na `DISABLED`.

Chování v API:

- požadavky s jinak platným tokenem vracejí `403 client_disabled`

## Aktivace klienta

Akce `Aktivovat` vrací status klienta na `ACTIVE`.

Podmínka:

- klient musí mít vybrané alespoň jedno platné oprávnění

## Revokace tokenu

Akce `Revokovat`:

- nastaví `revoked_at` na všech aktivních secretech klienta
- přepne klienta do stavu `REVOKED`

Chování v API:

- dosavadní token se projeví jako `401 invalid_token`

## Audit log

Integrační požadavky se zapisují do audit logu s těmito typy údajů:

- `request_id`
- čas požadavku
- HTTP metoda
- cesta
- hash query stringu
- zdrojová IP
- user-agent
- status kód
- error code
- počet vrácených řádků
- doba zpracování

Externímu partnerovi se nemají předávat názvy interních tabulek ani interní dotazy. Pro provozní ověření ale počítejte s tím, že audit log existuje a je ukládán na backendu.

## CLI fallback

Bezpečné příklady použití:

```bash
python scripts/manage_integrations.py list
python scripts/manage_integrations.py create --name "partner-mzdy" --scopes "integration:health,employments:read,attendance:read"
python scripts/manage_integrations.py rotate 1
python scripts/manage_integrations.py disable 1
python scripts/manage_integrations.py enable 1
python scripts/manage_integrations.py revoke 1
```

Pozor:

- výstup `create` a `rotate` vypíše plaintext token
- plaintext token nekopírujte do issue trackeru, wiki, ticketu ani commitu
- po předání partnerovi uložte pouze fingerprint a `last4`, ne plaintext

## Bezpečné předání tokenu třetí osobě

- používejte jednorázový zabezpečený kanál
- nesdílejte token v běžném e-mailovém vlákně bez šifrování
- nesdílejte screenshot tokenu ve skupinových chatech
- partnerovi předejte i informaci o scope, povoleném rozsahu a IP režimu
