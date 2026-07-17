import { useEffect } from "react";
import { BrowserRouter, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { App } from "./App";

function DocumentTitle() {
  const { pathname } = useLocation();
  const { t } = useTranslation();

  useEffect(() => {
    const routeTitleKey = (() => {
      if (pathname === "/") return "employee.login.title";
      if (pathname === "/app") return null;
      if (pathname === "/reset") return "auth.reset.title";
      if (pathname === "/integration-api") return "integrationDocs.title";
      if (pathname === "/admin/login") return "auth.admin.title";
      if (pathname === "/admin/prehled") return "overview.title";
      if (pathname === "/admin/users") return "users.title";
      if (pathname === "/admin/dochazka") return "adminMatrix.attendance.title";
      if (pathname === "/admin/plan-sluzeb") return "adminMatrix.shiftPlan.title";
      if (pathname === "/admin/export") return "adminOps.export.title";
      if (pathname === "/admin/tisky") return "adminOps.prints.title";
      if (pathname === "/admin/tisky/preview") return "adminOps.prints.previewTitle";
      if (pathname === "/admin/settings") return "adminOps.settings.title";
      if (pathname === "/admin/integrace") return "adminOps.integrations.title";
      return "auth.notFound.title";
    })();

    if (!routeTitleKey) return;
    document.title = `${t("common.appName")} · ${t(routeTitleKey)}`;
  }, [pathname, t]);

  return null;
}

export function Root() {
  const { t } = useTranslation();
  return <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><DocumentTitle /><a className="skip-link" href="#main-content">{t("nav.skipToContent")}</a><App/></BrowserRouter>;
}
