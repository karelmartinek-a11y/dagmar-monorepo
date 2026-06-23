import type {
  IntegrationClientConfiguration,
  IntegrationClientDetail,
  IntegrationClientOptions,
} from "../api/admin";

export type IntegrationDraft = IntegrationClientConfiguration & {
  name: string;
};

export function onlyFreeTextFieldIds(): string[] {
  return ["integration-name"];
}

export function buildEmptyIntegrationDraft(options: IntegrationClientOptions): IntegrationDraft {
  const defaultProfile = options.permission_profiles[0];
  return {
    name: "",
    selected_scope_ids: [...(defaultProfile?.scopes ?? [])],
    permission_profile_id: defaultProfile?.id ?? null,
    data_scope_mode: "ALL_ACTIVE_EMPLOYMENTS",
    selected_employee_ids: [],
    selected_employment_ids: [],
    include_inactive_employments: false,
    ip_restriction_mode: "NONE",
    expiration_choice: "NONE",
    custom_expiration_date: null,
  };
}

export function buildDraftFromClient(client: IntegrationClientDetail): IntegrationDraft {
  return {
    name: client.name,
    ...client.configuration,
  };
}

export function applyPermissionProfile(
  current: IntegrationDraft,
  profileId: string,
  options: IntegrationClientOptions,
): IntegrationDraft {
  const profile = options.permission_profiles.find((item) => item.id === profileId);
  if (!profile) {
    return { ...current, permission_profile_id: null };
  }
  return {
    ...current,
    permission_profile_id: profile.id,
    selected_scope_ids: [...profile.scopes].sort(),
  };
}

export function normalizeScopeSelection(scopeIds: string[]): string[] {
  return Array.from(new Set(scopeIds)).sort();
}

export function integrationScopeWarning(scopeId: string): string | null {
  if (scopeId === "attendance:delete") {
    return "Mazání docházky je nevratný zásah do evidence. Zapínejte jen pro auditovaný proces oprav a jen po výslovném schválení správce.";
  }
  return null;
}
