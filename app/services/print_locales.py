"""Presentation-only translations for backend-rendered attendance PDFs."""

MONTHS = {
    "en": "January February March April May June July August September October November December".split(),
    "sk": "január február marec apríl máj jún júl august september október november december".split(),
    "de": "Januar Februar März April Mai Juni Juli August September Oktober November Dezember".split(),
}
WORDS = {
    "Plán směn": ("Shift schedule", "Plán zmien", "Dienstplan"),
    "Měsíc": ("Month", "Mesiac", "Monat"),
    "Vygenerováno": ("Generated", "Vygenerované", "Erstellt"),
    "Strana": ("Page", "Strana", "Seite"),
    "Úvazek / osoba": ("Employment / person", "Úväzok / osoba", "Arbeitsverhältnis / Person"),
    "Časy PRŮCHOD 1, PRŮCHOD 2": ("Times ENTRY 1, ENTRY 2", "Časy PRIECHOD 1, PRIECHOD 2", "Zeiten BUCHUNG 1, BUCHUNG 2"),
    "v každé buňce shora dolů": ("top to bottom in each cell", "v každej bunke zhora nadol", "in jeder Zelle von oben nach unten"),
    "Měsíční součet (h)": ("Monthly total (h)", "Mesačný súčet (h)", "Summe (h)"),
    "Plán": ("Scheduled", "Plán", "Geplant"),
    "Odpoledne": ("Afternoon", "Popoludnie", "Nachmittag"),
    "Noc": ("Night", "Noc", "Nacht"),
    "Víkend": ("Weekend", "Víkend", "Wochenende"),
    "Svátek": ("Public holiday", "Sviatok", "Feiertag"),
    "Dovolená": ("Annual leave", "Dovolenka", "Urlaub"),
    "Nemoc": ("Sickness", "Choroba", "Krankheit"),
    "Paragraf": ("Statutory leave", "Paragraf", "Gesetzliche Freistellung"),
    "Volno": ("Day off", "Voľno", "Frei"),
    "směn": ("shifts", "zmien", "Schichten"),
    "Pracovní smlouva": ("Employment contract", "Pracovná zmluva", "Arbeitsvertrag"),
    "DPP / DPČ": ("Work agreement (DPP / DPČ)", "DPP / DPČ", "Arbeitsvereinbarung (DPP / DPČ)"),
    "Úkolová / směnová odměna": ("Task / shift-based pay", "Úkolová / zmenová odmena", "Aufgaben- / Schichtvergütung"),
    "Externí hodinová fakturace": ("External hourly billing", "Externá hodinová fakturácia", "Externe Stundenabrechnung"),
    "Legenda": ("Legend", "Legenda", "Legende"),
    "V buňce jsou chronologické plánované časy nebo celodenní stav.": ("Each cell shows chronological planned times or a full-day status.", "V bunke sú chronologické plánované časy alebo celodenný stav.", "Jede Zelle zeigt chronologische Planzeiten oder einen ganztägigen Status."),
    "Dovolená = celodenní stav z plánu směn.": ("Annual leave = full-day status from the shift schedule.", "Dovolenka = celodenný stav z plánu zmien.", "Urlaub = ganztägiger Status aus dem Dienstplan."),
    "Volno = celodenní stav bez plánované směny.": ("Day off = full-day status without a planned shift.", "Voľno = celodenný stav bez plánovanej zmeny.", "Frei = ganztägiger Status ohne geplante Schicht."),
    "Šedé buňky označují víkend, béžové státní svátek.": ("Grey cells mark weekends; beige cells mark public holidays.", "Sivé bunky označujú víkend, béžové štátny sviatok.", "Graue Zellen markieren Wochenenden, beige Zellen Feiertage."),
    "Hodiny: P plán, O odpoledne, N noc, V víkend, S svátek; DOV dovolená, NEM nemoc, PAR paragraf.": ("Hours: P scheduled, O afternoon, N night, V weekend, S public holiday; DOV annual leave, NEM sickness, PAR statutory leave.", "Hodiny: P plán, O popoludnie, N noc, V víkend, S sviatok; DOV dovolenka, NEM choroba, PAR paragraf.", "Stunden: P geplant, O Nachmittag, N Nacht, V Wochenende, S Feiertag; DOV Urlaub, NEM Krankheit, PAR gesetzliche Freistellung."),
    "Výstup je optimalizovaný pro A4 na šířku a stránkuje po nejvýše pěti úvazcích.": ("Optimized for A4 landscape, with up to five employments per page.", "Výstup je optimalizovaný pre A4 na šírku, najviac päť úväzkov na stranu.", "Für A4 quer optimiert, mit höchstens fünf Arbeitsverhältnissen pro Seite."),
    "Nový rok": ("New Year's Day", "Nový rok", "Neujahr"),
    "Svátek práce": ("Labour Day", "Sviatok práce", "Tag der Arbeit"),
    "Den vítězství": ("Victory Day", "Deň víťazstva", "Tag des Sieges"),
    "Cyril a Metoděj": ("Cyril and Methodius", "Cyril a Metod", "Kyrill und Method"),
    "Jan Hus": ("Jan Hus", "Jan Hus", "Jan Hus"),
    "Den české státnosti": ("Czech Statehood Day", "Deň českej štátnosti", "Tag der tschechischen Staatlichkeit"),
    "Den vzniku ČSR": ("Czechoslovak Independence Day", "Deň vzniku ČSR", "Gründung der Tschechoslowakei"),
    "Den boje za svobodu": ("Freedom and Democracy Day", "Deň boja za slobodu", "Tag der Freiheit und Demokratie"),
    "Štědrý den": ("Christmas Eve", "Štedrý deň", "Heiligabend"),
    "1. svátek vánoční": ("Christmas Day", "1. sviatok vianočný", "1. Weihnachtstag"),
    "2. svátek vánoční": ("Boxing Day", "2. sviatok vianočný", "2. Weihnachtstag"),
    "Velký pátek": ("Good Friday", "Veľký piatok", "Karfreitag"),
    "Velikonoční pondělí": ("Easter Monday", "Veľkonočný pondelok", "Ostermontag"),
}
WEEKDAYS = {
    "Po": ("Mon", "Po", "Mo"), "Út": ("Tue", "Ut", "Di"),
    "St": ("Wed", "St", "Mi"), "Čt": ("Thu", "Št", "Do"),
    "Pá": ("Fri", "Pi", "Fr"), "So": ("Sat", "So", "Sa"), "Ne": ("Sun", "Ne", "So"),
}


def print_text(value: str, locale: str = "cs") -> str:
    if locale == "cs":
        return value
    if locale not in MONTHS:
        raise ValueError("unsupported_print_locale")
    values = WORDS.get(value) or WEEKDAYS.get(value)
    return values[("en", "sk", "de").index(locale)] if values else value
