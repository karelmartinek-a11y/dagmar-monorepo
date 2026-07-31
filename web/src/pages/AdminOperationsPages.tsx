import { useState } from "react";
import { Download, Settings, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, Panel, StatusMessage } from "../components/Primitives";
import { api } from "../api/client";

export function AdminExportPage() {
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  async function download() {
    setState("loading");
    try {
      const response = await api.adminBlob(`/api/v1/admin/export?month=${new Date().toISOString().slice(0, 7)}&bulk=true`, { method: "GET" });
      const url = URL.createObjectURL(response.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "kajovodagmar-export.csv";
      anchor.click();
      URL.revokeObjectURL(url);
      setState("idle");
    } catch {
      setState("error");
    }
  }
  return <Panel title={t("adminOps.export.title")}><Button onClick={download} disabled={state === "loading"}><Download />{t("adminOps.export.download")}</Button>{state === "error" && <StatusMessage kind="error" title={t("adminOps.export.loadFailed")} />}</Panel>;
}

export function AdminPrintsPage() {
  const { t } = useTranslation();
  return <Panel title={t("adminOps.prints.title")}><StatusMessage kind="empty" title={t("adminOps.prints.empty")} /></Panel>;
}

export function AdminPrintPreviewPage() {
  const { t } = useTranslation();
  return <Panel title={t("adminOps.prints.preview.title")}><StatusMessage kind="empty" title={t("adminOps.prints.empty")} /></Panel>;
}

export function AdminSettingsPage() {
  const { t } = useTranslation();
  return <Panel title={t("adminOps.settings.title")}><div className="panel-body"><Settings aria-hidden="true" /><p>{t("adminOps.settings.employmentProfileOnly", "Časová nastavení se upravují na konkrétním úvazku.")}</p></div></Panel>;
}

export function AdminIntegrationsPage() {
  const { t } = useTranslation();
  return <Panel title={t("adminOps.integrations.title")}><div className="panel-body"><ShieldCheck aria-hidden="true" /><p>{t("adminOps.integrations.description", "Integrační API používá samostatné scoped tokeny.")}</p></div></Panel>;
}
