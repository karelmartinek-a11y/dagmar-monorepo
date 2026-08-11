# Obnova databáze před migraci `2026_05_20_0011`

Migrace převádí autoritu docházky, plánů, zámků a reminderů z instance na `employment_id` a není bezpečně vratná pomocí `alembic downgrade`.

1. Zastav backend a ověř, že nepřijímá zápisy.
2. Vyber poslední ověřenou PostgreSQL zálohu vytvořenou před migrací `2026_05_20_0011`.
3. Obnov zálohu do nové izolované databáze; nepřepisuj běžící produkční databázi.
4. Ověř integritu zálohy, jedinou hodnotu `alembic_version` a smoke test kompatibilního release.
5. Přepni databázové připojení pouze během řízeného incidentního zásahu a ponech backend zastavený až do dokončení kontrol.

Obnova je incidentní operace vyžadující auditní záznam, identifikaci použité zálohy, cílového commitu a výsledků konzistenčních kontrol.
