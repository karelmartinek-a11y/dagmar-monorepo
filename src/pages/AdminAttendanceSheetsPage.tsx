import { useEffect, useMemo, useState } from "react";
import { ApiError } from "../api/client";
import { adminGetAttendanceMonth, adminLockAttendance, adminUpsertAttendance, adminUnlockAttendance, type AdminAttendanceDay } from "../api/adminAttendance";
import { adminGetSettings, adminListUsers, type AdminEmployment, type PortalUser } from "../api/admin";
import { computeDayCalc, computeMonthStats, parseCutoffToMinutes, workingDaysInMonthCs } from "../utils/attendanceCalc";
import { normalizeTime, isValidTimeOrEmpty } from "../utils/timeInput";
import { planStatusInputPlaceholder, planStatusLabel } from "../utils/planStatus";
import { timeFieldPlaceholder } from "../utils/uiLabels";
import type { ShiftPlanDayStatus } from "../api/adminShiftPlan";

type EmploymentOption = AdminEmployment & { user_name: string };

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
  const dt = new Date(parsed.year, parsed.month - 1, 1);
  return dt.toLocaleDateString("cs-CZ", { month: "long", year: "numeric" });
}

function toDowLabel(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map((x) => parseInt(x, 10));
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("cs-CZ", { weekday: "short" });
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
    if (!parsed) return 0;
    return workingDaysInMonthCs(parsed.year, parsed.month) * 8;
  }, [month]);
  const today = isoToday();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [userRes, settingsRes] = await Promise.all([adminListUsers(), adminGetSettings()]);
        if (cancelled) return;
        setUsers(userRes.users);
        if (settingsRes.afternoon_cutoff) setAfternoonCutoff(settingsRes.afternoon_cutoff);
      } catch (err: unknown) {
        if (cancelled) return;
        setError(errorMessage(err, "Nepodařilo se načíst data."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const employments = useMemo<EmploymentOption[]>(
    () =>
      users.flatMap((user) =>
        user.employments.map((employment) => ({
          ...employment,
          user_name: user.name,
        }))
      ),
    [users]
  );

  const filtered = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return employments;
    return employments.filter((employment) => {
      const hay = `${employment.user_name} ${employment.label} ${employment.id}`.toLowerCase();
      return tokens.every((token) => hay.includes(token));
    });
  }, [employments, query]);

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    async function loadAttendance() {
      if (!selected) {
        setDays(null);
        setLocked(false);
        return;
      }
      const parsed = parseYYYYMM(month);
      if (!parsed) return;
      setDaysLoading(true);
      setError(null);
      try {
        const res = await adminGetAttendanceMonth({
          employmentId: selected.id,
          year: parsed.year,
          month: parsed.month,
          signal: ac.signal,
        });
        if (cancelled) return;
        setDays(res.days);
        setLocked(res.locked);
      } catch (err: unknown) {
        if (cancelled) return;
        setError(errorMessage(err, "Evidence docházky se nepodařilo načíst."));
        setDays(null);
        setLocked(false);
      } finally {
        if (!cancelled) setDaysLoading(false);
      }
    }
    void loadAttendance();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [selected, month]);

  async function commitTime(date: string, field: "arrival_time" | "departure_time", rawValue: string) {
    if (!selected) return;
    const normalized = normalizeTime(rawValue);
    if (!isValidTimeOrEmpty(normalized)) return;

    const nextValue = normalized === "" ? null : normalized;
    const row = days?.find((item) => item.date === date);
    if (!row) return;

    setDays((prev) =>
      prev?.map((item) => (item.date === date ? { ...item, [field]: nextValue } : item)) ?? null
    );
    setErrorByKey((prev) => {
      const next = { ...prev };
      delete next[`${date}:${field}`];
      return next;
    });

    try {
      await adminUpsertAttendance({
        employment_id: selected.id,
        date,
        arrival_time: field === "arrival_time" ? nextValue : row.arrival_time,
        departure_time: field === "departure_time" ? nextValue : row.departure_time,
      });
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : errorMessage(err, "Uložení se nezdařilo.");
      setErrorByKey((prev) => ({ ...prev, [`${date}:${field}`]: msg }));
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
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
        <section style={{ background: "white", borderRadius: 16, padding: 16, border: "1px solid var(--line)", flex: "1 1 340px" }}>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 10 }}>Výběr úvazku</div>
          <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Hledat podle zaměstnance nebo úvazku" />
          <div style={{ marginTop: 12, display: "grid", gap: 8, maxHeight: 560, overflowY: "auto" }}>
            {loading ? <div style={{ color: "var(--muted)" }}>Načítám…</div> : null}
            {!loading && filtered.length === 0 ? <div style={{ color: "var(--muted)" }}>Nic nenalezeno.</div> : null}
            {filtered.map((employment) => {
              const isSelected = selected?.id === employment.id;
              return (
                <button
                  key={employment.id}
                  type="button"
                  onClick={() => setSelected(employment)}
                  style={{
                    textAlign: "left",
                    borderRadius: 14,
                    border: "1px solid var(--line)",
                    padding: 12,
                    background: isSelected ? "rgba(38,43,49,0.06)" : "white",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{employment.label}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                    {employment.start_date} až {employment.end_date ?? "na dobu neurčitou"}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section style={{ background: "white", borderRadius: 16, padding: 16, border: "1px solid var(--line)", flex: "2 1 520px" }}>
          {!selected ? <div style={{ color: "var(--muted)" }}>Vyberte úvazek vlevo.</div> : null}
          {selected ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 850, fontSize: 20 }}>{selected.label}</div>
                  <div style={{ color: "var(--muted)", marginTop: 4 }}>Evidence docházky · {monthLabel(month)}</div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className="btn" onClick={() => setMonth((value) => addMonths(value, -1))}>
                    Předchozí měsíc
                  </button>
                  <button type="button" className="btn" onClick={() => setMonth((value) => addMonths(value, 1))}>
                    Další měsíc
                  </button>
                  <button type="button" className="btn solid" onClick={() => toggleLock(!locked)} disabled={daysLoading}>
                    {locked ? "Odemknout měsíc" : "Uzavřít měsíc"}
                  </button>
                </div>
              </div>

              {error ? <div style={{ marginTop: 12, color: "#b91c1c" }}>{error}</div> : null}
              {daysLoading ? <div style={{ marginTop: 12, color: "var(--muted)" }}>Načítám…</div> : null}

              <div style={{ paddingTop: 12, display: "grid", gap: 10 }}>
                {days?.map((day) => {
                  const calc = computeDayCalc({ date: day.date, arrival_time: day.arrival_time, departure_time: day.departure_time, planned_status: day.planned_status }, template, cutoffMinutes);
                  const mins = calc.workedMins;
                  const isToday = day.date === today;
                  return (
                    <div
                      key={day.date}
                      style={{
                        background: day.is_within_employment_period ? "white" : "rgba(245,158,11,0.08)",
                        borderRadius: 16,
                        padding: 14,
                        border: isToday ? "2px solid rgba(38,43,49,0.5)" : "1px solid rgba(35,41,44,0.12)",
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr 1fr 1fr",
                        gap: 12,
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 800, fontSize: 18 }}>{day.date.slice(8, 10)}.</div>
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>{toDowLabel(day.date)}</div>
                        {!day.is_within_employment_period ? <div style={{ fontSize: 11, color: "#b45309", marginTop: 6 }}>Mimo období úvazku</div> : null}
                      </div>
                      <TimeInput
                        label="Příchod"
                        placeholder={timeFieldPlaceholder()}
                        value={day.arrival_time ?? ""}
                        plannedValue={day.planned_arrival_time}
                        plannedStatus={day.planned_status}
                        error={errorByKey[`${day.date}:arrival_time`] ?? null}
                        readOnly={locked || !day.is_within_employment_period}
                        onCommit={(value) => commitTime(day.date, "arrival_time", value)}
                      />
                      <TimeInput
                        label="Odchod"
                        placeholder={timeFieldPlaceholder()}
                        value={day.departure_time ?? ""}
                        plannedValue={day.planned_departure_time}
                        plannedStatus={day.planned_status}
                        error={errorByKey[`${day.date}:departure_time`] ?? null}
                        readOnly={locked || !day.is_within_employment_period}
                        onCommit={(value) => commitTime(day.date, "departure_time", value)}
                      />
                      <div style={{ textAlign: "right", fontWeight: 800, color: mins ? "var(--kb-text)" : "rgba(82, 85, 93, 0.6)" }}>
                        {mins !== null ? `${formatHours(mins)} h` : "—"}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                <FooterStat label="Součet hodin" value={`${formatHours(monthStats.totalMins)} h`} />
                <FooterStat label="Dovolená" value={`${formatHours(monthStats.holidayMins)} h`} />
                <FooterStat label="Odpolední" value={`${formatHours(monthStats.afternoonMins)} h`} />
                <FooterStat label="Víkendy a svátky" value={`${formatHours(monthStats.weekendHolidayMins)} h`} />
                <FooterStat label="Pracovní fond" value={`${workingFundHours} h`} />
              </div>
            </>
          ) : null}
        </section>
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

  useEffect(() => {
    setLocal(value);
  }, [value]);

  const ok = isValidTimeOrEmpty(local);
  const plannedLabel = plannedStatus ? planStatusLabel(plannedStatus) : plannedValue;
  const plannedTone =
    plannedStatus === "HOLIDAY" ? "var(--kb-red)" : plannedStatus === "OFF" ? "#0c5fd3" : "rgba(82, 85, 93, 0.6)";
  const statusPlaceholder = planStatusInputPlaceholder(plannedStatus);
  const effectivePlaceholder = !local && statusPlaceholder ? statusPlaceholder : placeholder;
  const hasStatusPlaceholder = Boolean(statusPlaceholder);

  return (
    <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
      <div style={{ fontSize: 12, color: "var(--kb-brand-ink-600)", fontWeight: 700 }}>{label}</div>
      {plannedLabel ? <div style={{ fontSize: 11, color: plannedTone, fontWeight: 700 }}>Plán: {plannedLabel}</div> : null}
      <input
        inputMode="numeric"
        placeholder={effectivePlaceholder}
        value={local}
        readOnly={readOnly}
        disabled={readOnly}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          if (readOnly || !isValidTimeOrEmpty(local)) return;
          const norm = normalizeTime(local);
          setLocal(norm);
          onCommit(norm);
        }}
        style={{
          width: "100%",
          minWidth: 0,
          height: 44,
          borderRadius: 12,
          border: ok ? (hasStatusPlaceholder ? `1px solid ${plannedTone}` : "1px solid rgba(35, 41, 44, 0.18)") : "1px solid rgba(255,0,0,0.6)",
          outline: "none",
          padding: "0 12px",
          fontSize: 16,
          fontWeight: 700,
          background: readOnly ? "rgba(82,85,93,0.12)" : "white",
        }}
      />
      {!ok ? <div style={{ fontSize: 11, color: "var(--kb-red)" }}>Zadejte čas například jako 08:30, nebo pole nechte prázdné.</div> : null}
      {ok && error ? <div style={{ fontSize: 11, color: "var(--kb-red)" }}>{error}</div> : null}
    </div>
  );
}

function FooterStat(props: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>{props.label}</div>
      <div style={{ fontSize: 13, fontWeight: 700 }}>{props.value}</div>
    </div>
  );
}
