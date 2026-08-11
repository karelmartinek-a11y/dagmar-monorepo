import { z } from "zod";

export const metricSchema = z.object({
  minutes: z.number(),
  tenths: z.number(),
  hours: z.number(),
});
export const timeMetricsSchema = z.object({
  total: metricSchema.nullable(),
  afternoon: metricSchema.nullable(),
  night: metricSchema.nullable(),
  weekend: metricSchema.nullable(),
  public_holiday: metricSchema.nullable(),
});
export const employmentSchema = z.object({
  id: z.number(),
  user_id: z.number().optional(),
  title: z.string(),
  employment_type: z.enum([
    "WORK_CONTRACT",
    "DPP_DPC",
    "TASK_SHIFT_BASED",
    "EXTERNAL_HOURLY",
  ]),
  start_date: z.string(),
  end_date: z.string().nullable().optional(),
  is_active: z.boolean(),
  is_current: z.boolean().optional(),
  label: z.string().optional(),
  workload_fraction: z.string().nullable().optional(),
  time_profile: z.record(z.string(), z.unknown()).optional(),
});
export const portalLoginSchema = z.object({
  display_name: z.string(),
  employment_id: z.number().nullable(),
  available_employments: z.array(employmentSchema),
});
export const attendanceEventSchema = z.object({
  id: z.number(),
  employment_id: z.number(),
  occurred_at: z.string(),
  event_type: z.enum(["IN", "OUT"]),
  deletion_partner_id: z.number().nullable().optional(),
});
export const metricKeySchema = z.enum([
  "total",
  "afternoon",
  "night",
  "weekend",
  "public_holiday",
]);
export const attendanceDaySchema = z.object({
  date: z.string(),
  events: z.array(attendanceEventSchema),
  attendance_status: z.string().nullable().optional(),
  effective_status: z.string().nullable().optional(),
  planned_arrival_time: z.string().nullable().optional(),
  planned_departure_time: z.string().nullable().optional(),
  planned_status: z.string().nullable().optional(),
  planned_is_carryover: z.boolean(),
  planned_carryover_departure_time: z.string().nullable().optional(),
  next_event_type: z.enum(["IN", "OUT"]),
  calendar_tone: z.enum(["holiday", "weekend", "work"]),
  public_holiday_label: z.string().nullable(),
  is_within_employment_period: z.boolean(),
  worked: timeMetricsSchema.nullable(),
  planned: timeMetricsSchema.nullable(),
  worked_state: z.string(),
  planned_state: z.string(),
});
export const attendanceMonthSchema = z.object({
  employment_id: z.number(),
  employment_label: z.string(),
  display_metrics: z.array(metricKeySchema),
  days: z.array(attendanceDaySchema),
  worked: timeMetricsSchema.nullable(),
  planned: timeMetricsSchema.nullable(),
  attendance_locked: z.boolean(),
  shift_plan_locked: z.boolean(),
});

export type Metric = z.infer<typeof metricSchema>;
export type TimeMetrics = z.infer<typeof timeMetricsSchema>;
export type Employment = z.infer<typeof employmentSchema>;
export type PortalLogin = z.infer<typeof portalLoginSchema>;
export type AttendanceEvent = z.infer<typeof attendanceEventSchema>;
export type AttendanceDay = z.infer<typeof attendanceDaySchema>;
export type AttendanceMonth = z.infer<typeof attendanceMonthSchema>;
export type AttendanceMonthSummary = TimeMetrics;
export type MetricKey = z.infer<typeof metricKeySchema>;

export interface EmploymentGroupMember {
  employment_id: number;
  user_name: string;
  title: string;
  employment_type: string;
  display_label: string;
  start_date: string;
  end_date: string | null;
}
export interface EmploymentGroup {
  id: number;
  name: string;
  members: EmploymentGroupMember[];
}
export interface GroupShiftPlanMonth {
  group_id: number;
  group_name: string;
  year: number;
  month: number;
  rows: Array<{
    employment_id: number;
    display_label: string;
    is_own_employment: boolean;
    shift_plan_locked: boolean;
    display_metrics: MetricKey[];
    planned_minutes: number;
    planned_hours: number;
    planned: TimeMetrics | null;
    days: Array<{
      date: string;
      arrival_time: string | null;
      departure_time: string | null;
      status: string | null;
      effective_status: string | null;
      is_carryover: boolean;
      carryover_departure_time: string | null;
      is_within_employment_period: boolean;
      planned_minutes: number;
      planned_hours: number;
      planned_state: string;
      planned: TimeMetrics | null;
    }>;
  }>;
}
export type PortalSession = PortalLogin & {
  selected_employment_id: number | null;
};
export type ExternalProvider = "google" | "apple";
export interface AuthMethod {
  provider: ExternalProvider;
  enabled: boolean;
  linked: boolean;
  identifier: string | null;
  linked_at: string | null;
  last_login_at: string | null;
}
export interface AuthMethods {
  password_enabled: boolean;
  methods: AuthMethod[];
}
export interface AdminUser {
  id: number;
  email: string;
  name: string;
  phone?: string | null;
  role: string;
  is_active: boolean;
  is_blocked: boolean;
  login_status?: string;
  login_status_reason?: string | null;
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
  attendance_locked: boolean;
  shift_plan_locked: boolean;
  days: AttendanceDay[];
  worked: TimeMetrics | null;
  planned: TimeMetrics | null;
}
export type AdminAttendanceSheet = AttendanceMonth & {
  user_id: number;
  user_name: string;
  employment_title: string;
  employment_type: string;
  start_date: string;
  end_date: string | null;
  is_active_in_month: boolean;
};
export interface ShiftPlanRow {
  employment_id: number;
  user_id: number;
  user_name: string;
  employment_label: string;
  employment_type: string;
  selected: boolean;
  shift_plan_locked: boolean;
  attendance_locked: boolean;
  days: Array<{
    date: string;
    arrival_time: string | null;
    departure_time: string | null;
    status: string | null;
    is_carryover: boolean;
    carryover_departure_time: string | null;
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
