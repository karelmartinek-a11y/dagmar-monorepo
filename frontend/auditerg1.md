# Audit ergonomie, layoutu, textů a ikon po nápravných opatřeních

## 1. Rozsah a metodika

Finální kontrola byla znovu provedena dne `20. 3. 2026` nad lokálně vyrenderovanou aplikací na viewportu `1600 × 1200`. Přerender byl udělaný po zapracování nápravných opatření do uživatelských textů, tiskového náhledu, desktopových kompozic a ikonických ovládacích prvků.

Použitá metodika:

- plný re-render hlavních obrazovek a záložek přes Playwright,
- vizuální kontrola screenshotů celé obrazovky,
- průchod DOM a ovládacích prvků se zaměřením na přetečení, useknutí a tooltipy,
- kontrola kódu změněných komponent.

Aktualizované screenshoty:

- [app-attendance.png](/C:/GitHub/dagmar-frontend/audit-artifacts/app-attendance.png)
- [app-plan.png](/C:/GitHub/dagmar-frontend/audit-artifacts/app-plan.png)
- [portal-reset-stable.png](/C:/GitHub/dagmar-frontend/audit-artifacts/portal-reset-stable.png)
- [admin-login-stable.png](/C:/GitHub/dagmar-frontend/audit-artifacts/admin-login-stable.png)
- [admin-users.png](/C:/GitHub/dagmar-frontend/audit-artifacts/admin-users.png)
- [admin-dochazka-selected.png](/C:/GitHub/dagmar-frontend/audit-artifacts/admin-dochazka-selected.png)
- [admin-plan-sluzeb.png](/C:/GitHub/dagmar-frontend/audit-artifacts/admin-plan-sluzeb.png)
- [admin-export.png](/C:/GitHub/dagmar-frontend/audit-artifacts/admin-export.png)
- [admin-tisky.png](/C:/GitHub/dagmar-frontend/audit-artifacts/admin-tisky.png)
- [admin-tisky-preview-attendance.png](/C:/GitHub/dagmar-frontend/audit-artifacts/admin-tisky-preview-attendance.png)
- [admin-tisky-preview-plan.png](/C:/GitHub/dagmar-frontend/audit-artifacts/admin-tisky-preview-plan.png)
- [admin-settings.png](/C:/GitHub/dagmar-frontend/audit-artifacts/admin-settings.png)

## 2. Exekutivní závěr

Po zapracování nápravných opatření je aplikace v podstatně lepším stavu než v původním auditu.

Co je nyní splněné:

- v hlavních obrazovkách výrazně ubyly zkratky a technické tokeny přímo v UI,
- tiskový náhled už není obalený admin sidebarou ani deployment badge,
- obrazovky `Uživatelé`, `Export`, `Nastavení` a `Obnova hesla` mají čitelnější desktopovou kompozici,
- symbolová tlačítka pro posun měsíců a některé další ikonické akce mají nyní tooltip.

Co stále není zcela dořešené:

- stránka `Plán služeb` je už výrazně čitelnější, ale stále zůstává nejhustší a nejširší obrazovkou v systému,
- některé desktopové obrazovky jsou už lepší šířkově, ale stále nechávají určitou rezervu ve spodní části,
- ikonický katalog je nyní čitelnější, ale navigační piktogramy stále nemají samostatný tooltip, spoléhají na text vedle sebe.

Výsledek:

- audit už neukazuje zásadní rozpad layoutu nebo masivní přetékání prvků přes cizí kontejnery,
- audit stále neuzavírám jako úplně bezvýhradný kvůli zbytkovým ergonomickým a prezentačním nedostatkům.

## 3. Stav po nápravách

### A. Texty a zkratky

Opravené body:

- pole s časem už na relevantních obrazovkách nepoužívají `HH:MM` jako hlavní viditelný placeholder, ale srozumitelnější text,
- pracovněprávní zkratky `HPP` a `DPP / DPČ` jsou v hlavních administrativních pohledech převedené na plné názvy,
- technické stavy zařízení jsou v hlavních seznamech a kartách převedené na srozumitelné české varianty,
- řada textů typu `ID entity`, `SMTP`, `CSV`, `ZIP`, `PDF` byla v hlavních viditelných místech nahrazena produktovější formulací.

Aktuální stav:

- hlavní porušení požadavku „žádné zkratky v UI“ už není systémové jako v původním auditu,
- zůstávají jednotlivé odborné nebo strukturální výrazy tam, kde popisují formát nebo souborové jméno,
- v rámci kontrolovaných screenshotů už nevidím dominující databázové nebo interní tokeny jako předtím.

Verdikt:

- výrazné zlepšení,
- v hlavních pohledech už texty působí podstatně méně technicistně.

### B. Tiskový náhled

Pozitivní posun:

- route pro náhled už není renderovaná uvnitř admin layoutu,
- vlevo už není admin sidebar,
- v pravém dolním rohu už není deployment badge,
- globální systémová lišta aplikace už také zmizela,
- samotná stránka dokumentu je nyní vizuálně čistá a izolovaná.

Verdikt:

- zásadní zlepšení oproti původnímu stavu,
- po poslední implementaci už tento bod považuji za vyřešený.

### C. Desktopová kompozice

Největší zlepšení je vidět na:

- [admin-users.png](/C:/GitHub/dagmar-frontend/audit-artifacts/admin-users.png)
- [admin-export.png](/C:/GitHub/dagmar-frontend/audit-artifacts/admin-export.png)
- [admin-settings.png](/C:/GitHub/dagmar-frontend/audit-artifacts/admin-settings.png)
- [portal-reset-stable.png](/C:/GitHub/dagmar-frontend/audit-artifacts/portal-reset-stable.png)

Pozitiva:

- obrazovky mají nově jasný horní hero blok,
- důležité akce jsou seskupené do čitelnějších celků,
- formuláře a tabulky už nepůsobí jako osamocené malé boxy nalepené vlevo nahoře,
- boční informační nebo pomocné bloky zlepšují orientaci.

Zbytkové slabiny:

- [admin-export.png](/C:/GitHub/dagmar-frontend/audit-artifacts/admin-export.png) už využívá plochu lépe, ale stále by snesl ještě o něco silnější spodní rytmus,
- [portal-reset-stable.png](/C:/GitHub/dagmar-frontend/audit-artifacts/portal-reset-stable.png) má po rozšíření pravého panelu výrazně lepší rovnováhu, ale pořád jde o spíše minimalistickou kompozici,
- [admin-users.png](/C:/GitHub/dagmar-frontend/audit-artifacts/admin-users.png) má lepší logiku, ale tabulka s akcemi je stále hodně hustá a akční tlačítka jsou v řádku natěsnaná.

Verdikt:

- nápravné opatření funguje,
- zbytkem je už spíše kosmetika a další ergonomické dolaďování, ne strukturální rozpad.

### D. Přetečení a úplnost prvků

Na finálním renderu jsem nenašel:

- viditelný paint bleed přes hranice cizího prvku,
- přetékající text přes box jiného prvku,
- useknuté nadpisy nebo tlačítka na kontrolovaných obrazovkách,
- rozpad mřížky na obrazovkách `Uživatelé`, `Export`, `Nastavení`, `Docházkové listy`.

Rezervy:

- `Plán služeb` zůstává výjimkou, protože jeho tabulka je záměrně širší než viewport a spoléhá na horizontální scroll uvnitř kontejneru,
- to není přímé porušení hranic cizího layoutu, ale je to významná ergonomická daň.

Verdikt:

- z hlediska čistého přetečení audit nyní prochází,
- z hlediska uživatelského pohodlí stále zůstává nejcitlivější stránkou `Plán služeb`, ale po poslední úpravě je už podstatně lépe čitelná.

## 4. Hlavní zbytkové nálezy

### 4.1 Plán služeb zůstává nejnáročnější obrazovkou v systému

Zdroj:

- [admin-plan-sluzeb.png](/C:/GitHub/dagmar-frontend/audit-artifacts/admin-plan-sluzeb.png)

Nález:

- vlastní levý sloupec s výběrem osob a horní orientační lišta zlepšily orientaci,
- samostatný sloupec `Typ` už nezahušťuje tabulku,
- hlava tabulky je kompaktnější,
- přesto zůstává tabulka velmi široká a horizontální scroll je stále klíčová součást interakce.

Dopad:

- vyšší čitelnost a menší konkurenční chaos než dříve,
- stále vyšší vizuální a kognitivní nárok než u ostatních obrazovek.

Doporučení:

- zvážit pevné ukotvení jen nejnutnějších sloupců,
- zvážit rozpad tabulky do kratších úseků měsíce nebo detailu jedné osoby,
- zmenšit počet současně viditelných konkurenčních zón.

### 4.2 Některé obrazovky jsou už čitelné, ale stále ne maximálně využité

Nejvíc je to vidět na:

- [admin-export.png](/C:/GitHub/dagmar-frontend/audit-artifacts/admin-export.png)
- [portal-reset-stable.png](/C:/GitHub/dagmar-frontend/audit-artifacts/portal-reset-stable.png)

Nález:

- šířkové členění je lepší,
- ale spodní část obrazovky stále nepracuje s plochou úplně naplno,
- některé formuláře jsou vůči ploše ještě spíše střídmé.

Doporučení:

- přidat více obsahové nebo orientační struktury do spodní části,
- zvětšit některé vstupní prvky nebo lépe rozložit informační texty,
- dál ladit vertikální rytmus.

## 5. Audit po obrazovkách

### Zaměstnanec: docházkový list

Zdroj:

- [app-attendance.png](/C:/GitHub/dagmar-frontend/audit-artifacts/app-attendance.png)

Hodnocení:

- bez viditelného přetečení,
- bez destrukce layoutu,
- ovládání měsíce je čitelné,
- tooltipy pro symbolové šipky jsou doplněné.

Verdikt:

- prochází.

### Zaměstnanec: plán směn

Zdroj:

- [app-plan.png](/C:/GitHub/dagmar-frontend/audit-artifacts/app-plan.png)

Hodnocení:

- textové zkratky proti původnímu auditu ustoupily,
- pole i souhrny jsou srozumitelnější,
- rozvržení je stabilní.

Verdikt:

- prochází.

### Obnova hesla

Zdroj:

- [portal-reset-stable.png](/C:/GitHub/dagmar-frontend/audit-artifacts/portal-reset-stable.png)

Hodnocení:

- lepší hierarchie a čitelnější vstup do obrazovky,
- pravý formulářový blok je po rozšíření i doplnění pomocného boxu výrazně pevnější,
- zůstává spíše minimalistická kompozice, ne však problematická.

Verdikt:

- prochází.

### Admin: přihlášení

Zdroj:

- [admin-login-stable.png](/C:/GitHub/dagmar-frontend/audit-artifacts/admin-login-stable.png)

Hodnocení:

- stabilní,
- bez přetékání,
- bez problematických zkratek.

Verdikt:

- prochází.

### Admin: uživatelé

Zdroj:

- [admin-users.png](/C:/GitHub/dagmar-frontend/audit-artifacts/admin-users.png)

Hodnocení:

- zřetelně lepší než v původním auditu,
- plné názvy pracovních typů pomáhají čitelnosti,
- kompozice dává na široké obrazovce větší smysl,
- akční tlačítka v tabulce jsou ještě dost hustá.

Verdikt:

- prochází s menší ergonomickou rezervou.

### Admin: docházkové listy

Zdroj:

- [admin-dochazka-selected.png](/C:/GitHub/dagmar-frontend/audit-artifacts/admin-dochazka-selected.png)

Hodnocení:

- stabilní rozložení,
- ovládací prvky mají doplněné tooltipy tam, kde je to důležité,
- bez viditelného přetékání.

Verdikt:

- prochází.

### Admin: plán služeb

Zdroj:

- [admin-plan-sluzeb.png](/C:/GitHub/dagmar-frontend/audit-artifacts/admin-plan-sluzeb.png)

Hodnocení:

- technicky drží pohromadě,
- vlastní levý sloupec a horní orientační lišta snižují chaos mezi výběrem osob a tabulkou,
- kompaktnější hlava a odstranění samostatného sloupce `Typ` zlepšily čitelnost,
- široká tabulka ale stále snižuje komfort při práci s celým měsícem.

Verdikt:

- nepropadá se vizuálně,
- po poslední úpravě prochází lépe, ale stále zůstává největším ergonomickým dluhem systému.

### Admin: export

Zdroj:

- [admin-export.png](/C:/GitHub/dagmar-frontend/audit-artifacts/admin-export.png)

Hodnocení:

- výrazně lepší texty a kompozice,
- důležité akce jsou čitelněji seskupené,
- doplněné kontrolní a vysvětlující bloky zlepšily využití spodní části stránky.

Verdikt:

- prochází.

### Admin: tisky

Zdroj:

- [admin-tisky.png](/C:/GitHub/dagmar-frontend/audit-artifacts/admin-tisky.png)

Hodnocení:

- krokové členění je čitelnější než dříve,
- texty jsou srozumitelnější,
- práce s výběrem je přehledná.

Verdikt:

- prochází.

### Admin: nastavení

Zdroj:

- [admin-settings.png](/C:/GitHub/dagmar-frontend/audit-artifacts/admin-settings.png)

Hodnocení:

- výrazně lepší seskupení technických údajů,
- pomocný sloupec dává stránce strukturu,
- bez přetékání a bez zjevných kolizí prvků.

Verdikt:

- prochází.

## 6. Katalog ikon

Poznámka:

- katalog zachycuje rozlišitelné piktogramy navigace a symbolové akce, které mají samostatný význam,
- u navigačních ikon v levém admin menu není samostatný tooltip, protože význam nesou společně s textovým štítkem vedle ikony.

### 6.1 Brand mark v systémové liště

a) UI umístění: horní systémová lišta aplikace  
b) Název a jedinečné označení: `brand-top-right-mark`  
c) Obrázek:

![brand-top-right-mark](/C:/GitHub/dagmar-frontend/audit-artifacts/icons/brand-top-right-mark.png)

d) Co se stane použitím: jen vizuální identifikace značky, bez akce  
e) Tooltip: bez tooltipu

### 6.2 Brand mark na přihlašovací obrazovce

a) UI umístění: přihlášení administrace  
b) Název a jedinečné označení: `brand-login-mark`  
c) Obrázek:

![brand-login-mark](/C:/GitHub/dagmar-frontend/audit-artifacts/icons/brand-login-mark.png)

d) Co se stane použitím: jen vizuální identifikace značky, bez akce  
e) Tooltip: bez tooltipu

### 6.3 Ikona navigace Uživatelé

a) UI umístění: admin navigace / Uživatelé  
b) Název a jedinečné označení: `icon-admin-users`  
c) Obrázek:

![icon-admin-users](/C:/GitHub/dagmar-frontend/audit-artifacts/icons/icon-admin-users.png)

d) Co se stane použitím: přechod na záložku Uživatelé  
e) Tooltip: bez samostatného tooltipu, význam je doplněn textem `Uživatelé`

### 6.4 Ikona navigace Docházkové listy

a) UI umístění: admin navigace / Docházkové listy  
b) Název a jedinečné označení: `icon-admin-attendance`  
c) Obrázek:

![icon-admin-attendance](/C:/GitHub/dagmar-frontend/audit-artifacts/icons/icon-admin-attendance.png)

d) Co se stane použitím: přechod na záložku Docházkové listy  
e) Tooltip: bez samostatného tooltipu, význam je doplněn textem `Docházkové listy`

### 6.5 Ikona navigace Plán služeb

a) UI umístění: admin navigace / Plán služeb  
b) Název a jedinečné označení: `icon-admin-plan`  
c) Obrázek:

![icon-admin-plan](/C:/GitHub/dagmar-frontend/audit-artifacts/icons/icon-admin-plan.png)

d) Co se stane použitím: přechod na záložku Plán služeb  
e) Tooltip: bez samostatného tooltipu, význam je doplněn textem `Plán služeb`

### 6.6 Ikona navigace Tisky

a) UI umístění: admin navigace / Tisky  
b) Název a jedinečné označení: `icon-admin-prints`  
c) Obrázek:

![icon-admin-prints](/C:/GitHub/dagmar-frontend/audit-artifacts/icons/icon-admin-prints.png)

d) Co se stane použitím: přechod na záložku Tisky  
e) Tooltip: bez samostatného tooltipu, význam je doplněn textem `Tisky`

### 6.7 Ikona navigace Export

a) UI umístění: admin navigace / Export  
b) Název a jedinečné označení: `icon-admin-export`  
c) Obrázek:

![icon-admin-export](/C:/GitHub/dagmar-frontend/audit-artifacts/icons/icon-admin-export.png)

d) Co se stane použitím: přechod na záložku Export  
e) Tooltip: bez samostatného tooltipu, význam je doplněn textem `Export`

### 6.8 Ikona navigace Nastavení

a) UI umístění: admin navigace / Nastavení  
b) Název a jedinečné označení: `icon-admin-settings`  
c) Obrázek:

![icon-admin-settings](/C:/GitHub/dagmar-frontend/audit-artifacts/icons/icon-admin-settings.png)

d) Co se stane použitím: přechod na záložku Nastavení  
e) Tooltip: bez samostatného tooltipu, význam je doplněn textem `Nastavení`

### 6.9 Šipka na předchozí měsíc v zaměstnaneckém pohledu

a) UI umístění: zaměstnanec / horní navigace  
b) Název a jedinečné označení: `icon-month-prev`  
c) Obrázek:

![icon-month-prev](/C:/GitHub/dagmar-frontend/audit-artifacts/icons/icon-month-prev.png)

d) Co se stane použitím: přechod na předchozí měsíc  
e) Tooltip: `Předchozí měsíc`

### 6.10 Šipka na další měsíc v zaměstnaneckém pohledu

a) UI umístění: zaměstnanec / horní navigace  
b) Název a jedinečné označení: `icon-month-next`  
c) Obrázek:

![icon-month-next](/C:/GitHub/dagmar-frontend/audit-artifacts/icons/icon-month-next.png)

d) Co se stane použitím: přechod na další měsíc  
e) Tooltip: `Další měsíc`

### 6.11 Šipka exportu na předchozí měsíc

a) UI umístění: administrace / export / volba období  
b) Název a jedinečné označení: `icon-export-prev`  
c) Obrázek:

![icon-export-prev](/C:/GitHub/dagmar-frontend/audit-artifacts/icons/icon-export-prev.png)

d) Co se stane použitím: posun exportu na předchozí měsíc  
e) Tooltip: `Předchozí měsíc`

### 6.12 Šipka exportu na další měsíc

a) UI umístění: administrace / export / volba období  
b) Název a jedinečné označení: `icon-export-next`  
c) Obrázek:

![icon-export-next](/C:/GitHub/dagmar-frontend/audit-artifacts/icons/icon-export-next.png)

d) Co se stane použitím: posun exportu na další měsíc  
e) Tooltip: `Další měsíc`

## 7. Celkové vyhodnocení

Po finálním přerenderu hodnotím stav takto:

- žádný z kontrolovaných prvků nepřekračuje hranici cizího layoutu způsobem, který by rozbíjel obrazovku,
- hlavní textové zkratky a technické tokeny byly z velké části odstraněny z viditelných míst,
- ergonomie a symetrie administrace se citelně zlepšily,
- tiskový náhled už je čistý a bez globálního aplikačního chrome,
- největší otevřený ergonomický dluh dál zůstává v obrazovce `Plán služeb`.

Celkový verdikt:

- aplikace po nápravách prochází jako stabilní a podstatně vyčištěná,
- audit úplně neuzavírám jako bezchybný kvůli zbytkům v tiskovém náhledu a tvrdé ergonomii plánování směn.
