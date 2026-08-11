# Administrace integračních klientů

Administrace vytváří samostatné klienty, jednorázově předává tajnou část tokenu a v databázi uchovává pouze hash a bezpečný prefix. Rotace staré tajemství revokuje. Klienta lze deaktivovat, znovu aktivovat nebo definitivně revokovat.

## Oprávnění

Uložit lze pouze scopes, které mají aktivní a vynucenou integrační routu. Povinný `integration:health` je součástí každého profilu. Profily používají jen aktivní kombinace:

- pouze health;
- čtení úvazků, eventů a zámků;
- úplné read-only včetně chráněného OpenAPI.

Scopes bez endpointu nelze aktivovat. Migrace `0026` je odstranila i ze stávajících klientů a zapsala auditní změnu.

## Datový rozsah

Správce musí zvolit přesně jeden z režimů `ALL_EMPLOYMENTS`, `ALL_ACTIVE_EMPLOYMENTS`, `SELECTED_EMPLOYEES` nebo `SELECTED_EMPLOYMENTS`. Selektivní režim bez výběru je neplatný při správě klienta a deny-by-default při runtime načtení starých nebo nekonzistentních dat.

Každá změna scopes nebo datového rozsahu je auditovatelná. Token ani jeho hash se v seznamu, detailu ani auditu nevrací.
