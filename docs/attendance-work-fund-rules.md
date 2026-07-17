# Pravidla pracovního fondu a měsíčních součtů

Datum ověření: 17. 7. 2026

## Autoritativní zdroje

- MPSV: https://mpsv.gov.cz/zamestnanci-info
- Zákoník práce (262/2006 Sb.): https://www.zakonyprolidi.cz/cs/2006-262
- Zákon o státních svátcích (245/2000 Sb.): https://www.zakonyprolidi.cz/cs/2000-245
- SÚIP: https://www.suip.cz/web/oip05/informace-o-vysilani-pracovniku
- MPSV, rozvrhování pracovní doby u DPP/DPČ: https://mpsv.gov.cz/cms/documents/42c998d4-fda7-f860-2d58-eeae8fe8eeba/Pr%C3%A1vn%C3%AD%2B%C3%BAprava%2Bdohod%2Bo%2Bprac%C3%ADch%2Bkonan%C3%BDch%2Bmimo%2Bpracovn%C3%AD%2Bpom%C4%9Br%2Bpo%2Btranspozi%C4%8Dn%C3%AD%2Bnovele%2Bz%C3%A1kon%C3%ADku%2Bpr%C3%A1ce.pdf
- ČSSZ, ošetřovné: https://www.cssz.cz/web/cz/osetrovne

## Převod do systému

- Systém odděluje evidenční údaje od právního a mzdového posouzení.
- `ODPRACOVÁNO` je součet kompletních intervalů docházky v minutách.
- Neúplný interval se do denního součtu nezapočítá a den se označí jako `incomplete`.
- Běžná přestávka na jídlo a oddech se do odpracované doby nezapočítává; v současném datovém modelu se reprezentuje druhým párem příchod/odchod.
- Práce přes půlnoc se při měsíčních součtech i denních totalizacích rozděluje do správných kalendářních dnů.
- `ODPOLEDNÍ` používá administrátorské nastavení `app_settings.afternoon_cutoff_minutes`.
- `VÍKENDY + SVÁTKY` je součet skutečně odpracovaných minut v sobotu, neděli nebo český státní svátek včetně Velkého pátku a Velikonočního pondělí.
- `PRACOVNÍ FOND` se počítá po dnech v rámci platnosti úvazku:
  - `HPP`: 8 hodin za pracovní den, bez víkendů a svátků.
  - `DPP_DPC`: dokud model neobsahuje smluvní týdenní rozsah, používá se jako provozní fond součet plánovaných směn. Tím systém nevydává právní závěr o povinném rozsahu práce, pouze stabilizuje soulad UI, API a tisku.
- `DOVOLENÁ` se nyní zobrazuje jako dny i hodinový ekvivalent z plánované směny v daném dni.
- `NEMOC` se vede po dnech.
- `PARAGRAF` se vede jako celodenní attendance status a v měsíčním souhrnu se aktuálně převádí do hodin podle denního fondu dne; to je provozní aproximační pravidlo, nikoli mzdové rozhodnutí.
- Průběžná kontrola odpracované doby pro aktuální měsíc porovnává skutečnost proti fondu pouze do předchozího pražského dne; rozpracovaný dnešek se do upozornění nezapočítává.

## Omezení současného modelu

- Repo nyní neobsahuje explicitní smluvní týdenní nebo denní úvazek mimo rozlišení `HPP` a `DPP_DPC`.
- Pokud bude potřeba přesnější fond pro zkrácené úvazky nebo individuální pracovní režimy, je nutné doplnit samostatný údaj do modelu `Employment` a promítnout jej do administrace i migrací.
