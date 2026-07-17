import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { detectInitialLanguage, getDefaultLanguage, persistLanguage } from "./i18n/language";
import { resources, type AppLanguage } from "./i18n/resources";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: typeof resources.cs.translation;
  }
}

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: detectInitialLanguage(),
    fallbackLng: getDefaultLanguage(),
    supportedLngs: Object.keys(resources),
    defaultNS: "translation",
    interpolation: { escapeValue: false },
    returnNull: false,
    returnEmptyString: false,
    saveMissing: false,
  });

  i18n.on("languageChanged", (language) => {
    persistLanguage(language as AppLanguage);
    if (typeof document !== "undefined") document.documentElement.lang = language;
  });

  if (typeof document !== "undefined") document.documentElement.lang = i18n.language;
}

export { i18n };
