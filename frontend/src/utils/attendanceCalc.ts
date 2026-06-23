import type { EmploymentTemplate } from "../types/employment";

export type AttendanceRowLike = {
  date: string; // YYYY-MM-DD
  arrival_time: string | null; // HH:MM
  departure_time: string | null; // HH:MM
  planned_status?: "HOLIDAY" | "OFF" | null;
};

export type DayComputed = {
  workedMins: number | null;
  breakMins: number;
  breakLabel: string | null;
  breakTooltip: string | null;
  afternoonMins: number; // only for HPP
  weekendHolidayMins: number; // only for HPP
  isWeekend: boolean;
  holidayName: string | null;
  isWeekendOrHoliday: boolean;
};

export type MonthStats = {
  totalMins: number;
  breakMins: number;
  afternoonMins: number;
  weekendHolidayMins: number;
  holidayMins: number;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function parseTimeToMinutes(hhmm: string | null): number | null {
  if (!hhmm) return null;
  const m = /^([0-1]?\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export function parseCutoffToMinutes(value: string | null | undefined, fallback: string = "17:00"): number {
  const parsed = parseTimeToMinutes(value ?? null);
  if (parsed !== null) return parsed;
  const fb = parseTimeToMinutes(fallback);
  return fb ?? 17 * 60;
}

function minutesToHHMM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

function isoParts(dateIso: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return { y, m: mo, d };
}

export function isWeekendDate(dateIso: string): boolean {
  const p = isoParts(dateIso);
  if (!p) return false;
  const dow = new Date(p.y, p.m - 1, p.d).getDay(); // 0 Sun .. 6 Sat
  return dow === 0 || dow === 6;
}

function addDays(dt: Date, delta: number): Date {
  const out = new Date(dt);
  out.setDate(out.getDate() + delta);
  return out;
}

// Anonymous Gregorian algorithm
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=March, 4=April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

const holidayCache = new Map<number, Map<string, string>>();

function toIso(dt: Date): string {
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

function holidaysForYearCZ(year: number): Map<string, string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;

  const map = new Map<string, string>();

  // Fixed holidays (CZ)
  const fixed: Array<[string, string]> = [
    ["01-01", "Nový rok / Den obnovy samostatného českého státu"],
    ["05-01", "Svátek práce"],
    ["05-08", "Den vítězství"],
    ["07-05", "Cyril a Metoděj"],
    ["07-06", "Upálení mistra Jana Husa"],
    ["09-28", "Den české státnosti"],
    ["10-28", "Vznik samostatného československého státu"],
    ["11-17", "Den boje za svobodu a demokracii"],
    ["12-24", "Štědrý den"],
    ["12-25", "1. svátek vánoční"],
    ["12-26", "2. svátek vánoční"],
  ];
  for (const [mmdd, name] of fixed) {
    map.set(`${year}-${mmdd}`, name);
  }

  // Movable (Good Friday, Easter Monday)
  const easter = easterSunday(year);
  map.set(toIso(addDays(easter, -2)), "Velký pátek");
  map.set(toIso(addDays(easter, +1)), "Velikonoční pondělí");

  holidayCache.set(year, map);
  return map;
}

export function getCzechHolidayName(dateIso: string): string | null {
  const p = isoParts(dateIso);
  if (!p) return null;
  const map = holidaysForYearCZ(p.y);
  return map.get(dateIso) ?? null;
}

export function workingDaysInMonthCs(year: number, month1: number): number {
  const dim = new Date(year, month1, 0).getDate();
  let working = 0;
  for (let d = 1; d <= dim; d++) {
    const dt = new Date(year, month1 - 1, d);
    const dow = dt.getDay(); // 0 Sun .. 6 Sat
    if (dow === 0 || dow === 6) continue;
    const iso = `${year}-${pad2(month1)}-${pad2(d)}`;
    if (getCzechHolidayName(iso)) continue;
    working += 1;
  }
  return working;
}

type BreakWindow = { start: number; end: number };

function computeHppBreaks(startMin: number, endMin: number): BreakWindow[] {
  const dur = endMin - startMin;
  const breaks: BreakWindow[] = [];

  // Based on examples: apply 30 min pause at >= 6h30 and at >= 12h30.
  if (dur >= 6 * 60 + 30) {
    breaks.push({ start: startMin + 6 * 60, end: startMin + 6 * 60 + 30 });
  }
  if (dur >= 12 * 60 + 30) {
    breaks.push({ start: startMin + 12 * 60, end: startMin + 12 * 60 + 30 });
  }
  return breaks;
}

function segmentsMinusBreaks(startMin: number, endMin: number, breaks: BreakWindow[]): Array<[number, number]> {
  if (breaks.length === 0) return [[startMin, endMin]];
  const out: Array<[number, number]> = [];
  let cur = startMin;
  for (const b of breaks) {
    if (b.start > cur) out.push([cur, b.start]);
    cur = Math.max(cur, b.end);
  }
  if (cur < endMin) out.push([cur, endMin]);
  return out.filter(([a, b]) => b > a);
}

function overlapMinutes(a0: number, a1: number, b0: number, b1: number): number {
  const s = Math.max(a0, b0);
  const e = Math.min(a1, b1);
  return Math.max(0, e - s);
}

function breakLabelFromMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `−${h}:${pad2(m)} pauza`;
}

function breakTooltipFromWindows(windows: BreakWindow[]): string {
  if (windows.length === 0) return "";
  const parts = windows.map((w) => `${minutesToHHMM(w.start)}–${minutesToHHMM(w.end)}`);
  const total = windows.length * 30;
  const prefix = windows.length === 1 ? "Pauza" : "Pauzy";
  return `${prefix} ${breakLabelFromMinutes(total).replace("−", "")} (${parts.join(", ")})`;
}

export function computeDayCalc(row: AttendanceRowLike, template: EmploymentTemplate, cutoffMinutes: number): DayComputed {
  const isWeekend = isWeekendDate(row.date);
  const holidayName = getCzechHolidayName(row.date);
  const isWeekendOrHoliday = isWeekend || !!holidayName;

  const a = parseTimeToMinutes(row.arrival_time);
  const d = parseTimeToMinutes(row.departure_time);
  if (a === null || d === null || d <= a) {
    return {
      workedMins: null,
      breakMins: 0,
      breakLabel: null,
      breakTooltip: null,
      afternoonMins: 0,
      weekendHolidayMins: 0,
      isWeekend,
      holidayName,
      isWeekendOrHoliday,
    };
  }

  if (template !== "HPP") {
    return {
      workedMins: d - a,
      breakMins: 0,
      breakLabel: null,
      breakTooltip: null,
      afternoonMins: 0,
      weekendHolidayMins: 0,
      isWeekend,
      holidayName,
      isWeekendOrHoliday,
    };
  }

  const breaks = computeHppBreaks(a, d);
  const segments = segmentsMinusBreaks(a, d, breaks);
  const workedMins = segments.reduce((acc, [s, e]) => acc + (e - s), 0);
  const afternoonMins = segments.reduce((acc, [s, e]) => acc + overlapMinutes(s, e, cutoffMinutes, 24 * 60), 0);
  const weekendHolidayMins = isWeekendOrHoliday ? workedMins : 0;
  const breakMins = breaks.length * 30;

  return {
    workedMins,
    breakMins,
    breakLabel: breakMins ? breakLabelFromMinutes(breakMins) : null,
    breakTooltip: breaks.length ? breakTooltipFromWindows(breaks) : null,
    afternoonMins,
    weekendHolidayMins,
    isWeekend,
    holidayName,
    isWeekendOrHoliday,
  };
}

export function computeMonthStats(rows: AttendanceRowLike[], template: EmploymentTemplate, cutoffMinutes: number): MonthStats {
  let totalMins = 0;
  let breakMins = 0;
  let afternoonMins = 0;
  let weekendHolidayMins = 0;
  let holidayMins = 0;

  for (const r of rows) {
    const c = computeDayCalc(r, template, cutoffMinutes);
    if (c.workedMins !== null) totalMins += c.workedMins;
    breakMins += c.breakMins;
    afternoonMins += c.afternoonMins;
    weekendHolidayMins += c.weekendHolidayMins;
    if (r.planned_status === "HOLIDAY") {
      holidayMins += 8 * 60;
    }
  }

  if (template !== "HPP") {
    totalMins += holidayMins;
    return { totalMins, breakMins: 0, afternoonMins: 0, weekendHolidayMins: 0, holidayMins };
  }
  totalMins += holidayMins;
  return { totalMins, breakMins, afternoonMins, weekendHolidayMins, holidayMins };
}
