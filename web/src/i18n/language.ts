import type { AppLanguage } from "./resources";
import {
  coreSupportedLanguages,
  employeeSupportedLanguages,
  localeMap,
  supportedLanguages,
} from "./resources";

export const languageStorageKey = "kajovodagmar.language.v1";
export const employeeLanguageStorageKey = "kajovodagmar.language.employee.v1";
export type LanguageSurface = "core" | "employee";
const defaultLanguage: AppLanguage = "cs";

function isSupportedLanguage(
  value: string | null | undefined,
): value is AppLanguage {
  return Boolean(value) && supportedLanguages.includes(value as AppLanguage);
}

export function getDefaultLanguage(): AppLanguage {
  return defaultLanguage;
}

export function getBrowserLanguage(): AppLanguage {
  const candidates = [
    ...(typeof navigator !== "undefined" ? navigator.languages : []),
    typeof navigator !== "undefined" ? navigator.language : undefined,
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const base = candidate.toLowerCase().split("-")[0];
    if (isSupportedLanguage(base)) return base;
  }
  return defaultLanguage;
}

export function getLanguageSurface(
  pathname = typeof window !== "undefined" ? window.location.pathname : "/",
): LanguageSurface {
  return pathname === "/app" ||
    pathname.startsWith("/app/") ||
    pathname === "/reset"
    ? "employee"
    : "core";
}

export function isLanguageAllowed(
  language: AppLanguage,
  surface: LanguageSurface,
): boolean {
  const allowed: readonly string[] =
    surface === "employee"
      ? employeeSupportedLanguages
      : coreSupportedLanguages;
  return allowed.includes(language);
}

export function loadStoredLanguage(
  surface: LanguageSurface = getLanguageSurface(),
): AppLanguage | null {
  try {
    const value = localStorage.getItem(
      surface === "employee" ? employeeLanguageStorageKey : languageStorageKey,
    );
    return isSupportedLanguage(value) && isLanguageAllowed(value, surface)
      ? value
      : null;
  } catch {
    return null;
  }
}

export function persistLanguage(
  language: AppLanguage,
  surface: LanguageSurface = getLanguageSurface(),
): void {
  if (!isLanguageAllowed(language, surface)) return;
  try {
    localStorage.setItem(
      surface === "employee" ? employeeLanguageStorageKey : languageStorageKey,
      language,
    );
  } catch {
    // localStorage is optional
  }
}

export function detectInitialLanguage(): AppLanguage {
  const surface = getLanguageSurface();
  const browser = getBrowserLanguage();
  return (
    loadStoredLanguage(surface) ??
    (isLanguageAllowed(browser, surface) ? browser : defaultLanguage)
  );
}

export function getLocale(language: AppLanguage): string {
  return localeMap[language];
}
