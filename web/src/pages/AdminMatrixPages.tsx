import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LockKeyhole,
  Plus,
  Trash2,
  UnlockKeyhole,
  Utensils,
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
import { plannedHintForEvent } from "../utils/plannedEventHint";

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
const statusLabels: Record<string, string> = {
  HOLIDAY: "Dovolená",
  OFF: "Volno",
  SICKNESS: "Nemoc",
  PARAGRAPH: "Paragraf",
};
const attendanceStatuses = new Set(["SICKNESS", "PARAGRAPH"]);
const planStatuses = new Set(["HOLIDAY", "OFF"]);

function monthParts() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function displayDate(value: string) {
  return new Intl.DateTimeFormat("cs-CZ").format(new Date(`${value}T12:00:00`));
}

function eventTime(event: AttendanceEvent) {
  return new Intl.DateTimeFormat("cs-CZ", {
    timeZone: "Europe/Prague",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(event.occurred_at));
}

function EventEditor({
  day,
  sheet,
  refresh,
  report,
}: {
  day: AttendanceDay;
  sheet: AdminAttendanceSheet;
  refresh: () => void;
  report: (message: string) => void;
}) {
  const [newTime, setNewTime] = useState("");
  const [newEndTime, setNewEndTime] = useState("");
  const [newEndDate, setNewEndDate] = useState(day.date);
  const disabled =
    sheet.attendance_locked ||
    !day.is_within_employment_period ||
    Boolean(day.effective_status);
  const update = async (event: AttendanceEvent, time: string) => {
    if (!time) {
      await remove(event.id, event.deletion_partner_id ?? undefined, false);
      return;
    }
    if (time === eventTime(event)) return;
    try {
      await api.admin(`/api/v1/admin/attendance/events/${event.id}`, {
        method: "PUT",
        body: JSON.stringify({
          employment_id: sheet.employment_id,
          occurred_at: `${day.date}T${time}:00`,
          event_type: event.event_type,
        }),
      });
      refresh();
    } catch (reason) {
      report(
        reason instanceof Error
          ? reason.message
          : "Průchod se nepodařilo upravit.",
      );
    }
  };
  const remove = async (
    eventId: number,
    pairedEventId?: number,
    confirm = true,
  ) => {
    if (
      confirm &&
      !window.confirm(
        pairedEventId == null
          ? "Odstranit tento průchod?"
          : "Odstranit vybraný pár průchodů?",
      )
    )
      return;
    try {
      await api.admin(`/api/v1/admin/attendance/events/${eventId}${pairedEventId == null ? "" : `?paired_event_id=${pairedEventId}`}`, {
        method: "DELETE",
      });
      refresh();
    } catch (reason) {
      report(
        reason instanceof Error
          ? reason.message
          : "Průchod se nepodařilo odstranit.",
      );
    }
  };
  const add = async (startTime = newTime, endTime = newEndTime) => {
    if (!startTime) return;
    try {
      await api.admin("/api/v1/admin/attendance/events", {
        method: "POST",
        body: JSON.stringify({
          employment_id: sheet.employment_id,
          occurred_at: `${day.date}T${startTime}:00`,
          event_type: endTime ? "IN" : day.next_event_type,
          ...(endTime
            ? { paired_occurred_at: `${newEndDate}T${endTime}:00` }
            : {}),
        }),
      });
      setNewTime("");
      setNewEndTime("");
      setNewEndDate(day.date);
      refresh();
    } catch (reason) {
      report(
        reason instanceof Error
          ? reason.message
          : "Průchod se nepodařilo přidat.",
      );
    }
  };
  return (
    <div className="matrix-events">
      {day.events.map((event, index) => {
        const plannedTime = plannedHintForEvent(day, index);
        return <label className="matrix-event" key={event.id}>
          <span>
            {event.event_type === "IN" ? "Příchod" : "Odchod"} {index + 1}
          </span>
          <em>{plannedTime ? `plán ${plannedTime}` : ""}</em>
          <ClockInput
            aria-label={`${sheet.employment_label} ${day.date} ${event.event_type} ${index + 1}`}
            value={eventTime(event)}
            disabled={disabled}
            onCommit={(time) => void update(event, time)}
          />
          {event.event_type === "IN" ? (
            <button
              type="button"
              aria-label={`Odstranit interval ${day.date}`}
              disabled={disabled}
              onClick={() => void remove(event.id, event.deletion_partner_id ?? undefined)}
            >
              <Trash2 size={13} />
            </button>
          ) : event.deletion_partner_id != null ? (
            <button
              type="button"
              aria-label={`Odstranit pauzu ${day.date}`}
              disabled={disabled}
              onClick={() => void remove(event.id, event.deletion_partner_id ?? undefined)}
            >
              <Trash2 size={13} />
            </button>
          ) : null}
        </label>;
      })}
      <div className="matrix-event matrix-event--new">
        <span>
          {newEndTime || day.next_event_type === "IN" ? "Nový příchod" : "Nový odchod"}
        </span>
        <ClockInput
          aria-label={`Nový průchod ${sheet.employment_label} ${day.date}`}
          value={newTime}
          disabled={disabled}
          onCommit={(value) => {
            setNewTime(value);
            void add(value);
          }}
        />
        <ClockInput
          aria-label={`Nový odchod páru ${sheet.employment_label} ${day.date}`}
          value={newEndTime}
          disabled={disabled}
          onCommit={(value) => {
            setNewEndTime(value);
            if (newTime) void add(newTime, value);
          }}
        />
        {newEndTime ? (
          <input
            type="date"
            aria-label={`Datum odchodu páru ${sheet.employment_label} ${day.date}`}
            value={newEndDate}
            disabled={disabled}
            onChange={(event) => setNewEndDate(event.target.value)}
          />
        ) : null}
        <button
          type="button"
          aria-label={`Přidat průchod ${day.date}`}
          disabled={disabled || !newTime}
          onClick={() => void add()}
        >
          <Plus size={14} />
        </button>
      </div>
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
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    title: string;
  } | null>(null);
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
  const lock = useMutation({
    mutationFn: ({
      sheet,
      lockType,
      locked,
    }: {
      sheet: AdminAttendanceSheet;
      lockType: "attendance" | "shift_plan";
      locked: boolean;
    }) =>
      api.admin("/api/v1/admin/locks", {
        method: "PUT",
        body: JSON.stringify({
          lock_type: lockType,
          year,
          month,
          locked,
          employment_ids: [sheet.employment_id],
        }),
      }),
    onSuccess: refresh,
    onError: (reason) =>
      setNotice({
        kind: "error",
        title:
          reason instanceof Error
            ? reason.message
            : "Zámek se nepodařilo změnit.",
      }),
  });
  const addBreaks = async (sheet: AdminAttendanceSheet) => {
    if (
      !window.confirm(
        `Doplnit zákonné pauzy do docházky ${sheet.employment_label}? Změnu nelze hromadně vrátit.`,
      )
    )
      return;
    try {
      const result = await api.admin<{
        inserted_pairs: number;
        inserted_events: number;
      }>("/api/v1/admin/attendance/breaks", {
        method: "POST",
        body: JSON.stringify({
          employment_id: sheet.employment_id,
          year,
          month,
          confirmed: true,
        }),
      });
      setNotice({
        kind: "success",
        title: `Doplněno ${result.inserted_pairs} pauz (${result.inserted_events} průchodů).`,
      });
      refresh();
    } catch (reason) {
      setNotice({
        kind: "error",
        title:
          reason instanceof Error
            ? reason.message
            : "Pauzy se nepodařilo doplnit.",
      });
    }
  };
  const saveStatus = async (
    sheet: AdminAttendanceSheet,
    day: AttendanceDay,
    status: string,
  ) => {
    if (
      status &&
      !window.confirm(`Nastavit ${statusLabels[status]} pro ${day.date}?`)
    )
      return;
    try {
      await api.admin("/api/v1/admin/day-status", {
        method: "PUT",
        body: JSON.stringify({
          employment_id: sheet.employment_id,
          date: day.date,
          status: status || null,
          confirm_delete_conflicts: true,
        }),
      });
      refresh();
    } catch (reason) {
      setNotice({
        kind: "error",
        title:
          reason instanceof Error
            ? reason.message
            : "Stav dne se nepodařilo uložit.",
      });
    }
  };
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
        {notice && <StatusMessage kind={notice.kind} title={notice.title} />}
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
              visibleSheets.map((sheet) => (
                <section
                  className="attendance-sheet"
                  key={sheet.employment_id}
                  data-testid={`admin-attendance-${sheet.employment_id}`}
                >
                  <header className="attendance-sheet__header">
                    <div>
                      <h3>{sheet.employment_label}</h3>
                      <small>
                        {displayDate(sheet.start_date)} –{" "}
                        {sheet.end_date
                          ? displayDate(sheet.end_date)
                          : "bez omezení"}
                      </small>
                    </div>
                    <div className="action-row action-row--wrap">
                      <Button
                        variant="quiet"
                        onClick={() =>
                          lock.mutate({
                            sheet,
                            lockType: "attendance",
                            locked: !sheet.attendance_locked,
                          })
                        }
                      >
                        {sheet.attendance_locked ? (
                          <UnlockKeyhole />
                        ) : (
                          <LockKeyhole />
                        )}
                        {sheet.attendance_locked
                          ? "Odemknout docházku"
                          : "Zamknout docházku"}
                      </Button>
                      <Button
                        variant="quiet"
                        onClick={() =>
                          lock.mutate({
                            sheet,
                            lockType: "shift_plan",
                            locked: !sheet.shift_plan_locked,
                          })
                        }
                      >
                        {sheet.shift_plan_locked ? (
                          <UnlockKeyhole />
                        ) : (
                          <LockKeyhole />
                        )}
                        {sheet.shift_plan_locked
                          ? "Odemknout plán"
                          : "Zamknout plán"}
                      </Button>
                      <Button
                        disabled={sheet.attendance_locked}
                        onClick={() => void addBreaks(sheet)}
                      >
                        <Utensils />
                        Přidej pauzy
                      </Button>
                    </div>
                  </header>
                  <div className="data-table-wrap">
                    <table className="data-table attendance-matrix">
                      <thead>
                        <tr>
                          <th>Datum</th>
                          <th>Průchody</th>
                          <th>Nepřítomnost</th>
                          {sheet.display_metrics.map((key) => (
                            <th key={key}>{metricLabels[key]} (h)</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sheet.days.map((day) => (
                          <tr key={day.date}>
                            <td data-label="Datum">
                              {new Intl.DateTimeFormat("cs-CZ").format(
                                new Date(`${day.date}T12:00:00`),
                              )}
                              {day.planned_carryover_departure_time ? (
                                <small className="matrix-date-note">
                                  Přesah plánu do {day.planned_carryover_departure_time}
                                </small>
                              ) : null}
                            </td>
                            <td data-label="Průchody">
                              <EventEditor
                                day={day}
                                sheet={sheet}
                                refresh={refresh}
                                report={(message) =>
                                  setNotice({ kind: "error", title: message })
                                }
                              />
                            </td>
                            <td data-label="Nepřítomnost">
                              <select
                                aria-label={`Nepřítomnost ${sheet.employment_label} ${day.date}`}
                                value={day.effective_status ?? ""}
                                disabled={
                                  !day.is_within_employment_period ||
                                  (sheet.attendance_locked &&
                                    sheet.shift_plan_locked) ||
                                  (sheet.attendance_locked &&
                                    attendanceStatuses.has(
                                      day.effective_status ?? "",
                                    )) ||
                                  (sheet.shift_plan_locked &&
                                    planStatuses.has(
                                      day.effective_status ?? "",
                                    )) ||
                                  (sheet.attendance_locked &&
                                    day.events.length > 0) ||
                                  (sheet.shift_plan_locked &&
                                    Boolean(
                                      day.planned_arrival_time ||
                                        day.planned_departure_time ||
                                        day.planned_carryover_departure_time ||
                                        day.planned_status,
                                    ))
                                }
                                onChange={(event) =>
                                  void saveStatus(
                                    sheet,
                                    day,
                                    event.target.value,
                                  )
                                }
                              >
                                <option value="">Pracovní den</option>
                                <option
                                  value="HOLIDAY"
                                  disabled={sheet.shift_plan_locked}
                                >
                                  Dovolená
                                </option>
                                <option
                                  value="SICKNESS"
                                  disabled={sheet.attendance_locked}
                                >
                                  Nemoc
                                </option>
                                <option
                                  value="OFF"
                                  disabled={sheet.shift_plan_locked}
                                >
                                  Volno
                                </option>
                                <option
                                  value="PARAGRAPH"
                                  disabled={sheet.attendance_locked}
                                >
                                  Paragraf
                                </option>
                              </select>
                            </td>
                            {sheet.display_metrics.map((key) => (
                              <td
                                key={key}
                                data-label={`${metricLabels[key]} (h)`}
                              >
                                {day.worked?.[key]
                                  ? formatHours(day.worked[key]!.hours, "cs-CZ")
                                  : "—"}
                              </td>
                            ))}
                          </tr>
                        ))}
                        <tr>
                          <th colSpan={3}>Součet</th>
                          {sheet.display_metrics.map((key) => (
                            <th key={key}>
                              {sheet.worked?.[key]
                                ? formatHours(sheet.worked[key]!.hours, "cs-CZ")
                                : "—"}
                            </th>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </section>
              ))
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
              rows.map((row) => (
                <section
                  className="attendance-sheet"
                  key={row.employment_id}
                  data-testid={`admin-shift-plan-${row.employment_id}`}
                >
                  <header className="attendance-sheet__header">
                    <h3>{row.display_label}</h3>
                    <Button
                      variant="quiet"
                      onClick={() =>
                        lock.mutate({ row, locked: !row.shift_plan_locked })
                      }
                    >
                      {row.shift_plan_locked ? (
                        <UnlockKeyhole />
                      ) : (
                        <LockKeyhole />
                      )}
                      {row.shift_plan_locked
                        ? "Odemknout plán"
                        : "Zamknout plán"}
                    </Button>
                  </header>
                  <div className="data-table-wrap">
                    <table className="data-table shift-plan-matrix">
                      <thead>
                        <tr>
                          <th>Datum</th>
                          <th>Příchod</th>
                          <th>Odchod</th>
                          <th>Stav</th>
                          {row.display_metrics.map((key) => (
                            <th key={key}>{plannedMetricLabels[key]} (h)</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {row.days.map((day) => (
                          <tr key={day.date}>
                            <td data-label="Datum">
                              {new Intl.DateTimeFormat("cs-CZ").format(
                                new Date(`${day.date}T12:00:00`),
                              )}
                              {day.carryover_departure_time ? (
                                <small className="matrix-date-note">
                                  Přesah do {day.carryover_departure_time}
                                </small>
                              ) : null}
                            </td>
                            <td data-label="Příchod">
                              <ClockInput
                                aria-label={`${row.display_label} ${day.date} příchod`}
                                value={day.arrival_time ?? ""}
                                disabled={
                                  row.shift_plan_locked ||
                                  !day.is_within_employment_period ||
                                  Boolean(day.effective_status) ||
                                  day.is_carryover
                                }
                                onCommit={(value) =>
                                  save.mutate({
                                    employment_id: row.employment_id,
                                    date: day.date,
                                    arrival_time: value || null,
                                    departure_time: day.departure_time,
                                    status: day.status,
                                  })
                                }
                              />
                            </td>
                            <td data-label="Odchod">
                              <ClockInput
                                aria-label={`${row.display_label} ${day.date} odchod`}
                                value={day.departure_time ?? ""}
                                disabled={
                                  row.shift_plan_locked ||
                                  !day.is_within_employment_period ||
                                  Boolean(day.effective_status) ||
                                  day.is_carryover
                                }
                                onCommit={(value) =>
                                  save.mutate({
                                    employment_id: row.employment_id,
                                    date: day.date,
                                    arrival_time: day.arrival_time,
                                    departure_time: value || null,
                                    status: day.status,
                                  })
                                }
                              />
                            </td>
                            <td data-label="Stav">
                              <select
                                aria-label={`Stav plánu ${row.display_label} ${day.date}`}
                                value={day.status ?? ""}
                                disabled={
                                  row.shift_plan_locked ||
                                  !day.is_within_employment_period ||
                                  Boolean(day.carryover_departure_time) ||
                                  Boolean(day.effective_status && !day.status)
                                }
                                onChange={(event) => {
                                  const nextStatus = event.target.value || null;
                                  if (
                                    nextStatus &&
                                    (day.arrival_time || day.departure_time) &&
                                    !window.confirm(
                                      "Nahradit existující směnu celodenním stavem? Časy směny budou odstraněny.",
                                    )
                                  )
                                    return;
                                  save.mutate({
                                    employment_id: row.employment_id,
                                    date: day.date,
                                    arrival_time: null,
                                    departure_time: null,
                                    status: nextStatus,
                                    confirm_delete_conflicts: Boolean(nextStatus),
                                  });
                                }}
                              >
                                <option value="">Směna</option>
                                <option value="HOLIDAY">Dovolená</option>
                                <option value="OFF">Volno</option>
                              </select>
                            </td>
                            {row.display_metrics.map((key) => (
                              <td
                                key={key}
                                data-label={`${plannedMetricLabels[key]} (h)`}
                              >
                                {day.planned?.[key]
                                  ? formatHours(
                                      day.planned[key]!.hours,
                                      "cs-CZ",
                                    )
                                  : "—"}
                              </td>
                            ))}
                          </tr>
                        ))}
                        {row.display_metrics.length > 0 ? (
                          <tr>
                            <th colSpan={4}>Součet</th>
                            {row.display_metrics.map((key) => (
                              <th key={key}>
                                {row.summary.planned?.[key]
                                  ? formatHours(
                                      row.summary.planned[key]!.hours,
                                      "cs-CZ",
                                    )
                                  : "—"}
                              </th>
                            ))}
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
