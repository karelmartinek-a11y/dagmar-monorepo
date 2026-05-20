import { apiFetch } from "./client";
import { ensureCsrfToken } from "./csrf";
import type { EmploymentTemplate } from "../types/employment";

export type ActiveEmployment = {
  id: number;
  user_id: number;
  user_name: string;
  title: string;
  employment_type: EmploymentTemplate;
  display_label: string;
  start_date: string;
  end_date: string | null;
};

export type ShiftPlanDay = {
  date: string;
  arrival_time: string | null;
  departure_time: string | null;
  status?: ShiftPlanDayStatus | null;
  is_within_employment_period: boolean;
};

export type ShiftPlanDayStatus = "HOLIDAY" | "OFF";

export type ShiftPlanRow = {
  employment_id: number;
  user_name: string;
  title: string;
  employment_type: EmploymentTemplate;
  display_label: string;
  days: ShiftPlanDay[];
};

export type ShiftPlanMonth = {
  year: number;
  month: number;
  selected_employment_ids: number[];
  available_employments: ActiveEmployment[];
  rows: ShiftPlanRow[];
};

export type ShiftPlanSelectionRequest = {
  year: number;
  month: number;
  employment_ids: number[];
};

export type ShiftPlanUpsertRequest = {
  employment_id: number;
  date: string;
  arrival_time: string | null;
  departure_time: string | null;
  status?: ShiftPlanDayStatus | null;
};

export async function adminGetShiftPlanMonth(params: { year: number; month: number }): Promise<ShiftPlanMonth> {
  const { year, month } = params;
  if (!Number.isInteger(year) || year < 1970 || year > 2100) {
    throw new Error("Invalid year");
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Invalid month");
  }
  const mm = String(month).padStart(2, "0");
  return apiFetch<ShiftPlanMonth>({
    path: "/api/v1/admin/shift-plan",
    method: "GET",
    query: { year, month: mm },
  });
}

export async function adminUpsertShiftPlan(body: ShiftPlanUpsertRequest): Promise<{ ok: true }> {
  const csrf = await ensureCsrfToken();
  return apiFetch<{ ok: true }>({
    path: "/api/v1/admin/shift-plan",
    method: "PUT",
    body,
    csrfToken: csrf,
  });
}

export async function adminSetShiftPlanSelection(body: ShiftPlanSelectionRequest): Promise<{ ok: true }> {
  const csrf = await ensureCsrfToken();
  return apiFetch<{ ok: true }>({
    path: "/api/v1/admin/shift-plan/selection",
    method: "PUT",
    body,
    csrfToken: csrf,
  });
}
