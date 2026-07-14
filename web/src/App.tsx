import { Navigate, Route, Routes } from "react-router-dom";
import { AdminShell } from "./layout/AdminShell";
import { AdminGuard, AdminLoginPage, NotFoundPage, ResetPage } from "./pages/AuthPages";
import { EmployeePage } from "./pages/EmployeePage";
import { AdminOverviewPage } from "./pages/AdminOverviewPage";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { AdminAttendancePage, AdminShiftPlanPage } from "./pages/AdminMatrixPages";
import { AdminExportPage, AdminInstancesPage, AdminIntegrationsPage, AdminPrintPreviewPage, AdminPrintsPage, AdminSettingsPage } from "./pages/AdminOperationsPages";
import { IntegrationDocsPage } from "./pages/IntegrationDocsPage";

export function App() {
  return <Routes><Route path="/" element={<Navigate to="/app" replace />} /><Route path="/app" element={<EmployeePage />} /><Route path="/reset" element={<ResetPage />} /><Route path="/integration-api" element={<IntegrationDocsPage />} /><Route path="/admin/login" element={<AdminLoginPage />} /><Route path="/admin" element={<AdminGuard><AdminShell /></AdminGuard>}><Route index element={<Navigate to="prehled" replace />} /><Route path="prehled" element={<AdminOverviewPage />} /><Route path="users" element={<AdminUsersPage />} /><Route path="dochazka" element={<AdminAttendancePage />} /><Route path="plan-sluzeb" element={<AdminShiftPlanPage />} /><Route path="export" element={<AdminExportPage />} /><Route path="tisky" element={<AdminPrintsPage />} /><Route path="tisky/preview" element={<AdminPrintPreviewPage />} /><Route path="settings" element={<AdminSettingsPage />} /><Route path="instances" element={<AdminInstancesPage />} /><Route path="integrace" element={<AdminIntegrationsPage />} /></Route><Route path="*" element={<NotFoundPage />} /></Routes>;
}
