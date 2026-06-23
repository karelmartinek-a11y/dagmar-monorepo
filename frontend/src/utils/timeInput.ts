export function normalizeTime(value: string): string {
  const v = value.trim();
  if (!v) return "";

  if (/^\d{4}$/.test(v)) {
    const hh = parseInt(v.slice(0, 2), 10);
    const mm = parseInt(v.slice(2, 4), 10);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) return `${hh.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}`;
    return v;
  }

  const colon = v.match(/^(\d{1,2}):(\d{2})$/);
  if (colon) {
    const hh = parseInt(colon[1], 10);
    const mm = parseInt(colon[2], 10);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) return `${hh.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}`;
    return v;
  }

  if (/^\d{1,2}$/.test(v)) {
    const hh = parseInt(v, 10);
    if (hh >= 1 && hh <= 23) return `${hh.toString().padStart(2, "0")}:00`;
  }

  return v;
}

export function isValidTimeOrEmpty(value: string): boolean {
  const v = normalizeTime(value);
  if (v === "") return true;
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(v);
}
