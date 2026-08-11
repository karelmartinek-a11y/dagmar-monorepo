import type { ZodType } from "zod";
import { attendanceMonthSchema, employmentSchema, portalLoginSchema, type AttendanceMonth, type AuthMethods, type Employment, type ExternalProvider, type PortalLogin } from "./types";
import { i18n } from "../i18n";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly requestId: string | null,
  ) {
    super(message);
  }
  get conflict() { return this.status === 409 || this.status === 423; }
  get authenticationExpired() { return this.status === 401; }
  get offline() { return this.status === 0; }
}

type Mode = "public" | "portal" | "admin";
let adminCsrfToken: string | null = null;
let portalCsrfToken: string | null = null;

async function csrf(mode: "admin" | "portal"): Promise<string> {
  const cached = mode === "admin" ? adminCsrfToken : portalCsrfToken;
  if (cached) return cached;
  const response = await fetch(`/api/v1/${mode}/csrf`, { credentials: "include" });
  if (!response.ok) throw await responseError(response);
  const payload = await response.json() as { csrf_token: string };
  if (mode === "admin") adminCsrfToken = payload.csrf_token;
  else portalCsrfToken = payload.csrf_token;
  return payload.csrf_token;
}

async function responseError(response: Response): Promise<ApiError> {
  let message: string = String(i18n.t("api.genericError", { status: response.status }));
  let code: string | null = null;
  let requestId: string | null = response.headers.get("x-request-id");
  try {
    const body = await response.json() as {
      error?: { message?: string; code?: string; details?: Record<string, unknown>; request_id?: string };
    };
    const params = body.error?.details ?? {};
    code = body.error?.code ?? null;
    requestId = body.error?.request_id ?? requestId;
    if (code && i18n.exists(`apiErrors.${code}`)) {
      message = String(i18n.t(`apiErrors.${code}`, params));
    } else if (body.error?.message) {
      message = body.error.message;
    }
  } catch { /* response is not JSON */ }
  return new ApiError(message, response.status, code, requestId);
}

export async function request<T>(
  path: string,
  options: RequestInit = {},
  mode: Mode = "public",
  schema?: ZodType<T>,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const method = (options.method ?? "GET").toUpperCase();
  if ((mode === "admin" || mode === "portal") && !["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers.set("X-CSRF-Token", await csrf(mode));
  }
  let response: Response;
  try {
    response = await fetch(path, { ...options, headers, credentials: mode === "public" ? "same-origin" : "include" });
  } catch {
    throw new ApiError(i18n.t("common.status.networkOffline"), 0, "offline", null);
  }
  if (!response.ok) {
    if (response.status === 403 && mode === "admin") adminCsrfToken = null;
    if (response.status === 403 && mode === "portal") portalCsrfToken = null;
    throw await responseError(response);
  }
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("json") ? await response.json() : await response.text();
  return schema ? schema.parse(payload) : payload as T;
}

export async function requestBlob(
  path: string,
  options: RequestInit = {},
  mode: Mode = "public",
): Promise<{ blob: Blob; filename: string | null; contentType: string | null }> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const method = (options.method ?? "GET").toUpperCase();
  if ((mode === "admin" || mode === "portal") && !["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers.set("X-CSRF-Token", await csrf(mode));
  }
  let response: Response;
  try {
    response = await fetch(path, { ...options, headers, credentials: mode === "public" ? "same-origin" : "include" });
  } catch {
    throw new ApiError(i18n.t("common.status.networkOffline"), 0, "offline", null);
  }
  if (!response.ok) {
    if (response.status === 403 && mode === "admin") adminCsrfToken = null;
    if (response.status === 403 && mode === "portal") portalCsrfToken = null;
    throw await responseError(response);
  }
  const disposition = response.headers.get("content-disposition");
  const match = disposition ? /filename="([^"]+)"/i.exec(disposition) : null;
  return {
    blob: await response.blob(),
    filename: match?.[1] ?? null,
    contentType: response.headers.get("content-type"),
  };
}

export const api = {
  portalLogin: (email: string, password: string): Promise<PortalLogin> => request(
    "/api/v1/portal/login", { method: "POST", body: JSON.stringify({ email, password }) }, "public", portalLoginSchema,
  ),
  portalSession: (): Promise<PortalLogin> => request(
    "/api/v1/portal/session", {}, "portal", portalLoginSchema,
  ),
  portalLogout: async () => {
    const result = await request<{ ok: boolean }>("/api/v1/portal/logout", { method: "POST" }, "portal");
    portalCsrfToken = null;
    return result;
  },
  portalReset: (token: string, password: string) => request<{ ok: boolean }>(
    "/api/v1/portal/reset", { method: "POST", body: JSON.stringify({ token, password }) },
  ),
  externalProviders: () => request<{ google: boolean; apple: boolean }>("/api/v1/auth/providers"),
  externalLoginUrl: (portal: "employee" | "admin", provider: ExternalProvider, returnPath: string) =>
    `/api/v1/auth/${portal}/${provider}/start?return_path=${encodeURIComponent(returnPath)}`,
  consumeExternalLogin: (): Promise<PortalLogin> => request(
    "/api/v1/auth/result", { method: "POST" }, "public", portalLoginSchema,
  ),
  authMethods: (portal: "employee" | "admin"): Promise<AuthMethods> => request(
    `/api/v1/${portal === "employee" ? "portal" : "admin"}/auth-methods`, {}, portal === "employee" ? "portal" : "admin",
  ),
  linkAuthMethod: (portal: "employee" | "admin", provider: ExternalProvider, password: string): Promise<{ authorization_url: string }> => request(
    `/api/v1/${portal === "employee" ? "portal" : "admin"}/auth-methods/${provider}/link`,
    { method: "POST", body: JSON.stringify({ password, return_path: portal === "employee" ? "/app" : "/admin/ucet" }) },
    portal === "employee" ? "portal" : "admin",
  ),
  unlinkAuthMethod: (portal: "employee" | "admin", provider: ExternalProvider, password: string) => request<{ ok: boolean }>(
    `/api/v1/${portal === "employee" ? "portal" : "admin"}/auth-methods/${provider}`,
    { method: "DELETE", body: JSON.stringify({ password }) },
    portal === "employee" ? "portal" : "admin",
  ),
  attendance: (employmentId: number, year: number, month: number): Promise<AttendanceMonth> => request(
    `/api/v1/attendance?employment_id=${employmentId}&year=${year}&month=${month}`, {}, "portal", attendanceMonthSchema,
  ),
  attendanceEmployments: (year: number, month: number): Promise<Employment[]> => request(
    `/api/v1/attendance/employments?year=${year}&month=${month}`, {}, "portal", employmentSchema.array(),
  ),
  createAttendanceEvent: (payload: { employment_id: number; occurred_at: string; event_type: "IN" | "OUT"; paired_occurred_at?: string }) => request<{ id: number; employment_id: number; occurred_at: string; event_type: "IN" | "OUT" }>(
    "/api/v1/attendance/events", { method: "POST", body: JSON.stringify(payload) }, "portal",
  ),
  updateAttendanceEvent: (eventId: number, payload: { employment_id: number; occurred_at: string; event_type: "IN" | "OUT" }) => request<{ id: number; employment_id: number; occurred_at: string; event_type: "IN" | "OUT" }>(
    `/api/v1/attendance/events/${eventId}`, { method: "PUT", body: JSON.stringify(payload) }, "portal",
  ),
  deleteAttendanceEvent: (eventId: number, pairedEventId?: number) => request<{ ok: boolean }>(
    `/api/v1/attendance/events/${eventId}${pairedEventId == null ? "" : `?paired_event_id=${pairedEventId}`}`,
    { method: "DELETE" },
    "portal",
  ),
  savePortalStatus: (payload: Record<string, unknown>) => request<{ ok: boolean }>(
    "/api/v1/shift-plan/day-status", { method: "PUT", body: JSON.stringify(payload) }, "portal",
  ),
  savePortalAttendanceStatus: (payload: Record<string, unknown>) => request<{ ok: boolean }>(
    "/api/v1/attendance/day-status", { method: "PUT", body: JSON.stringify(payload) }, "portal",
  ),
  saveShiftPlan: (payload: Record<string, unknown>) => request<{ ok: boolean }>(
    "/api/v1/shift-plan", { method: "PUT", body: JSON.stringify(payload) }, "portal",
  ),
  shiftPlanGroups: (year: number, month: number) => request<{ groups: Array<{ id: number; name: string }> }>(`/api/v1/shift-plan/groups?year=${year}&month=${month}`, {}, "portal").then((result) => result.groups),
  groupShiftPlan: (groupId: number, year: number, month: number) => request<import("./types").GroupShiftPlanMonth>(
    `/api/v1/shift-plan/groups/${groupId}?year=${year}&month=${month}`, {}, "portal",
  ),
  adminMe: () => request<{ authenticated: boolean; username: string | null }>("/api/v1/admin/me", {}, "admin"),
  adminLogin: async (username: string, password: string) => {
    adminCsrfToken = null;
    return request<{ ok: boolean }>("/api/v1/admin/login", { method: "POST", body: JSON.stringify({ username, password }) }, "admin");
  },
  adminLogout: async () => {
    const result = await request<{ ok: boolean }>("/api/v1/admin/logout", { method: "POST" }, "admin");
    adminCsrfToken = null;
    return result;
  },
  admin: <T>(path: string, options: RequestInit = {}) => request<T>(path, options, "admin"),
  adminBlob: (path: string, options: RequestInit = {}) => requestBlob(path, options, "admin"),
};
