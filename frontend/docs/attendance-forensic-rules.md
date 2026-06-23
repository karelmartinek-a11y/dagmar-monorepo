# Forenzní pravidla docházky

Platí od: 2026-03-13

Tento dokument popisuje nevyjednatelná pravidla pro zápis docházky ze strany uživatele. Tato pravidla se vztahují výhradně na uživatelský portál a mobilní klienty uživatele. Na administraci se tato omezení nevztahují.

## 1. Referenční čas

- Referenční datum a čas pro webovou aplikaci je čas v časové zóně `Europe/Prague`.
- Web musí přednostně použít aktuální čas z internetu.
- Pokud internetový zdroj času není dostupný, použije se backend endpoint `/api/v1/time`.
- Pokud není dostupný ani tento endpoint, frontend smí nouzově použít lokální čas prohlížeče, ale backend zůstává autoritou pro finální validaci.

## 2. Zákaz budoucích průchodů pro uživatele

- Uživatel nikdy nesmí zapsat příchod ani odchod v budoucnu.
- Toto omezení platí pro celé budoucí datum i pro dnešní datum s časem větším než je aktuální pražský čas.
- Admin může tyto hodnoty upravit bez tohoto omezení.

## 3. Pravidla pro minulost

- Uživatel může zapisovat pouze v otevřeném, administrátorem neuzavřeném měsíci.
- Pro aktuální datum může uživatel příchod i odchod opakovaně měnit.
- Pro předchozí dny smí uživatel pouze doplnit chybějící příchod nebo chybějící odchod.
- Jakmile je příchod nebo odchod na minulém dni jednou uložen, uživatel ho už nesmí měnit ani mazat.
- Prakticky to znamená, že na minulém dni může vzniknout maximálně jeden záznam příchodu a jeden záznam odchodu ze strany uživatele.

## 4. Mazání uživatele v administraci

- Administrace musí umět uživatele smazat.
- Smazání uživatele musí kaskádově smazat i jeho docházku.

## 5. Typ úvazku v administraci

- Ve správě uživatelů musí být možné přepínat typ úvazku mezi `HPP` a `DPP/DPČ`.
- Hodnota se ukládá u uživatele a používá se i pro další výpočty a tiskové výstupy.

## 6. Výstražné e-maily k plánované směně

- Pokud má uživatel plánovaný příchod a 5 minut po plánovaném příchodu nemá zapsaný příchod, odešle se e-mail s textem `Nemáš zapsaný příchod`.
- Tento e-mail se pošle celkem 5x, vždy po 10 minutách od předchozího pokusu, dokud není příchod zapsán.
- Pokud má uživatel naplánované ukončení směny a ještě 2 hodiny po něm nemá zapsaný odchod, odešle se e-mail s textem `Jsi ještě v práci? Nemáš zapsán odchod`.
- Tento druhý e-mail se pošle celkem 5x, vždy po 10 minutách, dokud není odchod zapsán.
- Další kontrola probíhá v 8:00 ráno. Pokud má uživatel za předchozí den zapsán pouze příchod bez odchodu, odešle se mu stejný dotaz.
- Ranní upozornění se pošle celkem 5x, vždy po 10 minutách, dokud není včerejší odchod doplněn.
- Výstražné e-maily se posílají na e-mail uložený u uživatele.
- Za plánování a deduplikaci těchto výstrah odpovídá backend.
