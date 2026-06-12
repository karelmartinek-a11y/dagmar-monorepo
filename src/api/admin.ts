import { apiFetch, ApiError } from "./client";
import { ensureCsrfToken, setCsrfToken, withCsrf } from "./csrf";
import type { EmploymentTemplate } from "../types/employment";

export type AdminMe = {
  authenticated: boolean;
  username?: string;
};

export type InstanceStatus = "PENDING" | "ACTIVE" | "REVOKED" | "DEACTIVATED";
export type ClientType = "ANDROID" | "WEB";

export type AdminInstance = {
  id: string;
  client_type: ClientType;
  status: InstanceStatus;
  display_name: string | null;
  profile_instance_id?: string | null;
  created_at: string;
  last_seen_at: string | null;
  afternoon_cutoff?: string | null;
  activated_at?: string | null;
  revoked_at?: string | null;
  deactivated_at?: string | null;
  employment_template: EmploymentTemplate;
};

export type AdminEmployment = {
  id: number;
  user_id: number;
  title: string;
  employment_type: EmploymentTemplate;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  label: string;
};

export type PortalUser = {
  id: number;
  name: string;
  email: string;
  phone?: string | null;
  role: string;
  has_password: boolean;
  is_active: boolean;
  is_locked: boolean;
  locked_until?: string | null;
  login_status: "ACTIVE" | "DEACTIVATED" | "EMPLOYMENT_WINDOW_BLOCKED";
  login_status_reason?: string | null;
  employments: AdminEmployment[];
};

export type AdminUsersResponse = {
  users: PortalUser[];
};

export type EmploymentPeriodConflict = {
  code: "employment_period_conflict";
  message: string;
  attendance_count: number;
  shift_plan_count: number;
  attendance_lock_count: number;
  shift_plan_selection_count: number;
  reminder_count: number;
  problem_range_start: string | null;
  problem_range_end: string | null;
  requires_confirmation: true;
};

export type EmploymentDeleteConflict = {
  code: "employment_delete_conflict";
  message: string;
  attendance_count: number;
  shift_plan_count: number;
  attendance_lock_count: number;
  shift_plan_selection_count: number;
  reminder_count: number;
  problem_range_start: string | null;
  problem_range_end: string | null;
  requires_confirmation: true;
};

export type EmploymentUpdateResult =
  | AdminEmployment
  | {
      ok: true;
      deleted_attendance_count: number;
      deleted_shift_plan_count: number;
      deleted_attendance_lock_count: number;
      deleted_shift_plan_selection_count: number;
      deleted_reminder_count: number;
    };

export type AdminLoginRequest = {
  username?: string;
  email?: string;
  password: string;
};

export type AdminLoginResponse = {
  ok: true;
  csrf_token?: string;
};

export type CsrfTokenResponse = {
  csrf_token: string;
};

export async function adminLogin(body: AdminLoginRequest): Promise<AdminLoginResponse> {
  const csrf = await ensureCsrfToken();

  try {
    const res = await apiFetch<AdminLoginResponse>("/api/v1/admin/login", {
      method: "POST",
      headers: withCsrf(),
      csrfToken: csrf,
      body,
    });
    if (res?.csrf_token) setCsrfToken(res.csrf_token);
    return res;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && body.username && !body.email) {
      const fallbackRes = await apiFetch<AdminLoginResponse>("/api/v1/admin/login", {
        method: "POST",
        headers: withCsrf(),
        csrfToken: csrf,
        body: { email: body.username, password: body.password },
      });
      if (fallbackRes?.csrf_token) setCsrfToken(fallbackRes.csrf_token);
      return fallbackRes;
    }
    throw err;
  }
}

export async function adminLogout(): Promise<{ ok: true }> {
  const res = await apiFetch<{ ok: true }>("/api/v1/admin/logout", {
    method: "POST",
    headers: withCsrf(),
  });
  sessionStorage.removeItem("dagmar_csrf");
  return res;
}

export async function adminForgotPassword(email: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>("/api/v1/admin/forgot-password", {
    method: "POST",
    headers: withCsrf(),
    body: { email },
  });
}

export async function adminMe(): Promise<AdminMe> {
  try {
    return await apiFetch<AdminMe>("/api/v1/admin/me", { method: "GET" });
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      return { authenticated: false };
    }
    throw e;
  }
}

export async function adminListUsers(): Promise<AdminUsersResponse> {
  return apiFetch<AdminUsersResponse>("/api/v1/admin/users", { method: "GET" });
}

export async function adminCreateUser(payload: {
  name: string;
  email: string;
  phone?: string | null;
  role: string;
  password?: string | null;
  is_active?: boolean;
}): Promise<PortalUser> {
  return apiFetch<PortalUser>("/api/v1/admin/users", {
    method: "POST",
    headers: withCsrf(),
    body: payload,
  });
}

export type AdminUpdateUserPayload = {
  name?: string;
  email?: string;
  phone?: string | null;
  role?: string;
  password?: string | null;
  is_active?: boolean;
};

export async function adminUpdateUser(userId: number, payload: AdminUpdateUserPayload): Promise<PortalUser> {
  return apiFetch<PortalUser>(`/api/v1/admin/users/${encodeURIComponent(String(userId))}`, {
    method: "PUT",
    headers: withCsrf(),
    body: payload,
  });
}

export async function adminSendUserReset(userId: number): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/api/v1/admin/users/${encodeURIComponent(String(userId))}/send-reset`, {
    method: "POST",
    headers: withCsrf(),
  });
}

export async function adminDeleteUser(userId: number): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/api/v1/admin/users/${encodeURIComponent(String(userId))}`, {
    method: "DELETE",
    headers: withCsrf(),
  });
}

export async function adminUnlockUser(userId: number): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/api/v1/admin/users/${encodeURIComponent(String(userId))}/unlock`, {
    method: "POST",
    headers: withCsrf(),
  });
}

export async function adminListEmployments(userId: number): Promise<AdminEmployment[]> {
  return apiFetch<AdminEmployment[]>(`/api/v1/admin/users/${encodeURIComponent(String(userId))}/employments`, {
    method: "GET",
  });
}

export async function adminCreateEmployment(
  userId: number,
  payload: {
    title: string;
    employment_type: EmploymentTemplate;
    start_date: string;
    end_date: string | null;
    is_active?: boolean;
  }
): Promise<AdminEmployment> {
  return apiFetch<AdminEmployment>(`/api/v1/admin/users/${encodeURIComponent(String(userId))}/employments`, {
    method: "POST",
    headers: withCsrf(),
    body: payload,
  });
}

export async function adminUpdateEmployment(
  employmentId: number,
  payload: {
    title?: string;
    employment_type?: EmploymentTemplate;
    start_date?: string;
    end_date?: string | null;
    is_active?: boolean;
    confirm_delete_out_of_range?: boolean;
  }
): Promise<EmploymentUpdateResult> {
  try {
    return await apiFetch<EmploymentUpdateResult>(`/api/v1/admin/employments/${encodeURIComponent(String(employmentId))}`, {
      method: "PUT",
      headers: withCsrf(),
      body: payload,
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      const detail = error.body?.detail;
      if (detail && typeof detail === "object" && (detail as EmploymentPeriodConflict).code === "employment_period_conflict") {
        throw detail as EmploymentPeriodConflict;
      }
    }
    throw error;
  }
}

export async function adminDeleteEmployment(
  employmentId: number,
  payload?: { confirm_delete_related?: boolean }
): Promise<{ ok: true }> {
  try {
    return await apiFetch<{ ok: true }>(`/api/v1/admin/employments/${encodeURIComponent(String(employmentId))}`, {
      method: "DELETE",
      headers: withCsrf(),
      body: payload,
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      const detail = error.body?.detail;
      if (detail && typeof detail === "object" && (detail as EmploymentDeleteConflict).code === "employment_delete_conflict") {
        throw detail as EmploymentDeleteConflict;
      }
    }
    throw error;
  }
}

export type SmtpSettings = {
  host?: string | null;
  port?: number | null;
  security?: string | null;
  username?: string | null;
  from_email?: string | null;
  from_name?: string | null;
  password_set?: boolean;
};

export async function adminGetSmtpSettings(): Promise<SmtpSettings> {
  return apiFetch<SmtpSettings>("/api/v1/admin/smtp", { method: "GET" });
}

export async function adminSaveSmtpSettings(payload: {
  host?: string | null;
  port?: number | null;
  security?: string | null;
  username?: string | null;
  password?: string | null;
  from_email?: string | null;
  from_name?: string | null;
}): Promise<SmtpSettings> {
  return apiFetch<SmtpSettings>("/api/v1/admin/smtp", {
    method: "PUT",
    headers: withCsrf(),
    body: payload,
  });
}

export async function adminListInstances(): Promise<{ instances: AdminInstance[] }> {
  const items = await apiFetch<AdminInstance[]>("/api/v1/admin/instances", {
    method: "GET",
  });
  return { instances: items };
}

export async function adminActivateInstance(
  id: string,
  display_name: string,
  employment_template: EmploymentTemplate = "DPP_DPC"
): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/api/v1/admin/instances/${encodeURIComponent(id)}/activate`, {
    method: "POST",
    headers: withCsrf(),
    body: { display_name, employment_template },
  });
}

export async function adminRenameInstance(id: string, display_name: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/api/v1/admin/instances/${encodeURIComponent(id)}/rename`, {
    method: "POST",
    headers: withCsrf(),
    body: { display_name },
  });
}

export async function adminRevokeInstance(id: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/api/v1/admin/instances/${encodeURIComponent(id)}/revoke`, {
    method: "POST",
    headers: withCsrf(),
  });
}

export async function adminSetTemplate(id: string, employment_template: EmploymentTemplate): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/api/v1/admin/instances/${encodeURIComponent(id)}/set-template`, {
    method: "POST",
    headers: withCsrf(),
    body: { employment_template },
  });
}

export async function adminDeactivateInstance(id: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/api/v1/admin/instances/${encodeURIComponent(id)}/deactivate`, {
    method: "POST",
    headers: withCsrf(),
  });
}

export async function adminMergeInstances(
  target_id: string,
  source_ids: string[]
): Promise<{ ok: true; merged_count: number }> {
  return apiFetch<{ ok: true; merged_count: number }>("/api/v1/admin/instances/merge", {
    method: "POST",
    headers: withCsrf(),
    body: { target_id, source_ids },
  });
}

export type AdminSettings = { afternoon_cutoff: string };

export async function adminGetSettings(): Promise<AdminSettings> {
  return apiFetch<AdminSettings>("/api/v1/admin/settings", { method: "GET" });
}

export async function adminSetSettings(cutoff: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>("/api/v1/admin/settings", {
    method: "PUT",
    headers: withCsrf(),
    body: { afternoon_cutoff: cutoff },
  });
}

export async function adminDeleteInstance(id: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/api/v1/admin/instances/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: withCsrf(),
  });
}

export async function adminDeletePendingInstances(): Promise<{ ok: true; deleted: number }> {
  return apiFetch<{ ok: true; deleted: number }>("/api/v1/admin/instances/pending", {
    method: "DELETE",
    headers: withCsrf(),
  });
}

export function adminExportUrl(params: { month: string; employment_id?: number; bulk?: boolean }): string {
  const q = new URLSearchParams();
  q.set("month", params.month);
  if (params.employment_id) q.set("employment_id", String(params.employment_id));
  if (params.bulk) q.set("bulk", "true");
  return `/api/v1/admin/export?${q.toString()}`;
}

export async function ensureAdminCsrfReady(): Promise<void> {
  void ensureCsrfToken();
}

export const getAdminMe = adminMe;
export const postAdminLogout = adminLogout;
export const listInstances = async (): Promise<
  Array<{
    id: string;
    client_type: ClientType;
    status: InstanceStatus;
    display_name: string | null;
    created_at: string;
    last_seen: string | null;
  }>
> => {
  const res = await adminListInstances();
  return res.instances.map((i) => {
    const legacyLastSeen = "last_seen" in i ? (i as { last_seen?: string | null }).last_seen : null;
    return {
      id: i.id,
      client_type: i.client_type,
      status: i.status,
      display_name: i.display_name,
      created_at: i.created_at,
      last_seen: i.last_seen_at ?? legacyLastSeen ?? null,
    };
  });
};
export const activateInstance = adminActivateInstance;
export const renameInstance = adminRenameInstance;
export const revokeInstance = adminRevokeInstance;
export const deleteInstance = adminDeleteInstance;
export const deletePendingInstances = adminDeletePendingInstances;

export function adminExportBulkUrl(month: string): string {
  return adminExportUrl({ month, bulk: true });
}

export function adminExportEmploymentUrl(month: string, employmentId: number): string {
  return adminExportUrl({ month, employment_id: employmentId });
}
