import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Copy, Download, KeyRound, LoaderCircle, Plus, Power, Printer, RefreshCw, Save, Send, ShieldOff } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { AdminUser } from "../api/types";
import { Button, Field, Modal, Panel, StatusMessage } from "../components/Primitives";
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

function statusLabel(planDay: AdminShiftPlanResponse["rows"][number]["days"][number] | undefined, attendanceDay: AdminAttendanceResponse["rows"][number]["days"][number]): string {
  if (planDay?.status === "HOLIDAY") return "Dovolená";
  if (planDay?.status === "OFF") return "Volno";
  const tone = getCalendarDayTone(asPragueDate(attendanceDay.date));
  if (tone === "holiday") return "Státní svátek";
  if (tone === "weekend") return "Víkend";
  return "Pracovní den";
}

function printDayNote(planDay: AdminShiftPlanResponse["rows"][number]["days"][number] | undefined, attendanceDay: AdminAttendanceResponse["rows"][number]["days"][number]): string {
  const notes: string[] = [];
  if (planDay?.status === "HOLIDAY") notes.push("Dovolená podle plánu");
  if (planDay?.status === "OFF") notes.push("Volno podle plánu");
  const holiday = getHolidayLabel(asPragueDate(attendanceDay.date));
  if (holiday) notes.push(holiday);
  return notes.join(" · ");
}

function formatRange(start: string | null | undefined, end: string | null | undefined): string {
  return start && end ? `${start} - ${end}` : "–";
}

function formatPrintDate(date: string): string {
  return new Intl.DateTimeFormat("cs-CZ", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Prague" }).format(asPragueDate(date));
}

function dayBuckets(day: AdminAttendanceResponse["rows"][number]["days"][number], planDay: AdminShiftPlanResponse["rows"][number]["days"][number] | undefined, cutoff: string) {
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
    status: statusLabel(planDay, day),
    note: printDayNote(planDay, day),
  };
}

function printSummaryRows(attendance: AdminAttendanceResponse["rows"], shiftPlan: AdminShiftPlanResponse["rows"], cutoff: string) {
  const shiftPlanByEmployment = new Map(shiftPlan.map((row) => [row.employment_id, row]));
  return attendance.map((row) => {
    const planRow = shiftPlanByEmployment.get(row.employment_id);
    const dayRows = row.days.map((day) => {
      const planDay = planRow?.days.find((item) => item.date === day.date);
      return { day, planDay, buckets: dayBuckets(day, planDay, cutoff) };
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
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [employment, setEmployment] = useState("");
  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => api.admin<{ users: AdminUser[] }>("/api/v1/admin/users") });
  const employments = filteredEmployments(users.data?.users ?? []);
  const href = employment ? `/api/v1/admin/export?month=${month}&employment_id=${employment}` : `/api/v1/admin/export?month=${month}&bulk=true`;
  return <div className="page"><header className="page-heading"><div><p>Podklady pro mzdy a archivaci</p><h1>Export docházky</h1></div></header><div className="split"><Panel title="Parametry exportu"><div className="panel-body form-grid"><Field label="Měsíc"><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field><Field label="Rozsah"><select value={employment} onChange={(e) => setEmployment(e.target.value)}><option value="">Všechny relevantní úvazky · ZIP</option>{employments.map((item) => <option key={item.id} value={item.id}>{item.user_name} · {item.title} · {item.employment_type}</option>)}</select></Field><div className="full action-row"><a className="button button--primary" href={href}><Download />Stáhnout {employment ? "CSV" : "ZIP"}</a></div></div></Panel><Panel title="Co soubor obsahuje"><ul className="list"><li><span>Datová vazba</span><strong>employment_id</strong></li><li><span>Časový rozsah</span><strong>{month}</strong></li><li><span>Sloupce</span><strong>docházka · plán · stav</strong></li><li><span>Kódování</span><strong>UTF-8</strong></li></ul></Panel></div></div>;
}

export function AdminPrintsPage() {
  const navigate = useNavigate();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [kind, setKind] = useState<"summary" | "detail">("summary");
  const [scope, setScope] = useState<"all" | "selected">("all");
  const [selectedEmploymentIds, setSelectedEmploymentIds] = useState<number[]>([]);
  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => api.admin<{ users: AdminUser[] }>("/api/v1/admin/users") });
  const employments = filteredEmployments(users.data?.users ?? []);
  const toggleEmployment = (employmentId: number, checked: boolean) => setSelectedEmploymentIds((current) => checked ? [...current, employmentId] : current.filter((item) => item !== employmentId));
  const selectedQuery = scope === "selected" && selectedEmploymentIds.length > 0 ? `&employments=${selectedEmploymentIds.join(",")}` : "";

  return <div className="page"><header className="page-heading"><div><p>Tiskové sestavy</p><h1>Příprava tisku</h1></div></header><div className="split"><Panel title="Dokument"><div className="panel-body form-grid"><Field label="Typ sestavy"><select value={kind} onChange={(e) => setKind(e.target.value as "summary" | "detail")}><option value="summary">Hromadná sumarizace profilů</option><option value="detail">Docházkový list po úvazcích</option></select></Field><Field label="Měsíc"><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field><Field label="Rozsah tisku"><select value={scope} onChange={(e) => setScope(e.target.value as "all" | "selected")}><option value="all">Všechny profily</option><option value="selected">Jen vybrané profily</option></select></Field>{scope === "selected" && <div className="full admin-chip-grid">{employments.map((employment) => <label key={employment.id} className={`admin-chip admin-chip--checkbox ${selectedEmploymentIds.includes(employment.id) ? "admin-chip--active" : ""}`}><input type="checkbox" checked={selectedEmploymentIds.includes(employment.id)} onChange={(event) => toggleEmployment(employment.id, event.target.checked)} /><strong>{employment.user_name}</strong><span>{employment.title}</span><small>{employment.employment_type}</small></label>)}</div>}<div className="full action-row"><Button disabled={scope === "selected" && selectedEmploymentIds.length === 0} onClick={() => navigate(`/admin/tisky/preview?month=${month}&kind=${kind}${selectedQuery}`)}><Printer />Otevřít náhled</Button></div></div></Panel><Panel title="Co náhled vytiskne"><div className="panel-body stack"><p>{kind === "summary" ? "Jednu souhrnnou sestavu se stavem naplánovaných a odpracovaných hodin, dovolené, volna a odpoledních směn pro každý vybraný profil." : "Jednu samostatnou A4 stránku pro každý vybraný úvazek s denním rozpisem a měsíčním souhrnem v zápatí."}</p><p>Náhled používá živá data z administrace a nativní dialog prohlížeče umožní tisk i bezpečné uložení do PDF.</p></div></Panel></div></div>;
}

export function AdminPrintPreviewPage() {
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
    return printSummaryRows(attendance.data.rows, shiftPlan.data.rows, settings.data?.afternoon_cutoff ?? "12:00")
      .filter((row) => !allowedIds || allowedIds.has(row.employment_id));
  }, [attendance.data, selectedEmploymentIds, settings.data?.afternoon_cutoff, shiftPlan.data]);

  return <div className="page">
    <header className="page-heading no-print"><div><p>Kontrola před výstupem</p><h1>Náhled sestavy</h1></div><Button onClick={() => window.print()}><Printer />Tisk / uložit PDF</Button></header>
    {(attendance.isPending || shiftPlan.isPending || settings.isPending) && <StatusMessage kind="loading" title="Připravuji tisková data" />}
    {(attendance.error || shiftPlan.error || settings.error) && <StatusMessage kind="error" title="Náhled nelze vytvořit">{(attendance.error ?? shiftPlan.error ?? settings.error)?.message}</StatusMessage>}
    {attendance.data && shiftPlan.data && settings.data && kind === "summary" && <article className="print-sheet"><header className="print-sheet__header"><div><h1>KájovoDagmar</h1><p>Hromadná sumarizace profilů · {month}</p></div><strong>{rows.length} profilů</strong></header><table><thead><tr><th>Zaměstnanec / úvazek</th><th>Plán</th><th>Odpracováno</th><th>Dovolená</th><th>Volno</th><th>Odpolední</th><th>Vyplněno</th></tr></thead><tbody>{rows.map((row) => <tr key={row.employment_id}><td>{row.user_name}<br /><small>{row.label}</small></td><td>{formatHours(row.plannedMinutes)}</td><td>{formatHours(row.actualMinutes)}</td><td>{row.holidayDays} d</td><td>{row.offDays} d</td><td>{row.afternoonShifts}</td><td>{row.filledDays} dnů</td></tr>)}</tbody></table><footer><p>Vygenerováno {new Intl.DateTimeFormat("cs-CZ", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Prague" }).format(new Date())}</p></footer></article>}
    {attendance.data && shiftPlan.data && settings.data && kind === "detail" && rows.map((row) => <article key={row.employment_id} className="print-sheet print-sheet--page print-sheet--attendance-detail"><header className="print-sheet__header print-sheet__header--detail"><div><p className="print-sheet__eyebrow">Docházkový list pro mzdový podklad</p><h1>{row.employment_title}</h1><p>{row.employment_type} · {row.user_name}</p></div><div className="print-sheet__identity print-sheet__identity--detail"><strong>{row.label}</strong><small>Měsíc {month}</small><small>Řezná hodina odpolední směny: {settings.data.afternoon_cutoff}</small></div></header><section className="print-sheet__meta"><div><span>Zaměstnanec</span><strong>{row.user_name}</strong></div><div><span>Druh úvazku</span><strong>{row.employment_type}</strong></div><div><span>Rozsah</span><strong>{month}</strong></div><div><span>Vyplněné dny</span><strong>{row.filledDays}</strong></div></section><table className="print-attendance-table"><thead><tr><th>Datum</th><th>Den</th><th>Plán směny</th><th>1. příchod</th><th>1. odchod</th><th>2. příchod</th><th>2. odchod</th><th>Odprac.</th><th>Režim dne</th><th>Denní</th><th>Odpol.</th><th>Víkend</th><th>Svátek</th><th>Noční</th><th>Poznámka</th></tr></thead><tbody>{row.dayRows.map(({ day, planDay, buckets }) => { const date = asPragueDate(day.date); return <tr key={day.date} className={`print-day print-day--${getCalendarDayTone(date)}`}><td>{formatPrintDate(day.date)}</td><td>{getWeekdayLongLabel(date)}</td><td>{planDay?.status === "HOLIDAY" ? "Dovolená" : planDay?.status === "OFF" ? "Volno" : formatRange(planDay?.arrival_time, planDay?.departure_time)}</td><td>{day.arrival_time ?? "–"}</td><td>{day.departure_time ?? "–"}</td><td>{day.arrival_time_2 ?? "–"}</td><td>{day.departure_time_2 ?? "–"}</td><td>{formatHours(buckets.actualMinutes)}</td><td>{buckets.status}</td><td>{formatHours(Math.max(0, buckets.actualMinutes - buckets.weekendMinutes - buckets.holidayMinutes))}</td><td>{formatHours(buckets.afternoonMinutes)}</td><td>{formatHours(buckets.weekendMinutes)}</td><td>{formatHours(buckets.holidayMinutes)}</td><td>{formatHours(buckets.nightMinutes)}</td><td>{buckets.note || "–"}</td></tr>; })}</tbody></table><footer className="print-summary print-summary--detail"><div><span>Plán hodin</span><strong>{formatHours(row.plannedMinutes)}</strong></div><div><span>Odpracováno</span><strong>{formatHours(row.actualMinutes)}</strong></div><div><span>Dovolená</span><strong>{formatHours(row.vacationMinutes)}</strong></div><div><span>Volno</span><strong>{row.offDays} dnů</strong></div><div><span>Sváteční hodiny</span><strong>{formatHours(row.holidayMinutes)}</strong></div><div><span>Víkendové hodiny</span><strong>{formatHours(row.weekendMinutes)}</strong></div><div><span>Odpolední hodiny</span><strong>{formatHours(row.afternoonMinutes)}</strong></div><div><span>Noční hodiny</span><strong>{formatHours(row.nightMinutes)}</strong></div><div><span>Vyplněné dny</span><strong>{row.filledDays}</strong></div><div><span>Dny se směnou</span><strong>{row.scheduledDays}</strong></div></footer><footer className="print-sheet__footer-note">Vytištěno Dagmar Kájovo osobní asistentkou</footer></article>)}
  </div>;
}

export function AdminSettingsPage() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.admin<Settings>("/api/v1/admin/settings") });
  const smtp = useQuery({ queryKey: ["smtp"], queryFn: () => api.admin<Smtp>("/api/v1/admin/smtp") });
  const version = useQuery({ queryKey: ["version"], queryFn: () => api.admin<{ backend_deploy_tag: string; environment: string }>("/api/version") });
  const mutation = useMutation({ mutationFn: ({ path, body }: { path: string; body: unknown }) => api.admin(path, { method: "PUT", body: JSON.stringify(body) }), onSuccess: (_, variables) => { if (variables.path === "/api/v1/admin/settings") qc.invalidateQueries({ queryKey: ["settings"] }); if (variables.path === "/api/v1/admin/smtp") qc.invalidateQueries({ queryKey: ["smtp"] }); } });
  return <div className="page"><header className="page-heading"><div><p>Pravidla a diagnostika</p><h1>Nastavení systému</h1></div><span className="badge badge--good">Backend {version.data?.backend_deploy_tag ?? "…"}</span></header>{mutation.isSuccess && <StatusMessage kind="success" title="Nastavení bylo uloženo" />}{mutation.error && <StatusMessage kind="error" title="Nastavení nelze uložit">{mutation.error.message}</StatusMessage>}<div className="split"><Panel title="Provozní pravidla">{settings.data ? <SettingsForm value={settings.data} onSave={(body) => mutation.mutate({ path: "/api/v1/admin/settings", body })} /> : <div className="panel-body"><StatusMessage kind="loading" title="Načítám pravidla" /></div>}</Panel><Panel title="SMTP konfigurace">{smtp.data ? <SmtpForm value={smtp.data} onSave={(body) => mutation.mutate({ path: "/api/v1/admin/smtp", body })} /> : <div className="panel-body"><StatusMessage kind="loading" title="Načítám SMTP" /></div>}</Panel></div></div>;
}

function SettingsForm({ value, onSave }: { value: Settings; onSave: (body: unknown) => void }) {
  const [cutoff, setCutoff] = useState(value.afternoon_cutoff);
  return <div className="panel-body"><Field label="Začátek odpoledních hodin"><input type="time" value={cutoff} onChange={(e) => setCutoff(e.target.value)} /></Field><div className="action-row"><Button onClick={() => onSave({ afternoon_cutoff: cutoff })}><Save />Uložit pravidlo</Button></div></div>;
}

function SmtpForm({ value, onSave }: { value: Smtp; onSave: (body: unknown) => void }) {
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
      { key: "input_validation", label: "Validace vstupu", status: "running" as const },
      { key: "sender", label: "Sestavení odesílatele", status: "pending" as const },
      { key: "connect", label: "Navázání spojení se serverem", status: "pending" as const },
      { key: "tls", label: "Zabezpečení spojení", status: "pending" as const },
      { key: "auth", label: "SMTP autentizace", status: "pending" as const },
      { key: "message", label: "Sestavení testovací zprávy", status: "pending" as const },
      { key: "send", label: "Odeslání na e-mail administrátora", status: "pending" as const },
      { key: "quit", label: "Ukončení SMTP session", status: "pending" as const },
    ]
    : testMutation.data?.steps ?? [];
  return <div className="panel-body form-grid"><Field label="Server"><input value={form.host ?? ""} onChange={(e) => set("host", e.target.value)} /></Field><Field label="Port"><input type="number" value={form.port ?? ""} onChange={(e) => set("port", e.target.value === "" ? null : Number(e.target.value))} /></Field><Field label="Zabezpečení"><select value={form.security ?? "SSL"} onChange={(e) => set("security", e.target.value)}><option>SSL</option><option>STARTTLS</option><option>NONE</option></select></Field><Field label="Uživatel"><input value={form.username ?? ""} onChange={(e) => set("username", e.target.value)} /></Field><Field label="Nové heslo" hint={value.password_set ? "Heslo je nastaveno; prázdné pole jej zachová." : "Heslo zatím není nastaveno."}><input type="password" value={form.password} onChange={(e) => set("password", e.target.value)} /></Field><Field label="E-mail odesílatele"><input type="email" value={form.from_email ?? ""} onChange={(e) => set("from_email", e.target.value)} /></Field><Field label="Jméno odesílatele"><input value={form.from_name ?? ""} onChange={(e) => set("from_name", e.target.value)} /></Field><div className="full action-row"><Button variant="quiet" type="button" onClick={openTestModal}><Send />TEST</Button><Button type="button" onClick={() => onSave(form)}><Save />Uložit SMTP</Button></div>{isModalOpen && <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !testMutation.isPending && setIsModalOpen(false)}><section className="modal modal--wide" role="dialog" aria-modal="true" aria-labelledby="smtp-test-title"><div className="smtp-test-modal__header"><div><p>Ověření rozepsané konfigurace bez uložení</p><h2 id="smtp-test-title">SMTP test</h2></div><Button variant="quiet" type="button" onClick={() => setIsModalOpen(false)} disabled={testMutation.isPending}>Zavřít</Button></div><div className="smtp-test-modal__body">{testMutation.isPending && <StatusMessage kind="loading" title="Probíhá test SMTP spojení">Průběh zobrazíme po dokončení jednotlivých kroků.</StatusMessage>}{testMutation.isSuccess && testMutation.data?.ok && <StatusMessage kind="success" title="Testovací e-mail byl úspěšně odeslán">{`Zpráva byla odeslána na ${testMutation.data.target_email ?? "e-mail aktuálního administrátora"}.`}</StatusMessage>}{testMutation.isSuccess && !testMutation.data?.ok && testMutation.data?.error && <div className="smtp-test-warning" role="alert"><div className="smtp-test-warning__title"><AlertTriangle aria-hidden="true" /><strong>{testMutation.data.error.message_cs}</strong></div><p>{testMutation.data.error.root_cause}</p><button type="button" className="smtp-test-diagnostics-toggle" onClick={() => setShowDetails((current) => !current)}>{showDetails ? "Skrýt technickou diagnostiku" : "Zobrazit technickou diagnostiku"}</button>{showDetails && <pre className="smtp-test-diagnostics">{JSON.stringify(testMutation.data.error, null, 2)}</pre>}</div>}{testMutation.isError && <StatusMessage kind="error" title="SMTP test se nepodařilo spustit">{testMutation.error.message}</StatusMessage>}<ol className="smtp-test-steps">{steps.map((step) => <li key={step.key} className={`smtp-test-step smtp-test-step--${step.status}`}>{step.status === "success" ? <CheckCircle2 aria-hidden="true" /> : step.status === "error" ? <AlertTriangle aria-hidden="true" /> : step.status === "running" ? <LoaderCircle aria-hidden="true" className="spin" /> : <span className="smtp-test-step__dot" aria-hidden="true" />}<div><strong>{step.label}</strong>{step.detail && <p>{step.detail}</p>}</div></li>)}</ol></div></section></div>}</div>;
}

export function AdminIntegrationsPage() {
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
  return <div className="page"><header className="page-heading"><div><p>Strojové přístupy a scope</p><h1>Integrační klienti</h1></div><Button onClick={() => { setCreate(true); setSelectedId(null); }}><Plus />Nový klient</Button></header>{secret && <Panel title="Nový token · zobrazí se pouze nyní"><div className="panel-body stack"><div className="secret">{secret}</div><div className="action-row"><Button variant="quiet" onClick={async () => navigator.clipboard.writeText(secret)}><Copy />Kopírovat</Button><Button onClick={() => setSecret("")}>Token jsem bezpečně uložil</Button></div></div></Panel>}<div className="split"><Panel title={`Klienti · ${clients.data?.length ?? 0}`}>{clients.isPending ? <div className="panel-body"><StatusMessage kind="loading" title="Načítám integrace" /></div> : clients.data?.length ? <ul className="list">{clients.data.map((item) => <li key={item.id}><button className="row-action" onClick={() => { setSelectedId(item.id); setCreate(false); }}>{item.name}</button><span className={`badge ${item.status === "ACTIVE" ? "badge--good" : "badge--warn"}`}>{item.status_label ?? item.status}</span></li>)}</ul> : <div className="panel-body"><StatusMessage kind="empty" title="Zatím není vytvořen klient" /></div>}</Panel><Panel title={create ? "Nový klient" : detail.data?.name ?? "Inspektor integrace"}>{create && options.data ? <IntegrationForm options={options.data} onSubmit={(body) => run({ path: "/api/v1/admin/integrations/clients", body })} /> : detail.isPending && selectedId ? <div className="panel-body"><StatusMessage kind="loading" title="Načítám konfiguraci klienta" /></div> : detail.data && options.data ? <div className="stack"><IntegrationForm key={detail.data.updated_at} options={options.data} value={detail.data} onSubmit={(body) => run({ path: `/api/v1/admin/integrations/clients/${detail.data.id}`, method: "PUT", body })} /><div className="panel-body action-row action-row--wrap"><Button variant="quiet" onClick={() => run({ title: "Rotovat token?", description: "Všechny dosavadní tokeny klienta budou okamžitě zneplatněny.", path: `/api/v1/admin/integrations/clients/${detail.data.id}/rotate` })}><RefreshCw />Rotovat token</Button><Button variant="danger" onClick={() => run({ title: detail.data.status === "DISABLED" ? "Povolit klienta?" : "Dočasně zakázat klienta?", description: "Změna se projeví při následujícím integračním požadavku.", path: `/api/v1/admin/integrations/clients/${detail.data.id}/${detail.data.status === "DISABLED" ? "enable" : "disable"}` })}><Power />{detail.data.status === "DISABLED" ? "Povolit" : "Zakázat"}</Button><Button variant="danger" onClick={() => run({ title: "Odvolat aktivní token?", description: "Klient nebude moci API použít, dokud nevytvoříte nový token rotací.", path: `/api/v1/admin/integrations/clients/${detail.data.id}/revoke-secret` })}><ShieldOff />Odvolat token</Button></div></div> : <div className="panel-body"><StatusMessage kind="empty" title="Vyberte klienta nebo vytvořte nový" /></div>}</Panel></div>{mutation.error && <StatusMessage kind="error" title="Operaci nelze dokončit">{mutation.error.message}</StatusMessage>}{confirm && <Modal title={confirm.title ?? "Potvrdit operaci"} description={confirm.description ?? ""} confirmLabel="Potvrdit změnu" danger onClose={() => setConfirm(null)} onConfirm={() => mutation.mutate(confirm)} />}</div>;
}

function IntegrationForm({ options, value, onSubmit }: { options: IntegrationOptions; value?: any; onSubmit: (body: unknown) => void }) {
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
  return <form className="panel-body stack" onSubmit={submit}><Field label="Název klienta"><input required minLength={3} value={name} onChange={(event) => setName(event.target.value)} /></Field><fieldset><legend>Oprávnění</legend>{options.scopes.filter((scope) => scope.available).map((scope) => <label key={scope.id} className="field"><span><input type="checkbox" checked={scopes.includes(scope.id)} onChange={(event) => setScopes(toggle(scopes, scope.id, event.target.checked))} /> {scope.label}</span><small>{scope.description}</small></label>)}</fieldset><Field label="Rozsah dat"><select value={dataMode} onChange={(event) => setDataMode(event.target.value)}>{options.data_scope_modes.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}</select></Field>{dataMode === "SELECTED_EMPLOYEES" && <fieldset><legend>Vybrané osoby</legend>{options.employees.map((employee) => <label key={employee.id} className="field"><span><input type="checkbox" checked={employeeIds.includes(employee.id)} onChange={(event) => setEmployeeIds(toggle(employeeIds, employee.id, event.target.checked))} /> {employee.label}</span></label>)}<label className="field"><span><input type="checkbox" checked={includeInactive} onChange={(event) => setIncludeInactive(event.target.checked)} /> Zahrnout neaktivní úvazky</span></label></fieldset>}{dataMode === "SELECTED_EMPLOYMENTS" && <fieldset><legend>Vybrané úvazky</legend>{options.employments.map((employment) => <label key={employment.id} className="field"><span><input type="checkbox" checked={employmentIds.includes(employment.id)} onChange={(event) => setEmploymentIds(toggle(employmentIds, employment.id, event.target.checked))} /> {employment.label}</span></label>)}</fieldset>}<div className="form-grid"><Field label="IP omezení"><select value={ipMode} onChange={(event) => setIpMode(event.target.value)}>{options.ip_restriction_modes.map((mode) => <option key={mode.id} value={mode.id} disabled={!mode.editable && mode.id !== ipMode}>{mode.label}</option>)}</select></Field><Field label="Expirace"><select value={expiration} onChange={(event) => setExpiration(event.target.value)}>{options.expiration_options.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field>{expiration === "CUSTOM_DATE" && <Field label="Datum expirace"><input required type="date" value={customDate} onChange={(event) => setCustomDate(event.target.value)} /></Field>}</div><Button disabled={!name || scopes.length === 0}>{value ? <Save /> : <KeyRound />}{value ? "Uložit konfiguraci" : "Vytvořit a zobrazit token"}</Button></form>;
}
