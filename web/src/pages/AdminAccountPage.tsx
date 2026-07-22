import { AccountMethods } from "../components/AccountMethods";
import { useTranslation } from "react-i18next";

export function AdminAccountPage() {
  const { t } = useTranslation();
  return <div className="page">
    <header className="page-heading"><div><p>{t("account.adminEyebrow")}</p><h1>{t("account.title")}</h1><p>{t("account.adminDescription")}</p></div></header>
    <AccountMethods portal="admin" />
  </div>;
}
