import calendarSnapshot from "../data/calendar-snapshot.json";
import { getLocale } from "../i18n/language";
import type { AppLanguage } from "../i18n/resources";

export type CalendarDayTone = "holiday" | "weekend" | "work";
export type CalendarObservanceKind = "nameday" | "commemoration";

export type CalendarDayInfo = {
  publicHoliday: { id: string; label: string } | null;
  observance: {
    kind: CalendarObservanceKind;
    items: string[];
    source: string;
  } | null;
};

const holidayLabels: Record<AppLanguage, Record<string, string>> = {
  cs: {
    "01-01": "Nový rok / Den obnovy samostatného českého státu",
    "05-01": "Svátek práce",
    "05-08": "Den vítězství",
    "07-05": "Den slovanských věrozvěstů Cyrila a Metoděje",
    "07-06": "Den upálení mistra Jana Husa",
    "09-28": "Den české státnosti",
    "10-28": "Den vzniku samostatného československého státu",
    "11-17": "Den boje za svobodu a demokracii a Mezinárodní den studentstva",
    "12-24": "Štědrý den",
    "12-25": "1. svátek vánoční",
    "12-26": "2. svátek vánoční",
    easterFriday: "Velký pátek",
    easterMonday: "Velikonoční pondělí",
  },
  en: {
    "01-01": "New Year's Day / Restoration of the Independent Czech State Day",
    "05-01": "Labour Day",
    "05-08": "Victory Day",
    "07-05": "Saints Cyril and Methodius Day",
    "07-06": "Jan Hus Day",
    "09-28": "Czech Statehood Day",
    "10-28": "Independent Czechoslovak State Day",
    "11-17":
      "Struggle for Freedom and Democracy Day and International Students' Day",
    "12-24": "Christmas Eve",
    "12-25": "Christmas Day",
    "12-26": "St Stephen's Day",
    easterFriday: "Good Friday",
    easterMonday: "Easter Monday",
  },
  sk: {
    "01-01": "Nový rok / Deň obnovy samostatného českého štátu",
    "05-01": "Sviatok práce",
    "05-08": "Deň víťazstva",
    "07-05": "Deň slovanských vierozvestcov Cyrila a Metoda",
    "07-06": "Deň upálenia majstra Jána Husa",
    "09-28": "Deň českej štátnosti",
    "10-28": "Deň vzniku samostatného československého štátu",
    "11-17": "Deň boja za slobodu a demokraciu a Medzinárodný deň študentstva",
    "12-24": "Štedrý deň",
    "12-25": "Prvý sviatok vianočný",
    "12-26": "Druhý sviatok vianočný",
    easterFriday: "Veľký piatok",
    easterMonday: "Veľkonočný pondelok",
  },
  de: {
    "01-01":
      "Neujahr / Tag der Erneuerung des unabhängigen tschechischen Staates",
    "05-01": "Tag der Arbeit",
    "05-08": "Tag des Sieges",
    "07-05": "Tag der Slawenapostel Kyrill und Method",
    "07-06": "Gedenktag der Verbrennung von Jan Hus",
    "09-28": "Tag der tschechischen Staatlichkeit",
    "10-28": "Tag der Gründung des unabhängigen tschechoslowakischen Staates",
    "11-17":
      "Tag des Kampfes für Freiheit und Demokratie und Internationaler Studententag",
    "12-24": "Heiligabend",
    "12-25": "Erster Weihnachtstag",
    "12-26": "Zweiter Weihnachtstag",
    easterFriday: "Karfreitag",
    easterMonday: "Ostermontag",
  },
  hi: {
    "01-01": "नववर्ष / स्वतंत्र चेक राज्य की पुनर्स्थापना दिवस",
    "05-01": "श्रम दिवस",
    "05-08": "विजय दिवस",
    "07-05": "संत सिरिल और मेथोडियस दिवस",
    "07-06": "यान हुस स्मृति दिवस",
    "09-28": "चेक राज्यत्व दिवस",
    "10-28": "स्वतंत्र चेकोस्लोवाक राज्य की स्थापना दिवस",
    "11-17":
      "स्वतंत्रता और लोकतंत्र के संघर्ष का दिवस तथा अंतरराष्ट्रीय छात्र दिवस",
    "12-24": "क्रिसमस की पूर्वसंध्या",
    "12-25": "क्रिसमस दिवस",
    "12-26": "क्रिसमस का दूसरा दिन",
    easterFriday: "गुड फ़्राइडे",
    easterMonday: "ईस्टर सोमवार",
  },
};

const snapshot = calendarSnapshot as {
  meta: Record<string, string>;
  cs: Record<string, string | string[]>;
  sk: Record<string, string[]>;
  de: Record<string, string[]>;
  en: Record<string, string[]>;
};

function toLanguage(language: AppLanguage | string | undefined): AppLanguage {
  if (!language) return "cs";
  const base = language.toLowerCase().split("-")[0] as AppLanguage;
  return ["cs", "en", "sk", "de", "hi"].includes(base) ? base : "cs";
}

function toLocale(language: AppLanguage | string | undefined): string {
  if (!language) return getLocale("cs");
  if (language.includes("-")) return language;
  return getLocale(toLanguage(language));
}

export function asPragueDate(isoDate: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return new Date(Number.NaN);
  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12),
  );
}

function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.trunc(year / 100);
  const c = year % 100;
  const d = Math.trunc(b / 4);
  const e = b % 4;
  const f = Math.trunc((b + 8) / 25);
  const g = Math.trunc((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.trunc(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.trunc((a + 11 * h + 22 * l) / 451);
  const value = h + l - 7 * m + 114;
  return new Date(
    Date.UTC(year, Math.trunc(value / 31) - 1, (value % 31) + 1, 12),
  );
}

function dateKey(date: Date): string {
  return `${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function isoKey(date: Date): string {
  return `${date.getUTCFullYear()}-${dateKey(date)}`;
}

export function getHolidayLabel(
  date: Date,
  language?: AppLanguage | string,
): string | null {
  const labels = holidayLabels[toLanguage(language)];
  const fixed = labels[dateKey(date)];
  if (fixed) return fixed;
  const easter = easterSunday(date.getUTCFullYear());
  const friday = new Date(easter);
  friday.setUTCDate(easter.getUTCDate() - 2);
  const monday = new Date(easter);
  monday.setUTCDate(easter.getUTCDate() + 1);
  if (isoKey(date) === isoKey(friday)) return labels.easterFriday;
  if (isoKey(date) === isoKey(monday)) return labels.easterMonday;
  return null;
}

function observanceFor(
  date: Date,
  language: AppLanguage,
): CalendarDayInfo["observance"] {
  if (language === "hi") return null;
  const key = dateKey(date);
  const raw = snapshot[language][key];
  if (!raw) return null;
  const items = Array.isArray(raw) ? raw : [raw];
  return {
    kind: language === "en" ? "commemoration" : "nameday",
    items,
    source: snapshot.meta[language],
  };
}

export function getCalendarDayInfo(
  date: Date,
  language?: AppLanguage | string,
): CalendarDayInfo {
  const resolved = toLanguage(language);
  const holiday = getHolidayLabel(date, resolved);
  return {
    publicHoliday: holiday ? { id: isoKey(date), label: holiday } : null,
    observance: observanceFor(date, resolved),
  };
}

export function getCalendarDayTone(date: Date): CalendarDayTone {
  if (getHolidayLabel(date)) return "holiday";
  const weekday = date.getUTCDay();
  return weekday === 0 || weekday === 6 ? "weekend" : "work";
}

export function getWeekdayLongLabel(
  date: Date,
  language?: AppLanguage | string,
): string {
  return new Intl.DateTimeFormat(toLocale(language), {
    weekday: "long",
    timeZone: "Europe/Prague",
  }).format(date);
}

/** Compatibility text for admin matrices; employee cards use the structured contract. */
export function getDayMeta(
  date: Date,
  language?: AppLanguage | string,
): string {
  const info = getCalendarDayInfo(date, language);
  return [info.observance?.items.join(", "), info.publicHoliday?.label]
    .filter(Boolean)
    .join(" · ");
}
