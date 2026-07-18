import { Languages } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  isLanguageAllowed,
  persistLanguage,
  type LanguageSurface,
} from "../i18n/language";
import {
  coreSupportedLanguages,
  employeeSupportedLanguages,
  languageLabels,
  type AppLanguage,
} from "../i18n/resources";

export function LanguageSwitcher({
  compact = false,
  surface = "core",
}: {
  compact?: boolean;
  surface?: LanguageSurface;
}) {
  const { t, i18n } = useTranslation();
  const languages =
    surface === "employee"
      ? employeeSupportedLanguages
      : coreSupportedLanguages;
  const value = isLanguageAllowed(i18n.resolvedLanguage as AppLanguage, surface)
    ? i18n.resolvedLanguage
    : "cs";

  useEffect(() => {
    if (!isLanguageAllowed(i18n.resolvedLanguage as AppLanguage, surface))
      void i18n.changeLanguage("cs");
  }, [i18n, surface]);

  return (
    <label
      className={`language-switcher ${compact ? "language-switcher--compact" : ""}`}
    >
      <span className="sr-only">{t("common.language.label")}</span>
      <Languages aria-hidden="true" size={16} />
      <select
        aria-label={t("common.language.switcher")}
        value={value}
        onChange={(event) => {
          const value = event.target.value as AppLanguage;
          persistLanguage(value, surface);
          void i18n.changeLanguage(value);
        }}
      >
        {languages.map((language) => (
          <option key={language} value={language}>
            {languageLabels[language]}
          </option>
        ))}
      </select>
    </label>
  );
}
