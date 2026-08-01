import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Panel, StatusMessage } from "../components/Primitives";
import { api } from "../api/client";

function monthParts() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export function AdminAttendancePage() {
  const { t } = useTranslation();
  const initial = monthParts();
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<number> | null>(null);
  const sheets = useQuery({ queryKey: ["admin-attendance-month", year, month], queryFn: () => api.admin<{ data: AttendanceSheet[] }>(`/api/v1/admin/attendance/month?year=${year}&month=${month}`) });
  const availableSheets = useMemo(() => sheets.data?.data ?? [], [sheets.data]);
  const selectedIds = useMemo(() => selected ?? new Set(availableSheets.map((sheet) => sheet.employment_id)), [availableSheets, selected]);
  const visibleSheets = useMemo(() => availableSheets.filter((sheet) => selectedIds.has(sheet.employment_id) && sheet.employment_label.toLocaleLowerCase("cs-CZ").includes(filter.toLocaleLowerCase("cs-CZ"))), [availableSheets, filter, selectedIds]);
  const toggleSelection = (id: number) => setSelected((current) => { const next = new Set(current ?? availableSheets.map((sheet) => sheet.employment_id)); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const formatHours = (value: Metric | null | undefined) => value == null ? "—" : value.hours.toFixed(1);
  const formatEvents = (day: AttendanceDay) => day.events.map((event) => `${event.event_type} ${new Intl.DateTimeFormat("cs-CZ", { timeZone: "Europe/Prague", hour: "2-digit", minute: "2-digit" }).format(new Date(event.occurred_at))}`).join(" · ") || "—";
  return <Panel title={t("adminMatrix.attendance.title")}><div className="panel-body"><div className="form-grid"><label>Rok<input type="number" value={year} onChange={(event) => { setYear(Number(event.target.value)); setSelected(null); }} /></label><label>Měsíc<input type="number" min="1" max="12" value={month} onChange={(event) => { setMonth(Number(event.target.value)); setSelected(null); }} /></label><label>{t("adminMatrix.attendance.filter")}<input placeholder={t("adminMatrix.attendance.filterPlaceholder")} value={filter} onChange={(event) => setFilter(event.target.value)} /></label></div>{sheets.isPending && <StatusMessage kind="loading" title={t("adminMatrix.attendance.loading")} />}{sheets.isError && <StatusMessage kind="error" title={t("adminMatrix.attendance.loadFailed")} />}{!sheets.isPending && !sheets.isError && availableSheets.length === 0 && <StatusMessage kind="empty" title={t("adminMatrix.attendance.empty")} />}{availableSheets.length > 0 && <><div className="attendance-sheet-selection"><strong>{t("adminMatrix.attendance.selectionTitle")}</strong><div className="attendance-sheet-selection__items">{availableSheets.map((sheet) => <label key={sheet.employment_id}><input type="checkbox" checked={selectedIds.has(sheet.employment_id)} onChange={() => toggleSelection(sheet.employment_id)} />{sheet.employment_label}</label>)}</div></div>{visibleSheets.length === 0 ? <StatusMessage kind="empty" title={t("adminMatrix.attendance.empty")} /> : visibleSheets.map((sheet) => <section className="attendance-sheet" key={sheet.employment_id}><h3>{sheet.employment_label}</h3><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Datum</th><th>Průchody</th><th>Odpracováno (h)</th><th>Odpoledne (h)</th><th>Noc (h)</th><th>Víkend (h)</th><th>Svátek (h)</th></tr></thead><tbody>{sheet.days.map((day) => <tr key={day.date}><td>{new Intl.DateTimeFormat("cs-CZ").format(new Date(`${day.date}T12:00:00`))}</td><td>{formatEvents(day)}</td><td>{formatHours(day.worked?.total)}</td><td>{formatHours(day.worked?.afternoon)}</td><td>{formatHours(day.worked?.night)}</td><td>{formatHours(day.worked?.weekend)}</td><td>{formatHours(day.worked?.public_holiday)}</td></tr>)}<tr><th colSpan={2}>Součet</th><th>{formatHours(sheet.worked?.total)}</th><th>{formatHours(sheet.worked?.afternoon)}</th><th>{formatHours(sheet.worked?.night)}</th><th>{formatHours(sheet.worked?.weekend)}</th><th>{formatHours(sheet.worked?.public_holiday)}</th></tr></tbody></table></div></section>)}</>}</div></Panel>;
}

type Metric = { minutes: number; tenths: number; hours: number };
type AttendanceEvent = { id: number; occurred_at: string; event_type: "IN" | "OUT" };
type AttendanceDay = { date: string; events: AttendanceEvent[]; worked: Record<string, Metric | null> | null };
type AttendanceSheet = { employment_id: number; employment_label: string; days: AttendanceDay[]; worked: Record<string, Metric | null> | null };

export function AdminShiftPlanPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const initial = monthParts();
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [filter, setFilter] = useState("");
  const plan = useQuery({ queryKey: ["admin-shift-plan", year, month], queryFn: () => api.admin<PlanMonth>(`/api/v1/admin/shift-plan?year=${year}&month=${month}`) });
  const save = useMutation({ mutationFn: (body: PlanUpdate) => api.admin("/api/v1/admin/shift-plan", { method: "PUT", body: JSON.stringify(body) }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-shift-plan", year, month] }) });
  const select = useMutation({ mutationFn: (employmentIds: number[]) => api.admin("/api/v1/admin/shift-plan/selection", { method: "PUT", body: JSON.stringify({ year, month, employment_ids: employmentIds }) }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-shift-plan", year, month] }) });
  const available = plan.data?.available_employments ?? [];
  const selected = plan.data?.selected_employment_ids ?? [];
  const rows = (plan.data?.rows ?? []).filter((row) => selected.includes(row.employment_id) && row.display_label.toLocaleLowerCase("cs-CZ").includes(filter.toLocaleLowerCase("cs-CZ")));
  const toggle = (id: number, checked: boolean) => select.mutate(checked ? [...selected, id] : selected.filter((item) => item !== id));
  return <Panel title={t("adminMatrix.shiftPlan.title")}><div className="panel-body"><div className="form-grid"><label>Rok<input type="number" value={year} onChange={(event) => setYear(Number(event.target.value))} /></label><label>Měsíc<input type="number" min="1" max="12" value={month} onChange={(event) => setMonth(Number(event.target.value))} /></label><label>Filtrovat úvazky<input placeholder="Jméno nebo úvazek" value={filter} onChange={(event) => setFilter(event.target.value)} /></label></div>{plan.isPending && <StatusMessage kind="loading" title="Načítám plán služeb" />}{plan.isError && <StatusMessage kind="error" title="Plán služeb nelze načíst" />}{plan.data && <><div className="attendance-sheet-selection"><strong>Výběr úvazků pro plán</strong><div className="attendance-sheet-selection__items">{available.map((item) => <label key={item.id}><input type="checkbox" checked={selected.includes(item.id)} disabled={!item.is_active_in_month} onChange={(event) => toggle(item.id, event.target.checked)} />{item.display_label ?? `${item.user_name} — ${item.title}`}</label>)}</div></div>{rows.length === 0 ? <StatusMessage kind="empty" title={t("adminMatrix.shiftPlan.empty")} /> : rows.map((row) => <section className="attendance-sheet" key={row.employment_id}><h3>{row.display_label}</h3><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Datum</th><th>Příchod</th><th>Odchod</th><th>Stav</th><th>Plán (h)</th></tr></thead><tbody>{row.days.map((day) => <tr key={day.date}><td>{new Intl.DateTimeFormat("cs-CZ").format(new Date(`${day.date}T12:00:00`))}</td><td><input aria-label={`${row.display_label} ${day.date} příchod`} type="time" value={day.arrival_time ?? ""} disabled={row.shift_plan_locked || !day.is_within_employment_period} onChange={(event) => save.mutate({ employment_id: row.employment_id, date: day.date, arrival_time: event.target.value || null, departure_time: day.departure_time, status: day.status })} /></td><td><input aria-label={`${row.display_label} ${day.date} odchod`} type="time" value={day.departure_time ?? ""} disabled={row.shift_plan_locked || !day.is_within_employment_period} onChange={(event) => save.mutate({ employment_id: row.employment_id, date: day.date, arrival_time: day.arrival_time, departure_time: event.target.value || null, status: day.status })} /></td><td>{day.status ?? "—"}</td><td>{day.planned_hours.toFixed(1)}</td></tr>)}<tr><th colSpan={4}>Součet</th><th>{row.summary.planned_hours.toFixed(1)}</th></tr></tbody></table></div></section>)}</>}</div></Panel>;
}

type PlanUpdate = { employment_id: number; date: string; arrival_time: string | null; departure_time: string | null; status: string | null };
type ShiftPlanDay = { date: string; arrival_time: string | null; departure_time: string | null; status: string | null; is_within_employment_period: boolean; planned_hours: number; planned_state: string };
type ShiftPlanRow = { employment_id: number; display_label: string; shift_plan_locked: boolean; days: ShiftPlanDay[]; summary: { planned_hours: number; scheduled_days: number; holiday_days: number; off_days: number } };
type PlanMonth = { year: number; month: number; selected_employment_ids: number[]; available_employments: Array<{ id: number; display_label: string; user_name: string; title: string; is_active_in_month: boolean }>; rows: ShiftPlanRow[] };
