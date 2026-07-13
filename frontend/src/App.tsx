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

function DeploymentBadge() {
  return null;
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
