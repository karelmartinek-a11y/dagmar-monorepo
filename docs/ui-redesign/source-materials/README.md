# Zdrojové podklady UI redesignu

Tento adresář obsahuje přesné kopie podkladů použitých pro generační náhradu UI systému KájovoDagmar.

## Inventář

| Cílový soubor v repozitáři | Původní název | Typ | Velikost | Stran | Účel | Závaznost | Vztah k obrazovkám | Známé rozpory | Priorita |
| --- | --- | --- | ---: | ---: | --- | --- | --- | --- | --- |
| `frontendui_design_briefs(1).docx` | `frontendui_design_briefs(1).docx` | DOCX | 123 297 B | 50 | Funkční briefy po pohledech a rolích | Vysoká pro funkční pokrytí | `EMP-01` až `EMP-05`, `AUTH-01`, `ADM-01` až `ADM-11`, `NAV-01`, `PUB-01` | Dokument sám odkazuje na forenzní zdroje v kódu; neobsahuje hotové vizuální tokeny | 1 pro funkce a stavy |
| `KajovoDagmar_graficky_manual(2).pdf` | `KajovoDagmar_graficky_manual(2).pdf` | PDF | 1 249 766 B | 20 | Grafický a produktový design manuál | Vysoká pro design systém | Branding, shell, tabulky, buňky, formuláře, mobilní transformace, tokeny | Manuál popisuje obecný systém, ne všechny konkrétní routy | 1 pro vizuální systém |
| `novadagmar_kontrastnejsi(1).docx` | `novadagmar_kontrastnejsi(1).docx` | DOCX | 17 871 860 B | 33 | Vizuální katalog obrazovek a stavů | Vysoká pro konkrétní layouty | Zaměstnanecké a admin pohledy včetně stavových variant | Zadání v příloze mluví o `novadagmar.pdf`, ale skutečně dodaný soubor je DOCX s 33 stránkami | 1 pro konkrétní obrazovky |

## Čitelnost a kontrola

- `KajovoDagmar_graficky_manual(2).pdf` byl ověřen přes `pdfinfo` a vizuálně prohlédnut po vyrenderování všech 20 stran.
- `frontendui_design_briefs(1).docx` byl textově extrahován a vizuálně vyrenderován do 50 stran.
- `novadagmar_kontrastnejsi(1).docx` má minimální extrahovatelný text, proto byl jako hlavní zdroj použit vizuální render všech 33 stran.

## Klíčová rozhodnutí o prioritě zdrojů

1. Funkční kontrakt má přednost v repozitářovém kódu a backendu.
2. `frontendui_design_briefs(1).docx` je primární autorita pro rozsah stavů, toků a odpovědností pohledů.
3. `KajovoDagmar_graficky_manual(2).pdf` je primární autorita pro značku, typografii, paletu, sémantické stavy, hustotu, shell a komponentový jazyk.
4. `novadagmar_kontrastnejsi(1).docx` je primární autorita pro konkrétní hi-fi kompozice obrazovek a jejich stavové výřezy.
5. Pokud se vizuální podklad rozchází s backendovým kontraktem, funkce se zachová a převede do vizuálního systému bez oslabení backendových invariantů.

## Souhrn obsahu

- `frontendui_design_briefs(1).docx`: detailní briefy pro zaměstnance, reset hesla, admin shell, dashboard, uživatele a úvazky, docházku, plán služeb, exporty, tisky, preview PDF, nastavení, zařízení, integrace a veřejnou dokumentaci.
- `KajovoDagmar_graficky_manual(2).pdf`: logo, zakázané varianty, typografie Montserrat, dark-first paleta, sémantické stavy, rozestupy, rádiusy, shell, datové buňky, detailové formuláře, mobilní transformace a přístupnost.
- `novadagmar_kontrastnejsi(1).docx`: hi-fi obrazovky pro `/app`, `/reset`, `/admin/*` a `/integration-api`, včetně loading/error/offline/locked/conflict variant.
