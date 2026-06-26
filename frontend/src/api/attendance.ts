import { apiFetch, ApiError } from "./client";
import type { ShiftPlanDayStatus } from "./adminShiftPlan";

export type AttendanceDay = {
  date: string;
  arrival_time: string | null;
  departure_time: string | null;
  planned_arrival_time: string | null;
  planned_departure_time: string | null;
  planned_status?: ShiftPlanDayStatus | null;
  is_within_employment_period: boolean;
};

export type AttendanceMonthResponse = {
  employment_id: number;
  employment_label: string;
  locked: boolean;
  days: AttendanceDay[];
};

export type AttendanceUpsertBody = {
  employment_id: number;
  date: string;
  arrival_time: string | null;
  departure_time: string | null;
};

export type DayStatusType = ShiftPlanDayStatus | null;
export type PortalDayStatusBody = {
  employment_id: number;
  date: string;
  status: DayStatusType;
  confirm_delete_conflicts?: boolean;
};

export type DayStatusConflictDetail = {
  code: "day_status_conflict";
  message: string;
  employment_id: number;
  date: string;
  next_status: ShiftPlanDayStatus;
  requires_confirmation: true;
  attendance_exists: boolean;
  shift_plan_exists: boolean;
};

async function fetchAttendanceWithPortalFallback<T>(
  path: string,
  options: {
    method: "GET" | "PUT";
    query?: Record<string, string | number | boolean | null | undefined>;
    body?: AttendanceUpsertBody | PortalDayStatusBody;
    instanceToken: string;
    signal?: AbortSignal;
  }
): Promise<T> {
  try {
    return await apiFetch<T>({
      path,
      method: options.method,
      query: options.query,
      body: options.body,
      instanceToken: options.instanceToken,
      signal: options.signal,
    });
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401) {
      throw err;
    }

    return apiFetch<T>({
      path,
      method: options.method,
      query: options.query,
      body: options.body,
      signal: options.signal,
    });
  }
}

export async function getAttendanceMonth(params: {
  employmentId: number;
  year: number;
  month: number;
  instanceToken: string;
  signal?: AbortSignal;
}): Promise<AttendanceMonthResponse> {
  const { employmentId, year, month, instanceToken, signal } = params;
  if (!Number.isInteger(year) || year < 1970 || year > 2100) {
    throw new ApiError(400, "Invalid year");
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new ApiError(400, "Invalid month");
  }
  if (!Number.isInteger(employmentId) || employmentId < 1) {
    throw new ApiError(400, "Invalid employmentId");
  }

  const mm = String(month).padStart(2, "0");
  return fetchAttendanceWithPortalFallback<AttendanceMonthResponse>("/api/v1/attendance", {
    method: "GET",
    query: { employment_id: employmentId, year, month: mm },
    instanceToken,
    signal,
  });
}

export async function upsertAttendance(params: {
  body: AttendanceUpsertBody;
  instanceToken: string;
  signal?: AbortSignal;
}): Promise<{ ok: true }> {
  const { body, instanceToken, signal } = params;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    throw new ApiError(400, "Invalid date format");
  }
  if (!Number.isInteger(body.employment_id) || body.employment_id < 1) {
    throw new ApiError(400, "Invalid employment_id");
  }
  for (const [key, value] of Object.entries({
    arrival_time: body.arrival_time,
    departure_time: body.departure_time,
  })) {
    if (value === null) continue;
    if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) {
      throw new ApiError(400, `Invalid ${key} format`);
    }
  }

  return fetchAttendanceWithPortalFallback<{ ok: true }>("/api/v1/attendance", {
    method: "PUT",
    body,
    instanceToken,
    signal,
  });
}

export function getAttendance(employmentId: number, year: number, month: number, instanceToken: string, signal?: AbortSignal) {
  return getAttendanceMonth({ employmentId, year, month, instanceToken, signal });
}

export function putAttendance(body: AttendanceUpsertBody, instanceToken: string, signal?: AbortSignal) {
  return upsertAttendance({ body, instanceToken, signal });
}

export async function upsertPortalDayStatus(
  body: PortalDayStatusBody,
  instanceToken: string,
  signal?: AbortSignal,
) {
  return fetchAttendanceWithPortalFallback<{ ok: true }>("/api/v1/shift-plan/day-status", {
    method: "PUT",
    body: {
      ...body,
      confirm_delete_conflicts: body.confirm_delete_conflicts ?? false,
    },
    instanceToken,
    signal,
  });
}
