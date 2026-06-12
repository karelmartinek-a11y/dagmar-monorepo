import type { AdminInstance, PortalUser } from "../api/admin";

export function buildAdminOverviewSummary(users: PortalUser[], instances: AdminInstance[]) {
  const activeUsers = users.filter((user) => user.login_status === "ACTIVE").length;
  const blockedUsers = users.filter((user) => user.login_status === "EMPLOYMENT_WINDOW_BLOCKED").length;
  const withoutPassword = users.filter((user) => !user.has_password).length;
  const pendingInstances = instances.filter((item) => item.status === "PENDING");
  const activeInstances = instances.filter((item) => item.status === "ACTIVE").length;
  const revokedInstances = instances.filter((item) => item.status === "REVOKED").length;
  const deactivatedInstances = instances.filter((item) => item.status === "DEACTIVATED").length;
  const lastSeen = instances
    .filter((item) => item.last_seen_at)
    .sort((a, b) => String(b.last_seen_at).localeCompare(String(a.last_seen_at)))[0]?.last_seen_at;

  return {
    activeUsers,
    blockedUsers,
    withoutPassword,
    pendingInstances,
    activeInstances,
    revokedInstances,
    deactivatedInstances,
    lastSeen,
  };
}
