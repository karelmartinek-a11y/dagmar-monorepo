import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { persistLanguage } from "../i18n/language";
import { languageLabels, supportedLanguages, type AppLanguage } from "../i18n/resources";

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { t, i18n } = useTranslation();

  return (
    <label className={`language-switcher ${compact ? "language-switcher--compact" : ""}`}>
      <span className="sr-only">{t("common.language.label")}</span>
      <Languages aria-hidden="true" size={16} />
      <select
        aria-label={t("common.language.switcher")}
        value={i18n.resolvedLanguage}
        onChange={(event) => {
          const value = event.target.value as AppLanguage;
          persistLanguage(value);
          void i18n.changeLanguage(value);
        }}
      >
        {supportedLanguages.map((language) => (
          <option key={language} value={language}>
            {languageLabels[language]}
          </option>
        ))}
      </select>
    </label>
  );
}
