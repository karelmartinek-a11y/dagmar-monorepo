import { describe, expect, it } from "vitest";
import type { IntegrationClientDetail, IntegrationClientOptions } from "../src/api/admin";
import {
  applyPermissionProfile,
  buildDraftFromClient,
  buildEmptyIntegrationDraft,
  integrationScopeWarning,
  onlyFreeTextFieldIds,
} from "../src/utils/adminIntegrations";

const options: IntegrationClientOptions = {
  name_rules: {
    min_length: 3,
    max_length: 80,
    allowed_hint: "Písmena, číslice, mezery, pomlčky a podtržítka.",
    forbidden_hint: "Bez URL a tokenů.",
  },
  scopes: [
    {
      id: "integration:health",
      label: "Kontrola dostupnosti API",
      description: "Health check.",
      data_access: "Bez osobních dat.",
      when_to_enable: "Vždy.",
      risk: "Nízké",
      available: true,
      unavailable_reason: null,
    },
    {
      id: "attendance:create",
      label: "Vytváření docházky",
      description: "Zakládání docházky.",
      data_access: "Jen docházka.",
      when_to_enable: "Když partner zapisuje docházku.",
      risk: "Vysoké",
      available: true,
      unavailable_reason: null,
    },
    {
      id: "attendance:update",
      label: "Úprava docházky",
      description: "Úpravy docházky.",
      data_access: "Jen docházka.",
      when_to_enable: "Když partner opravuje docházku.",
      risk: "Vysoké",
      available: true,
      unavailable_reason: null,
    },
    {
      id: "attendance:delete",
      label: "Mazání docházky",
      description: "Mazání docházky.",
      data_access: "Jen docházka.",
      when_to_enable: "Jen výjimečně.",
      risk: "Kritické",
      available: true,
      unavailable_reason: null,
    },
  ],
  permission_profiles: [
    {
      id: "HEALTH_ONLY",
      label: "Pouze kontrola dostupnosti",
      description: "Jen health check.",
      scopes: ["integration:health"],
    },
  ],
  data_scope_modes: [
    {
      id: "ALL_ACTIVE_EMPLOYMENTS",
      label: "Všechny aktivní úvazky",
      description: "Jen aktivní úvazky.",
      supports_inactive_toggle: false,
    },
  ],
  employees: [],
  employments: [],
  ip_restriction_modes: [
    {
      id: "NONE",
      label: "Bez IP omezení",
      description: "Bez omezení.",
      editable: true,
    },
  ],
  expiration_options: [
    {
      id: "NONE",
      label: "Bez expirace",
      description: "Platí bez omezení.",
      requires_custom_date: false,
    },
  ],
  statuses: [],
};

const detail: IntegrationClientDetail = {
  id: 1,
  name: "Partner Export",
  status: "ACTIVE",
  status_label: "Aktivní",
  scopes: ["integration:health"],
  scope_labels: ["Kontrola dostupnosti API"],
  scope_summary: "Kontrola dostupnosti API",
  data_scope_summary: "Všechny aktivní úvazky",
  ip_restriction_mode: "NONE",
  ip_restriction_summary: "Bez IP omezení",
  expires_at: null,
  last_used_at: null,
  created_at: "2026-06-23T10:00:00Z",
  updated_at: "2026-06-23T10:00:00Z",
  created_by: "admin-web",
  active_secret_fingerprint: "abc123",
  active_secret_last4: "1234",
  available_actions: ["rotate"],
  configuration: {
    selected_scope_ids: ["integration:health"],
    permission_profile_id: "HEALTH_ONLY",
    data_scope_mode: "ALL_ACTIVE_EMPLOYMENTS",
    selected_employee_ids: [],
    selected_employment_ids: [],
    include_inactive_employments: false,
    ip_restriction_mode: "NONE",
    expiration_choice: "NONE",
    custom_expiration_date: null,
  },
  audit_summary: {
    request_count: 0,
    last_error: null,
    last_source_ip: null,
    last_path: null,
  },
};

describe("adminIntegrations config helpers", () => {
  it("ponechava jako jediny volny textovy vstup nazev integrace", () => {
    expect(onlyFreeTextFieldIds()).toEqual(["integration-name"]);
  });

  it("umi vytvorit prazdny draft a aplikovat profil opravneni", () => {
    const draft = buildEmptyIntegrationDraft(options);
    expect(draft.name).toBe("");
    expect(draft.selected_scope_ids).toEqual(["integration:health"]);

    const next = applyPermissionProfile(draft, "HEALTH_ONLY", options);
    expect(next.permission_profile_id).toBe("HEALTH_ONLY");
    expect(next.selected_scope_ids).toEqual(["integration:health"]);
  });

  it("umi naplnit edit draft z detailu klienta", () => {
    const draft = buildDraftFromClient(detail);
    expect(draft.name).toBe("Partner Export");
    expect(draft.data_scope_mode).toBe("ALL_ACTIVE_EMPLOYMENTS");
    expect(draft.selected_scope_ids).toEqual(["integration:health"]);
  });

  it("vraci specialni varovani pro mazani dochazky", () => {
    expect(integrationScopeWarning("attendance:delete")).toContain("nevratný zásah");
    expect(integrationScopeWarning("attendance:read")).toBeNull();
  });
});
