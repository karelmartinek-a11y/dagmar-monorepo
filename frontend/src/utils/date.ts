function pad2(value: number) {
  return String(value).padStart(2, "0");
}

export function formatIsoDateForDisplay(value: string | null | undefined): string {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return value;
  return `${match[3]}.${match[2]}.${match[1]}`;
}

export function parseCzechDateToIso(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) return null;
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(normalized);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    !Number.isFinite(day) ||
    !Number.isFinite(month) ||
    !Number.isFinite(year) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function formatMonthLabelCs(value: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!match) return value;
  return new Date(Number(match[1]), Number(match[2]) - 1, 1).toLocaleDateString("cs-CZ", {
    month: "long",
    year: "numeric",
  });
}

export function formatIsoMonthForDisplay(value: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!match) return value;
  return `${match[2]}.${match[1]}`;
}

export function parseCzechMonthToIso(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) return null;
  const match = /^(\d{1,2})\.(\d{4})$/.exec(normalized);
  if (!match) return null;
  const month = Number(match[1]);
  const year = Number(match[2]);
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 2100) {
    return null;
  }
  return `${year}-${pad2(month)}`;
}
