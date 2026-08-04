import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
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
  TimeMetrics,
} from "../api/types";
import { Button, Panel, StatusMessage } from "../components/Primitives";
import { ClockInput } from "../components/ClockInput";
import { formatHours } from "../utils/hoursFormat";
import { chronologicalPlanBoundaries, edgeEvents, formatPragueTime } from "../utils/presentationAdapters";

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

function monthParts() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function eventTime(event: AttendanceEvent) {
  return formatPragueTime(event.occurred_at);
}

function AdminAttendanceMatrix({
  sheets,
  refresh,
  onLock,
  onBreaks,
}: {
  sheets: AdminAttendanceSheet[];
  refresh: () => void;
  onLock: (sheet: AdminAttendanceSheet) => void;
  onBreaks: (sheet: AdminAttendanceSheet) => void;
}) {
  const { t } = useTranslation();
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const days = sheets[0]?.days ?? [];
  const update = async (sheet: AdminAttendanceSheet, day: AttendanceDay, event: AttendanceEvent | undefined, value: string) => {
    try {
      if (!event && value) {
        await api.admin("/api/v1/admin/attendance/events", { method: "POST", body: JSON.stringify({ employment_id: sheet.employment_id, occurred_at: `${day.date}T${value}:00`, event_type: day.next_event_type }) });
      } else if (event && !value) {
        await api.admin(`/api/v1/admin/attendance/events/${event.id}${event.deletion_partner_id == null ? "" : `?paired_event_id=${event.deletion_partner_id}`}`, { method: "DELETE" });
      } else if (event && value !== eventTime(event)) {
        await api.admin(`/api/v1/admin/attendance/events/${event.id}`, { method: "PUT", body: JSON.stringify({ employment_id: sheet.employment_id, occurred_at: `${day.date}T${value}:00`, event_type: event.event_type }) });
      } else return;
      refresh();
    } catch (reason) {
      throw reason instanceof Error ? reason : new Error("PRŮCHOD se nepodařilo uložit.");
    }
  };
  const updateStatus = async (sheet: AdminAttendanceSheet, day: AttendanceDay, status: string) => {
    await api.admin("/api/v1/admin/day-status", { method: "PUT", body: JSON.stringify({ employment_id: sheet.employment_id, date: day.date, status: status || null, confirm_delete_conflicts: Boolean(status) }) });
    refresh();
  };
  return (
    <div className="data-table-wrap group-plan-table-wrap admin-attendance-matrix-wrap">
      <table className="data-table matrix admin-attendance-matrix">
        <thead><tr><th className="matrix__sticky-left">{t("adminMatrix.common.employment")}</th>{days.map((day) => <th className="matrix__day-head" key={day.date}><strong>{day.date.slice(-2)}</strong><span>{new Intl.DateTimeFormat("cs-CZ", { weekday: "short" }).format(new Date(`${day.date}T12:00:00`))}</span></th>)}<th>{t("adminMatrix.common.completed")}</th></tr></thead>
        <tbody>
          {sheets.map((sheet) => (
            <tr key={sheet.employment_id} data-testid={`admin-attendance-${sheet.employment_id}`}>
              <th className="matrix__sticky-left"><div className="matrix-user"><strong>{sheet.employment_label}</strong><small>{sheet.attendance_locked ? "Zamčeno" : "Odemčeno"}</small><span className="matrix-user__actions"><Button variant="quiet" onClick={() => onLock(sheet)}>{sheet.attendance_locked ? <UnlockKeyhole /> : <LockKeyhole />}{sheet.attendance_locked ? "Odemknout docházku" : "Zamknout docházku"}</Button><Button variant="quiet" onClick={() => onBreaks(sheet)}>Přidej pauzy</Button></span></div></th>
              {sheet.days.map((day) => {
                const edges = edgeEvents(day.events);
                const disabled = sheet.attendance_locked || !day.is_within_employment_period || Boolean(day.effective_status);
                const dayKey = `${sheet.employment_id}-${day.date}`;
                const visibleEvents: (AttendanceEvent | undefined)[] = expandedDays.has(dayKey) ? [...day.events, undefined] : day.events.length === 0 ? [undefined] : day.events.length === 1 ? [edges.first, undefined] : [edges.first, edges.last];
                return <td className="day-cell" key={day.date}>
                  {edges.middleCount ? <button type="button" className="matrix-middle-count" onClick={() => setExpandedDays((current) => { const next = new Set(current); if (next.has(dayKey)) next.delete(dayKey); else next.add(dayKey); return next; })} aria-expanded={expandedDays.has(dayKey)}>{expandedDays.has(dayKey) ? t("adminMatrix.common.collapse") : `${t("adminMatrix.common.expand")} (+${edges.middleCount})`}</button> : null}
                  <div className="matrix-day-editor">
                    {visibleEvents.map((event, index) => <ClockInput key={event?.id ?? `append-${index}`} aria-label={`${sheet.employment_label} ${day.date} PRŮCHOD ${index + 1}`} value={event ? eventTime(event) : ""} disabled={disabled || (!event && index !== day.events.length)} onCommit={(value) => update(sheet, day, event, value)} />)}
                    <select aria-label={`Nepřítomnost ${sheet.employment_label} ${day.date}`} value={day.effective_status ?? ""} disabled={sheet.attendance_locked || !day.is_within_employment_period} onChange={(event) => { if (event.target.value && !window.confirm("Nahradit docházku celodenním stavem?")) return; void updateStatus(sheet, day, event.target.value); }}><option value="">{t("adminMatrix.common.workday")}</option><option value="SICKNESS">{t("adminMatrix.statuses.SICKNESS")}</option><option value="PARAGRAPH">{t("adminMatrix.statuses.PARAGRAPH")}</option><option value="HOLIDAY">{t("adminMatrix.statuses.HOLIDAY")}</option><option value="OFF">{t("adminMatrix.statuses.OFF")}</option></select>
                  </div>
                </td>;
              })}
              <td className="matrix__summary">{sheet.display_metrics.map((key) => <span key={key}>{metricLabels[key]}: {sheet.worked?.[key] ? formatHours(sheet.worked[key]!.hours, "cs-CZ") : "—"}</span>)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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
    void queryClient.invalidateQueries({
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
  const toggleSelection = (id: number) =>
    setSelected((current) => {
      const next = new Set(
        current ?? availableSheets.map((sheet) => sheet.employment_id),
      );
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
            <div className="attendance-sheet-selection">
              <strong>{t("adminMatrix.attendance.selectionTitle")}</strong>
              <div className="attendance-sheet-selection__items">
                {availableSheets.map((sheet) => (
                  <label key={sheet.employment_id}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(sheet.employment_id)}
                      onChange={() => toggleSelection(sheet.employment_id)}
                    />
                    {sheet.employment_label}
                  </label>
                ))}
              </div>
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
  const toggle = (id: number, checked: boolean) =>
    select.mutate(
      checked ? [...selected, id] : selected.filter((item) => item !== id),
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
            <div className="attendance-sheet-selection">
              <strong>Výběr úvazků pro plán</strong>
              <div className="attendance-sheet-selection__items">
                {available.map((item) => (
                  <label key={item.id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(item.id)}
                      disabled={!item.is_active_in_month}
                      onChange={(event) =>
                        toggle(item.id, event.target.checked)
                      }
                    />
                    {item.display_label ?? `${item.user_name} — ${item.title}`}
                  </label>
                ))}
              </div>
            </div>
            {rows.length === 0 ? (
              <StatusMessage
                kind="empty"
                title={t("adminMatrix.shiftPlan.empty")}
              />
            ) : (
              <div className="data-table-wrap group-plan-table-wrap admin-shift-plan-matrix-wrap">
                <table className="data-table matrix shift-plan-matrix">
                  <thead>
                    <tr>
                      <th className="matrix__sticky-left">Úvazek</th>
                      {rows[0]?.days.map((day) => (
                        <th className="matrix__day-head" key={day.date}>
                          <strong>{day.date.slice(-2)}</strong>
                          <span>{new Intl.DateTimeFormat("cs-CZ", { weekday: "short" }).format(new Date(`${day.date}T12:00:00`))}</span>
                        </th>
                      ))}
                      <th>Souhrn</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.employment_id} data-testid={`admin-shift-plan-${row.employment_id}`}>
                        <th className="matrix__sticky-left">
                          <div className="matrix-user">
                            <strong>{row.display_label}</strong>
                            <Button variant="quiet" onClick={() => lock.mutate({ row, locked: !row.shift_plan_locked })}>
                              {row.shift_plan_locked ? <UnlockKeyhole /> : <LockKeyhole />}
                              {row.shift_plan_locked ? "Odemknout plán" : "Zamknout plán"}
                            </Button>
                          </div>
                        </th>
                        {row.days.map((day) => {
                          const disabled = row.shift_plan_locked || !day.is_within_employment_period || Boolean(day.effective_status);
                          const planTimes = chronologicalPlanBoundaries({ planned_carryover_departure_time: day.carryover_departure_time, planned_arrival_time: day.arrival_time, planned_departure_time: day.departure_time });
                          const carryover = Boolean(day.carryover_departure_time);
                          return (
                            <td className="day-cell" key={day.date}>
                              <div className="matrix-day-editor">
                                {Array.from({ length: Math.max(2, planTimes.length) }, (_, index) => <ClockInput key={index} aria-label={`${row.display_label} ${day.date} PRŮCHOD ${index + 1}`} value={planTimes[index] ?? ""} disabled={disabled || (carryover && index === 0) || index > (carryover ? 2 : 1)} onCommit={async (value) => { const arrivalIndex = carryover ? 1 : 0; const departureIndex = carryover ? 2 : 1; await save.mutateAsync({ employment_id: row.employment_id, date: day.date, arrival_time: index === arrivalIndex ? value || null : day.arrival_time, departure_time: index === departureIndex ? value || null : day.departure_time, status: day.status }); }} />)}
                                <select aria-label={`Stav plánu ${row.display_label} ${day.date}`} value={day.status ?? ""} disabled={disabled || Boolean(day.carryover_departure_time)} onChange={(event) => { const nextStatus = event.target.value || null; if (nextStatus && (day.arrival_time || day.departure_time) && !window.confirm("Nahradit existující směnu celodenním stavem? Časy směny budou odstraněny.")) return; void save.mutateAsync({ employment_id: row.employment_id, date: day.date, arrival_time: null, departure_time: null, status: nextStatus, confirm_delete_conflicts: Boolean(nextStatus) }); }}>
                                  <option value="">Směna</option><option value="HOLIDAY">Dovolená</option><option value="OFF">Volno</option>
                                </select>
                              </div>
                            </td>
                          );
                        })}
                        <td className="matrix__summary">
                          {row.display_metrics.map((key) => <span key={key}>{plannedMetricLabels[key]}: {row.summary.planned?.[key] ? formatHours(row.summary.planned[key]!.hours, "cs-CZ") : "—"}</span>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
