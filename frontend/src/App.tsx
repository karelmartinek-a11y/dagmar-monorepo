import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import EmployeePage from "./pages/EmployeePage";
import AdminLayout from "./pages/AdminLayout";
import AdminLoginPage from "./pages/AdminLoginPage";
import AdminOverviewPage from "./pages/AdminOverviewPage";
import AdminUsersPage from "./pages/AdminUsersPage";
import AdminExportPage from "./pages/AdminExportPage";
import AdminAttendanceSheetsPage from "./pages/AdminAttendanceSheetsPage";
import AdminSettingsPage from "./pages/AdminSettingsPage";
import AdminShiftPlanPage from "./pages/AdminShiftPlanPage";
import AdminPrintsPage from "./pages/AdminPrintsPage";
import AdminPrintPreviewPage from "./pages/AdminPrintPreviewPage";
import AdminInstancesPage from "./pages/AdminInstancesPage";
import AdminIntegrationsPage from "./pages/AdminIntegrationsPage";
import PortalResetPage from "./pages/PortalResetPage";
import IntegrationApiDocsPage from "./pages/IntegrationApiDocsPage";

type VersionPayload = {
  frontend_commit?: string;
  backend_deploy_tag?: string;
};

function DeploymentBadge() {
  const [frontendCommit, setFrontendCommit] = useState<string | null>(null);
  const [backendCommit, setBackendCommit] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const loadFrontend = async () => {
      try {
        const resp = await fetch("/frontend-version.json", { cache: "no-store" });
        if (!resp.ok) return;
        const data = (await resp.json()) as VersionPayload;
        if (active) setFrontendCommit(data.frontend_commit || null);
      } catch {
        if (active) setFrontendCommit(null);
      }
    };

    const loadBackend = async () => {
      try {
        const resp = await fetch("/api/version", { cache: "no-store" });
        if (!resp.ok) return;
        const data = (await resp.json()) as VersionPayload;
        if (active) setBackendCommit(data.backend_deploy_tag || null);
      } catch {
        if (active) setBackendCommit(null);
      }
    };

    loadFrontend();
    loadBackend();

    return () => {
      active = false;
    };
  }, []);

  if (!frontendCommit && !backendCommit) {
    return null;
  }

  return (
    <div className="kb-deployment" aria-label="Informace o nasazení">
      <div>Frontend: {frontendCommit || "-"}</div>
      <div>Backend: {backendCommit || "-"}</div>
    </div>
  );
}

function AppShell() {
  const location = useLocation();
  const isPrintPreview = location.pathname === "/admin/tisky/preview";

  return (
    <>
      <Routes>
        <Route path="/" element={<Navigate to="/app" replace />} />

        <Route path="/app" element={<EmployeePage />} />
        <Route path="/integration-api" element={<IntegrationApiDocsPage />} />
        <Route path="/reset" element={<PortalResetPage />} />
        <Route path="/admin/login" element={<AdminLoginPage />} />
        <Route path="/admin/tisky/preview" element={<AdminPrintPreviewPage />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Navigate to="prehled" replace />} />
          <Route path="prehled" element={<AdminOverviewPage />} />
          <Route path="users" element={<AdminUsersPage />} />
          <Route path="dochazka" element={<AdminAttendanceSheetsPage />} />
          <Route path="plan-sluzeb" element={<AdminShiftPlanPage />} />
          <Route path="export" element={<AdminExportPage />} />
          <Route path="tisky" element={<AdminPrintsPage />} />
          <Route path="settings" element={<AdminSettingsPage />} />
          <Route path="instances" element={<AdminInstancesPage />} />
          <Route path="integrace" element={<AdminIntegrationsPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
      {isPrintPreview ? null : <DeploymentBadge />}
    </>
  );
}

/**
 * Routes:
 * - /app        Zaměstnanec (web i Android WebView)
 * - /admin      Administrace (rozvržení + podstránky)
 * - /admin/login
 */
export default function App() {
  return <AppShell />;
}
