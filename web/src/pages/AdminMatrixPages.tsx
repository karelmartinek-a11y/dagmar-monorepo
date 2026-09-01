import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  LockKeyhole,
  UnlockKeyhole,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import type {
  AdminAttendanceSheet,
  AttendanceDay,
  AttendanceEvent,
  MetricKey,
  StatusMetrics,
  StatusMetricKey,
  TimeMetrics,
} from "../api/types";
import { Button, Panel, StatusMessage } from "../components/Primitives";
import { ClockInput } from "../components/ClockInput";
import { formatHours } from "../utils/hoursFormat";
import { formatCalendarDate } from "../utils/format";
import { chronologicalPlanBoundaries, formatPragueTime } from "../utils/presentationAdapters";
import { normalizeTimeInput } from "../utils/timeInput";
import { statusMetricKeyForStatus, statusMetricKeys } from "../utils/statusMetrics";

const metricLabels: Record<MetricKey, string> = {
  total: "Odpracováno",
  afternoon: "Odpoledne",
  night: "Noc",
  weekend: "Víkend",
  public_holiday: "Svátek",
};
const plannedMetricLabels: Record<MetricKey, string> = {
  ...metricLabels,
  total: "Plán",
};
const statusMetricLabels: Record<StatusMetricKey, string> = {
  holiday: "Dovolená",
  sickness: "Nemoc",
  paragraph: "Paragraf",
};

function statusMetricText(metrics: Record<StatusMetricKey, { hours: number } | null>) {
  return statusMetricKeys
    .filter((key) => metrics[key])
    .map((key) => `${statusMetricLabels[key]}: ${formatHours(metrics[key]!.hours, "cs-CZ")}`)
    .join(" · ");
}

function monthParts() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function eventTime(event: AttendanceEvent) {
  return formatPragueTime(event.occurred_at);
}

type EmploymentOption = { id: number; label: string; disabled?: boolean };

function EmploymentSelector({
  options,
  selectedIds,
  onChange,
  label,
}: {
  options: EmploymentOption[];
  selectedIds: Set<number>;
  onChange: (ids: Set<number>) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (wasOpen.current && !open) triggerRef.current?.focus();
    wasOpen.current = open;
    if (!open) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);
  const visible = options.filter((item) =>
    item.label.toLocaleLowerCase("cs-CZ").includes(query.toLocaleLowerCase("cs-CZ")),
  );
  const toggle = (id: number) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };
  return (
    <div className="employment-selector">
      <button ref={triggerRef} type="button" className="employment-selector__trigger" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span>{label}</span>
        <strong>{selectedIds.size}/{options.filter((item) => !item.disabled).length}</strong>
        <ChevronDown aria-hidden="true" />
      </button>
      {open && createPortal(<>
        <button type="button" className="employment-selector__scrim" aria-label="Zavřít výběr úvazků" onClick={() => setOpen(false)} />
        <div ref={menuRef} className="employment-selector__menu" role="dialog" aria-modal="true" aria-label={label} onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const focusable = Array.from(menuRef.current?.querySelectorAll<HTMLElement>("button, input, [href], [tabindex]:not([tabindex='-1'])") ?? []);
          if (focusable.length === 0) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }}>
          <div className="employment-selector__toolbar">
            <input autoFocus placeholder="Hledat úvazek nebo jméno" value={query} onChange={(event) => setQuery(event.target.value)} />
            <div className="employment-selector__actions">
              <button type="button" onClick={() => onChange(new Set(options.filter((item) => !item.disabled).map((item) => item.id)))}>Všechny</button>
              <button type="button" onClick={() => onChange(new Set())}>Zrušit výběr</button>
              <button type="button" className="employment-selector__close" onClick={() => setOpen(false)}>Hotovo</button>
            </div>
          </div>
          <div className="employment-selector__list">
            {visible.map((item) => (
              <label key={item.id} className={item.disabled ? "is-disabled" : ""}>
                <input type="checkbox" checked={selectedIds.has(item.id)} disabled={item.disabled} onChange={() => toggle(item.id)} />
                <span>{item.label}</span>
                {selectedIds.has(item.id) && <Check aria-hidden="true" />}
              </label>
            ))}
            {visible.length === 0 && <p className="employment-selector__empty">Pro hledání nejsou žádné úvazky.</p>}
          </div>
        </div>
      </>, document.body)}
    </div>
  );
}

function AdminAttendanceMatrix({ sheets, refresh, onLock, onBreaks }: { sheets: AdminAttendanceSheet[]; refresh: () => Promise<void>; onLock: (sheet: AdminAttendanceSheet) => void; onBreaks: (sheet: AdminAttendanceSheet) => void; }) {
  const [context, setContext] = useState<{ sheet: AdminAttendanceSheet; day: AttendanceDay; x: number; y: number } | null>(null);
  const update = async (sheet: AdminAttendanceSheet, day: AttendanceDay, event: AttendanceEvent | undefined, rawValue: string) => {
    const value = normalizeTimeInput(rawValue);
    if (value === null) throw new Error("Neplatný čas, použijte HH:MM.");
    if (!event && value) await api.admin("/api/v1/admin/attendance/events", { method: "POST", body: JSON.stringify({ employment_id: sheet.employment_id, occurred_at: `${day.date}T${value}:00`, event_type: day.next_event_type }) });
    else if (event && !value) await api.admin(`/api/v1/admin/attendance/events/${event.id}${event.deletion_partner_id == null ? "" : `?paired_event_id=${event.deletion_partner_id}`}`, { method: "DELETE" });
    else if (event && value !== eventTime(event)) await api.admin(`/api/v1/admin/attendance/events/${event.id}`, { method: "PUT", body: JSON.stringify({ employment_id: sheet.employment_id, occurred_at: `${day.date}T${value}:00`, event_type: event.event_type }) });
    else return;
    await refresh();
  };
  const updateStatus = async (sheet: AdminAttendanceSheet, day: AttendanceDay, status: string) => { await api.admin("/api/v1/admin/day-status", { method: "PUT", body: JSON.stringify({ employment_id: sheet.employment_id, date: day.date, status: status || null, confirm_delete_conflicts: Boolean(status) }) }); await refresh(); };
  const labels: Record<string, string> = { SICKNESS: "Nemoc", PARAGRAPH: "Paragraf", HOLIDAY: "Dovolená", OFF: "Volno" };
  return <div className="admin-day-tables admin-attendance-matrix-wrap">{sheets.map((sheet) => <section className="admin-employment-table" key={sheet.employment_id} data-testid={`admin-attendance-${sheet.employment_id}`}>
    <header className="admin-employment-table__header"><strong>{sheet.employment_label}</strong><span>{sheet.attendance_locked ? "Zamčeno" : "Odemčeno"}</span><div className="matrix-user__actions"><Button variant="quiet" onClick={() => onLock(sheet)}>{sheet.attendance_locked ? <UnlockKeyhole /> : <LockKeyhole />}{sheet.attendance_locked ? "Odemknout docházku" : "Zamknout docházku"}</Button><Button variant="quiet" onClick={() => onBreaks(sheet)}>Přidej pauzy</Button></div></header>
    <div className="data-table-wrap"><table className="data-table employee-month-table"><thead><tr><th>Datum</th><th>Den</th>{Array.from({ length: Math.max(4, ...sheet.days.map((day) => day.events.length)) }, (_, index) => <th key={index}>PRŮCHOD {index + 1}</th>)}{sheet.display_metrics.map((key) => <th key={key}>{metricLabels[key]} (h)</th>)}</tr></thead><tbody>{sheet.days.map((day) => { const disabled = sheet.attendance_locked || !day.is_within_employment_period || Boolean(day.effective_status); const statusKey = statusMetricKeyForStatus(day.effective_status); const statusValue = statusKey ? day.status_metrics[statusKey] : null; return <tr key={day.date} onContextMenu={(event) => { event.preventDefault(); setContext({ sheet, day, x: event.clientX, y: event.clientY }); }}><th>{formatCalendarDate(day.date)}</th><td>{new Intl.DateTimeFormat("cs-CZ", { weekday: "long" }).format(new Date(`${day.date}T12:00:00`))}</td>{Array.from({ length: Math.max(4, ...sheet.days.map((item) => item.events.length)) }, (_, index) => { const item = day.events[index]; return <td key={index}>{day.effective_status ? <strong className="day-absence-label">{index === 0 ? `${labels[day.effective_status] ?? day.effective_status}${statusValue ? ` · ${formatHours(statusValue.hours, "cs-CZ")}` : ""}` : labels[day.effective_status] ?? day.effective_status}</strong> : <ClockInput aria-label={`${sheet.employment_label} ${day.date} PRŮCHOD ${index + 1}`} value={item ? eventTime(item) : ""} disabled={disabled} onCommit={(value) => update(sheet, day, item, value)} />}</td>; })}{sheet.display_metrics.map((key) => <td key={key}>{day.worked?.[key] ? formatHours(day.worked[key]!.hours, "cs-CZ") : "—"}</td>)}</tr>; })}</tbody></table></div>
    {statusMetricText(sheet.status_metrics) ? <p className="status-metrics-summary">Celodenní stavy: {statusMetricText(sheet.status_metrics)}</p> : null}
  </section>)}{context ? <div className="row-context-menu" role="menu" style={{ left: context.x, top: context.y }} onMouseLeave={() => setContext(null)}><strong>Celodenní nepřítomnost</strong>{Object.entries(labels).map(([status, label]) => <button type="button" role="menuitem" key={status} onClick={() => { if (window.confirm(`Nastavit ${label} pro ${context.day.date}?`)) void updateStatus(context.sheet, context.day, status).then(() => setContext(null)); }}>{label}</button>)}<button type="button" role="menuitem" disabled={!context.day.effective_status} onClick={() => void updateStatus(context.sheet, context.day, "").then(() => setContext(null))}>Pracovní den</button></div> : null}</div>;
}

export function AdminAttendancePage() {
  const { t } = useTranslation();
  const initial = monthParts();
  const queryClient = useQueryClient();
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<number> | null>(null);
  const sheets = useQuery({
    queryKey: ["admin-attendance-month", year, month],
    queryFn: () =>
      api.admin<{ data: AdminAttendanceSheet[] }>(
        `/api/v1/admin/attendance/month?year=${year}&month=${month}`,
      ),
  });
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ["admin-attendance-month", year, month],
    });
  const lock = useMutation({
    mutationFn: (sheet: AdminAttendanceSheet) =>
      api.admin("/api/v1/admin/locks", { method: "PUT", body: JSON.stringify({ lock_type: "attendance", year, month, locked: !sheet.attendance_locked, employment_ids: [sheet.employment_id] }) }),
    onSuccess: refresh,
  });
  const addBreaks = useMutation({
    mutationFn: (sheet: AdminAttendanceSheet) =>
      api.admin("/api/v1/admin/attendance/breaks", { method: "POST", body: JSON.stringify({ employment_id: sheet.employment_id, year, month, confirmed: true }) }),
    onSuccess: refresh,
  });
  const availableSheets = useMemo(() => sheets.data?.data ?? [], [sheets.data]);
  const selectedIds = useMemo(
    () =>
      selected ?? new Set(availableSheets.map((sheet) => sheet.employment_id)),
    [availableSheets, selected],
  );
  const visibleSheets = useMemo(
    () =>
      availableSheets.filter(
        (sheet) =>
          selectedIds.has(sheet.employment_id) &&
          sheet.employment_label
            .toLocaleLowerCase("cs-CZ")
            .includes(filter.toLocaleLowerCase("cs-CZ")),
      ),
    [availableSheets, filter, selectedIds],
  );
  return (
    <Panel title={t("adminMatrix.attendance.title")}>
      <div className="panel-body">
        <div className="form-grid">
          <label>
            Rok
            <input
              type="number"
              value={year}
              onChange={(event) => {
                setYear(Number(event.target.value));
                setSelected(null);
              }}
            />
          </label>
          <label>
            Měsíc
            <input
              type="number"
              min="1"
              max="12"
              value={month}
              onChange={(event) => {
                setMonth(Number(event.target.value));
                setSelected(null);
              }}
            />
          </label>
          <label>
            {t("adminMatrix.attendance.filter")}
            <input
              placeholder={t("adminMatrix.attendance.filterPlaceholder")}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </label>
        </div>
        {sheets.isPending && (
          <StatusMessage
            kind="loading"
            title={t("adminMatrix.attendance.loading")}
          />
        )}
        {sheets.isError && (
          <StatusMessage
            kind="error"
            title={t("adminMatrix.attendance.loadFailed")}
          />
        )}
        {!sheets.isPending &&
          !sheets.isError &&
          availableSheets.length === 0 && (
            <StatusMessage
              kind="empty"
              title={t("adminMatrix.attendance.empty")}
            />
          )}
        {availableSheets.length > 0 && (
          <>
            <div className="matrix-toolbar">
              <EmploymentSelector
                label={t("adminMatrix.attendance.selectionTitle")}
                options={availableSheets.map((sheet) => ({ id: sheet.employment_id, label: sheet.employment_label }))}
                selectedIds={selectedIds}
                onChange={setSelected}
              />
            </div>
            {visibleSheets.length === 0 ? (
              <StatusMessage
                kind="empty"
                title={t("adminMatrix.attendance.empty")}
              />
            ) : (
              <>
                <AdminAttendanceMatrix sheets={visibleSheets} refresh={refresh} onLock={(sheet) => lock.mutate(sheet)} onBreaks={(sheet) => { if (window.confirm("Doplnit chybějící zákonné pauzy?")) addBreaks.mutate(sheet); }} />
              </>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

type PlanUpdate = {
  employment_id: number;
  date: string;
  arrival_time: string | null;
  departure_time: string | null;
  status: string | null;
  confirm_delete_conflicts?: boolean;
};
type ShiftPlanDay = {
  date: string;
  arrival_time: string | null;
  departure_time: string | null;
  status: string | null;
  effective_status: string | null;
  is_carryover: boolean;
  carryover_departure_time: string | null;
  is_within_employment_period: boolean;
  planned_hours: number;
  planned: TimeMetrics | null;
  planned_state: string;
  status_metrics: StatusMetrics;
};
type ShiftPlanRow = {
  employment_id: number;
  display_label: string;
  shift_plan_locked: boolean;
  attendance_locked: boolean;
  display_metrics: MetricKey[];
  days: ShiftPlanDay[];
  summary: {
    planned_hours: number;
    planned: TimeMetrics | null;
    scheduled_days: number;
    holiday_days: number;
    off_days: number;
    status_metrics: StatusMetrics;
  };
};
type PlanMonth = {
  year: number;
  month: number;
  selected_employment_ids: number[];
  available_employments: Array<{
    id: number;
    display_label: string;
    user_name: string;
    title: string;
    is_active_in_month: boolean;
  }>;
  rows: ShiftPlanRow[];
};

export function AdminShiftPlanPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const initial = monthParts();
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [filter, setFilter] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [context, setContext] = useState<{ row: ShiftPlanRow; day: ShiftPlanRow["days"][number]; x: number; y: number } | null>(null);
  const plan = useQuery({
    queryKey: ["admin-shift-plan", year, month],
    queryFn: () =>
      api.admin<PlanMonth>(
        `/api/v1/admin/shift-plan?year=${year}&month=${month}`,
      ),
  });
  const refresh = () =>
    void queryClient.invalidateQueries({
      queryKey: ["admin-shift-plan", year, month],
    });
  const save = useMutation({
    mutationFn: (body: PlanUpdate) =>
      api.admin("/api/v1/admin/shift-plan", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    onSuccess: refresh,
    onError: (reason) =>
      setNotice(
        reason instanceof Error ? reason.message : "Plán se nepodařilo uložit.",
      ),
  });
  const select = useMutation({
    mutationFn: (employmentIds: number[]) =>
      api.admin("/api/v1/admin/shift-plan/selection", {
        method: "PUT",
        body: JSON.stringify({ year, month, employment_ids: employmentIds }),
      }),
    onSuccess: refresh,
  });
  const lock = useMutation({
    mutationFn: ({ row, locked }: { row: ShiftPlanRow; locked: boolean }) =>
      api.admin("/api/v1/admin/locks", {
        method: "PUT",
        body: JSON.stringify({
          lock_type: "shift_plan",
          year,
          month,
          locked,
          employment_ids: [row.employment_id],
        }),
      }),
    onSuccess: refresh,
    onError: (reason) =>
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Zámek se nepodařilo změnit.",
      ),
  });
  const available = plan.data?.available_employments ?? [];
  const selected = plan.data?.selected_employment_ids ?? [];
  const rows = (plan.data?.rows ?? []).filter(
    (row) =>
      selected.includes(row.employment_id) &&
      row.display_label
        .toLocaleLowerCase("cs-CZ")
        .includes(filter.toLocaleLowerCase("cs-CZ")),
  );
  return (
    <Panel title={t("adminMatrix.shiftPlan.title")}>
      <div className="panel-body">
        <div className="form-grid">
          <label>
            Rok
            <input
              type="number"
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
            />
          </label>
          <label>
            Měsíc
            <input
              type="number"
              min="1"
              max="12"
              value={month}
              onChange={(event) => setMonth(Number(event.target.value))}
            />
          </label>
          <label>
            Filtrovat úvazky
            <input
              placeholder="Jméno nebo úvazek"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </label>
        </div>
        {notice && <StatusMessage kind="error" title={notice} />}
        {plan.isPending && (
          <StatusMessage kind="loading" title="Načítám plán služeb" />
        )}
        {plan.isError && (
          <StatusMessage kind="error" title="Plán služeb nelze načíst" />
        )}
        {plan.data && (
          <>
            <div className="matrix-toolbar">
              <EmploymentSelector
                label="Výběr úvazků pro zobrazení"
                options={available.map((item) => ({ id: item.id, label: item.display_label ?? `${item.user_name} — ${item.title}`, disabled: !item.is_active_in_month }))}
                selectedIds={new Set(selected)}
                onChange={(ids) => select.mutate([...ids])}
              />
            </div>
            {rows.length === 0 ? (
              <StatusMessage
                kind="empty"
                title={t("adminMatrix.shiftPlan.empty")}
              />
            ) : (
              <div className="admin-day-tables admin-shift-plan-matrix-wrap">
                {rows.map((row) => <section className="admin-employment-table" key={row.employment_id} data-testid={`admin-shift-plan-${row.employment_id}`}>
                  <header className="admin-employment-table__header"><strong>{row.display_label}</strong><div className="matrix-user__actions"><Button variant="quiet" onClick={() => lock.mutate({ row, locked: !row.shift_plan_locked })}>{row.shift_plan_locked ? <UnlockKeyhole /> : <LockKeyhole />}{row.shift_plan_locked ? "Odemknout plán" : "Zamknout plán"}</Button></div></header>
                  <div className="data-table-wrap"><table className="data-table employee-month-table"><thead><tr><th>Datum</th><th>Den</th>{Array.from({ length: Math.max(4, ...row.days.map((day) => chronologicalPlanBoundaries({ carryover_departure_time: day.carryover_departure_time, arrival_time: day.arrival_time, departure_time: day.departure_time }).length)) }, (_, index) => <th key={index}>PRŮCHOD {index + 1}</th>)}{row.display_metrics.map((key) => <th key={key}>{plannedMetricLabels[key]} (h)</th>)}</tr></thead><tbody>{row.days.map((day) => { const disabled = row.shift_plan_locked || !day.is_within_employment_period || Boolean(day.effective_status); const planTimes = chronologicalPlanBoundaries({ carryover_departure_time: day.carryover_departure_time, arrival_time: day.arrival_time, departure_time: day.departure_time }); const carryover = Boolean(day.carryover_departure_time); const statusKey = statusMetricKeyForStatus(day.effective_status || day.status); const statusMetric = statusKey ? day.status_metrics[statusKey] : null; return <tr key={day.date} onContextMenu={(event) => { event.preventDefault(); setContext({ row, day, x: event.clientX, y: event.clientY }); }}><th>{formatCalendarDate(day.date)}</th><td>{new Intl.DateTimeFormat("cs-CZ", { weekday: "long" }).format(new Date(`${day.date}T12:00:00`))}</td>{Array.from({ length: Math.max(4, ...row.days.map((item) => chronologicalPlanBoundaries({ carryover_departure_time: item.carryover_departure_time, arrival_time: item.arrival_time, departure_time: item.departure_time }).length)) }, (_, index) => <td key={index}>{day.effective_status || day.status ? <strong className="day-absence-label">{index === 0 ? `${day.effective_status || day.status}${statusMetric ? ` · ${formatHours(statusMetric.hours, "cs-CZ")}` : ""}` : day.effective_status || day.status}</strong> : <ClockInput aria-label={`${t("adminMatrix.common.plannedPass", "PLÁN – PRŮCHOD")} ${index + 1} ${day.date}`} value={planTimes[index] ?? ""} disabled={disabled || (carryover && index === 0) || index > (carryover ? 2 : 1)} onCommit={async (value) => { const arrivalIndex = carryover ? 1 : 0; const departureIndex = carryover ? 2 : 1; await save.mutateAsync({ employment_id: row.employment_id, date: day.date, arrival_time: index === arrivalIndex ? value || null : day.arrival_time, departure_time: index === departureIndex ? value || null : day.departure_time, status: day.status }); }} />}</td>)}{row.display_metrics.map((key) => <td key={key}>{day.planned?.[key] ? formatHours(day.planned[key]!.hours, "cs-CZ") : "—"}</td>)}</tr>; })}</tbody></table></div>
                  {statusMetricText(row.summary.status_metrics) ? <p className="status-metrics-summary">Celodenní stavy: {statusMetricText(row.summary.status_metrics)}</p> : null}
                </section>)}
                {context ? <div className="row-context-menu" role="menu" style={{ left: context.x, top: context.y }} onMouseLeave={() => setContext(null)}><strong>Celodenní nepřítomnost</strong>{["HOLIDAY", "OFF"].map((status) => <button type="button" role="menuitem" key={status} onClick={() => { if (window.confirm(`Nastavit ${status} pro ${context.day.date}?`)) void save.mutateAsync({ employment_id: context.row.employment_id, date: context.day.date, arrival_time: null, departure_time: null, status }).then(() => setContext(null)); }}>{status === "HOLIDAY" ? "Dovolená" : "Volno"}</button>)}<button type="button" role="menuitem" disabled={!context.day.status} onClick={() => void save.mutateAsync({ employment_id: context.row.employment_id, date: context.day.date, arrival_time: null, departure_time: null, status: null }).then(() => setContext(null))}>Pracovní den</button></div> : null}
              </div>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
