export function formatHours(hours: number, locale?: string): string {
  const activeLocale =
    locale ?? (document.documentElement.lang || navigator.language);
  return `${new Intl.NumberFormat(activeLocale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(hours)} h`;
}
