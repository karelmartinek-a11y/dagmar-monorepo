import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Clock3,
  LogOut,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { ApiError, api } from "../api/client";
import type {
  AttendanceDay,
  AttendanceEvent,
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
  loadPortalSession,
  replaceAvailableEmployments,
  savePortalLogin,
  selectEmployment,
} from "../state/portalSession";
import { formatHours } from "../utils/hoursFormat";
import { reconcileSelectedGroup } from "../utils/groupSelection";
import { plannedHintForEvent } from "../utils/plannedEventHint";

type View = "attendance" | "plan" | "group-plan";
const metricOrder: MetricKey[] = [
  "total",
  "afternoon",
  "night",
  "weekend",
  "public_holiday",
];
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
  return new Intl.DateTimeFormat("cs-CZ", {
    timeZone: "Europe/Prague",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(event.occurred_at));
}

function DayCard({
  day,
  locked,
  displayMetrics,
  employmentId,
  onRefresh,
  onError,
  statusControl,
}: {
  day: AttendanceDay;
  locked: boolean;
  displayMetrics: MetricKey[];
  employmentId: number;
  onRefresh: () => void;
  onError: (message: string) => void;
  statusControl: React.ReactNode;
}) {
  const [newTime, setNewTime] = useState("");
  const [newEndTime, setNewEndTime] = useState("");
  const [newEndDate, setNewEndDate] = useState(day.date);
  const disabled =
    locked || !day.is_within_employment_period || Boolean(day.effective_status);
  const update = async (event: AttendanceEvent, time: string) => {
    if (!time) {
      await remove(event.id, event.deletion_partner_id ?? undefined, false);
      return;
    }
    if (time === eventTime(event)) return;
    try {
      await api.updateAttendanceEvent(event.id, {
        employment_id: employmentId,
        occurred_at: `${day.date}T${time}:00`,
        event_type: event.event_type,
      });
      onRefresh();
    } catch (reason) {
      onError(
        reason instanceof Error
          ? reason.message
          : "Průchod se nepodařilo uložit.",
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
          ? "Opravdu odstranit tento průchod?"
          : "Opravdu odstranit vybraný pár průchodů?",
      )
    )
      return;
    try {
      await api.deleteAttendanceEvent(eventId, pairedEventId);
      onRefresh();
    } catch (reason) {
      onError(
        reason instanceof Error
          ? reason.message
          : "Průchod se nepodařilo odstranit.",
      );
    }
  };
  const add = async (startTime = newTime, endTime = newEndTime) => {
    if (!startTime) return;
    try {
      await api.createAttendanceEvent({
        employment_id: employmentId,
        occurred_at: `${day.date}T${startTime}:00`,
        event_type: endTime ? "IN" : day.next_event_type,
        ...(endTime
          ? { paired_occurred_at: `${newEndDate}T${endTime}:00` }
          : {}),
      });
      setNewTime("");
      setNewEndTime("");
      setNewEndDate(day.date);
      onRefresh();
    } catch (reason) {
      onError(
        reason instanceof Error
          ? reason.message
          : "Průchod se nepodařilo přidat.",
      );
    }
  };
  return (
    <article
      className={`employee-day ${disabled ? "employee-day--readonly" : ""}`}
      data-testid={`attendance-day-${day.date}`}
    >
      <div className="employee-day__date">
        <strong>
          {new Intl.DateTimeFormat("cs-CZ", {
            day: "numeric",
            month: "numeric",
          }).format(new Date(`${day.date}T12:00:00`))}
        </strong>
        <span>
          {new Intl.DateTimeFormat("cs-CZ", { weekday: "long" }).format(
            new Date(`${day.date}T12:00:00`),
          )}
        </span>
        {day.effective_status ? (
          <small>
            {statusLabels[day.effective_status] ?? day.effective_status}
          </small>
        ) : null}
        {day.planned_carryover_departure_time ? (
          <small>Přesah plánu do {day.planned_carryover_departure_time}</small>
        ) : null}
        <div className="employee-day__absence">{statusControl}</div>
      </div>
      <div className="employee-event-grid">
        {day.events.map((event, index) => {
          const plannedTime = plannedHintForEvent(day, index);
          return <label className="time-cell" key={event.id}>
            <span>{event.event_type === "IN" ? "Příchod" : "Odchod"}</span>
            <em>{plannedTime ? `plán ${plannedTime}` : ""}</em>
            <ClockInput
              aria-label={`${day.date} ${event.event_type} ${index + 1}`}
              value={eventTime(event)}
              disabled={disabled}
              onCommit={(time) => void update(event, time)}
            />
            {event.event_type === "IN" ? (
              <button
                type="button"
                className="event-delete"
                aria-label={`Odstranit interval ${day.date}`}
                disabled={disabled}
                onClick={() => void remove(event.id, event.deletion_partner_id ?? undefined)}
              >
                <Trash2 size={13} />
              </button>
            ) : event.deletion_partner_id != null ? (
              <button
                type="button"
                className="event-delete"
                aria-label={`Odstranit pauzu ${day.date}`}
                disabled={disabled}
                onClick={() => void remove(event.id, event.deletion_partner_id ?? undefined)}
              >
                <Trash2 size={13} />
              </button>
            ) : null}
          </label>;
        })}
      </div>
      <div className="employee-add-event">
        <label className="time-cell">
          <span>
            {newEndTime || day.next_event_type === "IN" ? "Nový příchod" : "Nový odchod"}
          </span>
          <ClockInput
            aria-label={`Nový ${day.next_event_type} ${day.date}`}
            value={newTime}
            disabled={disabled}
            onDraftChange={setNewTime}
            onCommit={(value) => {
              setNewTime(value);
              void add(value);
            }}
          />
        </label>
        {newEndTime ? (
          <label className="time-cell employee-pair-end-date">
            <span>Datum odchodu páru</span>
            <input
              aria-label={`Datum odchodu páru ${day.date}`}
              type="date"
              value={newEndDate}
              disabled={disabled}
              onChange={(event) => setNewEndDate(event.target.value)}
            />
          </label>
        ) : null}
        <label className="time-cell">
          <span>Odchod páru (volitelné)</span>
          <ClockInput
            aria-label={`Nový odchod páru ${day.date}`}
            value={newEndTime}
            disabled={disabled}
            onDraftChange={setNewEndTime}
            onCommit={(value) => {
              setNewEndTime(value);
              if (newTime) void add(newTime, value);
            }}
          />
        </label>
        <Button
          type="button"
          variant="quiet"
          disabled={disabled || !newTime}
          onClick={() => void add()}
        >
          <Plus />
          Přidat
        </Button>
      </div>
      <div className="employee-day__metric-list">
        {displayMetrics.map((key) => (
          <span key={key}>
            {metricLabels[key]}:{" "}
            {day.worked?.[key]
              ? formatHours(day.worked[key]!.hours, "cs-CZ")
              : "—"}
          </span>
        ))}
      </div>
    </article>
  );
}

function StatusSelect({
  day,
  employmentId,
  attendanceLocked,
  shiftPlanLocked,
  onRefresh,
  onError,
}: {
  day: AttendanceDay;
  employmentId: number;
  attendanceLocked: boolean;
  shiftPlanLocked: boolean;
  onRefresh: () => void;
  onError: (message: string) => void;
}) {
  const currentStatus = day.effective_status ?? "";
  const currentStatusLocked =
    (attendanceLocked && attendanceStatuses.has(currentStatus)) ||
    (shiftPlanLocked && planStatuses.has(currentStatus));
  const conflictingDomainLocked =
    (attendanceLocked && day.events.length > 0) ||
    (shiftPlanLocked &&
      Boolean(
        day.planned_arrival_time ||
          day.planned_departure_time ||
          day.planned_carryover_departure_time ||
          day.planned_status,
      ));
  const save = async (status: string) => {
    if (
      status &&
      !window.confirm(
        `Nastavit ${statusLabels[status]} pro ${day.date}? Existující konfliktní data mohou být odstraněna.`,
      )
    )
      return;
    const payload = {
      employment_id: employmentId,
      date: day.date,
      status: status || null,
      confirm_delete_conflicts: true,
    };
    try {
      await api.savePortalAttendanceStatus(payload);
      onRefresh();
    } catch (reason) {
      onError(
        reason instanceof Error
          ? reason.message
          : "Stav dne se nepodařilo uložit.",
      );
    }
  };
  return (
    <label className="day-status-select">
      <span>Typ dne</span>
      <select
        aria-label={`Celodenní nepřítomnost ${day.date}`}
        value={day.effective_status ?? ""}
        disabled={
          !day.is_within_employment_period ||
          currentStatusLocked ||
          conflictingDomainLocked ||
          (attendanceLocked && shiftPlanLocked)
        }
        onChange={(event) => void save(event.target.value)}
      >
        <option value="">Pracovní den</option>
        <option value="HOLIDAY" disabled={shiftPlanLocked}>
          Dovolená
        </option>
        <option value="SICKNESS" disabled={attendanceLocked}>
          Nemoc
        </option>
        <option value="OFF" disabled={shiftPlanLocked}>
          Volno
        </option>
        <option value="PARAGRAPH" disabled={attendanceLocked}>
          Paragraf
        </option>
      </select>
    </label>
  );
}

export function EmployeePage() {
  const { t } = useTranslation();
  const [session, setSession] = useState<PortalSession | null>(() =>
    loadPortalSession(),
  );
  const [month, setMonth] = useState(() => new Date());
  const [view, setView] = useState<View>("attendance");
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<number | null>(null);
  const employmentId = session?.selected_employment_id ?? null;
  const queryClient = useQueryClient();
  const year = month.getFullYear();
  const monthNumber = month.getMonth() + 1;
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
  const groupDisplayMetrics = metricOrder.filter((key) =>
    groupPlan.data?.rows.some((row) => row.display_metrics.includes(key)),
  );
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
  if (!session) return <Login onLogin={setSession} />;
  return (
    <main className="employee-app">
      <header className="employee-topbar">
        <Brand />
        <div className="employee-topbar__actions">
          <LanguageSwitcher compact surface="employee" />
          <Button
            variant="quiet"
            onClick={() => {
              clearPortalSession();
              setSession(null);
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
              <section className="employee-days">
                {query.data.days.map((day) =>
                  view === "attendance" ? (
                    <DayCard
                      key={day.date}
                      day={day}
                      employmentId={query.data!.employment_id}
                      locked={query.data!.attendance_locked}
                      displayMetrics={query.data!.display_metrics}
                      onRefresh={refresh}
                      onError={setNotice}
                      statusControl={
                        <StatusSelect
                          day={day}
                          employmentId={query.data!.employment_id}
                          attendanceLocked={query.data!.attendance_locked}
                          shiftPlanLocked={query.data!.shift_plan_locked}
                          onRefresh={refresh}
                          onError={setNotice}
                        />
                      }
                    />
                  ) : (
                    <article
                      className="employee-day employee-day--plan"
                      key={day.date}
                    >
                      <div className="employee-day__date">
                        <strong>
                          {new Intl.DateTimeFormat("cs-CZ").format(
                            new Date(`${day.date}T12:00:00`),
                          )}
                        </strong>
                        <span>
                          {day.effective_status
                            ? statusLabels[day.effective_status]
                            : "Plán směny"}
                        </span>
                        {day.planned_carryover_departure_time ? (
                          <small>
                            Přesah z předchozího dne do{" "}
                            {day.planned_carryover_departure_time}
                          </small>
                        ) : null}
                      </div>
                      <label className="time-cell">
                        <span>Příchod</span>
                        <em>plán</em>
                        <ClockInput
                          aria-label={`Plánovaný příchod ${day.date}`}
                          value={day.planned_arrival_time ?? ""}
                          disabled={
                            query.data!.shift_plan_locked ||
                            !day.is_within_employment_period ||
                            Boolean(day.effective_status) ||
                            day.planned_is_carryover
                          }
                          onCommit={(value) =>
                            planMutation.mutate({
                              employment_id: query.data!.employment_id,
                              date: day.date,
                              arrival_time: value || null,
                              departure_time:
                                day.planned_departure_time ?? null,
                              status: day.planned_status ?? null,
                            })
                          }
                        />
                      </label>
                      <label className="time-cell">
                        <span>Odchod</span>
                        <em>{day.planned_is_carryover ? "přesah z předchozího dne" : "plán"}</em>
                        <ClockInput
                          aria-label={`Plánovaný odchod ${day.date}`}
                          value={day.planned_departure_time ?? ""}
                          disabled={
                            query.data!.shift_plan_locked ||
                            !day.is_within_employment_period ||
                            Boolean(day.effective_status) ||
                            day.planned_is_carryover
                          }
                          onCommit={(value) =>
                            planMutation.mutate({
                              employment_id: query.data!.employment_id,
                              date: day.date,
                              arrival_time: day.planned_arrival_time ?? null,
                              departure_time: value || null,
                              status: day.planned_status ?? null,
                            })
                          }
                        />
                      </label>
                      <StatusSelect
                        day={day}
                        employmentId={query.data!.employment_id}
                        attendanceLocked={query.data!.attendance_locked}
                        shiftPlanLocked={query.data!.shift_plan_locked}
                        onRefresh={refresh}
                        onError={setNotice}
                      />
                      <div className="employee-day__metric-list">
                        {query.data!.display_metrics.map((key) => (
                          <span key={key}>
                            {plannedMetricLabels[key]}:{" "}
                            {day.planned?.[key]
                              ? formatHours(day.planned[key]!.hours, "cs-CZ")
                              : "—"}
                          </span>
                        ))}
                      </div>
                    </article>
                  ),
                )}
              </section>
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
                    <div className="group-plan-cards">
                      {groupPlan.data.rows.map((row) => (
                        <section
                          key={row.employment_id}
                          className="group-plan-card"
                        >
                          <header>
                            <strong>{row.display_label}</strong>
                            {row.is_own_employment ? (
                              <span>Moje směny</span>
                            ) : (
                              <span>Pouze náhled</span>
                            )}
                          </header>
                          <div className="employee-day__metric-list">
                            {row.display_metrics.map((key) => (
                              <span key={key}>
                                {plannedMetricLabels[key]}:{" "}
                                {row.planned?.[key]
                                  ? formatHours(
                                      row.planned[key]!.hours,
                                      "cs-CZ",
                                    )
                                  : "—"}
                              </span>
                            ))}
                          </div>
                          <div className="group-plan-card__days">
                            {row.days.map((day) => (
                              <article key={day.date}>
                                <strong>
                                  {new Intl.DateTimeFormat("cs-CZ", {
                                    day: "numeric",
                                    month: "numeric",
                                    weekday: "short",
                                  }).format(new Date(`${day.date}T12:00:00`))}
                                </strong>
                                {day.effective_status ? (
                                  <span>
                                    {statusLabels[day.effective_status] ?? day.effective_status}
                                  </span>
                                ) : null}
                                {day.carryover_departure_time ? (
                                  <small>
                                    Přesah do {day.carryover_departure_time}
                                  </small>
                                ) : null}
                                <label>
                                  Příchod
                                  <ClockInput
                                    aria-label={`Karta ${row.display_label} ${day.date} příchod`}
                                    value={day.arrival_time ?? ""}
                                    disabled={
                                      !row.is_own_employment ||
                                      row.shift_plan_locked ||
                                      !day.is_within_employment_period ||
                                      Boolean(day.effective_status) ||
                                      day.is_carryover
                                    }
                                    onCommit={(value) =>
                                      planMutation.mutate({
                                        employment_id: row.employment_id,
                                        date: day.date,
                                        arrival_time: value || null,
                                        departure_time: day.departure_time,
                                        status: day.status,
                                      })
                                    }
                                  />
                                </label>
                                <label>
                                  Odchod
                                  <ClockInput
                                    aria-label={`Karta ${row.display_label} ${day.date} odchod`}
                                    value={day.departure_time ?? ""}
                                    disabled={
                                      !row.is_own_employment ||
                                      row.shift_plan_locked ||
                                      !day.is_within_employment_period ||
                                      Boolean(day.effective_status) ||
                                      day.is_carryover
                                    }
                                    onCommit={(value) =>
                                      planMutation.mutate({
                                        employment_id: row.employment_id,
                                        date: day.date,
                                        arrival_time: day.arrival_time,
                                        departure_time: value || null,
                                        status: day.status,
                                      })
                                    }
                                  />
                                </label>
                              </article>
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                    <div className="data-table-wrap group-plan-table-wrap">
                      <table className="data-table matrix group-plan-table">
                        <thead>
                          <tr>
                            <th>Úvazek</th>
                            {groupDisplayMetrics.map((key) => (
                              <th key={key}>{plannedMetricLabels[key]} (h)</th>
                            ))}
                            {groupPlan.data.rows[0]?.days.map((day) => (
                              <th key={day.date}>{day.date.slice(-2)}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {groupPlan.data.rows.map((row) => (
                            <tr key={row.employment_id}>
                              <th>
                                {row.display_label}
                                {row.is_own_employment ? (
                                  <small> Moje</small>
                                ) : null}
                              </th>
                              {groupDisplayMetrics.map((key) => (
                                <td key={key}>
                                  {row.display_metrics.includes(key) &&
                                  row.planned?.[key]
                                    ? formatHours(
                                        row.planned[key]!.hours,
                                        "cs-CZ",
                                      )
                                    : "—"}
                                </td>
                              ))}
                              {row.days.map((day) => (
                                <td key={day.date}>
                                  {day.carryover_departure_time ? (
                                    <small>
                                      do {day.carryover_departure_time}
                                    </small>
                                  ) : null}
                                  {day.effective_status ? (
                                    <strong>
                                      {statusLabels[day.effective_status] ?? day.effective_status}
                                    </strong>
                                  ) : (
                                    <>
                                      <ClockInput
                                        aria-label={`${row.display_label} ${day.date} příchod`}
                                        value={day.arrival_time ?? ""}
                                        disabled={
                                          !row.is_own_employment ||
                                          row.shift_plan_locked ||
                                          !day.is_within_employment_period ||
                                          Boolean(day.effective_status) ||
                                          day.is_carryover
                                        }
                                        onCommit={(value) =>
                                          planMutation.mutate({
                                            employment_id: row.employment_id,
                                            date: day.date,
                                            arrival_time: value || null,
                                            departure_time: day.departure_time,
                                            status: day.status,
                                          })
                                        }
                                      />
                                      <ClockInput
                                        aria-label={`${row.display_label} ${day.date} odchod`}
                                        value={day.departure_time ?? ""}
                                        disabled={
                                          !row.is_own_employment ||
                                          row.shift_plan_locked ||
                                          !day.is_within_employment_period ||
                                          Boolean(day.effective_status) ||
                                          day.is_carryover
                                        }
                                        onCommit={(value) =>
                                          planMutation.mutate({
                                            employment_id: row.employment_id,
                                            date: day.date,
                                            arrival_time: day.arrival_time,
                                            departure_time: value || null,
                                            status: day.status,
                                          })
                                        }
                                      />
                                    </>
                                  )}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
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
