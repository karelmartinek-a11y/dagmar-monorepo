import { apiFetch, ApiError } from "./client";
import { adminUpsertDayStatus, type ShiftPlanDayStatus } from "./adminShiftPlan";
import { ensureCsrfToken } from "./csrf";

export type AdminAttendanceDay = {
  date: string;
  arrival_time: string | null;
  departure_time: string | null;
  planned_arrival_time?: string | null;
  planned_departure_time?: string | null;
  planned_status?: ShiftPlanDayStatus | null;
  is_within_employment_period: boolean;
};

export type AdminAttendanceMonthResponse = {
  employment_id: number;
  employment_label: string;
  days: AdminAttendanceDay[];
  locked: boolean;
};

export type AdminAttendanceUpsertBody = {
  employment_id: number;
  date: string;
  arrival_time: string | null;
  departure_time: string | null;
};

export async function adminGetAttendanceMonth(params: {
  employmentId: number;
  year: number;
  month: number;
  signal?: AbortSignal;
}): Promise<AdminAttendanceMonthResponse> {
  const { employmentId, year, month, signal } = params;
  if (!Number.isInteger(year) || year < 1970 || year > 2100) {
    throw new ApiError(400, "Invalid year");
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new ApiError(400, "Invalid month");
  }

  return apiFetch<AdminAttendanceMonthResponse>({
    path: "/api/v1/admin/attendance",
    method: "GET",
    query: { employment_id: employmentId, year, month },
    signal,
  });
}

export async function adminUpsertAttendance(body: AdminAttendanceUpsertBody): Promise<{ ok: true }> {
  const csrf = await ensureCsrfToken();
  return apiFetch<{ ok: true }>({
    path: "/api/v1/admin/attendance",
    method: "PUT",
    body,
    csrfToken: csrf,
  });
}

export async function adminLockAttendance(body: { employment_id: number; year: number; month: number }): Promise<{ ok: true }> {
  const csrf = await ensureCsrfToken();
  return apiFetch<{ ok: true }>({
    path: "/api/v1/admin/attendance/lock",
    method: "POST",
    body,
    csrfToken: csrf,
  });
}

export async function adminUnlockAttendance(body: { employment_id: number; year: number; month: number }): Promise<{ ok: true }> {
  const csrf = await ensureCsrfToken();
  return apiFetch<{ ok: true }>({
    path: "/api/v1/admin/attendance/unlock",
    method: "POST",
    body,
    csrfToken: csrf,
  });
}

export { adminUpsertDayStatus };
