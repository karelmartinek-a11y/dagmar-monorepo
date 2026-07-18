# Kalendářní data zaměstnaneckého portálu

Zaměstnanecký portál odděluje české veřejné svátky od jmenin a církevních připomínek. Produkční aplikace používá pouze verzovaný soubor `web/src/data/calendar-snapshot.json`; za běhu nic nestahuje ani nescrapuje.

- České jmeniny: `namedays-cs` 1.2.1, MIT, pinovaný snapshot. Ve dnech veřejných svátků zůstávají jmeniny samostatným údajem.
- Slovenské jmeniny: *Oficiálne kalendárium 2025* Ministerstva kultury Slovenské republiky.
- Německé údaje: katolický *Heiligen- und Namenstagskalender* na `namenstage.katholisch.de`. Jde o zvolenou církevní variantu, nikoli zákonný jednotný německý kalendář.
- Anglické údaje: observance z *Common Worship Calendar* Church of England. UI je označuje jako „Commemoration“, nikoli jako britský osobní nameday nebo zákonný státní standard.
- Hindi: jmeniny ani umělý ekvivalent se nezobrazují.

České veřejné svátky vycházejí ze zákona č. 245/2000 Sb., včetně Velkého pátku a Velikonočního pondělí. Datum a český právní význam jsou ve všech jazycích stejné; překládá se pouze název.

Snapshot se obnovuje údržbovým skriptem `scripts/generate_calendar_snapshot.py`. Vstupní text slovenského PDF musí být před generováním ručně zkontrolován a výsledný diff projít věcnou revizí. Skript není součástí runtime ani deploye.
