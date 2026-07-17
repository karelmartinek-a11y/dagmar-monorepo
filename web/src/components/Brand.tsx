import { useTranslation } from "react-i18next";

export function Brand({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  return <div className={`brand ${compact ? "brand--compact" : ""}`} aria-label={`${t("common.appName")} — ${t("common.appSubtitle")}`}>
    <span className="brand__mark" aria-hidden="true"><i /><i /><i /></span>
    <span className="brand__copy"><strong>{t("common.appName")}</strong><small>{t("common.appSubtitle")}</small></span>
  </div>;
}
