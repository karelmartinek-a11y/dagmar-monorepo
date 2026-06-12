import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import { adminGetSettings, adminListUsers, type AdminEmployment, type PortalUser } from "../api/admin";
import { adminGetAttendanceMonth, adminLockAttendance, adminUnlockAttendance, adminUpsertAttendance, type AdminAttendanceDay } from "../api/adminAttendance";
import { ApiError } from "../api/client";
import { FilterBar, InlineNotice, MetricCard, PageHeader, StateBadge } from "../components/admin/AdminUI";
import { computeDayCalc, computeMonthStats, parseCutoffToMinutes, workingDaysInMonthCs } from "../utils/attendanceCalc";
import { employmentIsActiveInMonth } from "../utils/employmentActivity";
import { normalizeTime, isValidTimeOrEmpty } from "../utils/timeInput";
import { planStatusInputPlaceholder, planStatusLabel } from "../utils/planStatus";
import { timeFieldPlaceholder } from "../utils/uiLabels";
import type { ShiftPlanDayStatus } from "../api/adminShiftPlan";
import Button from "../ui/Button";

type EmploymentOption = AdminEmployment & { user_name: string; user_is_active: boolean };

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function yyyyMm(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function parseYYYYMM(s: string): { year: number; month: number } | null {
  const m = /^([0-9]{4})-([0-9]{2})$/.exec(s.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  return { year, month };
}

function monthLabel(yyyyMmStr: string) {
  const parsed = parseYYYYMM(yyyyMmStr);
  if (!parsed) return yyyyMmStr;
  return new Date(parsed.year, parsed.month - 1, 1).toLocaleDateString("cs-CZ", { month: "long", year: "numeric" });
}

function toDowLabel(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map((x) => parseInt(x, 10));
  return new Date(y, m - 1, d).toLocaleDateString("cs-CZ", { weekday: "short" });
}

function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addMonths(yyyyMmStr: string, delta: number) {
  const parsed = parseYYYYMM(yyyyMmStr);
  if (!parsed) return yyyyMmStr;
  const dt = new Date(parsed.year, parsed.month - 1, 1);
  dt.setMonth(dt.getMonth() + delta);
  return yyyyMm(dt);
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string") return err;
  return fallback;
}

function formatHours(mins: number): string {
  return (mins / 60).toFixed(1);
}

export default function AdminAttendanceSheetsPage() {
  const [users, setUsers] = useState<PortalUser[]>([]);
  const [showInactiveEmployments, setShowInactiveEmployments] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<EmploymentOption | null>(null);
  const [month, setMonth] = useState(() => yyyyMm(new Date()));
  const [days, setDays] = useState<AdminAttendanceDay[] | null>(null);
  const [locked, setLocked] = useState(false);
  const [afternoonCutoff, setAfternoonCutoff] = useState<string>("17:00");
  const [loading, setLoading] = useState(false);
  const [daysLoading, setDaysLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorByKey, setErrorByKey] = useState<Record<string, string>>({});

  const cutoffMinutes = useMemo(() => parseCutoffToMinutes(afternoonCutoff), [afternoonCutoff]);
  const template = selected?.employment_type ?? "DPP_DPC";
  const monthStats = useMemo(() => computeMonthStats(days ?? [], template, cutoffMinutes), [days, template, cutoffMinutes]);
  const workingFundHours = useMemo(() => {
    const parsed = parseYYYYMM(month);
    return parsed ? workingDaysInMonthCs(parsed.year, parsed.month) * 8 : 0;
  }, [month]);
  const today = isoToday();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all([adminListUsers(), adminGetSettings()])
      .then(([userRes, settingsRes]) => {
        if (cancelled) return;
        setUsers(userRes.users);
        if (settingsRes.afternoon_cutoff) setAfternoonCutoff(settingsRes.afternoon_cutoff);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(errorMessage(err, "Nepodařilo se načíst data."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const employments = useMemo<EmploymentOption[]>(
    () => users.flatMap((user) => user.employments.map((employment) => ({ ...employment, user_name: user.name, user_is_active: user.is_active }))),
    [users],
  );

  const parsedMonth = useMemo(() => parseYYYYMM(month), [month]);
  const filtered = useMemo(() => {
    const visible = parsedMonth
      ? employments.filter((employment) => showInactiveEmployments || employmentIsActiveInMonth(employment, employment.user_is_active, parsedMonth.year, parsedMonth.month))
      : employments;
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return visible;
    return visible.filter((employment) => tokens.every((token) => `${employment.user_name} ${employment.label} ${employment.id}`.toLowerCase().includes(token)));
  }, [employments, parsedMonth, query, showInactiveEmployments]);

  useEffect(() => {
    if (filtered.length === 0) {
      setSelected(null);
      return;
    }
    if (!selected || !filtered.some((employment) => employment.id === selected.id)) {
      setSelected(filtered[0]);
    }
  }, [filtered, selected]);

  useEffect(() => {
    let cancelled = false;
    if (!selected) {
      setDays(null);
      setLocked(false);
      return;
    }
    const parsed = parseYYYYMM(month);
    if (!parsed) return;
    setDaysLoading(true);
    setError(null);
    void adminGetAttendanceMonth({ employmentId: selected.id, year: parsed.year, month: parsed.month })
      .then((res) => {
        if (cancelled) return;
        setDays(res.days);
        setLocked(res.locked);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(errorMessage(err, "Evidence docházky se nepodařilo načíst."));
      })
      .finally(() => {
        if (!cancelled) setDaysLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [month, selected]);

  async function commitTime(date: string, field: "arrival_time" | "departure_time", rawValue: string) {
    if (!selected) return;
    const normalized = normalizeTime(rawValue);
    if (!isValidTimeOrEmpty(normalized)) return;
    const nextValue = normalized === "" ? null : normalized;
    const row = days?.find((item) => item.date === date);
    if (!row) return;
    setDays((prev) => prev?.map((item) => (item.date === date ? { ...item, [field]: nextValue } : item)) ?? null);
    try {
      await adminUpsertAttendance({
        employment_id: selected.id,
        date,
        arrival_time: field === "arrival_time" ? nextValue : row.arrival_time,
        departure_time: field === "departure_time" ? nextValue : row.departure_time,
      });
      setErrorByKey((prev) => {
        const next = { ...prev };
        delete next[`${date}:${field}`];
        return next;
      });
    } catch (err: unknown) {
      const message = err instanceof ApiError ? err.message : errorMessage(err, "Uložení se nezdařilo.");
      setErrorByKey((prev) => ({ ...prev, [`${date}:${field}`]: message }));
    }
  }

  async function toggleLock(nextLocked: boolean) {
    if (!selected) return;
    const parsed = parseYYYYMM(month);
    if (!parsed) return;
    setDaysLoading(true);
    setError(null);
    try {
      if (nextLocked) {
        await adminLockAttendance({ employment_id: selected.id, year: parsed.year, month: parsed.month });
      } else {
        await adminUnlockAttendance({ employment_id: selected.id, year: parsed.year, month: parsed.month });
      }
      const res = await adminGetAttendanceMonth({ employmentId: selected.id, year: parsed.year, month: parsed.month });
      setDays(res.days);
      setLocked(res.locked);
    } catch (err: unknown) {
      setError(errorMessage(err, "Operace se nezdařila."));
    } finally {
      setDaysLoading(false);
    }
  }

  return (
    <div className="admin-page-grid">
      <PageHeader
        eyebrow="Docházka po úvazcích"
        title="Evidence docházky"
        description="Třípanelové rozhraní pro výběr úvazku, editaci dne a průběžný provozní souhrn."
        actions={
          <div className="admin-action-stack">
            <Button type="button" variant="ghost" onClick={() => setMonth((value) => addMonths(value, -1))}>
              Předchozí měsíc
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMonth((value) => addMonths(value, 1))}>
              Další měsíc
            </Button>
            <NavLink to="/admin/settings" className="admin-action-link">
              Správa odpolední hranice
            </NavLink>
          </div>
        }
      />

      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}

      <div className="admin-triple-layout">
        <section className="admin-surface">
          <div className="admin-surface-head">
            <div>
              <div className="admin-surface-title">Výběr úvazku</div>
              <div className="admin-surface-subtitle">{filtered.length} z {employments.length} úvazků odpovídá filtru.</div>
            </div>
          </div>
          <FilterBar>
            <input className="kb-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Hledat podle zaměstnance nebo úvazku" />
          </FilterBar>
          <label className="admin-checkbox-row">
            <input type="checkbox" checked={showInactiveEmployments} onChange={(e) => setShowInactiveEmployments(e.target.checked)} />
            <span>Zobrazit i neaktivní úvazky</span>
          </label>
          <div className="admin-list" style={{ marginTop: 12 }}>
            {loading ? <InlineNotice>Načítám…</InlineNotice> : null}
            {filtered.map((employment) => (
              <button key={employment.id} type="button" className={`admin-selection-row${selected?.id === employment.id ? " active" : ""}`} onClick={() => setSelected(employment)}>
                <div>
                  <div className="admin-list-title">{employment.label}</div>
                  <div className="admin-list-subtitle">
                    {employment.start_date} až {employment.end_date ?? "na dobu neurčitou"}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="admin-surface">
          <div className="admin-surface-head">
            <div>
              <div className="admin-surface-title">{selected ? selected.label : "Vyberte úvazek"}</div>
              <div className="admin-surface-subtitle">Měsíc {monthLabel(month)}</div>
            </div>
            <div className="admin-action-row">
              <StateBadge tone={locked ? "warning" : "ok"}>{locked ? "Měsíc uzavřený" : "Měsíc otevřený"}</StateBadge>
              {selected ? (
                <Button type="button" variant={locked ? "ghost" : "primary"} onClick={() => void toggleLock(!locked)} disabled={daysLoading}>
                  {locked ? "Odemknout měsíc" : "Uzavřít měsíc"}
                </Button>
              ) : null}
            </div>
          </div>
          {daysLoading ? <InlineNotice>Načítám vybraný měsíc…</InlineNotice> : null}
          <div className="admin-attendance-list">
            {days?.map((day) => {
              const calc = computeDayCalc({ date: day.date, arrival_time: day.arrival_time, departure_time: day.departure_time, planned_status: day.planned_status }, template, cutoffMinutes);
              const isToday = day.date === today;
              return (
                <div key={day.date} className={`admin-attendance-row${isToday ? " is-today" : ""}${!day.is_within_employment_period ? " is-outside" : ""}`}>
                  <div className="admin-attendance-date">
                    <strong>{day.date.slice(8, 10)}.</strong>
                    <span>{toDowLabel(day.date)}</span>
                    {!day.is_within_employment_period ? <StateBadge tone="warning">Mimo období</StateBadge> : null}
                  </div>
                  <TimeInput
                    label="Příchod"
                    placeholder={timeFieldPlaceholder()}
                    value={day.arrival_time ?? ""}
                    plannedValue={day.planned_arrival_time}
                    plannedStatus={day.planned_status}
                    error={errorByKey[`${day.date}:arrival_time`] ?? null}
                    readOnly={locked || !day.is_within_employment_period}
                    onCommit={(value) => void commitTime(day.date, "arrival_time", value)}
                  />
                  <TimeInput
                    label="Odchod"
                    placeholder={timeFieldPlaceholder()}
                    value={day.departure_time ?? ""}
                    plannedValue={day.planned_departure_time}
                    plannedStatus={day.planned_status}
                    error={errorByKey[`${day.date}:departure_time`] ?? null}
                    readOnly={locked || !day.is_within_employment_period}
                    onCommit={(value) => void commitTime(day.date, "departure_time", value)}
                  />
                  <div className="admin-attendance-hours">{calc.workedMins !== null ? `${formatHours(calc.workedMins)} h` : "—"}</div>
                </div>
              );
            })}
          </div>
        </section>

        <aside className="admin-surface">
          <div className="admin-surface-head">
            <div>
              <div className="admin-surface-title">Souhrn měsíce</div>
              <div className="admin-surface-subtitle">Včetně odpoledních hodin a pracovního fondu.</div>
            </div>
          </div>
          <div className="admin-stack">
            <MetricCard label="Součet hodin" value={`${formatHours(monthStats.totalMins)} h`} tone="accent" />
            <MetricCard label="Dovolená" value={`${formatHours(monthStats.holidayMins)} h`} />
            <MetricCard label="Odpolední" value={`${formatHours(monthStats.afternoonMins)} h`} />
            <MetricCard label="Víkendy a svátky" value={`${formatHours(monthStats.weekendHolidayMins)} h`} />
            <MetricCard label="Pracovní fond" value={`${workingFundHours} h`} />
            <InlineNotice>
              Odpolední hranice je aktuálně nastavena na <strong>{afternoonCutoff}</strong>. Zamknuté měsíce a dny mimo období úvazku jsou v rozhraní read-only.
            </InlineNotice>
          </div>
        </aside>
      </div>
    </div>
  );
}

function TimeInput(props: {
  label: string;
  placeholder: string;
  value: string;
  plannedValue?: string | null;
  plannedStatus?: ShiftPlanDayStatus | null;
  error: string | null;
  readOnly: boolean;
  onCommit: (v: string) => void;
}) {
  const { label, placeholder, value, plannedValue, plannedStatus, error, readOnly, onCommit } = props;
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);

  const ok = isValidTimeOrEmpty(local);
  const plannedLabel = plannedStatus ? planStatusLabel(plannedStatus) : plannedValue;
  const statusPlaceholder = planStatusInputPlaceholder(plannedStatus);
  const effectivePlaceholder = !local && statusPlaceholder ? statusPlaceholder : placeholder;

  return (
    <label className="admin-time-field">
      <span>{label}</span>
      {plannedLabel ? <small>Plán: {plannedLabel}</small> : null}
      <input
        className="kb-input"
        inputMode="numeric"
        value={local}
        disabled={readOnly}
        readOnly={readOnly}
        placeholder={effectivePlaceholder}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          if (readOnly || !ok) return;
          const norm = normalizeTime(local);
          setLocal(norm);
          onCommit(norm);
        }}
      />
      {!ok ? <small className="admin-field-error">Zadejte čas ve formátu 08:30 nebo pole nechte prázdné.</small> : null}
      {ok && error ? <small className="admin-field-error">{error}</small> : null}
    </label>
  );
}
