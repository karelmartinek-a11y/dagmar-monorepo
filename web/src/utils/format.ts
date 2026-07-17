import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { getLocale } from "../i18n/language";
import type { AppLanguage } from "../i18n/resources";

const PRAGUE_TIME_ZONE = "Europe/Prague";

export function useCurrentLanguage(): AppLanguage {
  const { i18n } = useTranslation();
  return i18n.resolvedLanguage as AppLanguage;
}

export function useLocaleValue(): string {
  const language = useCurrentLanguage();
  return getLocale(language);
}

export function useDateFormatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const locale = useLocaleValue();
  return useMemo(() => new Intl.DateTimeFormat(locale, { timeZone: PRAGUE_TIME_ZONE, ...options }), [locale, options]);
}

export function useNumberFormatter(options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  const locale = useLocaleValue();
  return useMemo(() => new Intl.NumberFormat(locale, options), [locale, options]);
}

export function formatDateForLanguage(language: AppLanguage, value: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(getLocale(language), { timeZone: PRAGUE_TIME_ZONE, ...options }).format(value);
}

export function formatDateForCurrentLanguage(value: Date, language: AppLanguage, options: Intl.DateTimeFormatOptions): string {
  return formatDateForLanguage(language, value, options);
}
