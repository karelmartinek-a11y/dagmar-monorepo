# Delegovaná centrální správa účtů

CML správce s users.access používá účelový podepsaný grant kajovo-user-administration/1 pod skutečným user:UUID. Nemusí mít osobní hotelový/docházkový profil. Identita je omezena na přípravu profilu a kontaktní údaje, role, aktivaci či úvazky; žádná jiná provozní agenda není tímto grantem dostupná. Heslo a MFA spravuje pouze CML. Zápis stále vyžaduje čerstvé ověření, CSRF a původní trvalou účtenku.
