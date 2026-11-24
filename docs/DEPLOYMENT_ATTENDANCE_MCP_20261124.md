# Přejímka MCP KájovoDocházka 24. 11. 2026

Produkční backend běží ze zdroje `d6b9091a93635c47018a69717ad90411875b76a0`.
Přejímka proběhla přes `https://dagmar.hcasc.cz/mcp` protokolem `2025-11-25`.
Produkční databáze má Alembic revizi `2026_11_24_0035`. Před migracemi byly
ověřené PostgreSQL zálohy. Kontrola denních metrik po migracích nehlásila změny.
Nginx směruje MCP a OAuth přes vyhrazený include. Běžný webový vstup dál vede do CML.

[GitHub CI pro nasazený backend](https://github.com/karelmartinek-a11y/dagmar-monorepo/actions/runs/45428920573).

## Ověření

- Oficiální MCP klient načetl oba veřejné katalogy a provedl čtení. Zápisové nástroje jsou dostupné v odpovídajícím OAuth profilu. Volání účtenky v čtecím profilu skončilo odmítnutím.
- Živá dynamická registrace a PKCE přesměrovaly na souhlas v CML. Dočasná registrace i její žádost byly odstraněny. Přihlášený CML prohlížeč načetl stránku souhlasu a ověřil odmítnutí chybějící žádosti.
- Produkční ZIP měl 22 B a PDF vybraného úvazku 281 143 B. U obou se shodovala délka i SHA-256 uloženého souboru. Anonymní stažení bylo odmítnuto. Soubory a dočasná ověřovací oprávnění byly odstraněny.
- V izolovaných DB proběhly zápis a čtení průchodů, odlišení plánu od skutečnosti, změny členství, odmítnutí zastaralé verze, zápis a účtenka v jedné transakci, souběžné opakování v PostgreSQL a stažení souboru přes platný podepsaný CML vstup včetně expirace.
- V ChatGPT byl připojen soukromý čtecí plugin s rozsahem `attendance:read` přes dynamickou registraci klienta a potvrzení v CML. ChatGPT skutečně zavolal `shift_groups_list` pro listopad 2026 s limitem 1 a vrátil jednu položku. [Plugin](https://chatgpt.com/plugins/plugin_asdk_app_6b060bdc78848191935dffb46e4654a6) · [Zkušební chat](https://chatgpt.com/local/6b060d12-6890-83eb-880b-de704390f07d)
- Odhady vycházejí z živého katalogu a tokenizeru `o200k_base`. ChatGPT počet vstupních tokenů v ověřovacím chatu nezobrazil.

## Katalog

| Profil | Nástrojů | Definice v B | Odhad tokenů |
| --- | ---: | ---: | ---: |
| Čtecí vlastník | 7 | 8 365 | 2 191 |
| Rozšířený vlastník | 18 | 21 259 | 5 574 |
| Instrukce v obou profilech | | 115 | 40 |

U stejné původní čtveřice nástrojů klesl katalog ze 7 222 na 5 625 B
a odhad z 1 847 na 1 473 tokenů. Názvy a vlastní validační schémata
zůstávají kompatibilní.
