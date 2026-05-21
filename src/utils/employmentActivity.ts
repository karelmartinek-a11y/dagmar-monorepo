type EmploymentRangeLike = {
  start_date: string;
  end_date: string | null;
  is_active: boolean;
};

function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  return new Date(year, month - 1, day);
}

function monthBounds(year: number, month: number): { start: Date; end: Date } {
  return {
    start: new Date(year, month - 1, 1),
    end: new Date(year, month, 0),
  };
}

export function employmentIncludesDay(employment: EmploymentRangeLike, dateIso: string): boolean {
  const current = parseIsoDate(dateIso);
  const start = parseIsoDate(employment.start_date);
  if (!current || !start) return false;
  const end = employment.end_date ? parseIsoDate(employment.end_date) : null;
  if (current < start) return false;
  if (end && current > end) return false;
  return true;
}

export function employmentOverlapsMonthIgnoringActive(employment: EmploymentRangeLike, year: number, month: number): boolean {
  const start = parseIsoDate(employment.start_date);
  if (!start) return false;
  const end = employment.end_date ? parseIsoDate(employment.end_date) : null;
  const monthRange = monthBounds(year, month);
  if (start > monthRange.end) return false;
  if (end && end < monthRange.start) return false;
  return true;
}

export function employmentIsActiveInMonth(
  employment: EmploymentRangeLike,
  userIsActive: boolean,
  year: number,
  month: number,
): boolean {
  return userIsActive && employment.is_active && employmentOverlapsMonthIgnoringActive(employment, year, month);
}
