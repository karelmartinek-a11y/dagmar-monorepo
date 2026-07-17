import type { ZodType } from "zod";
import { attendanceMonthSchema, portalLoginSchema, type AttendanceMonth, type PortalLogin } from "./types";
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
let csrfToken: string | null = null;
let portalToken: string | null = null;

export function setPortalToken(token: string | null) { portalToken = token; }

async function csrf(): Promise<string> {
  if (csrfToken) return csrfToken;
  const response = await fetch("/api/v1/admin/csrf", { credentials: "include" });
  if (!response.ok) throw await responseError(response);
  const payload = await response.json() as { csrf_token: string };
  csrfToken = payload.csrf_token;
  return csrfToken;
}

async function responseError(response: Response): Promise<ApiError> {
  let message: string = String(i18n.t("api.genericError", { status: response.status }));
  let code: string | null = null;
  try {
    const body = await response.json() as {
      detail?: unknown;
      error?: { message?: string; code?: string; params?: Record<string, unknown> };
    };
    const detailObject = typeof body.detail === "object" && body.detail !== null
      ? body.detail as { code?: string; message?: string; params?: Record<string, unknown> }
      : null;
    const params = body.error?.params ?? detailObject?.params ?? {};
    code = body.error?.code ?? detailObject?.code ?? null;
    if (code && i18n.exists(`apiErrors.${code}`)) {
      message = String(i18n.t(`apiErrors.${code}`, params));
    } else if (typeof body.detail === "string") {
      message = body.detail;
    } else if (detailObject?.message) {
      message = detailObject.message;
    } else if (body.error?.message) {
      message = body.error.message;
    }
  } catch { /* response is not JSON */ }
  return new ApiError(message, response.status, code, response.headers.get("x-request-id"));
}

export async function request<T>(
  path: string,
  options: RequestInit = {},
  mode: Mode = "public",
  schema?: ZodType<T>,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (mode === "portal" && portalToken) headers.set("Authorization", `Bearer ${portalToken}`);
  const method = (options.method ?? "GET").toUpperCase();
  if (mode === "admin" && !["GET", "HEAD", "OPTIONS"].includes(method)) headers.set("X-CSRF-Token", await csrf());
  let response: Response;
  try {
    response = await fetch(path, { ...options, headers, credentials: mode === "admin" ? "include" : "same-origin" });
  } catch {
    throw new ApiError(i18n.t("common.status.networkOffline"), 0, "offline", null);
  }
  if (!response.ok) {
    if (response.status === 403 && mode === "admin") csrfToken = null;
    throw await responseError(response);
  }
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("json") ? await response.json() : await response.text();
  return schema ? schema.parse(payload) : payload as T;
}

export const api = {
  portalLogin: (email: string, password: string): Promise<PortalLogin> => request(
    "/api/v1/portal/login", { method: "POST", body: JSON.stringify({ email, password }) }, "public", portalLoginSchema,
  ),
  portalReset: (token: string, password: string) => request<{ ok: boolean }>(
    "/api/v1/portal/reset", { method: "POST", body: JSON.stringify({ token, password }) },
  ),
  attendance: (employmentId: number, year: number, month: number): Promise<AttendanceMonth> => request(
    `/api/v1/attendance?employment_id=${employmentId}&year=${year}&month=${month}`, {}, "portal", attendanceMonthSchema,
  ),
  saveAttendance: (payload: Record<string, unknown>) => request<{ ok: boolean }>(
    "/api/v1/attendance", { method: "PUT", body: JSON.stringify(payload) }, "portal",
  ),
  savePortalStatus: (payload: Record<string, unknown>) => request<{ ok: boolean }>(
    "/api/v1/shift-plan/day-status", { method: "PUT", body: JSON.stringify(payload) }, "portal",
  ),
  saveShiftPlan: (payload: Record<string, unknown>) => request<{ ok: boolean }>(
    "/api/v1/shift-plan", { method: "PUT", body: JSON.stringify(payload) }, "portal",
  ),
  adminMe: () => request<{ authenticated: boolean; username: string | null }>("/api/v1/admin/me", {}, "admin"),
  adminLogin: async (username: string, password: string) => {
    csrfToken = null;
    return request<{ ok: boolean }>("/api/v1/admin/login", { method: "POST", body: JSON.stringify({ username, password }) }, "admin");
  },
  adminLogout: async () => {
    const result = await request<{ ok: boolean }>("/api/v1/admin/logout", { method: "POST" }, "admin");
    csrfToken = null;
    return result;
  },
  admin: <T>(path: string, options: RequestInit = {}) => request<T>(path, options, "admin"),
};
