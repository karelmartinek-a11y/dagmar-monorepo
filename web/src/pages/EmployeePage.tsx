import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Clock3,
  LogOut,
  Users,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { ApiError, api } from "../api/client";
import type {
  AttendanceDay,
  AttendanceEvent,
  AttendanceMonth,
  GroupShiftPlanMonth,
  MetricKey,
  PortalSession,
} from "../api/types";
import { Brand } from "../components/Brand";
import { ExternalLoginButtons } from "../components/ExternalLoginButtons";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { Button, Field, StatusMessage } from "../components/Primitives";
import { ClockInput } from "../components/ClockInput";
import {
  clearPortalSession,
  replaceAvailableEmployments,
  savePortalLogin,
  selectEmployment,
} from "../state/portalSession";
import { formatHours } from "../utils/hoursFormat";
import { reconcileSelectedGroup } from "../utils/groupSelection";
import { plannedHintForEvent } from "../utils/plannedEventHint";
import { chronologicalPlanBoundaries, formatPragueTime } from "../utils/presentationAdapters";

type View = "attendance" | "plan" | "group-plan";
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
type GroupPlanRow = GroupShiftPlanMonth["rows"][number];
type GroupPlanDay = GroupPlanRow["days"][number];

function weekdayLabel(date: string, language: string): string {
  return new Intl.DateTimeFormat(language === "cs" ? "cs-CZ" : language, {
    weekday: "long",
  }).format(new Date(`${date}T12:00:00`));
}

function absenceLabel(status: string | null | undefined): string {
  return status ? statusLabels[status] ?? status : "";
}

function AbsenceContextMenu({
  open,
  x,
  y,
  day,
  employmentId,
  attendanceLocked,
  shiftPlanLocked,
  onRefresh,
  onClose,
  mode,
}: {
  open: boolean;
  x: number;
  y: number;
  day: AttendanceDay;
  employmentId: number;
  attendanceLocked: boolean;
  shiftPlanLocked: boolean;
  onRefresh: () => void;
  onClose: () => void;
  mode: "attendance" | "plan";
}) {
  if (!open) return null;
  const options = mode === "attendance" ? ["SICKNESS", "PARAGRAPH"] : ["HOLIDAY", "OFF"];
  const save = async (status: string | null) => {
    if (status && !window.confirm(`Nastavit ${absenceLabel(status)} pro ${day.date}?`)) return;
    await (mode === "attendance" ? api.savePortalAttendanceStatus : api.savePortalStatus)({
      employment_id: employmentId,
      date: day.date,
      status,
      confirm_delete_conflicts: Boolean(status),
    });
    onClose();
    onRefresh();
  };
  const locked = mode === "attendance" ? attendanceLocked : shiftPlanLocked;
  return (
    <div className="row-context-menu" role="menu" style={{ left: x, top: y }} onMouseLeave={onClose}>
      <strong>Celodenní nepřítomnost</strong>
      {options.map((status) => <button type="button" role="menuitem" key={status} disabled={locked} onClick={() => void save(status)}>{absenceLabel(status)}</button>)}
      <button type="button" role="menuitem" disabled={locked || !day.effective_status} onClick={() => void save(null)}>Pracovní den</button>
    </div>
  );
}

function GroupPlanContextMenu({
  context,
  onSave,
  onClose,
}: {
  context: { row: GroupPlanRow; day: GroupPlanDay; x: number; y: number };
  onSave: (row: GroupPlanRow, day: GroupPlanDay, status: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const options = ["HOLIDAY", "OFF"];
  return <div className="row-context-menu" role="menu" style={{ left: context.x, top: context.y }} onMouseLeave={onClose}>
    <strong>Celodenní nepřítomnost</strong>
    {options.map((status) => <button type="button" role="menuitem" key={status} disabled={!context.row.is_own_employment || context.row.shift_plan_locked} onClick={() => { if (window.confirm(`Nastavit ${absenceLabel(status)} pro ${context.day.date}?`)) void onSave(context.row, context.day, status); }}>{absenceLabel(status)}</button>)}
    <button type="button" role="menuitem" disabled={!context.row.is_own_employment || context.row.shift_plan_locked || !context.day.status} onClick={() => void onSave(context.row, context.day, null)}>Pracovní den</button>
  </div>;
}

function Login({ onLogin }: { onLogin: (session: PortalSession) => void }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const providers = useQuery({
    queryKey: ["external-providers"],
    queryFn: api.externalProviders,
    retry: false,
  });
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      onLogin(savePortalLogin(await api.portalLogin(email, password)));
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("api.genericError"),
      );
    }
  }
  return (
    <main className="auth-page">
      <div className="auth-page__toolbar">
        <Brand />
        <LanguageSwitcher surface="employee" />
      </div>
      <form className="panel auth-panel" onSubmit={submit}>
        <h1>{t("employee.login.title")}</h1>
        <Field label={t("auth.email", "Pracovní e-mail")}>
          <input
            aria-label={t("auth.email", "Pracovní e-mail")}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </Field>
        <Field label={t("auth.password", "Heslo")}>
          <input
            aria-label={t("auth.password", "Heslo")}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </Field>
        {error ? <StatusMessage kind="error" title={error} /> : null}
        <Button type="submit">{t("auth.actions.login", "Přihlásit se")}</Button>
        <ExternalLoginButtons
          enabled={providers.data}
          getUrl={(provider) =>
            api.externalLoginUrl("employee", provider, "/app")
          }
          portal="employee"
        />
      </form>
    </main>
  );
}

function eventTime(event: AttendanceEvent): string {
  return formatPragueTime(event.occurred_at);
}

function EmployeeAttendanceTable({
  month,
  onRefresh,
}: {
  month: AttendanceMonth;
  onRefresh: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [context, setContext] = useState<{ day: AttendanceDay; x: number; y: number } | null>(null);
  const passColumns = Math.max(4, ...month.days.map((day) => day.events.length));
  const locked = month.attendance_locked;
  const update = async (day: AttendanceDay, event: AttendanceEvent | undefined, value: string) => {
    try {
      if (!event && value) {
        await api.createAttendanceEvent({
          employment_id: month.employment_id,
          occurred_at: `${day.date}T${value}:00`,
          event_type: day.next_event_type,
        });
      } else if (event && !value) {
        await api.deleteAttendanceEvent(event.id, event.deletion_partner_id ?? undefined);
      } else if (event && value !== eventTime(event)) {
        await api.updateAttendanceEvent(event.id, {
          employment_id: month.employment_id,
          occurred_at: `${day.date}T${value}:00`,
          event_type: event.event_type,
        });
      } else {
        return;
      }
      onRefresh();
    } catch (reason) {
      throw reason instanceof Error ? reason : new Error("Průchod se nepodařilo uložit.");
    }
  };
  return (
    <div className="data-table-wrap employee-table-wrap">
      <table className="data-table employee-month-table">
        <thead>
          <tr>
            <th>{t("employee.page.table.date")}</th>
            <th>{t("employee.page.table.day")}</th>
            {Array.from({ length: passColumns }, (_, index) => (
              <th key={index}>{t("employee.page.table.pass")} {index + 1}</th>
            ))}
            {month.display_metrics.map((key) => <th key={key}>{metricLabels[key]} (h)</th>)}
          </tr>
        </thead>
        <tbody>
          {month.days.map((day) => (
            <tr key={day.date} data-testid={`attendance-day-${day.date}`} onContextMenu={(event) => { event.preventDefault(); setContext({ day, x: event.clientX, y: event.clientY }); }}>
              <th>{day.date}</th>
              <td>{weekdayLabel(day.date, i18n.language)}</td>
              {Array.from({ length: passColumns }, (_, index) => {
                const event = day.events[index];
                const plannedTime = plannedHintForEvent(day, index);
                const editable = !locked && day.is_within_employment_period && !day.effective_status;
                return (
                  <td key={index}>
                    {day.effective_status ? <strong className="day-absence-label">{absenceLabel(day.effective_status)}</strong> : <><em className="planned-hint">{plannedTime ? `plán ${plannedTime}` : ""}</em><ClockInput aria-label={`${month.employment_label} ${day.date} PRŮCHOD ${index + 1}`} value={event ? eventTime(event) : ""} disabled={!editable} onCommit={(value) => update(day, event, value)} /></>}
                  </td>
                );
              })}
              {month.display_metrics.map((key) => (
                <td key={key}>{day.worked?.[key] ? formatHours(day.worked[key]!.hours, "cs-CZ") : "—"}</td>
              ))}
            </tr>
          ))}
          <tr className="summary-row">
            <th colSpan={2 + passColumns}>{t("employee.page.table.sum")}</th>
            {month.display_metrics.map((key) => (
              <th key={key}>{month.worked?.[key] ? formatHours(month.worked[key]!.hours, "cs-CZ") : "—"}</th>
            ))}
          </tr>
        </tbody>
      </table>
      {context ? <AbsenceContextMenu open x={context.x} y={context.y} day={context.day} employmentId={month.employment_id} attendanceLocked={month.attendance_locked} shiftPlanLocked={month.shift_plan_locked} onRefresh={onRefresh} onClose={() => setContext(null)} mode="attendance" /> : null}
    </div>
  );
}

function EmployeePlanTable({
  month,
  onRefresh,
  onSave,
}: {
  month: AttendanceMonth;
  onRefresh: () => void;
  onSave: (body: Record<string, unknown>) => Promise<unknown>;
}) {
  const { t, i18n } = useTranslation();
  const [context, setContext] = useState<{ day: AttendanceDay; x: number; y: number } | null>(null);
  const passColumns = Math.max(4, ...month.days.map((day) => chronologicalPlanBoundaries({ planned_carryover_departure_time: day.planned_carryover_departure_time, planned_arrival_time: day.planned_arrival_time, planned_departure_time: day.planned_departure_time }).length));
  return (
    <div className="data-table-wrap employee-table-wrap">
      <table className="data-table employee-month-table">
        <thead><tr><th>{t("employee.page.table.date")}</th><th>{t("employee.page.table.day")}</th>{Array.from({ length: passColumns }, (_, index) => <th key={index}>{t("employee.page.table.pass")} {index + 1}</th>)}{month.display_metrics.map((key) => <th key={key}>{plannedMetricLabels[key]} (h)</th>)}</tr></thead>
        <tbody>
          {month.days.map((day) => {
            const disabled = month.shift_plan_locked || !day.is_within_employment_period || Boolean(day.effective_status) || day.planned_is_carryover;
            const planTimes = chronologicalPlanBoundaries({ planned_carryover_departure_time: day.planned_carryover_departure_time, planned_arrival_time: day.planned_arrival_time, planned_departure_time: day.planned_departure_time });
            const carryover = Boolean(day.planned_carryover_departure_time);
            const save = (arrival: string | null, departure: string | null) => onSave({ employment_id: month.employment_id, date: day.date, arrival_time: arrival, departure_time: departure, status: day.planned_status ?? null });
            return (
              <tr key={day.date} onContextMenu={(event) => { event.preventDefault(); setContext({ day, x: event.clientX, y: event.clientY }); }}>
                <th>{day.date}</th>
                <td>{weekdayLabel(day.date, i18n.language)}</td>
                {Array.from({ length: passColumns }, (_, index) => <td key={index}>{day.effective_status || day.planned_status ? <strong className="day-absence-label">{absenceLabel(day.effective_status || day.planned_status)}</strong> : <ClockInput aria-label={`${t("adminMatrix.common.plannedPass", "PLÁN – PRŮCHOD")} ${index + 1} ${day.date}`} value={planTimes[index] ?? ""} disabled={disabled || (carryover && index === 0) || (carryover && index > 2) || index > (carryover ? 2 : 1)} onCommit={async (value) => { const arrivalIndex = carryover ? 1 : 0; const departureIndex = carryover ? 2 : 1; await save(index === arrivalIndex ? value || null : day.planned_arrival_time ?? null, index === departureIndex ? value || null : day.planned_departure_time ?? null); }} />}</td>)}
                {month.display_metrics.map((key) => <td key={key}>{day.planned?.[key] ? formatHours(day.planned[key]!.hours, "cs-CZ") : "—"}</td>)}
              </tr>
            );
          })}
          <tr className="summary-row"><th colSpan={2 + passColumns}>{t("employee.page.table.sum")}</th>{month.display_metrics.map((key) => <th key={key}>{month.planned?.[key] ? formatHours(month.planned[key]!.hours, "cs-CZ") : "—"}</th>)}</tr>
        </tbody>
      </table>
      {context ? <AbsenceContextMenu open x={context.x} y={context.y} day={context.day} employmentId={month.employment_id} attendanceLocked={month.attendance_locked} shiftPlanLocked={month.shift_plan_locked} onRefresh={onRefresh} onClose={() => setContext(null)} mode="plan" /> : null}
    </div>
  );
}

export function EmployeePage() {
  const { t } = useTranslation();
  const [session, setSession] = useState<PortalSession | null | undefined>(undefined);
  const [month, setMonth] = useState(() => new Date());
  const [view, setView] = useState<View>("attendance");
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<number | null>(null);
  const [groupContext, setGroupContext] = useState<{ row: GroupPlanRow; day: GroupPlanDay; x: number; y: number } | null>(null);
  const employmentId = session?.selected_employment_id ?? null;
  const queryClient = useQueryClient();
  const year = month.getFullYear();
  const monthNumber = month.getMonth() + 1;
  useEffect(() => {
    let active = true;
    const externalComplete = new URLSearchParams(window.location.search).get("external_auth") === "complete";
    const restore = externalComplete ? api.consumeExternalLogin() : api.portalSession();
    void restore
      .then((login) => {
        if (active) setSession(savePortalLogin(login));
        if (externalComplete) window.history.replaceState({}, "", "/app");
      })
      .catch(() => { if (active) setSession(null); });
    return () => { active = false; };
  }, []);
  const employments = useQuery({
    queryKey: ["attendance-employments", year, monthNumber],
    queryFn: () => api.attendanceEmployments(year, monthNumber),
    enabled: Boolean(session),
  });
  const query = useQuery({
    queryKey: ["attendance", employmentId, year, monthNumber],
    queryFn: () => api.attendance(employmentId as number, year, monthNumber),
    enabled: employmentId !== null,
  });
  const groups = useQuery({
    queryKey: ["shift-plan-groups", year, monthNumber],
    queryFn: () => api.shiftPlanGroups(year, monthNumber),
    enabled: Boolean(session),
  });
  const selectedGroupIsAvailable = Boolean(
    selectedGroup !== null &&
      groups.data?.some((group) => group.id === selectedGroup),
  );
  const groupPlan = useQuery({
    queryKey: ["group-plan", selectedGroup, year, monthNumber],
    queryFn: () =>
      api.groupShiftPlan(selectedGroup as number, year, monthNumber),
    enabled: view === "group-plan" && selectedGroupIsAvailable,
  });
  useEffect(() => {
    document.title = `${t("common.appName")} · ${t("employee.page.title")}`;
  }, [t]);
  useEffect(() => {
    if (!employments.data) return;
    setSession((current) => {
      if (!current) return current;
      const nextIds = employments.data.map((item) => item.id).join(",");
      const currentIds = current.available_employments
        .map((item) => item.id)
        .join(",");
      const selectedIsAvailable = employments.data.some(
        (item) => item.id === current.selected_employment_id,
      );
      if (
        nextIds === currentIds &&
        (selectedIsAvailable || current.selected_employment_id === null)
      )
        return current;
      return replaceAvailableEmployments(current, employments.data);
    });
  }, [employments.data]);
  useEffect(() => {
    if (!groups.data) return;
    const next = reconcileSelectedGroup(selectedGroup, groups.data);
    if (next !== selectedGroup) setSelectedGroup(next);
  }, [groups.data, selectedGroup]);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["attendance"] });
    void queryClient.invalidateQueries({ queryKey: ["group-plan"] });
  };
  const planMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.saveShiftPlan(body),
    onSuccess: refresh,
    onError: (reason) =>
      setNotice(
        reason instanceof Error ? reason.message : "Plán se nepodařilo uložit.",
      ),
  });
  if (session === undefined) return <main className="employee-app" aria-busy="true" />;
  if (session === null) return <Login onLogin={setSession} />;
  return (
    <main className="employee-app">
      <header className="employee-topbar">
        <Brand />
        <div className="employee-topbar__actions">
          <LanguageSwitcher compact surface="employee" />
          <Button
            variant="quiet"
            onClick={() => {
              void api.portalLogout().finally(() => {
                clearPortalSession();
                setSession(null);
              });
            }}
          >
            <LogOut />
            <span>{t("common.actions.logout")}</span>
          </Button>
        </div>
      </header>
      <section className="employee-main">
        <div className="employee-page">
          <div className="employee-command">
            <div className="employee-mode-switch" role="tablist">
              <button
                role="tab"
                aria-selected={view === "attendance"}
                className={view === "attendance" ? "active" : ""}
                onClick={() => setView("attendance")}
              >
                <Clock3 />
                Docházka
              </button>
              <button
                role="tab"
                aria-selected={view === "plan"}
                className={view === "plan" ? "active" : ""}
                onClick={() => setView("plan")}
              >
                <CalendarDays />
                Plán služeb
              </button>
              <button
                role="tab"
                aria-selected={view === "group-plan"}
                className={view === "group-plan" ? "active" : ""}
                onClick={() => setView("group-plan")}
              >
                <Users />
                Skupinový plán služeb
              </button>
            </div>
            <div className="month-toolbar">
              <Button
                variant="quiet"
                onClick={() =>
                  setMonth(new Date(year, month.getMonth() - 1, 1))
                }
              >
                ‹
              </Button>
              <strong>
                {new Intl.DateTimeFormat("cs-CZ", {
                  month: "long",
                  year: "numeric",
                }).format(month)}
              </strong>
              <Button
                variant="quiet"
                onClick={() =>
                  setMonth(new Date(year, month.getMonth() + 1, 1))
                }
              >
                ›
              </Button>
            </div>
          </div>
          <div className="employee-employment">
            <Field label="Úvazek">
              <select
                value={employmentId ?? ""}
                disabled={session.available_employments.length === 0}
                onChange={(event) =>
                  setSession(
                    selectEmployment(session, Number(event.target.value)),
                  )
                }
              >
                {session.available_employments.map((employment) => (
                  <option key={employment.id} value={employment.id}>
                    {employment.label ?? employment.title}
                  </option>
                ))}
              </select>
            </Field>
            {session.available_employments.length === 0 ? (
              <StatusMessage
                kind="empty"
                title="Ve zvoleném měsíci není aktivní žádný úvazek."
              />
            ) : null}
          </div>
          {notice ? <StatusMessage kind="error" title={notice} /> : null}
          {view !== "group-plan" && employmentId !== null && query.isPending ? (
            <StatusMessage kind="loading" title="Načítám měsíc" />
          ) : null}
          {view !== "group-plan" && query.error ? (
            <StatusMessage
              kind={query.error instanceof ApiError && query.error.offline ? "offline" : "error"}
              title={
                query.error instanceof ApiError && query.error.offline
                  ? "Jste offline"
                  : query.error.message
              }
            >
              {query.error instanceof ApiError && query.error.offline
                ? query.error.message
                : null}
            </StatusMessage>
          ) : null}
          {query.data && view !== "group-plan" ? (
            <>
              <div className="employee-metrics">
                {query.data.display_metrics.map((key) => (
                  <div className="metric" key={key}>
                    <span>
                      {view === "plan"
                        ? plannedMetricLabels[key]
                        : metricLabels[key]}
                    </span>
                    <strong>
                      {(
                        view === "plan"
                          ? query.data?.planned?.[key]
                          : query.data?.worked?.[key]
                      )
                        ? formatHours(
                            (view === "plan"
                              ? query.data.planned![key]!
                              : query.data.worked![key]!
                            ).hours,
                            "cs-CZ",
                          )
                        : "—"}
                    </strong>
                  </div>
                ))}
              </div>
              <div className="employee-locks">
                <span
                  className={`badge ${query.data.attendance_locked ? "badge--danger" : "badge--good"}`}
                >
                  Docházka{" "}
                  {query.data.attendance_locked ? "zamčena" : "otevřena"}
                </span>
                <span
                  className={`badge ${query.data.shift_plan_locked ? "badge--danger" : "badge--good"}`}
                >
                  Plán {query.data.shift_plan_locked ? "zamčen" : "otevřen"}
                </span>
              </div>
              {view === "attendance" ? (
                <EmployeeAttendanceTable month={query.data} onRefresh={refresh} />
              ) : (
                <EmployeePlanTable month={query.data} onRefresh={refresh} onSave={(body) => planMutation.mutateAsync(body)} />
              )}
            </>
          ) : null}
          {view === "group-plan" ? (
            <section className="panel group-plan-panel">
              <div className="panel-body">
                <Field label="Skupina">
                  <select
                    value={selectedGroup ?? ""}
                    onChange={(event) =>
                      setSelectedGroup(
                        event.target.value ? Number(event.target.value) : null,
                      )
                    }
                  >
                    <option value="">Vyberte skupinu</option>
                    {(groups.data ?? []).map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                </Field>
                {selectedGroup !== null && groupPlan.isPending ? (
                  <StatusMessage
                    kind="loading"
                    title="Načítám skupinový plán"
                  />
                ) : null}
                {groups.error ? (
                  <StatusMessage
                    kind={groups.error instanceof ApiError && groups.error.offline ? "offline" : "error"}
                    title={
                      groups.error instanceof ApiError && groups.error.offline
                        ? "Jste offline"
                        : groups.error.message
                    }
                  />
                ) : null}
                {groupPlan.error ? (
                  <StatusMessage
                    kind={groupPlan.error instanceof ApiError && groupPlan.error.offline ? "offline" : "error"}
                    title={
                      groupPlan.error instanceof ApiError && groupPlan.error.offline
                        ? "Jste offline"
                        : groupPlan.error.message
                    }
                  />
                ) : null}
                {groupPlan.data ? (
                  <>
                    <div className="admin-day-tables group-plan-table-wrap">
                      {groupPlan.data.rows.map((row) => <section className="admin-employment-table" key={row.employment_id}>
                        <header className="admin-employment-table__header"><strong>{row.display_label}</strong>{row.is_own_employment ? <span>Moje</span> : null}</header>
                        <div className="data-table-wrap"><table className="data-table employee-month-table"><thead><tr><th>Datum</th><th>Den</th>{Array.from({ length: Math.max(4, ...row.days.map((day) => chronologicalPlanBoundaries({ carryover_departure_time: day.carryover_departure_time, arrival_time: day.arrival_time, departure_time: day.departure_time }).length)) }, (_, index) => <th key={index}>PRŮCHOD {index + 1}</th>)}{row.display_metrics.map((key) => <th key={key}>{plannedMetricLabels[key]} (h)</th>)}</tr></thead><tbody>{row.days.map((day) => { const planTimes = chronologicalPlanBoundaries({ planned_carryover_departure_time: day.carryover_departure_time, planned_arrival_time: day.arrival_time, planned_departure_time: day.departure_time }); const carryover = Boolean(day.carryover_departure_time); return <tr key={day.date} onContextMenu={(event) => { event.preventDefault(); setGroupContext({ row, day, x: event.clientX, y: event.clientY }); }}>{<th>{day.date}</th>}<td>{new Intl.DateTimeFormat("cs-CZ", { weekday: "long" }).format(new Date(`${day.date}T12:00:00`))}</td>{Array.from({ length: Math.max(4, ...row.days.map((item) => chronologicalPlanBoundaries({ carryover_departure_time: item.carryover_departure_time, arrival_time: item.arrival_time, departure_time: item.departure_time }).length)) }, (_, index) => <td key={index}>{day.effective_status ? <strong className="day-absence-label">{statusLabels[day.effective_status] ?? day.effective_status}</strong> : <ClockInput aria-label={`${t("adminMatrix.common.plannedPass", "PLÁN – PRŮCHOD")} ${index + 1} ${day.date}`} value={planTimes[index] ?? ""} disabled={!row.is_own_employment || row.shift_plan_locked || !day.is_within_employment_period || Boolean(day.effective_status) || (carryover && index === 0) || index > (carryover ? 2 : 1)} onCommit={async (value) => { const arrivalIndex = carryover ? 1 : 0; const departureIndex = carryover ? 2 : 1; await planMutation.mutateAsync({ employment_id: row.employment_id, date: day.date, arrival_time: index === arrivalIndex ? value || null : day.arrival_time, departure_time: index === departureIndex ? value || null : day.departure_time, status: day.status }); }} />}</td>)}{row.display_metrics.map((key) => <td key={key}>{day.planned?.[key] ? formatHours(day.planned[key]!.hours, "cs-CZ") : "—"}</td>)}</tr>; })}</tbody></table></div>
                      </section>)}
                      {groupContext ? <GroupPlanContextMenu context={groupContext} onClose={() => setGroupContext(null)} onSave={async (row, day, status) => { await planMutation.mutateAsync({ employment_id: row.employment_id, date: day.date, arrival_time: null, departure_time: null, status }); setGroupContext(null); }} /> : null}
                    </div>
                  </>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>
      </section>
    </main>
  );
}
