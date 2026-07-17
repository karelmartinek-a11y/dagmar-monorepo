import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Copy, Download, KeyRound, LoaderCircle, Plus, Power, Printer, RefreshCw, Save, Send, ShieldOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { AdminUser } from "../api/types";
import { Button, Field, Modal, Panel, StatusMessage } from "../components/Primitives";
import { useDateFormatter, useLocaleValue } from "../utils/format";
import { asPragueDate, getCalendarDayTone, getHolidayLabel, getWeekdayLongLabel } from "../utils/calendar";
import { formatHours, normalizeMinutes } from "../utils/timeMath";

type AdminAttendanceResponse = Awaited<ReturnType<typeof loadAttendanceMonth>>;
type AdminShiftPlanResponse = Awaited<ReturnType<typeof loadShiftPlanMonth>>;

type Settings = { afternoon_cutoff: string };
type Smtp = { host: string | null; port: number | null; security: string | null; username: string | null; from_email: string | null; from_name: string | null; password_set: boolean };
type SmtpFormState = Smtp & { password: string };
type SmtpTestStep = { key: string; label: string; status: "pending" | "running" | "success" | "error"; detail?: string | null };
type SmtpTestError = { code: string; message_cs: string; root_cause: string };
type SmtpTestResult = { ok: boolean; steps: SmtpTestStep[]; target_email: string | null; error: SmtpTestError | null };
type IntegrationOptions = { scopes: Array<{ id: string; label: string; description: string; available: boolean }>; data_scope_modes: Array<{ id: string; label: string; description?: string; supports_inactive_toggle?: boolean }>; employees: Array<{ id: number; label: string }>; employments: Array<{ id: number; label: string }>; ip_restriction_modes: Array<{ id: string; label: string; editable: boolean }>; expiration_options: Array<{ id: string; label: string; requires_custom_date?: boolean }> };
type IntegrationOperation = { title?: string; description?: string; path: string; method?: "POST" | "PUT"; body?: unknown };

function loadAttendanceMonth(year: number, month: number) {
  return api.admin<{ year: number; month: number; rows: Array<{ employment_id: number; user_name: string; employment_label: string; employment_title: string; employment_type: string; locked: boolean; days: Array<{ date: string; arrival_time: string | null; departure_time: string | null; arrival_time_2: string | null; departure_time_2: string | null; planned_arrival_time: string | null; planned_departure_time: string | null; planned_status: string | null; is_within_employment_period?: boolean }> }> }>(`/api/v1/admin/attendance/month?year=${year}&month=${month}`);
}

function loadShiftPlanMonth(year: number, month: number) {
  return api.admin<{ year: number; month: number; selected_employment_ids: number[]; rows: Array<{ employment_id: number; user_id: number; user_name: string; title: string; employment_type: string; display_label: string; days: Array<{ date: string; arrival_time: string | null; departure_time: string | null; status: string | null }> }> }>(`/api/v1/admin/shift-plan?year=${year}&month=${month}`);
}

function monthParts(month: string): [number, number] {
  const [year, monthNumber] = month.split("-").map(Number);
  return [year, monthNumber];
}

function hhmmToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return (hours * 60) + minutes;
}

function normalizeInterval(start: string | null | undefined, end: string | null | undefined): [number, number] | null {
  const startMinutes = hhmmToMinutes(start);
  const endMinutes = hhmmToMinutes(end);
  if (startMinutes === null || endMinutes === null) return null;
  return endMinutes > startMinutes ? [startMinutes, endMinutes] : [startMinutes, endMinutes + (24 * 60)];
}

function overlapMinutes(interval: [number, number] | null, rangeStart: number, rangeEnd: number): number {
  if (!interval) return 0;
  const start = Math.max(interval[0], rangeStart);
  const end = Math.min(interval[1], rangeEnd);
  return Math.max(0, end - start);
}

function intervalMinutes(start: string | null | undefined, end: string | null | undefined): number {
  return normalizeMinutes(start ?? null, end ?? null);
}

function actualDayMinutes(day: AdminAttendanceResponse["rows"][number]["days"][number]): number {
  return intervalMinutes(day.arrival_time, day.departure_time) + intervalMinutes(day.arrival_time_2, day.departure_time_2);
}

function plannedDayMinutes(day: AdminShiftPlanResponse["rows"][number]["days"][number] | undefined): number {
  return day ? intervalMinutes(day.arrival_time, day.departure_time) : 0;
}

function employmentCalendarMinutesForDay(day: { date: string; is_within_employment_period?: boolean }): number {
  if (day.is_within_employment_period === false) return 0;
  return getCalendarDayTone(asPragueDate(day.date)) === "work" ? 8 * 60 : 0;
}

function afternoonMinutes(day: AdminAttendanceResponse["rows"][number]["days"][number], cutoff: string): number {
  const cutoffMinutes = hhmmToMinutes(cutoff) ?? 12 * 60;
  const first = normalizeInterval(day.arrival_time, day.departure_time);
  const second = normalizeInterval(day.arrival_time_2, day.departure_time_2);
  return overlapMinutes(first, cutoffMinutes, 24 * 60) + overlapMinutes(second, cutoffMinutes, 24 * 60);
}

function nightMinutes(day: AdminAttendanceResponse["rows"][number]["days"][number]): number {
  const first = normalizeInterval(day.arrival_time, day.departure_time);
  const second = normalizeInterval(day.arrival_time_2, day.departure_time_2);
  const nightSpans: Array<[number, number]> = [[0, 6 * 60], [22 * 60, 30 * 60]];
  return [first, second].reduce((total, interval) => total + nightSpans.reduce((sum, [start, end]) => sum + overlapMinutes(interval, start, end), 0), 0);
}

function statusLabel(
  planDay: AdminShiftPlanResponse["rows"][number]["days"][number] | undefined,
  attendanceDay: AdminAttendanceResponse["rows"][number]["days"][number],
  t: (key: string) => string,
  locale: string,
): string {
  if (planDay?.status === "HOLIDAY") return t("adminMatrix.statuses.HOLIDAY");
  if (planDay?.status === "OFF") return t("adminMatrix.statuses.OFF");
  const tone = getCalendarDayTone(asPragueDate(attendanceDay.date));
  if (tone === "holiday") return t("employee.dayCard.holiday");
  if (tone === "weekend") return getWeekdayLongLabel(new Date("2026-07-18T12:00:00"), locale);
  return t("adminMatrix.common.workday");
}

function printDayNote(
  planDay: AdminShiftPlanResponse["rows"][number]["days"][number] | undefined,
  attendanceDay: AdminAttendanceResponse["rows"][number]["days"][number],
  t: (key: string) => string,
  locale: string,
): string {
  const notes: string[] = [];
  if (planDay?.status === "HOLIDAY") notes.push(t("adminOps.prints.preview.holidayByPlan"));
  if (planDay?.status === "OFF") notes.push(t("adminOps.prints.preview.offByPlan"));
  const holiday = getHolidayLabel(asPragueDate(attendanceDay.date), locale);
  if (holiday) notes.push(holiday);
  return notes.join(" · ");
}

function formatRange(start: string | null | undefined, end: string | null | undefined): string {
  return start && end ? `${start} - ${end}` : "–";
}

function formatPrintDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Prague" }).format(asPragueDate(date));
}

function dayBuckets(
  day: AdminAttendanceResponse["rows"][number]["days"][number],
  planDay: AdminShiftPlanResponse["rows"][number]["days"][number] | undefined,
  cutoff: string,
  t: (key: string) => string,
  locale: string,
) {
  const date = asPragueDate(day.date);
  const tone = getCalendarDayTone(date);
  const actualMinutes = actualDayMinutes(day);
  const plannedMinutes = plannedDayMinutes(planDay);
  const calendarMinutes = employmentCalendarMinutesForDay(day);
  const vacationMinutes = planDay?.status === "HOLIDAY" ? (plannedMinutes || calendarMinutes) : 0;
  const holidayMinutes = tone === "holiday" ? (actualMinutes || plannedMinutes) : 0;
  const weekendMinutes = tone === "weekend" ? actualMinutes : 0;
  return {
    actualMinutes,
    plannedMinutes,
    vacationMinutes,
    holidayMinutes,
    weekendMinutes,
    afternoonMinutes: afternoonMinutes(day, cutoff),
    nightMinutes: nightMinutes(day),
    filled: Boolean(day.arrival_time || day.departure_time || day.arrival_time_2 || day.departure_time_2),
    status: statusLabel(planDay, day, t, locale),
    note: printDayNote(planDay, day, t, locale),
  };
}

function printSummaryRows(
  attendance: AdminAttendanceResponse["rows"],
  shiftPlan: AdminShiftPlanResponse["rows"],
  cutoff: string,
  t: (key: string) => string,
  locale: string,
) {
  const shiftPlanByEmployment = new Map(shiftPlan.map((row) => [row.employment_id, row]));
  return attendance.map((row) => {
    const planRow = shiftPlanByEmployment.get(row.employment_id);
    const dayRows = row.days.map((day) => {
      const planDay = planRow?.days.find((item) => item.date === day.date);
      return { day, planDay, buckets: dayBuckets(day, planDay, cutoff, t, locale) };
    });
    const plannedMinutes = dayRows.reduce((total, item) => total + item.buckets.plannedMinutes, 0);
    const actualMinutes = dayRows.reduce((total, item) => total + item.buckets.actualMinutes, 0);
    const holidayDays = (planRow?.days ?? []).filter((day) => day.status === "HOLIDAY").length;
    const offDays = (planRow?.days ?? []).filter((day) => day.status === "OFF").length;
    const afternoonShifts = dayRows.filter((item) => item.buckets.afternoonMinutes > 0).length;
    const filledDays = dayRows.filter((item) => item.buckets.filled).length;
    return {
      employment_id: row.employment_id,
      user_name: row.user_name,
      employment_title: row.employment_title,
      employment_type: row.employment_type,
      label: row.employment_label,
      plannedMinutes,
      actualMinutes,
      holidayDays,
      offDays,
      afternoonShifts,
      filledDays,
      holidayMinutes: dayRows.reduce((total, item) => total + item.buckets.holidayMinutes, 0),
      weekendMinutes: dayRows.reduce((total, item) => total + item.buckets.weekendMinutes, 0),
      vacationMinutes: dayRows.reduce((total, item) => total + item.buckets.vacationMinutes, 0),
      nightMinutes: dayRows.reduce((total, item) => total + item.buckets.nightMinutes, 0),
      afternoonMinutes: dayRows.reduce((total, item) => total + item.buckets.afternoonMinutes, 0),
      scheduledDays: dayRows.filter((item) => item.buckets.plannedMinutes > 0).length,
      days: row.days,
      planDays: planRow?.days ?? [],
      dayRows,
    };
  });
}

function filteredEmployments(users: AdminUser[]) {
  return users.flatMap((user) => (user.employments ?? []).map((employment) => ({ ...employment, user_name: user.name })));
}

export function AdminExportPage() {
  const { t } = useTranslation();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [employment, setEmployment] = useState("");
  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => api.admin<{ users: AdminUser[] }>("/api/v1/admin/users") });
  const employments = filteredEmployments(users.data?.users ?? []);
  const href = employment ? `/api/v1/admin/export?month=${month}&employment_id=${employment}` : `/api/v1/admin/export?month=${month}&bulk=true`;
  return <div className="page"><header className="page-heading"><div><p>{t("adminOps.export.eyebrow")}</p><h1>{t("adminOps.export.title")}</h1></div></header><div className="split"><Panel title={t("adminOps.export.params")}><div className="panel-body form-grid"><Field label={t("adminOps.export.month")}><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field><Field label={t("adminOps.export.scope")}><select value={employment} onChange={(e) => setEmployment(e.target.value)}><option value="">{t("adminOps.export.allZip")}</option>{employments.map((item) => <option key={item.id} value={item.id}>{item.user_name} · {item.title} · {item.employment_type}</option>)}</select></Field><div className="full action-row"><a className="button button--primary" href={href}><Download />{t("adminOps.export.download")} {employment ? "CSV" : "ZIP"}</a></div></div></Panel><Panel title={t("adminOps.export.contains")}><ul className="list"><li><span>{t("adminOps.export.dataBinding")}</span><strong>employment_id</strong></li><li><span>{t("adminOps.export.timeRange")}</span><strong>{month}</strong></li><li><span>{t("adminOps.export.columns")}</span><strong>{t("adminOps.export.columnValue")}</strong></li><li><span>{t("adminOps.export.encoding")}</span><strong>UTF-8</strong></li></ul></Panel></div></div>;
}

export function AdminPrintsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [kind, setKind] = useState<"summary" | "detail">("summary");
  const [scope, setScope] = useState<"all" | "selected">("all");
  const [selectedEmploymentIds, setSelectedEmploymentIds] = useState<number[]>([]);
  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => api.admin<{ users: AdminUser[] }>("/api/v1/admin/users") });
  const employments = filteredEmployments(users.data?.users ?? []);
  const toggleEmployment = (employmentId: number, checked: boolean) => setSelectedEmploymentIds((current) => checked ? [...current, employmentId] : current.filter((item) => item !== employmentId));
  const selectedQuery = scope === "selected" && selectedEmploymentIds.length > 0 ? `&employments=${selectedEmploymentIds.join(",")}` : "";

  return <div className="page"><header className="page-heading"><div><p>{t("adminOps.prints.eyebrow")}</p><h1>{t("adminOps.prints.title")}</h1></div></header><div className="split"><Panel title={t("adminOps.prints.document")}><div className="panel-body form-grid"><Field label={t("adminOps.prints.reportType")}><select value={kind} onChange={(e) => setKind(e.target.value as "summary" | "detail")}><option value="summary">{t("adminOps.prints.summary")}</option><option value="detail">{t("adminOps.prints.detail")}</option></select></Field><Field label={t("adminOps.prints.month")}><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field><Field label={t("adminOps.prints.scope")}><select value={scope} onChange={(e) => setScope(e.target.value as "all" | "selected")}><option value="all">{t("adminOps.prints.allProfiles")}</option><option value="selected">{t("adminOps.prints.selectedProfiles")}</option></select></Field>{scope === "selected" && <div className="full admin-chip-grid">{employments.map((employment) => <label key={employment.id} className={`admin-chip admin-chip--checkbox ${selectedEmploymentIds.includes(employment.id) ? "admin-chip--active" : ""}`}><input type="checkbox" checked={selectedEmploymentIds.includes(employment.id)} onChange={(event) => toggleEmployment(employment.id, event.target.checked)} /><strong>{employment.user_name}</strong><span>{employment.title}</span><small>{employment.employment_type}</small></label>)}</div>}<div className="full action-row"><Button disabled={scope === "selected" && selectedEmploymentIds.length === 0} onClick={() => navigate(`/admin/tisky/preview?month=${month}&kind=${kind}${selectedQuery}`)}><Printer />{t("adminOps.prints.openPreview")}</Button></div></div></Panel><Panel title={t("adminOps.prints.previewContains")}><div className="panel-body stack"><p>{kind === "summary" ? t("adminOps.prints.summaryDescription") : t("adminOps.prints.detailDescription")}</p><p>{t("adminOps.prints.previewHelp")}</p></div></Panel></div></div>;
}

export function AdminPrintPreviewPage() {
  const { t } = useTranslation();
  const locale = useLocaleValue();
  const formatDateTime = useDateFormatter({ dateStyle: "long", timeStyle: "short" });
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const month = params.get("month") ?? new Date().toISOString().slice(0, 7);
  const kind = (params.get("kind") as "summary" | "detail" | null) ?? "summary";
  const selectedEmploymentIds = (params.get("employments") ?? "").split(",").filter(Boolean).map(Number);
  const [year, monthNumber] = monthParts(month);
  const attendance = useQuery({ queryKey: ["print-attendance", month], queryFn: () => loadAttendanceMonth(year, monthNumber) });
  const shiftPlan = useQuery({ queryKey: ["print-plan", month], queryFn: () => loadShiftPlanMonth(year, monthNumber) });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.admin<Settings>("/api/v1/admin/settings") });
  const rows = useMemo(() => {
    if (!attendance.data || !shiftPlan.data) return [];
    const allowedIds = selectedEmploymentIds.length > 0 ? new Set(selectedEmploymentIds) : null;
    return printSummaryRows(attendance.data.rows, shiftPlan.data.rows, settings.data?.afternoon_cutoff ?? "12:00", t, locale)
      .filter((row) => !allowedIds || allowedIds.has(row.employment_id));
  }, [attendance.data, locale, selectedEmploymentIds, settings.data?.afternoon_cutoff, shiftPlan.data, t]);

  return <div className="page">
    <header className="page-heading no-print"><div><p>{t("adminOps.prints.previewEyebrow")}</p><h1>{t("adminOps.prints.previewTitle")}</h1></div><Button onClick={() => window.print()}><Printer />{t("adminOps.prints.printPdf")}</Button></header>
    {(attendance.isPending || shiftPlan.isPending || settings.isPending) && <StatusMessage kind="loading" title={t("adminOps.prints.preparing")} />}
    {(attendance.error || shiftPlan.error || settings.error) && <StatusMessage kind="error" title={t("adminOps.prints.failed")}>{(attendance.error ?? shiftPlan.error ?? settings.error)?.message}</StatusMessage>}
    {attendance.data && shiftPlan.data && settings.data && kind === "summary" && <article className="print-sheet"><header className="print-sheet__header"><div><h1>KájovoDagmar</h1><p>{t("adminOps.prints.summary")} · {month}</p></div><strong>{rows.length}</strong></header><table><thead><tr><th>{t("users.title")}</th><th>{t("adminMatrix.summary.plan")}</th><th>{t("employee.metrics.worked")}</th><th>{t("employee.statuses.HOLIDAY")}</th><th>{t("employee.statuses.OFF")}</th><th>{t("adminOps.prints.preview.afternoonShifts")}</th><th>{t("adminOps.prints.preview.filledDays")}</th></tr></thead><tbody>{rows.map((row) => <tr key={row.employment_id}><td>{row.user_name}<br /><small>{row.label}</small></td><td>{formatHours(row.plannedMinutes)}</td><td>{formatHours(row.actualMinutes)}</td><td>{t("adminOps.prints.preview.dayCountShort", { count: row.holidayDays })}</td><td>{t("adminOps.prints.preview.dayCountShort", { count: row.offDays })}</td><td>{row.afternoonShifts}</td><td>{t("adminOps.prints.preview.filledDaysCount", { count: row.filledDays })}</td></tr>)}</tbody></table><footer><p>{t("adminOps.prints.preview.generatedAt")} {formatDateTime.format(new Date())}</p></footer></article>}
    {attendance.data && shiftPlan.data && settings.data && kind === "detail" && rows.map((row) => <article key={row.employment_id} className="print-sheet print-sheet--page print-sheet--attendance-detail"><header className="print-sheet__header print-sheet__header--detail"><div><p className="print-sheet__eyebrow">{t("adminOps.prints.preview.attendanceSheet")}</p><h1>{row.employment_title}</h1><p>{row.employment_type} · {row.user_name}</p></div><div className="print-sheet__identity print-sheet__identity--detail"><strong>{row.label}</strong><small>{t("adminOps.export.month")} {month}</small><small>{t("adminOps.settings.afternoonCutoff")}: {settings.data.afternoon_cutoff}</small></div></header><section className="print-sheet__meta"><div><span>{t("users.fields.name")}</span><strong>{row.user_name}</strong></div><div><span>{t("users.fields.employmentType")}</span><strong>{row.employment_type}</strong></div><div><span>{t("adminOps.export.scope")}</span><strong>{month}</strong></div><div><span>{t("adminOps.prints.preview.filledDays")}</span><strong>{row.filledDays}</strong></div></section><table className="print-attendance-table"><thead><tr><th>{t("adminOps.prints.preview.table.date")}</th><th>{t("adminOps.prints.preview.table.day")}</th><th>{t("adminOps.prints.preview.table.shiftPlan")}</th><th>{t("adminOps.prints.preview.table.arrival1")}</th><th>{t("adminOps.prints.preview.table.departure1")}</th><th>{t("adminOps.prints.preview.table.arrival2")}</th><th>{t("adminOps.prints.preview.table.departure2")}</th><th>{t("adminOps.prints.preview.table.worked")}</th><th>{t("adminOps.prints.preview.table.dayMode")}</th><th>{t("adminOps.prints.preview.table.daytime")}</th><th>{t("adminOps.prints.preview.table.afternoon")}</th><th>{t("adminOps.prints.preview.table.weekend")}</th><th>{t("adminOps.prints.preview.table.holiday")}</th><th>{t("adminOps.prints.preview.table.night")}</th><th>{t("adminOps.prints.preview.table.note")}</th></tr></thead><tbody>{row.dayRows.map(({ day, planDay, buckets }) => { const date = asPragueDate(day.date); return <tr key={day.date} className={`print-day print-day--${getCalendarDayTone(date)}`}><td>{formatPrintDate(day.date, locale)}</td><td>{getWeekdayLongLabel(date, locale)}</td><td>{planDay?.status === "HOLIDAY" ? t("adminMatrix.statuses.HOLIDAY") : planDay?.status === "OFF" ? t("adminMatrix.statuses.OFF") : formatRange(planDay?.arrival_time, planDay?.departure_time)}</td><td>{day.arrival_time ?? "–"}</td><td>{day.departure_time ?? "–"}</td><td>{day.arrival_time_2 ?? "–"}</td><td>{day.departure_time_2 ?? "–"}</td><td>{formatHours(buckets.actualMinutes)}</td><td>{buckets.status}</td><td>{formatHours(Math.max(0, buckets.actualMinutes - buckets.weekendMinutes - buckets.holidayMinutes))}</td><td>{formatHours(buckets.afternoonMinutes)}</td><td>{formatHours(buckets.weekendMinutes)}</td><td>{formatHours(buckets.holidayMinutes)}</td><td>{formatHours(buckets.nightMinutes)}</td><td>{buckets.note || "–"}</td></tr>; })}</tbody></table><footer className="print-summary print-summary--detail"><div><span>{t("employee.metrics.plannedHours")}</span><strong>{formatHours(row.plannedMinutes)}</strong></div><div><span>{t("employee.metrics.worked")}</span><strong>{formatHours(row.actualMinutes)}</strong></div><div><span>{t("employee.statuses.HOLIDAY")}</span><strong>{formatHours(row.vacationMinutes)}</strong></div><div><span>{t("employee.statuses.OFF")}</span><strong>{t("adminOps.prints.preview.dayCountShort", { count: row.offDays })}</strong></div><div><span>{t("adminOps.prints.preview.holidayHours")}</span><strong>{formatHours(row.holidayMinutes)}</strong></div><div><span>{t("adminOps.prints.preview.weekendHours")}</span><strong>{formatHours(row.weekendMinutes)}</strong></div><div><span>{t("adminOps.prints.preview.afternoonHours")}</span><strong>{formatHours(row.afternoonMinutes)}</strong></div><div><span>{t("adminOps.prints.preview.nightHours")}</span><strong>{formatHours(row.nightMinutes)}</strong></div><div><span>{t("adminOps.prints.preview.filledDays")}</span><strong>{row.filledDays}</strong></div><div><span>{t("adminOps.prints.preview.scheduledDays")}</span><strong>{row.scheduledDays}</strong></div></footer><footer className="print-sheet__footer-note">{t("adminOps.prints.preview.footerNote")}</footer></article>)}
  </div>;
}

export function AdminSettingsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.admin<Settings>("/api/v1/admin/settings") });
  const smtp = useQuery({ queryKey: ["smtp"], queryFn: () => api.admin<Smtp>("/api/v1/admin/smtp") });
  const version = useQuery({ queryKey: ["version"], queryFn: () => api.admin<{ backend_deploy_tag: string; environment: string }>("/api/version") });
  const mutation = useMutation({ mutationFn: ({ path, body }: { path: string; body: unknown }) => api.admin(path, { method: "PUT", body: JSON.stringify(body) }), onSuccess: (_, variables) => { if (variables.path === "/api/v1/admin/settings") qc.invalidateQueries({ queryKey: ["settings"] }); if (variables.path === "/api/v1/admin/smtp") qc.invalidateQueries({ queryKey: ["smtp"] }); } });
  return <div className="page"><header className="page-heading"><div><p>{t("adminOps.settings.eyebrow")}</p><h1>{t("adminOps.settings.title")}</h1></div><span className="badge badge--good">{t("adminOps.settings.backend")} {version.data?.backend_deploy_tag ?? "…"}</span></header>{mutation.isSuccess && <StatusMessage kind="success" title={t("adminOps.settings.saved")} />}{mutation.error && <StatusMessage kind="error" title={t("adminOps.settings.failed")}>{mutation.error.message}</StatusMessage>}<div className="split"><Panel title={t("adminOps.settings.rules")}>{settings.data ? <SettingsForm value={settings.data} onSave={(body) => mutation.mutate({ path: "/api/v1/admin/settings", body })} /> : <div className="panel-body"><StatusMessage kind="loading" title={t("adminOps.settings.loadingRules")} /></div>}</Panel><Panel title={t("adminOps.settings.smtp")}>{smtp.data ? <SmtpForm value={smtp.data} onSave={(body) => mutation.mutate({ path: "/api/v1/admin/smtp", body })} /> : <div className="panel-body"><StatusMessage kind="loading" title={t("adminOps.settings.loadingSmtp")} /></div>}</Panel></div></div>;
}

function SettingsForm({ value, onSave }: { value: Settings; onSave: (body: unknown) => void }) {
  const { t } = useTranslation();
  const [cutoff, setCutoff] = useState(value.afternoon_cutoff);
  return <div className="panel-body"><Field label={t("adminOps.settings.afternoonCutoff")}><input type="time" value={cutoff} onChange={(e) => setCutoff(e.target.value)} /></Field><div className="action-row"><Button onClick={() => onSave({ afternoon_cutoff: cutoff })}><Save />{t("adminOps.settings.saveRule")}</Button></div></div>;
}

function SmtpForm({ value, onSave }: { value: Smtp; onSave: (body: unknown) => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState<SmtpFormState>({ ...value, password: "" });
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const testMutation = useMutation({
    mutationFn: (body: SmtpFormState) => api.admin<SmtpTestResult>("/api/v1/admin/smtp/test", { method: "POST", body: JSON.stringify(body) }),
  });
  const set = (key: keyof SmtpFormState, val: string | number | boolean | null) => setForm((current) => ({ ...current, [key]: val }));
  const openTestModal = () => {
    setShowDetails(false);
    setIsModalOpen(true);
    testMutation.reset();
    testMutation.mutate(form);
  };
  const steps = testMutation.isPending
    ? [
      { key: "input_validation", label: t("adminOps.settings.smtpSteps.inputValidation"), status: "running" as const },
      { key: "sender", label: t("adminOps.settings.smtpSteps.sender"), status: "pending" as const },
      { key: "connect", label: t("adminOps.settings.smtpSteps.connect"), status: "pending" as const },
      { key: "tls", label: t("adminOps.settings.smtpSteps.tls"), status: "pending" as const },
      { key: "auth", label: t("adminOps.settings.smtpSteps.auth"), status: "pending" as const },
      { key: "message", label: t("adminOps.settings.smtpSteps.message"), status: "pending" as const },
      { key: "send", label: t("adminOps.settings.smtpSteps.send"), status: "pending" as const },
      { key: "quit", label: t("adminOps.settings.smtpSteps.quit"), status: "pending" as const },
    ]
    : testMutation.data?.steps ?? [];
  return <div className="panel-body form-grid"><Field label={t("adminOps.settings.smtpFields.server")}><input value={form.host ?? ""} onChange={(e) => set("host", e.target.value)} /></Field><Field label={t("adminOps.settings.smtpFields.port")}><input type="number" value={form.port ?? ""} onChange={(e) => set("port", e.target.value === "" ? null : Number(e.target.value))} /></Field><Field label={t("adminOps.settings.smtpFields.security")}><select value={form.security ?? "SSL"} onChange={(e) => set("security", e.target.value)}><option>SSL</option><option>STARTTLS</option><option>NONE</option></select></Field><Field label={t("adminOps.settings.smtpFields.user")}><input value={form.username ?? ""} onChange={(e) => set("username", e.target.value)} /></Field><Field label={t("adminOps.settings.smtpFields.newPassword")} hint={value.password_set ? t("adminOps.settings.smtpHints.passwordSet") : t("adminOps.settings.smtpHints.passwordMissing")}><input type="password" value={form.password} onChange={(e) => set("password", e.target.value)} /></Field><Field label={t("adminOps.settings.smtpFields.senderEmail")}><input type="email" value={form.from_email ?? ""} onChange={(e) => set("from_email", e.target.value)} /></Field><Field label={t("adminOps.settings.smtpFields.senderName")}><input value={form.from_name ?? ""} onChange={(e) => set("from_name", e.target.value)} /></Field><div className="full action-row"><Button variant="quiet" type="button" onClick={openTestModal}><Send />{t("adminOps.settings.smtpActions.test")}</Button><Button type="button" onClick={() => onSave(form)}><Save />{t("adminOps.settings.smtpActions.save")}</Button></div>{isModalOpen && <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !testMutation.isPending && setIsModalOpen(false)}><section className="modal modal--wide" role="dialog" aria-modal="true" aria-labelledby="smtp-test-title"><div className="smtp-test-modal__header"><div><p>{t("adminOps.settings.smtpModal.eyebrow")}</p><h2 id="smtp-test-title">{t("adminOps.settings.smtpModal.title")}</h2></div><Button variant="quiet" type="button" onClick={() => setIsModalOpen(false)} disabled={testMutation.isPending}>{t("adminOps.settings.smtpActions.close")}</Button></div><div className="smtp-test-modal__body">{testMutation.isPending && <StatusMessage kind="loading" title={t("adminOps.settings.smtpModal.loadingTitle")}>{t("adminOps.settings.smtpModal.loadingBody")}</StatusMessage>}{testMutation.isSuccess && testMutation.data?.ok && <StatusMessage kind="success" title={t("adminOps.settings.smtpModal.successTitle")}>{t("adminOps.settings.smtpModal.successBody", { email: testMutation.data.target_email ?? t("adminOps.settings.smtpModal.successFallbackEmail") })}</StatusMessage>}{testMutation.isSuccess && !testMutation.data?.ok && testMutation.data?.error && <div className="smtp-test-warning" role="alert"><div className="smtp-test-warning__title"><AlertTriangle aria-hidden="true" /><strong>{testMutation.data.error.message_cs}</strong></div><p>{testMutation.data.error.root_cause}</p><button type="button" className="smtp-test-diagnostics-toggle" onClick={() => setShowDetails((current) => !current)}>{showDetails ? t("adminOps.settings.smtpModal.diagnosticsHide") : t("adminOps.settings.smtpModal.diagnosticsShow")}</button>{showDetails && <pre className="smtp-test-diagnostics">{JSON.stringify(testMutation.data.error, null, 2)}</pre>}</div>}{testMutation.isError && <StatusMessage kind="error" title={t("adminOps.settings.smtpModal.failed")}>{testMutation.error.message}</StatusMessage>}<ol className="smtp-test-steps">{steps.map((step) => <li key={step.key} className={`smtp-test-step smtp-test-step--${step.status}`}>{step.status === "success" ? <CheckCircle2 aria-hidden="true" /> : step.status === "error" ? <AlertTriangle aria-hidden="true" /> : step.status === "running" ? <LoaderCircle aria-hidden="true" className="spin" /> : <span className="smtp-test-step__dot" aria-hidden="true" />}<div><strong>{step.label}</strong>{step.detail && <p>{step.detail}</p>}</div></li>)}</ol></div></section></div>}</div>;
}

export function AdminIntegrationsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [create, setCreate] = useState(false);
  const [secret, setSecret] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<IntegrationOperation | null>(null);
  const clients = useQuery({ queryKey: ["integrations"], queryFn: () => api.admin<any[]>("/api/v1/admin/integrations/clients") });
  const options = useQuery({ queryKey: ["integration-options"], queryFn: () => api.admin<IntegrationOptions>("/api/v1/admin/integrations/clients/options") });
  const detail = useQuery({ queryKey: ["integration-detail", selectedId], queryFn: () => api.admin<any>(`/api/v1/admin/integrations/clients/${selectedId}`), enabled: selectedId !== null });
  const mutation = useMutation({ mutationFn: (operation: IntegrationOperation) => api.admin<any>(operation.path, { method: operation.method ?? "POST", body: operation.body ? JSON.stringify(operation.body) : undefined }), onSuccess: (data) => { if (data.plaintext_token) setSecret(data.plaintext_token); qc.invalidateQueries({ queryKey: ["integrations"] }); qc.invalidateQueries({ queryKey: ["integration-detail"] }); setCreate(false); setConfirm(null); } });
  const run = (operation: IntegrationOperation) => operation.title ? setConfirm(operation) : mutation.mutate(operation);
  return <div className="page"><header className="page-heading"><div><p>{t("adminOps.integrations.eyebrow")}</p><h1>{t("adminOps.integrations.title")}</h1></div><Button onClick={() => { setCreate(true); setSelectedId(null); }}><Plus />{t("adminOps.integrations.newClient")}</Button></header>{secret && <Panel title={t("adminOps.integrations.newToken")}><div className="panel-body stack"><div className="secret">{secret}</div><div className="action-row"><Button variant="quiet" onClick={async () => navigator.clipboard.writeText(secret)}><Copy />{t("adminOps.integrations.copy")}</Button><Button onClick={() => setSecret("")}>{t("adminOps.integrations.tokenSaved")}</Button></div></div></Panel>}<div className="split"><Panel title={t("adminOps.integrations.clients", { count: clients.data?.length ?? 0 })}>{clients.isPending ? <div className="panel-body"><StatusMessage kind="loading" title={t("adminOps.integrations.loading")} /></div> : clients.data?.length ? <ul className="list">{clients.data.map((item) => <li key={item.id}><button className="row-action" onClick={() => { setSelectedId(item.id); setCreate(false); }}>{item.name}</button><span className={`badge ${item.status === "ACTIVE" ? "badge--good" : "badge--warn"}`}>{item.status_label ?? item.status}</span></li>)}</ul> : <div className="panel-body"><StatusMessage kind="empty" title={t("adminOps.integrations.empty")} /></div>}</Panel><Panel title={create ? t("adminOps.integrations.newClientPanel") : detail.data?.name ?? t("adminOps.integrations.inspector")}>{create && options.data ? <IntegrationForm options={options.data} onSubmit={(body) => run({ path: "/api/v1/admin/integrations/clients", body })} /> : detail.isPending && selectedId ? <div className="panel-body"><StatusMessage kind="loading" title={t("adminOps.integrations.loadingConfig")} /></div> : detail.data && options.data ? <div className="stack"><IntegrationForm key={detail.data.updated_at} options={options.data} value={detail.data} onSubmit={(body) => run({ path: `/api/v1/admin/integrations/clients/${detail.data.id}`, method: "PUT", body })} /><div className="panel-body action-row action-row--wrap"><Button variant="quiet" onClick={() => run({ title: t("adminOps.integrations.rotateTitle"), description: t("adminOps.integrations.rotateDescription"), path: `/api/v1/admin/integrations/clients/${detail.data.id}/rotate` })}><RefreshCw />{t("adminOps.integrations.actions.rotate")}</Button><Button variant="danger" onClick={() => run({ title: detail.data.status === "DISABLED" ? t("adminOps.integrations.enableTitle") : t("adminOps.integrations.disableTitle"), description: t("adminOps.integrations.statusChangeDescription"), path: `/api/v1/admin/integrations/clients/${detail.data.id}/${detail.data.status === "DISABLED" ? "enable" : "disable"}` })}><Power />{detail.data.status === "DISABLED" ? t("adminOps.integrations.actions.enable") : t("adminOps.integrations.actions.disable")}</Button><Button variant="danger" onClick={() => run({ title: t("adminOps.integrations.revokeTitle"), description: t("adminOps.integrations.revokeDescription"), path: `/api/v1/admin/integrations/clients/${detail.data.id}/revoke-secret` })}><ShieldOff />{t("adminOps.integrations.actions.revoke")}</Button></div></div> : <div className="panel-body"><StatusMessage kind="empty" title={t("adminOps.integrations.pickOrCreate")} /></div>}</Panel></div>{mutation.error && <StatusMessage kind="error" title={t("adminOps.integrations.failed")}>{mutation.error.message}</StatusMessage>}{confirm && <Modal title={confirm.title ?? t("common.modal.confirmOperation")} description={confirm.description ?? ""} confirmLabel={t("adminOps.integrations.confirm")} danger onClose={() => setConfirm(null)} onConfirm={() => mutation.mutate(confirm)} />}</div>;
}

function IntegrationForm({ options, value, onSubmit }: { options: IntegrationOptions; value?: any; onSubmit: (body: unknown) => void }) {
  const { t } = useTranslation();
  const config = value?.configuration;
  const [name, setName] = useState(value?.name ?? "");
  const [scopes, setScopes] = useState<string[]>(config?.selected_scope_ids ?? []);
  const [dataMode, setDataMode] = useState(config?.data_scope_mode ?? options.data_scope_modes[0]?.id ?? "ALL_ACTIVE_EMPLOYMENTS");
  const [employeeIds, setEmployeeIds] = useState<number[]>(config?.selected_employee_ids ?? []);
  const [employmentIds, setEmploymentIds] = useState<number[]>(config?.selected_employment_ids ?? []);
  const [includeInactive, setIncludeInactive] = useState(config?.include_inactive_employments ?? false);
  const [ipMode, setIpMode] = useState(config?.ip_restriction_mode ?? options.ip_restriction_modes[0]?.id ?? "NONE");
  const [expiration, setExpiration] = useState(config?.expiration_choice ?? options.expiration_options[0]?.id ?? "NONE");
  const [customDate, setCustomDate] = useState(config?.custom_expiration_date ?? "");
  const toggle = <T,>(items: T[], item: T, checked: boolean) => checked ? [...items, item] : items.filter((current) => current !== item);
  const submit = (event: FormEvent) => { event.preventDefault(); onSubmit({ name, selected_scope_ids: scopes, data_scope_mode: dataMode, selected_employee_ids: employeeIds, selected_employment_ids: employmentIds, include_inactive_employments: includeInactive, ip_restriction_mode: ipMode, expiration_choice: expiration, custom_expiration_date: expiration === "CUSTOM_DATE" ? customDate || null : null }); };
  return <form className="panel-body stack" onSubmit={submit}><Field label={t("adminOps.integrations.form.clientName")}><input required minLength={3} value={name} onChange={(event) => setName(event.target.value)} /></Field><fieldset><legend>{t("adminOps.integrations.form.scopes")}</legend>{options.scopes.filter((scope) => scope.available).map((scope) => <label key={scope.id} className="field"><span><input type="checkbox" checked={scopes.includes(scope.id)} onChange={(event) => setScopes(toggle(scopes, scope.id, event.target.checked))} /> {scope.label}</span><small>{scope.description}</small></label>)}</fieldset><Field label={t("adminOps.integrations.form.dataScope")}><select value={dataMode} onChange={(event) => setDataMode(event.target.value)}>{options.data_scope_modes.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}</select></Field>{dataMode === "SELECTED_EMPLOYEES" && <fieldset><legend>{t("adminOps.integrations.form.selectedPeople")}</legend>{options.employees.map((employee) => <label key={employee.id} className="field"><span><input type="checkbox" checked={employeeIds.includes(employee.id)} onChange={(event) => setEmployeeIds(toggle(employeeIds, employee.id, event.target.checked))} /> {employee.label}</span></label>)}<label className="field"><span><input type="checkbox" checked={includeInactive} onChange={(event) => setIncludeInactive(event.target.checked)} /> {t("adminOps.integrations.form.includeInactive")}</span></label></fieldset>}{dataMode === "SELECTED_EMPLOYMENTS" && <fieldset><legend>{t("adminOps.integrations.form.selectedEmployments")}</legend>{options.employments.map((employment) => <label key={employment.id} className="field"><span><input type="checkbox" checked={employmentIds.includes(employment.id)} onChange={(event) => setEmploymentIds(toggle(employmentIds, employment.id, event.target.checked))} /> {employment.label}</span></label>)}</fieldset>}<div className="form-grid"><Field label={t("adminOps.integrations.form.ipRestriction")}><select value={ipMode} onChange={(event) => setIpMode(event.target.value)}>{options.ip_restriction_modes.map((mode) => <option key={mode.id} value={mode.id} disabled={!mode.editable && mode.id !== ipMode}>{mode.label}</option>)}</select></Field><Field label={t("adminOps.integrations.form.expiration")}><select value={expiration} onChange={(event) => setExpiration(event.target.value)}>{options.expiration_options.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field>{expiration === "CUSTOM_DATE" && <Field label={t("adminOps.integrations.form.expirationDate")}><input required type="date" value={customDate} onChange={(event) => setCustomDate(event.target.value)} /></Field>}</div><Button disabled={!name || scopes.length === 0}>{value ? <Save /> : <KeyRound />}{value ? t("adminOps.integrations.actions.saveConfig") : t("adminOps.integrations.actions.createToken")}</Button></form>;
}
