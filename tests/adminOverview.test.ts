import { describe, expect, it } from "vitest";
import type { AdminInstance, PortalUser } from "../src/api/admin";
import { buildAdminOverviewSummary } from "../src/utils/adminOverview";

function makeUser(overrides: Partial<PortalUser>): PortalUser {
  return {
    id: 1,
    name: "Test",
    email: "test@example.cz",
    role: "employee",
    has_password: true,
    is_active: true,
    is_locked: false,
    login_status: "ACTIVE",
    employments: [],
    ...overrides,
  };
}

function makeInstance(overrides: Partial<AdminInstance>): AdminInstance {
  return {
    id: "inst-1",
    client_type: "WEB",
    status: "ACTIVE",
    display_name: "Recepce",
    created_at: "2026-06-01T08:00:00Z",
    last_seen_at: "2026-06-11T08:00:00Z",
    employment_template: "DPP_DPC",
    ...overrides,
  };
}

describe("buildAdminOverviewSummary", () => {
  it("spravne agreguje uzivatele a instance pro dashboard", () => {
    const users = [
      makeUser({ id: 1, login_status: "ACTIVE", has_password: true }),
      makeUser({ id: 2, login_status: "EMPLOYMENT_WINDOW_BLOCKED", has_password: false }),
      makeUser({ id: 3, login_status: "DEACTIVATED", has_password: false }),
    ];
    const instances = [
      makeInstance({ id: "pending-1", status: "PENDING", last_seen_at: null }),
      makeInstance({ id: "active-1", status: "ACTIVE", last_seen_at: "2026-06-11T11:00:00Z" }),
      makeInstance({ id: "revoked-1", status: "REVOKED", last_seen_at: "2026-06-10T11:00:00Z" }),
      makeInstance({ id: "deactivated-1", status: "DEACTIVATED", last_seen_at: "2026-06-09T11:00:00Z" }),
    ];

    const summary = buildAdminOverviewSummary(users, instances);

    expect(summary.activeUsers).toBe(1);
    expect(summary.blockedUsers).toBe(1);
    expect(summary.withoutPassword).toBe(2);
    expect(summary.pendingInstances).toHaveLength(1);
    expect(summary.activeInstances).toBe(1);
    expect(summary.revokedInstances).toBe(1);
    expect(summary.deactivatedInstances).toBe(1);
    expect(summary.lastSeen).toBe("2026-06-11T11:00:00Z");
  });
});
