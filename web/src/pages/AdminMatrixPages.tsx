import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
  return <Panel title={t("adminMatrix.shiftPlan.title")}><StatusMessage kind="empty" title={t("adminMatrix.shiftPlan.empty")} /></Panel>;
}
