import { z } from "zod";

export const employmentSchema = z.object({
  id: z.number(),
  title: z.string(),
  employment_type: z.string(),
  start_date: z.string(),
  end_date: z.string().nullable().optional(),
  is_active: z.boolean(),
  is_current: z.boolean().optional(),
  label: z.string().optional(),
});

export const portalLoginSchema = z.object({
  instance_token: z.string(),
  display_name: z.string(),
  employment_id: z.number().nullable(),
  available_employments: z.array(employmentSchema),
  afternoon_cutoff: z.string().nullable().optional(),
});

export const attendanceDaySchema = z.object({
  date: z.string(),
  arrival_time: z.string().nullable(),
  departure_time: z.string().nullable(),
  arrival_time_2: z.string().nullable().optional(),
  departure_time_2: z.string().nullable().optional(),
  planned_arrival_time: z.string().nullable(),
  planned_departure_time: z.string().nullable(),
  planned_status: z.string().nullable(),
  is_within_employment_period: z.boolean(),
});

export const attendanceMonthSchema = z.object({
  employment_id: z.number(),
  employment_label: z.string(),
  locked: z.boolean(),
  shift_plan_editable: z.boolean().optional(),
  days: z.array(attendanceDaySchema),
});

export type Employment = z.infer<typeof employmentSchema>;
export type PortalLogin = z.infer<typeof portalLoginSchema>;
export type AttendanceDay = z.infer<typeof attendanceDaySchema>;
export type AttendanceMonth = z.infer<typeof attendanceMonthSchema>;

export type PortalSession = PortalLogin & { selected_employment_id: number | null };

export interface AdminUser {
  id: number;
  email: string;
  name: string;
  phone?: string | null;
  role: string;
  is_active: boolean;
  last_login_at?: string | null;
  instance_id?: number | null;
  employment_count?: number;
  current_employment_count?: number;
  employments?: Employment[];
}

export interface AttendanceMatrixRow {
  employment_id: number;
  user_id: number;
  user_name: string;
  employment_label: string;
  employment_title: string;
  employment_type: string;
  user_is_active: boolean;
  employment_is_active: boolean;
  start_date: string;
  end_date: string | null;
  is_active_in_month: boolean;
  locked: boolean;
  days: AttendanceDay[];
}

export interface ShiftPlanRow {
  employment_id: number;
  user_id: number;
  user_name: string;
  employment_label: string;
  employment_type: string;
  selected: boolean;
  locked: boolean;
  employee_plan_edit_allowed?: boolean;
  employee_plan_edit_override?: boolean | null;
  days: Array<{
    date: string;
    arrival_time: string | null;
    departure_time: string | null;
    status: string | null;
    is_within_employment_period: boolean;
  }>;
}

export interface Instance {
  id: number;
  name: string | null;
  slug: string | null;
  status: string;
  is_active: boolean;
  is_template: boolean;
  claimed: boolean;
  last_seen_at: string | null;
  created_at: string;
}

export interface IntegrationClient {
  id: number;
  name: string;
  status: string;
  scopes: string[];
  token_prefix?: string | null;
  token_last4?: string | null;
  expires_at?: string | null;
  updated_at?: string;
}
