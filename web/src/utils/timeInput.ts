export function normalizeTimeInput(raw: string): string | null {
  const value = raw.trim().replace(".", ":");
  if (!value) return "";
  const compact = value.replace(":", "");
  if (!/^\d{1,4}$/.test(compact)) return null;
  const hour = compact.length <= 2 ? Number(compact) : Number(compact.slice(0, -2));
  const minute = compact.length <= 2 ? 0 : Number(compact.slice(-2));
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
