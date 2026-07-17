import type { AppLanguage } from "./resources";
import { localeMap, supportedLanguages } from "./resources";

export const languageStorageKey = "kajovodagmar.language.v1";
const defaultLanguage: AppLanguage = "cs";

function isSupportedLanguage(value: string | null | undefined): value is AppLanguage {
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

export function loadStoredLanguage(): AppLanguage | null {
  try {
    const value = localStorage.getItem(languageStorageKey);
    return isSupportedLanguage(value) ? value : null;
  } catch {
    return null;
  }
}

export function persistLanguage(language: AppLanguage): void {
  try {
    localStorage.setItem(languageStorageKey, language);
  } catch {
    // localStorage is optional
  }
}

export function detectInitialLanguage(): AppLanguage {
  return loadStoredLanguage() ?? getBrowserLanguage() ?? defaultLanguage;
}

export function getLocale(language: AppLanguage): string {
  return localeMap[language];
}
