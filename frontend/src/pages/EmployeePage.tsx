import React, { useEffect, useMemo, useRef, useState } from "react";
import { getAttendance, putAttendance, upsertPortalDayStatus } from "../api/attendance";
import { ApiError } from "../api/client";
import type { ShiftPlanDayStatus } from "../api/adminShiftPlan";
import { getPragueTimeSnapshot, type PragueTimeSource } from "../api/time";
import type { EmploymentTemplate } from "../types/employment";
import { portalLogin, type PortalLoginEmployment } from "../api/portal";
import { BRAND_ASSETS, APP_NAME_SHORT } from "../brand/brand";
import { ConfirmDialog } from "../components/admin/AdminUI";
import { clearPortalAuthState, getPortalAuthState, setPortalAuthState } from "../state/portalAuthStore";
import { computeDayCalc, computeMonthStats, parseCutoffToMinutes, workingDaysInMonthCs } from "../utils/attendanceCalc";
import { planStatusInputPlaceholder, planStatusLabel } from "../utils/planStatus";
import { timeFieldPlaceholder } from "../utils/uiLabels";

type DayRow = {
  date: string; // YYYY-MM-DD
  arrival_time: string | null;
  departure_time: string | null;
  planned_arrival_time: string | null;
  planned_departure_time: string | null;
  planned_status?: ShiftPlanDayStatus | null;
  is_within_employment_period?: boolean;
};

type QueueItem = {
  date: string;
  arrival_time: string | null;
  departure_time: string | null;
  enqueuedAt: number;
};

const OFFLINE_QUEUE_STORAGE_KEY = "dagmar.portal.offlineQueue";

function loadStoredQueue(): QueueItem[] {
  try {
    const raw = window.localStorage.getItem(OFFLINE_QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is QueueItem => {
        return Boolean(
          item &&
            typeof item === "object" &&
            typeof (item as QueueItem).date === "string" &&
            (typeof (item as QueueItem).arrival_time === "string" || (item as QueueItem).arrival_time === null) &&
            (typeof (item as QueueItem).departure_time === "string" || (item as QueueItem).departure_time === null),
        );
      })
      .map((item) => ({ ...item, enqueuedAt: Number.isFinite(item.enqueuedAt) ? item.enqueuedAt : Date.now() }));
  } catch {
    return [];
  }
}

function persistQueue(queue: QueueItem[]) {
  try {
    if (queue.length === 0) {
      window.localStorage.removeItem(OFFLINE_QUEUE_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(OFFLINE_QUEUE_STORAGE_KEY, JSON.stringify(queue));
  } catch {
    // ignore storage errors
  }
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string") return err;
  return fallback;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function yyyyMm(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function monthLabel(yyyyMmStr: string) {
  const [y, m] = yyyyMmStr.split("-").map((x) => parseInt(x, 10));
  const dt = new Date(y, m - 1, 1);
  return dt.toLocaleDateString("cs-CZ", { month: "long", year: "numeric" });
}

function daysInMonth(yyyy: number, mm1: number) {
  return new Date(yyyy, mm1, 0).getDate();
}

function toDowLabel(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map((x) => parseInt(x, 10));
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("cs-CZ", { weekday: "long" });
}

function normalizeTime(value: string): string {
  const v = value.trim();
  if (!v) return "";

  // Support "HHMM" numeric input, e.g. "1000" => "10:00".
  if (/^\d{4}$/.test(v)) {
    const hh = parseInt(v.slice(0, 2), 10);
    const mm = parseInt(v.slice(2), 10);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) return `${pad2(hh)}:${pad2(mm)}`;
    return v;
  }

  // Support "H:MM" and "HH:MM" (normalize to 2-digit hour).
  const colon = v.match(/^(\d{1,2}):(\d{2})$/);
  if (colon) {
    const hh = parseInt(colon[1], 10);
    const mm = parseInt(colon[2], 10);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) return `${pad2(hh)}:${pad2(mm)}`;
    return v;
  }

  // Support hour-only input 1..23, e.g. "1" => "01:00", "23" => "23:00".
  if (/^\d{1,2}$/.test(v)) {
    const hh = parseInt(v, 10);
    if (hh >= 1 && hh <= 23) return `${pad2(hh)}:00`;
  }

  return v;
}

function isValidTimeOrEmpty(value: string): boolean {
  const v = normalizeTime(value);
  if (v === "") return true;
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(v);
}

function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

const PRAGUE_TIME_ZONE = "Europe/Prague";

type PragueClock = {
  date: string;
  time: string;
  minutes: number;
  source: PragueTimeSource;
};

type ContextMenuState = { x: number; y: number; date: string };
type DayStatusDialogState = {
  date: string;
  status: ShiftPlanDayStatus;
  attendanceExists: boolean;
  shiftPlanExists: boolean;
};

function getPragueParts(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PRAGUE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));

  const readPart = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";

  return {
    year: readPart("year"),
    month: readPart("month"),
    day: readPart("day"),
    hour: readPart("hour"),
    minute: readPart("minute"),
  };
}

function toPragueClock(timestamp: number, source: PragueTimeSource): PragueClock {
  const parts = getPragueParts(timestamp);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    source,
  };
}

function compareIsoDates(left: string, right: string): number {
  return left.localeCompare(right);
}

function isFutureTimeOnSameDay(value: string | null, currentMinutes: number): boolean {
  if (!value) return false;
  const [hour, minute] = value.split(":").map((item) => parseInt(item, 10));
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;
  return hour * 60 + minute > currentMinutes;
}

function getHistoricalReadOnlyReason(row: DayRow, field: "arrival_time" | "departure_time", today: string): string | null {
  const dateCmp = compareIsoDates(row.date, today);
  if (dateCmp > 0) return "Budoucí průchod uživatel nesmí zadat.";
  if (dateCmp < 0 && row[field] !== null) return "Na minulých dnech už lze jen doplnit chybějící čas.";
  return null;
}

function formatHours(mins: number): string {
  return (mins / 60).toFixed(1);
}

function addMonths(yyyyMmStr: string, delta: number) {
  const [y, m] = yyyyMmStr.split("-").map((x) => parseInt(x, 10));
  const dt = new Date(y, m - 1, 1);
  dt.setMonth(dt.getMonth() + delta);
  return yyyyMm(dt);
}

function buildEmptyMonthRows(year: number, month: number): DayRow[] {
  const dim = daysInMonth(year, month);
  const out: DayRow[] = [];
  for (let day = 1; day <= dim; day++) {
    out.push({
      date: `${year}-${pad2(month)}-${pad2(day)}`,
      arrival_time: null,
      departure_time: null,
      planned_arrival_time: null,
      planned_departure_time: null,
      planned_status: null,
    });
  }
  return out;
}

export function EmployeePage() {
  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    typeof window === "undefined" ? 1440 : window.innerWidth,
  );
  const [online, setOnline] = useState<boolean>(navigator.onLine);
  const [token, setToken] = useState<string | null>(() => getPortalAuthState().accessToken);
  const [employmentId, setEmploymentId] = useState<number | null>(() => getPortalAuthState().employmentId);
  const [displayName, setDisplayName] = useState<string | null>(() => getPortalAuthState().displayName);
  const [availableEmployments, setAvailableEmployments] = useState<PortalLoginEmployment[]>(() => getPortalAuthState().employments);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [employmentTemplate, setEmploymentTemplate] = useState<EmploymentTemplate>("DPP_DPC");
  const [afternoonCutoff, setAfternoonCutoff] = useState<string>("17:00");
  const cutoffMinutes = useMemo(() => parseCutoffToMinutes(afternoonCutoff), [afternoonCutoff]);
  const [month, setMonth] = useState<string>(() => yyyyMm(new Date()));
  const [rows, setRows] = useState<DayRow[]>([]);
  const [viewMode, setViewMode] = useState<"attendance" | "plan">("attendance");
  const [monthLocked, setMonthLocked] = useState(false);
  const [clockNowMs, setClockNowMs] = useState(() => Date.now());
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [clockSource, setClockSource] = useState<PragueTimeSource>("browser");
  const displayedRows = useMemo(() => {
    if (viewMode === "attendance") return rows;
    return rows.map((r) => ({
      ...r,
      arrival_time: r.planned_arrival_time,
      departure_time: r.planned_departure_time,
      planned_status: r.planned_status,
    }));
  }, [rows, viewMode]);
  const monthStats = useMemo(
    () => computeMonthStats(displayedRows, employmentTemplate, cutoffMinutes),
    [displayedRows, employmentTemplate, cutoffMinutes]
  );
  const monthTotalMins = monthStats.totalMins;
  const monthHolidayMins = monthStats.holidayMins;

  const [queuedCount, setQueuedCount] = useState<number>(0);
  const [sending, setSending] = useState<boolean>(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [dayStatusDialog, setDayStatusDialog] = useState<DayStatusDialogState | null>(null);
  const pragueNow = useMemo(() => toPragueClock(clockNowMs + clockOffsetMs, clockSource), [clockNowMs, clockOffsetMs, clockSource]);
  const selectedEmployment = useMemo(
    () => availableEmployments.find((item) => item.id === employmentId) ?? null,
    [availableEmployments, employmentId]
  );

  const queueRef = useRef<QueueItem[]>([]);
  const isNarrowPhone = viewportWidth <= 430;
  const isMobile = viewportWidth <= 640;
  const isTablet = viewportWidth <= 860;
  const workingFundHours = useMemo(() => {
    const [y, m] = month.split("-").map((x) => parseInt(x, 10));
    if (!Number.isFinite(y) || !Number.isFinite(m)) return 0;
    return workingDaysInMonthCs(y, m) * 8;
  }, [month]);

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    const onUp = () => setOnline(true);
    const onDown = () => setOnline(false);
    window.addEventListener("online", onUp);
    window.addEventListener("offline", onDown);
    return () => {
      window.removeEventListener("online", onUp);
      window.removeEventListener("offline", onDown);
    };
  }, []);

  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };

    document.addEventListener("click", closeMenu);
    document.addEventListener("scroll", closeMenu, true);
    document.addEventListener("keydown", handleKey);

    return () => {
      document.removeEventListener("click", closeMenu);
      document.removeEventListener("scroll", closeMenu, true);
      document.removeEventListener("keydown", handleKey);
    };
  }, []);

  useEffect(() => {
    const initialQueue = loadStoredQueue();
    queueRef.current = initialQueue;
    setQueuedCount(initialQueue.length);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function syncClock() {
      const snapshot = await getPragueTimeSnapshot();
      if (cancelled) return;
      setClockOffsetMs(snapshot.timestamp - Date.now());
      setClockNowMs(Date.now());
      setClockSource(snapshot.source);
    }

    void syncClock();

    const syncHandle = window.setInterval(() => {
      void syncClock();
    }, 5 * 60 * 1000);
    const tickHandle = window.setInterval(() => {
      setClockNowMs(Date.now());
    }, 30 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(syncHandle);
      window.clearInterval(tickHandle);
    };
  }, []);

  // Load attendance for month (only when online)
  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!online) {
        setRows([]);
        setMonthLocked(false);
        return;
      }
      if (!token || !employmentId) {
        setRows([]);
        setMonthLocked(false);
        return;
      }

      try {
        const [y, m] = month.split("-").map((x) => parseInt(x, 10));
        const res = await getAttendance(employmentId, y, m, token);
        if (cancelled) return;
        const activeEmployment = availableEmployments.find((item) => item.id === employmentId) ?? null;
        if (activeEmployment) setEmploymentTemplate(activeEmployment.employment_type);

        // Normalize to full month list
        const dim = daysInMonth(y, m);
        const byDate = new Map<string, DayRow>();
        for (const d of res.days) byDate.set(d.date, d);

        const out: DayRow[] = [];
        for (let day = 1; day <= dim; day++) {
          const date = `${y}-${pad2(m)}-${pad2(day)}`;
          out.push(
            byDate.get(date) ?? {
              date,
              arrival_time: null,
              departure_time: null,
              planned_arrival_time: null,
              planned_departure_time: null,
              planned_status: null,
            },
          );
        }
        setRows(out);
        setMonthLocked(res.locked);
      } catch (err) {
        if (cancelled) return;
        const [y, m] = month.split("-").map((x) => parseInt(x, 10));
        if (err instanceof ApiError && err.status === 423 && Number.isFinite(y) && Number.isFinite(m)) {
          setRows(buildEmptyMonthRows(y, m));
          setMonthLocked(true);
          return;
        }
        setRows([]);
        setMonthLocked(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [availableEmployments, employmentId, month, online, refreshTick, token]);

  // Try to flush any offline queue whenever connectivity returns.
  useEffect(() => {
    flushQueueIfPossible();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  async function onLoginSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoginError(null);
    if (!loginEmail.trim() || !loginPassword) {
      setLoginError("Vyplňte e-mail a heslo.");
      return;
    }
    setLoginSubmitting(true);
    try {
      const res = await portalLogin({ email: loginEmail.trim(), password: loginPassword });
      setToken(res.instance_token);
      setEmploymentId(res.employment_id);
      setDisplayName(res.display_name ?? null);
      setAvailableEmployments(res.available_employments);
      setPortalAuthState({
        accessToken: res.instance_token,
        employmentId: res.employment_id,
        displayName: res.display_name ?? null,
        employments: res.available_employments,
      });
      const defaultEmployment = res.available_employments.find((item) => item.id === res.employment_id) ?? res.available_employments[0];
      if (defaultEmployment) setEmploymentTemplate(defaultEmployment.employment_type as EmploymentTemplate);
      if (res.afternoon_cutoff) setAfternoonCutoff(res.afternoon_cutoff);
      setLoginEmail("");
      setLoginPassword("");
    } catch (err: unknown) {
      setLoginError(errorMessage(err, "Přihlášení se nezdařilo."));
    } finally {
      setLoginSubmitting(false);
    }
  }

  if (!token) {
    return (
      <div className="container" style={{ padding: "18px 0 30px" }}>
        <div className="card pad" style={{ maxWidth: 520, margin: "0 auto" }}>
          <div style={{ fontSize: 18, fontWeight: 850 }}>Přihlášení</div>
          <div style={{ color: "var(--muted)", marginTop: 4 }}>Přihlaste se e-mailem a heslem.</div>

          {loginError ? (
            <div
              style={{
                border: "1px solid rgba(255,0,0,0.35)",
                background: "rgba(255,0,0,0.08)",
                borderRadius: 12,
                padding: 12,
                color: "var(--kb-red)",
                marginTop: 12,
                fontSize: 13,
              }}
            >
              {loginError}
            </div>
          ) : null}

          <form onSubmit={onLoginSubmit} className="stack" style={{ gap: 12, marginTop: 12 }}>
            <div>
              <label className="label" htmlFor="portal-login-email">E-mail</label>
              <input
                id="portal-login-email"
                className="input"
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="name@hotelchodovasc.cz"
                autoComplete="username"
                name="username"
              />
            </div>
            <div>
              <label className="label" htmlFor="portal-login-password">Heslo</label>
              <input
                id="portal-login-password"
                className="input"
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="Zadejte své heslo"
                autoComplete="current-password"
                name="current-password"
              />
            </div>
            <button type="submit" className="btn solid" disabled={loginSubmitting}>
              {loginSubmitting ? "Přihlašuji…" : "Přihlásit"}
            </button>
            <a href="/reset" style={{ fontSize: 12, color: "var(--muted)" }}>
              Nastavit nebo změnit heslo
            </a>
          </form>
        </div>
      </div>
    );
  }

  function enqueue(item: QueueItem) {
    // Replace any existing item for same date (latest wins)
    const q = queueRef.current;
    const idx = q.findIndex((x) => x.date === item.date);
    if (idx >= 0) q.splice(idx, 1);
    q.push(item);
    persistQueue(q);
    setQueuedCount(q.length);
  }

  async function flushQueueIfPossible() {
    if (!online) return;
    if (sending) return;
    const currentToken = token;
    if (!currentToken) return;

    const q = queueRef.current;
    if (q.length === 0) return;

    setSending(true);
    try {
      // Send in enqueue order
      while (q.length > 0) {
        const item = q[0];
        if (!employmentId) break;
        await putAttendance(
          {
            employment_id: employmentId,
            date: item.date,
            arrival_time: item.arrival_time,
            departure_time: item.departure_time,
          },
          currentToken,
        );
        q.shift();
        persistQueue(q);
        setQueuedCount(q.length);
      }
    } catch {
      // keep remaining in queue
    } finally {
      setSending(false);
    }
  }

  async function onChangeTime(date: string, field: "arrival_time" | "departure_time", value: string) {
    if (monthLocked) return;
    const trimmed = normalizeTime(value);
    if (!isValidTimeOrEmpty(trimmed)) {
      // Do not push invalid; just update UI field to raw value? We'll keep last valid shown by not updating.
      return;
    }

    const row = rows.find((item) => item.date === date);
    if (!row) return;
    if (row.planned_status) {
      window.alert(`Do dne označeného jako ${row.planned_status === "HOLIDAY" ? "DOVOLENÁ" : "VOLNO"} nelze zapisovat čas.`);
      return;
    }

    const readOnlyReason = getHistoricalReadOnlyReason(row, field, pragueNow.date);
    if (readOnlyReason) {
      window.alert(readOnlyReason);
      return;
    }

    const nextValue = trimmed === "" ? null : trimmed;
    if (date === pragueNow.date && isFutureTimeOnSameDay(nextValue, pragueNow.minutes)) {
      window.alert("U dnešního dne nelze zadat čas v budoucnosti. Rozhoduje aktuální čas v Praze.");
      return;
    }

    // Update UI immediately (optimistic)
    setRows((prev) =>
      prev.map((r) => {
        if (r.date !== date) return r;
        const next: DayRow = { ...r };
        next[field] = nextValue;
        return next;
      }),
    );

    const currentToken = token;

    // Compute payload from current state after update
    const payload = {
      employment_id: employmentId ?? 0,
      date,
      arrival_time: field === "arrival_time" ? nextValue : row.arrival_time ?? null,
      departure_time: field === "departure_time" ? nextValue : row.departure_time ?? null,
    };

    if (!online || !currentToken || !employmentId) {
      enqueue({ ...payload, enqueuedAt: Date.now() });
      return;
    }

    try {
      await putAttendance(payload, currentToken);
    } catch (err) {
      if (err instanceof ApiError && err.status === 423) {
        setMonthLocked(true);
        return;
      }
      enqueue({ ...payload, enqueuedAt: Date.now() });
    } finally {
      flushQueueIfPossible();
    }
  }

  async function handlePlanDayStatusChange(date: string, status: ShiftPlanDayStatus | null) {
    if (!employmentId || !token || monthLocked) return;
    setContextMenu(null);

    setRows((prev) =>
      prev.map((row) =>
        row.date === date
          ? {
              ...row,
              planned_status: status,
              planned_arrival_time: null,
              planned_departure_time: null,
              arrival_time: status ? null : row.arrival_time,
              departure_time: status ? null : row.departure_time,
            }
          : row,
      ),
    );

    try {
      await upsertPortalDayStatus(
        {
          employment_id: employmentId,
          date,
          status,
        },
        token,
      );
      setDayStatusDialog(null);
      setRefreshTick((tick) => tick + 1);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.body?.detail && typeof err.body.detail !== "string" && status) {
        const detail = err.body.detail as {
          attendance_exists?: boolean;
          shift_plan_exists?: boolean;
        };
        setDayStatusDialog({
          date,
          status,
          attendanceExists: Boolean(detail.attendance_exists),
          shiftPlanExists: Boolean(detail.shift_plan_exists),
        });
        setRefreshTick((tick) => tick + 1);
        return;
      }
      if (err instanceof ApiError && err.status === 423) {
        setMonthLocked(true);
      }
      setRefreshTick((tick) => tick + 1);
    }
  }

  async function confirmPlanDayStatusChange() {
    if (!employmentId || !token || !dayStatusDialog) return;
    try {
      await upsertPortalDayStatus(
        {
          employment_id: employmentId,
          date: dayStatusDialog.date,
          status: dayStatusDialog.status,
          confirm_delete_conflicts: true,
        },
        token,
      );
      setDayStatusDialog(null);
      setRefreshTick((tick) => tick + 1);
    } catch (err) {
      if (err instanceof ApiError && err.status === 423) {
        setMonthLocked(true);
      }
    }
  }

  const today = pragueNow.date || isoToday();
  const monthHead = monthLabel(month).toUpperCase();

  function handlePunchNow() {
    if (monthLocked) {
      window.alert("Měsíc je uzavřen. Nelze zapisovat nové časy.");
      return;
    }
    const todayRow = rows.find((r) => r.date === today);
    if (!todayRow) {
      window.alert("Dnešní den není v aktuálním přehledu.");
      return;
    }
    if (todayRow.planned_status) {
      window.alert(`Dnešní den je označen jako ${todayRow.planned_status === "HOLIDAY" ? "DOVOLENÁ" : "VOLNO"}. Čas nelze zapsat.`);
      return;
    }
    const hhmm = pragueNow.time;
    if (!todayRow.arrival_time) {
      onChangeTime(today, "arrival_time", hhmm);
      return;
    }
    if (!todayRow.departure_time) {
      onChangeTime(today, "departure_time", hhmm);
      return;
    }
    window.alert("Dnešní den už má vyplněný příchod i odchod, není kam zapsat čas.");
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--kb-bg)" }}>
      <header
        style={
          {
            position: "sticky",
            top: "var(--kb-systembar-h)",
            zIndex: 20,
            background:
              "linear-gradient(135deg, rgba(26,31,35,0.98) 0%, rgba(38,43,49,0.97) 56%, rgba(58,64,70,0.94) 100%)",
            color: "white",
            borderBottom: "1px solid rgba(255,255,255,0.12)",
            boxShadow: "0 16px 32px rgba(18,22,25,0.22)",
          }
        }
      >
        <div
          style={{
            maxWidth: 980,
            margin: "0 auto",
            padding: isMobile ? "14px 14px 16px" : "18px 16px 20px",
            display: "flex",
            flexDirection: "column",
            gap: isMobile ? 12 : 16,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isTablet ? "1fr" : "minmax(0, 1fr) auto",
              alignItems: "start",
              gap: isMobile ? 10 : 16,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  color: "rgba(255,255,255,0.66)",
                }}
              >
                Vybraný úvazek
              </div>
              <div
                style={{
                  fontWeight: 800,
                  fontSize: isNarrowPhone ? 14 : isMobile ? 15 : 20,
                  textTransform: "uppercase",
                  lineHeight: 1.2,
                  wordBreak: "break-word",
                  color: "rgba(255,255,255,0.96)",
                  textShadow: "0 1px 2px rgba(0,0,0,0.2)",
                }}
              >
                {monthHead} - {(selectedEmployment?.label ?? displayName) || "—"}
              </div>
              {availableEmployments.length > 1 ? (
                <select
                  className="input"
                  value={employmentId ?? ""}
                  onChange={(e) => {
                    const nextEmploymentId = Number(e.target.value);
                    const nextEmployment = availableEmployments.find((item) => item.id === nextEmploymentId) ?? null;
                    setEmploymentId(Number.isInteger(nextEmploymentId) ? nextEmploymentId : null);
                    if (nextEmployment) {
                      setEmploymentTemplate(nextEmployment.employment_type);
                      setPortalAuthState({
                        accessToken: token,
                        employmentId: nextEmployment.id,
                        displayName,
                        employments: availableEmployments,
                      });
                    }
                  }}
                  style={{ minWidth: 0, width: "100%", fontSize: isMobile ? 14 : undefined }}
                  aria-label="Vybraný úvazek"
                >
                  {availableEmployments.map((employment) => (
                    <option key={employment.id} value={employment.id}>
                      {employment.label}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: isTablet ? "space-between" : "flex-end",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              {!isMobile ? (
                <img
                  src={BRAND_ASSETS.logoHorizontal}
                  alt={APP_NAME_SHORT}
                  style={{ height: 32, width: "auto", objectFit: "contain", opacity: 0.94 }}
                />
              ) : null}
              <button
                type="button"
                onClick={() => {
                  clearPortalAuthState();
                  setToken(null);
                  setEmploymentId(null);
                  setDisplayName(null);
                  setAvailableEmployments([]);
                  setLoginEmail("");
                  setLoginPassword("");
                  setLoginError(null);
                  queueRef.current = [];
                  persistQueue([]);
                  setQueuedCount(0);
                }}
                className="btn"
                aria-label="Odhlásit"
                title="Odhlásit"
                style={{
                  padding: isMobile ? "10px 14px" : "10px 16px",
                  minHeight: 42,
                  background: "rgba(255,255,255,0.96)",
                  border: "1px solid rgba(255,255,255,0.2)",
                  color: "var(--kb-text)",
                  boxShadow: "0 8px 18px rgba(0,0,0,0.18)",
                }}
              >
                Odhlásit
              </button>
            </div>
          </div>
          <div
            style={{
              fontWeight: 900,
              letterSpacing: isMobile ? 0.4 : 0.8,
              textTransform: "uppercase",
              fontSize: isNarrowPhone ? 18 : isMobile ? 20 : 30,
              lineHeight: 1.05,
              color: "rgba(255,255,255,0.98)",
              textShadow: "0 1px 2px rgba(0,0,0,0.24)",
            }}
          >
            {viewMode === "plan" ? "Plán směn" : "Docházkový list"}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "minmax(0, auto) minmax(0, 1fr) minmax(0, auto)",
              alignItems: "center",
              gap: isMobile ? 10 : 12,
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr",
                gap: 10,
              }}
            >
              <button
                type="button"
                onClick={() => setMonth((m) => addMonths(m, -1))}
                style={headerNavButtonStyle(isMobile)}
                aria-label="Předchozí měsíc"
                title="Předchozí měsíc"
              >
                ← <span style={{ fontSize: isMobile ? 12 : 13, fontWeight: 700 }}>{isNarrowPhone ? "Předchozí" : "Předchozí měsíc"}</span>
              </button>
              {isMobile ? (
                <button
                  type="button"
                  onClick={() => setMonth((m) => addMonths(m, +1))}
                  style={headerNavButtonStyle(true)}
                  aria-label="Další měsíc"
                  title="Další měsíc"
                >
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{isNarrowPhone ? "Další" : "Další měsíc"}</span> →
                </button>
              ) : null}
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
              {viewMode === "attendance" ? (
                <>
                  <button type="button" onClick={() => setViewMode("plan")} style={headerActionButtonStyle(isMobile)} aria-label="Přepnout na plán směn">
                    Plán směn
                  </button>
                  <button
                    type="button"
                    onClick={handlePunchNow}
                    style={{
                      ...headerActionButtonStyle(isMobile),
                      background: "linear-gradient(135deg, #ff1a1a, var(--kb-red))",
                      border: "1px solid rgba(255,255,255,0.08)",
                      boxShadow: "0 10px 22px rgba(255,0,0,0.3)",
                    }}
                    aria-label="Zapsat aktuální čas"
                    title="Zapsat aktuální čas"
                  >
                    Teď
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setViewMode("attendance")}
                  style={headerActionButtonStyle(isMobile)}
                  aria-label="Přepnout na docházkový list"
                  title="Přepnout na docházkový list"
                >
                  Docházkový list
                </button>
              )}
              <button
                type="button"
                onClick={() => setRefreshTick((t) => t + 1)}
                style={headerActionButtonStyle(isMobile)}
                aria-label="Obnovit"
                title="Obnovit"
              >
                Obnovit
              </button>
            </div>
            {!isMobile ? (
              <button
                type="button"
                onClick={() => setMonth((m) => addMonths(m, +1))}
                style={headerNavButtonStyle(false)}
                aria-label="Další měsíc"
                title="Další měsíc"
              >
                <span style={{ fontSize: 13, fontWeight: 700 }}>Další měsíc</span> →
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 980, margin: "0 auto", padding: "16px" }}>
        {monthLocked ? (
          <div style={cardStyle()}>
            <div style={{ fontWeight: 800, marginBottom: 6, color: "var(--kb-red)" }}>Měsíc uzavřen</div>
            <div style={{ color: "var(--kb-brand-ink-600)" }}>
              Měsíc {monthLabel(month)} je uzavřen administrátorem. Data zůstávají viditelná, ale nové zápisy ani změny označení dne nejsou povolené.
            </div>
          </div>
        ) : null}

        {!online ? (
          <div style={cardStyle()}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Offline</div>
            <div style={{ color: "var(--kb-brand-ink-600)" }}>
              Bez internetu nelze načíst historii ze serveru. Můžete zadávat změny; uloží se do zařízení a odešlou se po obnovení připojení.
              {queuedCount > 0 ? ` Ve frontě čeká ${queuedCount} změn.` : ""}
            </div>
          </div>
        ) : null}

        {!selectedEmployment ? (
          <div style={cardStyle()}>
            <div style={{ fontWeight: 800, marginBottom: 6, color: "#b45309" }}>Není dostupný úvazek</div>
            <div style={{ color: "var(--kb-brand-ink-600)" }}>Tento účet momentálně nemá vybraný úvazek pro zobrazení nebo zápis evidence docházky. Pokud máte více úvazků, vyberte ho v horní liště.</div>
          </div>
        ) : null}

        <div style={{ display: "grid", gap: 10 }}>
          {displayedRows.length > 0 ? (
            <div
              className="attendance-grid-row attendance-grid-header"
              style={{
                ...cardStyle(),
                padding: 12,
                background: "rgba(35,41,44,0.04)",
                border: "1px solid rgba(35,41,44,0.12)",
                boxShadow: "none",
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr 1fr",
                gap: 12,
                alignItems: "center",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 800, color: "var(--kb-brand-ink-600)" }}>Den</div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "var(--kb-brand-ink-600)" }}>Příchod</div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "var(--kb-brand-ink-600)" }}>Odchod</div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "var(--kb-brand-ink-600)", textAlign: "right" }}>Hodiny</div>
            </div>
          ) : null}
          {displayedRows.map((r) => {
            const isToday = r.date === today;
            const arrivalReadOnlyReason = viewMode === "attendance" ? getHistoricalReadOnlyReason(r, "arrival_time", today) : null;
            const departureReadOnlyReason = viewMode === "attendance" ? getHistoricalReadOnlyReason(r, "departure_time", today) : null;
            const hasPlan = Boolean(r.planned_arrival_time || r.planned_departure_time || r.planned_status);
            const calc = computeDayCalc(r, employmentTemplate, cutoffMinutes);
            const mins = calc.workedMins;
            const isSpecial = employmentTemplate === "HPP" && calc.isWeekendOrHoliday;
            const hoursTitle =
              employmentTemplate === "HPP" && mins !== null
                ? `Odpolední: ${formatHours(calc.afternoonMins)} h • Víkend/svátek: ${formatHours(calc.weekendHolidayMins)} h${calc.breakTooltip ? ` • ${calc.breakTooltip}` : ""}`
                : undefined;
            return (
              <div
                key={r.date}
                className="attendance-grid-row"
                onContextMenu={(event) => {
                  if (viewMode !== "plan" || monthLocked || !r.is_within_employment_period) return;
                  event.preventDefault();
                  setContextMenu({ x: event.clientX, y: event.clientY, date: r.date });
                }}
                style={{
                  ...cardStyle(),
                  border: isToday
                    ? "2px solid rgba(38,43,49,0.5)"
                    : hasPlan
                      ? "2px solid rgba(38,43,49,0.4)"
                      : "1px solid rgba(35,41,44,0.12)",
                  boxShadow: isToday
                    ? "0 8px 24px rgba(38,43,49,0.12)"
                    : hasPlan
                      ? "0 8px 20px rgba(38,43,49,0.1)"
                      : "0 6px 18px rgba(35, 41, 44, 0.06)",
                  background:
                    r.planned_status === "HOLIDAY"
                      ? "rgba(255,0,0,0.08)"
                      : r.planned_status === "OFF"
                        ? "rgba(12,95,211,0.08)"
                        : isSpecial
                          ? "rgba(255,0,0,0.08)"
                          : "white",
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr 1fr",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontWeight: 800, fontSize: 18, color: "var(--kb-text)" }}>{r.date.slice(8, 10)}.</div>
                  <div style={{ fontSize: 12, color: "var(--kb-brand-ink-600)" }}>
                    {toDowLabel(r.date)}
                    {employmentTemplate === "HPP" && calc.holidayName ? ` • ${calc.holidayName}` : ""}
                  </div>
                  {employmentTemplate === "HPP" && calc.breakLabel ? (
                    <div
                      title={calc.breakTooltip ?? undefined}
                      style={{
                        display: "inline-block",
                        marginTop: 6,
                        fontSize: 11,
                        fontWeight: 800,
                        color: "var(--kb-text)",
                        background: "rgba(35,41,44,0.12)",
                        border: "1px solid rgba(35,41,44,0.18)",
                        padding: "4px 8px",
                        borderRadius: 999,
                      }}
                    >
                      {calc.breakLabel}
                    </div>
                  ) : null}
                  {isToday ? (
                    <div
                      style={{
                        display: "inline-block",
                        marginTop: 6,
                        fontSize: 11,
                        fontWeight: 700,
                        color: "var(--kb-brand-ink-800)",
                        background: "rgba(38,43,49,0.1)",
                        padding: "4px 8px",
                        borderRadius: 999,
                      }}
                    >
                      Dnes
                    </div>
                  ) : null}
                </div>

                <TimeInput
                  label="Příchod"
                  placeholder={timeFieldPlaceholder()}
                  value={r.arrival_time ?? ""}
                  plannedValue={viewMode === "attendance" ? r.planned_arrival_time : undefined}
                  plannedStatus={r.planned_status}
                  readOnly={viewMode === "plan" || arrivalReadOnlyReason !== null || Boolean(r.planned_status)}
                  readOnlyReason={viewMode === "plan" ? null : arrivalReadOnlyReason}
                  onChange={(v) => onChangeTime(r.date, "arrival_time", v)}
                />

                <TimeInput
                  label="Odchod"
                  placeholder={timeFieldPlaceholder()}
                  value={r.departure_time ?? ""}
                  plannedValue={viewMode === "attendance" ? r.planned_departure_time : undefined}
                  plannedStatus={r.planned_status}
                  readOnly={viewMode === "plan" || departureReadOnlyReason !== null || Boolean(r.planned_status)}
                  readOnlyReason={viewMode === "plan" ? null : departureReadOnlyReason}
                  onChange={(v) => onChangeTime(r.date, "departure_time", v)}
                />
                <div title={hoursTitle} style={{ textAlign: "right", fontWeight: 800, color: mins ? "var(--kb-text)" : "rgba(82, 85, 93, 0.6)" }}>
                  {mins !== null ? `${formatHours(mins)} h` : "—"}
                </div>
              </div>
            );
          })}
        </div>

        {rows.length === 0 ? (
          <div style={{ ...cardStyle(), marginTop: 14, color: "var(--kb-text)", fontSize: 14 }}>
            {online ? "Pro zvolený měsíc zatím nejsou žádné záznamy. Zkuste jiný měsíc nebo použijte tlačítko Teď pro dnešní zápis." : "Bez internetu nelze historii načíst."}
          </div>
        ) : null}
      </main>

      {contextMenu ? (
        <div className="plan-context-menu" style={{ top: contextMenu.y, left: contextMenu.x, position: "fixed" }}>
          <button type="button" onClick={() => void handlePlanDayStatusChange(contextMenu.date, "HOLIDAY")}>
            Označit jako DOVOLENÁ
          </button>
          <button type="button" onClick={() => void handlePlanDayStatusChange(contextMenu.date, "OFF")}>
            Označit jako VOLNO
          </button>
          <button type="button" onClick={() => void handlePlanDayStatusChange(contextMenu.date, null)}>
            Zrušit označení dne
          </button>
        </div>
      ) : null}

      <ConfirmDialog
        open={dayStatusDialog !== null}
        title="Smazat kolidující údaje?"
        description="V tomto dni už existuje plán směny nebo docházka. Potvrzením budou stávající údaje pro tento den smazány a den se označí vybraným stavem."
        confirmLabel="Potvrdit a smazat údaje"
        cancelLabel="Zrušit"
        tone="danger"
        details={
          dayStatusDialog
            ? [
                { label: "Datum", value: dayStatusDialog.date },
                { label: "Nový stav", value: dayStatusDialog.status === "HOLIDAY" ? "DOVOLENÁ" : "VOLNO" },
                { label: "Docházka", value: dayStatusDialog.attendanceExists ? "Ano" : "Ne" },
                { label: "Plán směny", value: dayStatusDialog.shiftPlanExists ? "Ano" : "Ne" },
              ]
            : []
        }
        onConfirm={() => void confirmPlanDayStatusChange()}
        onClose={() => {
          setDayStatusDialog(null);
          setRefreshTick((tick) => tick + 1);
        }}
      />

      <footer style={{ maxWidth: 980, margin: "0 auto", padding: "20px 16px" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
          }}
        >
          <FooterStat label="Identifikátor úvazku" value={employmentId ? String(employmentId) : "—"} />
          <FooterStat label="Vybraný úvazek" value={(selectedEmployment?.label ?? displayName) || "—"} />
          <FooterStat
            label={`Součet hodin (${monthLabel(month)})`}
            value={`${formatHours(monthTotalMins)} h (z toho ${formatHours(monthHolidayMins)} h dovolená)`}
          />
          <FooterStat label="Počet dní dovolené" value={String(monthStats.vacationDays)} />
          <FooterStat label="Víkend + svátky" value={`${formatHours(monthStats.weekendHolidayMins)} h`} />
          <FooterStat label={`Odpolední (${afternoonCutoff})`} value={`${formatHours(monthStats.afternoonMins)} h`} />
          <FooterStat label="Pracovní fond" value={`${workingFundHours} h`} />
        </div>
        <div style={{ marginTop: 12, color: "var(--kb-brand-ink-600)", fontSize: 12 }}>
          Docházka se ukládá na serveru. Offline změny se průběžně ukládají i v zařízení a po obnovení připojení se odešlou automaticky.
          {` Uživatelská omezení se vyhodnocují podle času v Praze (${pragueNow.source === "internet" ? "internet" : pragueNow.source === "server" ? "server" : "nouzový čas prohlížeče"}).`}
        </div>
      </footer>
    </div>
  );
}

function headerNavButtonStyle(compact = false): React.CSSProperties {
  return {
    appearance: "none",
    border: "1px solid rgba(255,255,255,0.22)",
    background: "rgba(255,255,255,0.08)",
    color: "rgba(255,255,255,0.96)",
    minWidth: compact ? 0 : 46,
    minHeight: compact ? 46 : 48,
    width: compact ? "100%" : undefined,
    padding: compact ? "0 14px" : "0 16px",
    borderRadius: compact ? 12 : 14,
    fontSize: compact ? 15 : 18,
    fontWeight: 800,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: compact ? 6 : 8,
    whiteSpace: compact ? "normal" : "nowrap",
    textAlign: "center",
    boxShadow: "0 8px 18px rgba(0,0,0,0.16)",
    transition: "transform 120ms ease, box-shadow 120ms ease, background 120ms ease",
  };
}

function headerActionButtonStyle(compact = false): React.CSSProperties {
  return {
    ...headerNavButtonStyle(compact),
    minWidth: compact ? 0 : 160,
    width: compact ? "100%" : "auto",
    padding: compact ? "0 14px" : "0 16px",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  };
}

function cardStyle(): React.CSSProperties {
  return {
    background: "white",
    borderRadius: 16,
    padding: 14,
    border: "1px solid rgba(35,41,44,0.12)",
    boxShadow: "0 6px 18px rgba(35, 41, 44, 0.06)",
  };
}

function TimeInput(props: {
  label: string;
  placeholder: string;
  value: string;
  plannedValue?: string | null;
  plannedStatus?: ShiftPlanDayStatus | null;
  readOnly?: boolean;
  readOnlyReason?: string | null;
  onChange: (v: string) => void;
}) {
  const { label, placeholder, value, plannedValue, plannedStatus, readOnly, readOnlyReason, onChange } = props;
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
      {plannedLabel ? (
        <div style={{ fontSize: 11, color: plannedTone, fontWeight: 700 }}>Plán: {plannedLabel}</div>
      ) : null}
      <input
        inputMode="numeric"
        placeholder={effectivePlaceholder}
        value={local}
        readOnly={readOnly}
        disabled={readOnly}
        onChange={(e) => {
          if (readOnly) return;
          setLocal(e.target.value);
        }}
        onBlur={() => {
          if (readOnly) return;
          if (isValidTimeOrEmpty(local)) onChange(local);
        }}
        style={{
          width: "100%",
          minWidth: 0,
          height: 44,
          borderRadius: 12,
          border: ok
            ? hasStatusPlaceholder
              ? `1px solid ${plannedTone}`
              : "1px solid rgba(35, 41, 44, 0.18)"
            : "1px solid rgba(255,0,0,0.6)",
          outline: "none",
          padding: "0 12px",
          fontSize: 16,
          fontWeight: 700,
          letterSpacing: 0.2,
          background: readOnly
            ? "rgba(82,85,93,0.18)"
            : hasStatusPlaceholder
              ? "rgba(255,255,255,0.96)"
              : ok
                ? "white"
                : "rgba(255,0,0,0.05)",
          color: readOnly ? "var(--kb-brand-ink-600)" : undefined,
          cursor: readOnly ? "not-allowed" : "text",
        }}
      />
      {readOnly && readOnlyReason ? <div style={{ fontSize: 11, color: "var(--kb-brand-ink-600)" }}>{readOnlyReason}</div> : null}
      {!ok && !readOnly ? <div style={{ fontSize: 11, color: "var(--kb-red)" }}>Zadejte čas například jako 08:30, nebo pole nechte prázdné.</div> : null}
    </div>
  );
}
function FooterStat(props: { label: string; value: string; valueStyle?: React.CSSProperties }) {
  const { label, value, valueStyle } = props;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--kb-brand-ink-600)", textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 800, color: "var(--kb-text)", ...valueStyle }}>{value}</div>
    </div>
  );
}


export default EmployeePage;
