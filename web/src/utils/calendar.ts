const weekdayLongFormatter = new Intl.DateTimeFormat("cs-CZ", { weekday: "long", timeZone: "Europe/Prague" });

const fixedPublicHolidays: Record<string, string> = {
  "01-01": "Nový rok / Den obnovy samostatného českého státu",
  "05-01": "Svátek práce",
  "05-08": "Den vítězství",
  "07-05": "Cyril a Metoděj",
  "07-06": "Den upálení mistra Jana Husa",
  "09-28": "Den české státnosti",
  "10-28": "Den vzniku samostatného československého státu",
  "11-17": "Den boje za svobodu a demokracii",
  "12-24": "Štědrý den",
  "12-25": "1. svátek vánoční",
  "12-26": "2. svátek vánoční",
};

export type CalendarDayTone = "holiday" | "weekend" | "work";

export function asPragueDate(isoDate: string): Date {
  return new Date(`${isoDate}T12:00:00`);
}

function easterSunday(year: number): Date {
  const goldenYear = year % 19;
  const century = Math.trunc(year / 100);
  const yearInCentury = year - century * 100;
  const leapCenturies = Math.trunc(century / 4);
  const centuryRemainder = century - leapCenturies * 4;
  const lunarShift = Math.trunc((century + 8) / 25);
  const solarLunarCorrection = Math.trunc((century - lunarShift + 1) / 3);
  const epact = (19 * goldenYear + century - leapCenturies - solarLunarCorrection + 15) % 30;
  const leapYearsInCentury = Math.trunc(yearInCentury / 4);
  const yearRemainder = yearInCentury - leapYearsInCentury * 4;
  const weekdayOffset = (32 + 2 * centuryRemainder + 2 * leapYearsInCentury - epact - yearRemainder) % 7;
  const correction = Math.trunc((goldenYear + 11 * epact + 22 * weekdayOffset) / 451);
  const marchBasedDay = epact + weekdayOffset - 7 * correction + 114;
  return new Date(year, Math.trunc(marchBasedDay / 31) - 1, (marchBasedDay % 31) + 1, 12);
}

function dateKey(date: Date): string {
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isoDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function getHolidayLabel(date: Date): string | null {
  const fixed = fixedPublicHolidays[dateKey(date)];
  if (fixed) return fixed;
  const easter = easterSunday(date.getFullYear());
  const goodFriday = new Date(easter);
  goodFriday.setDate(easter.getDate() - 2);
  const easterMonday = new Date(easter);
  easterMonday.setDate(easter.getDate() + 1);
  if (isoDateKey(date) === isoDateKey(goodFriday)) return "Velký pátek";
  if (isoDateKey(date) === isoDateKey(easterMonday)) return "Velikonoční pondělí";
  return null;
}

export function getCalendarDayTone(date: Date): CalendarDayTone {
  if (getHolidayLabel(date)) return "holiday";
  const weekday = date.getDay();
  return weekday === 0 || weekday === 6 ? "weekend" : "work";
}

export function getWeekdayLongLabel(date: Date): string {
  return weekdayLongFormatter.format(date);
}
