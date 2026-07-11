import { ChangeEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  adminGetShiftPlanMonth,
  adminSetShiftPlanSelection,
  adminUpsertDayStatus,
  adminUpsertShiftPlan,
  type ShiftPlanMonth,
  type ShiftPlanRow,
  type ShiftPlanDayStatus,
} from "../api/adminShiftPlan";
import { ApiError } from "../api/client";
import { Breadcrumbs, ConfirmDialog, EmptyState } from "../components/admin/AdminUI";
import { getCzechHolidayName, isWeekendDate, workingDaysInMonthCs } from "../utils/attendanceCalc";
import { formatIsoMonthForDisplay, parseCzechMonthToIso } from "../utils/date";
import { isValidTimeOrEmpty, normalizeTime } from "../utils/timeInput";
import { planStatusInputPlaceholder, planStatusLabel } from "../utils/planStatus";
import { employmentTemplateLabel, timeFieldPlaceholder } from "../utils/uiLabels";
import Button from "../ui/Button";

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function monthLabel(year: number, month: number) {
  const dt = new Date(year, month - 1, 1);
  return dt.toLocaleDateString("cs-CZ", { month: "long", year: "numeric" });
}

function monthDays(year: number, month: number) {
  const days: { date: string; number: string; weekday: string }[] = [];
  const current = new Date(year, month - 1, 1);

  while (current.getMonth() === month - 1) {
    // Lokální datum (ne UTC), aby při převodu na ISO nedocházelo k posunu o den.
    const iso = `${current.getFullYear()}-${pad2(current.getMonth() + 1)}-${pad2(current.getDate())}`;
    days.push({
      date: iso,
      number: pad2(current.getDate()),
      weekday: current.toLocaleDateString("cs-CZ", { weekday: "short" }),
    });
    current.setDate(current.getDate() + 1);
  }

  return days;
}

function minutesFromHHMM(value: string | null) {
  if (!value) return null;
  const [hh, mm] = value.split(":").map((part) => Number(part));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function plannedMinutesWithHoliday(row: ShiftPlanRow) {
  return row.days.reduce(
    (acc, day) => {
      if (day.status === "HOLIDAY") {
        acc.holidayMins += 8 * 60;
        acc.holidayDays += 1;
        acc.totalMins += 8 * 60;
        return acc;
      }
      const arrival = minutesFromHHMM(day.arrival_time);
      const departure = minutesFromHHMM(day.departure_time);

      if (arrival !== null && departure !== null && departure > arrival) {
        acc.totalMins += departure - arrival;
      }
      return acc;
    },
    { totalMins: 0, holidayMins: 0, holidayDays: 0 },
  );
}

function formatHours(mins: number) {
  return (mins / 60).toFixed(1);
}

type ContextMenuState = { x: number; y: number; employmentId: number; date: string };
type DayStatusDialogState = {
  employmentId: number;
  date: string;
  status: ShiftPlanDayStatus;
  attendanceExists: boolean;
  shiftPlanExists: boolean;
};
type PlanShiftFilter = "all" | "morning" | "afternoon" | "night" | "holiday" | "off" | "empty";

function planShiftTone(arrival: string | null | undefined) {
  if (!arrival) return "empty";
  if (arrival >= "22:00" || arrival < "06:00") return "night";
  if (arrival >= "14:00") return "afternoon";
  return "morning";
}

function rowMatchesShiftFilter(row: ShiftPlanRow, filter: PlanShiftFilter) {
  if (filter === "all") return true;
  return row.days.some((day) => {
    if (filter === "holiday") return day.status === "HOLIDAY";
    if (filter === "off") return day.status === "OFF";
    if (filter === "empty") return !day.status && !day.arrival_time && !day.departure_time && day.is_within_employment_period;
    return !day.status && planShiftTone(day.arrival_time) === filter;
  });
}

export default function AdminShiftPlanPage() {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  });
  const [monthInputValue, setMonthInputValue] = useState(() => formatIsoMonthForDisplay(month));
  const [monthInputError, setMonthInputError] = useState<string | null>(null);
  const [plan, setPlan] = useState<ShiftPlanMonth | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savingCells, setSavingCells] = useState<Record<string, boolean>>({});
  const [successCells, setSuccessCells] = useState<Record<string, boolean>>({});
  const [refreshTick, setRefreshTick] = useState(0);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [instanceQuery, setInstanceQuery] = useState("");
  const [showInactiveEmployments, setShowInactiveEmployments] = useState(false);
  const [planShiftFilter, setPlanShiftFilter] = useState<PlanShiftFilter>("all");
  const [dayStatusDialog, setDayStatusDialog] = useState<DayStatusDialogState | null>(null);
  const successTimeouts = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const tableWrapperRef = useRef<HTMLDivElement | null>(null);

  const year = Number(month.slice(0, 4)) || new Date().getFullYear();
  const monthNum = Number(month.slice(5, 7)) || new Date().getMonth() + 1;
  const monthLabelText = monthLabel(year, monthNum);

  const days = useMemo(
    () =>
      monthDays(year, monthNum).map((day) => {
        const isWeekend = isWeekendDate(day.date);
        const holidayName = getCzechHolidayName(day.date);
        return {
          ...day,
          isWeekend,
          isHoliday: Boolean(holidayName),
          isWeekendOrHoliday: isWeekend || Boolean(holidayName),
        };
      }),
    [year, monthNum],
  );

  const workingFundHours = useMemo(() => workingDaysInMonthCs(year, monthNum) * 8, [year, monthNum]);

  useEffect(() => {
    setMonthInputValue(formatIsoMonthForDisplay(month));
  }, [month]);

  const makeCellKey = (
    employmentId: number,
    date: string,
    field: "arrival_time" | "departure_time",
  ) => `${employmentId}:${date}:${field}`;

  const addSuccessFlash = (cellKey: string) => {
    setSuccessCells((prev) => ({ ...prev, [cellKey]: true }));

    if (successTimeouts.current[cellKey]) {
      clearTimeout(successTimeouts.current[cellKey]);
    }

    successTimeouts.current[cellKey] = setTimeout(() => {
      setSuccessCells((prev) => {
        const next = { ...prev };
        delete next[cellKey];
        return next;
      });
      delete successTimeouts.current[cellKey];
    }, 900);
  };

  const setSavingForDay = (employmentId: number, date: string, value: boolean) => {
    setSavingCells((prev) => {
      const next = { ...prev };
      const arrivalKey = makeCellKey(employmentId, date, "arrival_time");
      const departureKey = makeCellKey(employmentId, date, "departure_time");
      if (value) {
        next[arrivalKey] = true;
        next[departureKey] = true;
      } else {
        delete next[arrivalKey];
        delete next[departureKey];
      }
      return next;
    });
  };

  const setSuccessForDay = (employmentId: number, date: string) => {
    addSuccessFlash(makeCellKey(employmentId, date, "arrival_time"));
    addSuccessFlash(makeCellKey(employmentId, date, "departure_time"));
  };

  const applyFieldValue = (
    employmentId: number,
    date: string,
    field: "arrival_time" | "departure_time",
    value: string | null,
  ) => {
    setPlan((prev) => {
      if (!prev) return prev;

      return {
        ...prev,
        rows: prev.rows.map((row) => {
          if (row.employment_id !== employmentId) return row;

          return {
            ...row,
            days: row.days.map((day) => {
              if (day.date !== date) return day;
              return { ...day, [field]: value };
            }),
          };
        }),
      };
    });
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const data = await adminGetShiftPlanMonth({ year, month: monthNum });
        if (cancelled) return;
        setPlan(data);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Načtení plánu selhalo.");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [year, monthNum, refreshTick]);

  useEffect(() => {
    const timeouts = successTimeouts.current;
    return () => {
      Object.values(timeouts).forEach((timer) => clearTimeout(timer));
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

  const selectedIds = plan?.selected_employment_ids ?? [];
  const activeEmployments = useMemo(() => plan?.available_employments ?? [], [plan?.available_employments]);
  const visibleEmployments = useMemo(
    () => (showInactiveEmployments ? activeEmployments : activeEmployments.filter((item) => item.is_active_in_month)),
    [activeEmployments, showInactiveEmployments],
  );
  const filteredEmployments = useMemo(() => {
    const tokens = instanceQuery
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (tokens.length === 0) return visibleEmployments;
    return visibleEmployments.filter((it) => {
      const hay = `${it.display_label} ${it.user_name} ${it.title} ${it.id} ${it.employment_type}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [instanceQuery, visibleEmployments]);
  const rows = useMemo(
    () =>
      (plan?.rows ?? []).filter((row) => {
        const meta = activeEmployments.find((item) => item.id === row.employment_id);
        if (!meta) return showInactiveEmployments;
        if (!showInactiveEmployments && !meta.is_active_in_month) return false;
        return rowMatchesShiftFilter(row, planShiftFilter);
      }),
    [activeEmployments, plan?.rows, planShiftFilter, showInactiveEmployments],
  );

  const planOverview = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        const totals = plannedMinutesWithHoliday(row);
        acc.totalMins += totals.totalMins;
        acc.holidayDays += totals.holidayDays;
        row.days.forEach((day) => {
          if (!day.is_within_employment_period) return;
          if (day.status === "HOLIDAY") acc.holiday += 1;
          else if (day.status === "OFF") acc.off += 1;
          else if (day.arrival_time || day.departure_time) {
            acc.planned += 1;
            const tone = planShiftTone(day.arrival_time);
            if (tone === "morning") acc.morning += 1;
            if (tone === "afternoon") acc.afternoon += 1;
            if (tone === "night") acc.night += 1;
          } else {
            acc.empty += 1;
          }
        });
        return acc;
      },
      { totalMins: 0, planned: 0, morning: 0, afternoon: 0, night: 0, holiday: 0, off: 0, empty: 0, holidayDays: 0 },
    );
  }, [rows]);

  const dailyPlanCoverage = useMemo(
    () =>
      days.map((day) =>
        rows.reduce(
          (acc, row) => {
            const item = row.days.find((entry) => entry.date === day.date);
            if (!item || !item.is_within_employment_period) return acc;
            if (item.status === "HOLIDAY") acc.holiday += 1;
            else if (item.status === "OFF") acc.off += 1;
            else if (item.arrival_time || item.departure_time) acc.planned += 1;
            return acc;
          },
          { planned: 0, holiday: 0, off: 0 },
        ),
      ),
    [days, rows],
  );

  const handleMonthChange = (event: ChangeEvent<HTMLInputElement>) => {
    setMonthInputValue(event.target.value);
    if (monthInputError) {
      setMonthInputError(null);
    }
  };

  const commitMonthInput = () => {
    const parsed = parseCzechMonthToIso(monthInputValue);
    if (!parsed) {
      setMonthInputError("Měsíc zadejte ve formátu mm.rrrr, například 06.2026.");
      setMonthInputValue(formatIsoMonthForDisplay(month));
      return;
    }
    setMonthInputError(null);
    setMonth(parsed);
  };

  const handleToggleInstance = async (employmentId: number) => {
    if (!plan) return;

    setSaveError(null);
    const exists = selectedIds.includes(employmentId);
    const nextSelection = exists ? selectedIds.filter((id) => id !== employmentId) : [...selectedIds, employmentId];

    try {
      await adminSetShiftPlanSelection({ year, month: monthNum, employment_ids: nextSelection });
      setRefreshTick((tick) => tick + 1);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Nelze změnit výběr.");
    }
  };

  const handleInputChange = (
    employmentId: number,
    date: string,
    field: "arrival_time" | "departure_time",
    value: string,
  ) => {
    setPlan((prev) => {
      if (!prev) return prev;

      return {
        ...prev,
        rows: prev.rows.map((row) => {
          if (row.employment_id !== employmentId) return row;

          return {
            ...row,
            days: row.days.map((day) => {
              if (day.date !== date) return day;
              return { ...day, [field]: value === "" ? null : value };
            }),
          };
        }),
      };
    });
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    }
  };

  const handleInputBlur = async (
    employmentId: number,
    date: string,
    field: "arrival_time" | "departure_time",
  ) => {
    if (!plan) return;

    setSaveError(null);
    const row = plan.rows.find((item) => item.employment_id === employmentId);
    const day = row?.days.find((item) => item.date === date);
    if (!row || !day) return;
    if (day.status) {
      setSaveError(`Do dne označeného jako ${day.status === "HOLIDAY" ? "DOVOLENÁ" : "VOLNO"} nelze zapisovat plán směny.`);
      return;
    }

    const rawValue = day[field] ?? "";
    const normalized = normalizeTime(rawValue);
    if (!isValidTimeOrEmpty(normalized)) {
      setSaveError("Čas zadejte například jako 08:30 nebo jako číslo 1, 100 nebo 0100.");
      return;
    }

    const finalValue = normalized === "" ? null : normalized;
    applyFieldValue(employmentId, date, field, finalValue);

    const arrivalValue = field === "arrival_time" ? finalValue : day.arrival_time;
    const departureValue = field === "departure_time" ? finalValue : day.departure_time;
    const cellKey = `${employmentId}:${date}:${field}`;

    setSavingCells((prev) => ({ ...prev, [cellKey]: true }));

    try {
      await adminUpsertShiftPlan({
        employment_id: employmentId,
        date,
        arrival_time: arrivalValue,
        departure_time: departureValue,
      });

      setSaveError(null);
      setSuccessCells((prev) => ({ ...prev, [cellKey]: true }));

      if (successTimeouts.current[cellKey]) {
        clearTimeout(successTimeouts.current[cellKey]);
      }

      successTimeouts.current[cellKey] = setTimeout(() => {
        setSuccessCells((prev) => {
          const next = { ...prev };
          delete next[cellKey];
          return next;
        });
        delete successTimeouts.current[cellKey];
      }, 900);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Nelze uložit změnu.");
    } finally {
      setSavingCells((prev) => {
        const next = { ...prev };
        delete next[cellKey];
        return next;
      });
    }
  };

  const handleDayStatusChange = async (employmentId: number, date: string, status: ShiftPlanDayStatus | null) => {
    if (!plan) return;
    setSaveError(null);
    setContextMenu(null);

    const row = plan.rows.find((item) => item.employment_id === employmentId);
    const day = row?.days.find((item) => item.date === date);
    if (!row || !day) return;

    const nextStatus = status ?? null;

    setPlan((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        rows: prev.rows.map((r) => {
          if (r.employment_id !== employmentId) return r;
          return {
            ...r,
            days: r.days.map((d) => {
              if (d.date !== date) return d;
              return {
                ...d,
                status: nextStatus,
                arrival_time: nextStatus ? null : d.arrival_time,
                departure_time: nextStatus ? null : d.departure_time,
              };
            }),
          };
        }),
      };
    });

    setSavingForDay(employmentId, date, true);

    try {
      await adminUpsertDayStatus({
        employment_id: employmentId,
        date,
        status: nextStatus,
      });
      setSuccessForDay(employmentId, date);
      setDayStatusDialog(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.body?.detail && typeof err.body.detail !== "string" && nextStatus) {
        const detail = err.body.detail as {
          attendance_exists?: boolean;
          shift_plan_exists?: boolean;
        };
        setDayStatusDialog({
          employmentId,
          date,
          status: nextStatus,
          attendanceExists: Boolean(detail.attendance_exists),
          shiftPlanExists: Boolean(detail.shift_plan_exists),
        });
        setRefreshTick((tick) => tick + 1);
        return;
      }
      setSaveError(err instanceof Error ? err.message : "Nelze uložit změnu.");
    } finally {
      setSavingForDay(employmentId, date, false);
    }
  };

  const confirmDayStatusChange = async () => {
    if (!dayStatusDialog) return;
    setSavingForDay(dayStatusDialog.employmentId, dayStatusDialog.date, true);
    try {
      await adminUpsertDayStatus({
        employment_id: dayStatusDialog.employmentId,
        date: dayStatusDialog.date,
        status: dayStatusDialog.status,
        confirm_delete_conflicts: true,
      });
      setDayStatusDialog(null);
      setRefreshTick((tick) => tick + 1);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Nelze uložit změnu.");
    } finally {
      setSavingForDay(dayStatusDialog.employmentId, dayStatusDialog.date, false);
    }
  };

  const handleCellContextMenu = (event: React.MouseEvent, employmentId: number, date: string) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, employmentId, date });
  };

  const instancePicker = (
    <div className="plan-instance-picker plan-instance-picker--sidebar">
      <div className="plan-instance-header">
        <div>
          <div className="plan-instance-title">Výběr uživatelů pro plán</div>
          <div className="plan-instance-subtitle">Jen seznam uživatelů, ne existující docházky.</div>
        </div>
        <div className="plan-instance-count">
          Vybráno {selectedIds.length}/{activeEmployments.length}
        </div>
      </div>
      <label className="plan-instance-toggle">
        <input type="checkbox" checked={showInactiveEmployments} onChange={(e) => setShowInactiveEmployments(e.target.checked)} />
        <span>Zobrazit i neaktivní úvazky</span>
      </label>
      <div className="plan-instance-filter">
        <label htmlFor="plan-instance-search">Filtrovat</label>
        <input
          id="plan-instance-search"
          type="text"
          placeholder="např. Novák, pokoj nebo typ úvazku"
          value={instanceQuery}
          onChange={(e) => setInstanceQuery(e.target.value)}
        />
      </div>
      <div className="plan-instance-list">
        {filteredEmployments.map((inst) => {
          const selected = selectedIds.includes(inst.id);
          return (
            <label key={inst.id} className={`plan-instance-row${selected ? " selected" : ""}`}>
              <input
                type="checkbox"
                checked={selected}
                onChange={() => handleToggleInstance(inst.id)}
                aria-label={`Zahrnout ${inst.display_label}`}
              />
              <div className="plan-instance-main">
                <div className="plan-instance-name">{inst.display_label}</div>
                <div className="plan-instance-meta">
                  {employmentTemplateLabel(inst.employment_type)}
                  {!inst.is_active_in_month ? " · neaktivní pro zvolený měsíc" : ""}
                </div>
              </div>
            </label>
          );
        })}
        {filteredEmployments.length === 0 ? <div className="plan-instance-empty">Žádný úvazek neodpovídá filtru.</div> : null}
      </div>
    </div>
  );

  return (
    <div className="plan-page">
      <header className="ops-header plan-ops-header">
        <div>
          <Breadcrumbs items={[{ label: "Administrace", to: "/admin/prehled" }, { label: "Plán služeb" }]} />
          <h1>Plán služeb</h1>
          <p>
            Rozvržení tabulky odpovídá listu plánu směn: vlevo zůstává jméno, vpravo měsíční celkem a posouvají se
            pouze dny uprostřed.
          </p>
        </div>
        <div className="ops-actions">
          <Button type="button" variant="ghost" size="sm" onClick={() => setRefreshTick((tick) => tick + 1)}>Obnovit</Button>
          <a className="ops-btn" href="/admin/tisky">Tisk</a>
          <a className="ops-btn" href="/admin/export">Export</a>
          <a className="ops-btn" href="/admin/settings">Nastavení</a>
        </div>
      </header>

      <section className="ops-stat-strip" aria-label="Souhrn plánu podle aktuálního filtru">
        <div><span>Úvazky</span><strong>{rows.length}</strong></div>
        <div><span>Plán hodin</span><strong>{formatHours(planOverview.totalMins)} h</strong></div>
        <div><span>Ranní</span><strong>{planOverview.morning}</strong></div>
        <div><span>Odpolední</span><strong>{planOverview.afternoon}</strong></div>
        <div><span>Noční</span><strong>{planOverview.night}</strong></div>
        <div><span>Dovolená / volno</span><strong>{planOverview.holiday}/{planOverview.off}</strong></div>
      </section>

      <section className="ops-toolbar" aria-label="Filtry plánu služeb">
        <Button type="button" variant="ghost" size="sm" onClick={() => setMonth(`${new Date(year, monthNum - 2, 1).getFullYear()}-${pad2(new Date(year, monthNum - 2, 1).getMonth() + 1)}`)}>
          Předchozí
        </Button>
        <label className="ops-select-field" htmlFor="plan-month-input">
          <span>Měsíc</span>
          <div className="plan-month-picker-controls">
            <input
              id="plan-month-input"
              className="ops-input ops-input--month"
              type="text"
              inputMode="numeric"
              value={monthInputValue}
              onChange={handleMonthChange}
              onBlur={commitMonthInput}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitMonthInput();
                }
              }}
              placeholder="např. 06.2026"
              aria-invalid={monthInputError ? "true" : "false"}
              aria-describedby={monthInputError ? "plan-month-input-error" : undefined}
            />
          </div>
        </label>
        <Button type="button" variant="ghost" size="sm" onClick={() => setMonth(`${new Date(year, monthNum, 1).getFullYear()}-${pad2(new Date(year, monthNum, 1).getMonth() + 1)}`)}>
          Další
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => {
          const now = new Date();
          setMonth(`${now.getFullYear()}-${pad2(now.getMonth() + 1)}`);
        }}>Dnes</Button>
        <label className="ops-select-field">
          <span>Směna</span>
          <select className="ops-input" value={planShiftFilter} onChange={(event) => setPlanShiftFilter(event.target.value as PlanShiftFilter)}>
            <option value="all">Všechny směny</option>
            <option value="morning">Ranní</option>
            <option value="afternoon">Odpolední</option>
            <option value="night">Noční</option>
            <option value="holiday">Dovolená</option>
            <option value="off">Volno</option>
            <option value="empty">Nevyplněno</option>
          </select>
        </label>
        <input className="ops-input" type="search" value={instanceQuery} onChange={(event) => setInstanceQuery(event.target.value)} placeholder="Hledat zaměstnance, úvazek nebo ID" aria-label="Hledat v plánu služeb" />
        <label className="ops-check">
          <input type="checkbox" checked={showInactiveEmployments} onChange={(event) => setShowInactiveEmployments(event.target.checked)} />
          <span>Včetně neaktivních</span>
        </label>
        {monthInputError ? <div id="plan-month-input-error" className="admin-field-error">{monthInputError}</div> : null}
      </section>

      <div className="ops-legend" aria-label="Legenda plánu služeb">
        <span><i className="ops-dot ops-dot--morning" />R ranní</span>
        <span><i className="ops-dot ops-dot--planned" />O odpolední</span>
        <span><i className="ops-dot ops-dot--night" />N noční</span>
        <span><i className="ops-dot ops-dot--holiday" />D dovolená</span>
        <span><i className="ops-dot ops-dot--off" />V volno</span>
        <span><i className="ops-dot ops-dot--warning" />Mimo úvazek / nevyplněno</span>
      </div>

      <div className="plan-layout">
        <aside className="plan-local-sidebar" aria-label="Zaměstnanci v plánu služeb">
          {instancePicker}
        </aside>
        <main className="plan-main">
          {loading ? <div className="plan-loading">Načítám plán…</div> : null}
          {!loading && error ? <div className="plan-error">{error}</div> : null}
          {saveError ? <div className="plan-error">{saveError}</div> : null}

          {rows.length === 0 ? (
            <EmptyState
              title="Žádné řádky plánu"
              description={
                filteredEmployments.length === 0
                  ? "Vybraný měsíc nebo filtr nevrátil žádné úvazky. Zkuste změnit měsíc nebo uvolnit filtr."
                  : "Vyberte alespoň jeden úvazek v levém panelu. Každá osoba pak dostane horní řádek pro příchod a spodní pro odchod."
              }
            />
          ) : (
            <>
              <div className="plan-table-wrapper" ref={tableWrapperRef}>
                <table className="plan-table">
                  <colgroup>
                    <col style={{ width: 92 }} />
                    {days.map((day) => (
                      <col key={`col-${day.date}`} style={{ width: 70 }} />
                    ))}
                    <col style={{ width: 140 }} />
                  </colgroup>

                  <thead>
                    <tr className="plan-table-head plan-table-head--numbers">
                      <th className="plan-table-th plan-table-th--name" rowSpan={2}>
                        Řádek
                      </th>
                      {days.map((day) => (
                        <th
                          className={`plan-table-th plan-table-th--day${day.isWeekendOrHoliday ? " plan-table-th--weekend" : ""}`}
                          key={`header-day-${day.date}`}
                        >
                          {day.number}
                        </th>
                      ))}
                      <th className="plan-table-th plan-table-th--sum" rowSpan={2}>
                        Celkem
                      </th>
                    </tr>
                    <tr className="plan-table-head plan-table-head--meta">
                      {days.map((day) => (
                        <th
                          className={`plan-table-th plan-table-th--meta${day.isWeekendOrHoliday ? " plan-table-th--weekend" : ""}`}
                          key={`header-meta-${day.date}`}
                        >
                          <span className="plan-day-head">
                            <span className="plan-day-head-weekday">{day.weekday.toUpperCase()}</span>
                            <span className="plan-day-head-note">
                              {day.isWeekendOrHoliday ? (day.isHoliday ? "svátek" : "víkend") : ""}
                            </span>
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {rows.map((row, rowIndex) => {
                      const rowId = row.employment_id;
                      const dayMap = row.days.reduce(
                        (acc, day) => {
                          acc[day.date] = day;
                          return acc;
                        },
                        {} as Record<string, (typeof row.days)[number]>,
                      );
                      const { totalMins, holidayMins, holidayDays } = plannedMinutesWithHoliday(row);
                      const totalHours = formatHours(totalMins);
                      const holidayHours = formatHours(holidayMins);
                      const fundHours = formatHours(workingFundHours * 60);

                      return (
                        <Fragment key={rowId}>
                          <tr className="plan-table-row plan-table-row-arrival">
                            <td className="plan-name-cell plan-name-cell--compact" rowSpan={2} aria-label={`${row.display_label}, ${employmentTemplateLabel(row.employment_type)}`}>
                              <div className="plan-row-index">{rowIndex + 1}</div>
                              <div className="plan-name-kindstack">
                                <span className="plan-name-kind">Příchod</span>
                                <span className="plan-name-kind plan-name-kind--muted">Odchod</span>
                              </div>
                            </td>

                            {days.map((day) => {
                              const planDay = dayMap[day.date];
                              const value = planDay?.arrival_time ?? "";
                              const cellKey = `${rowId}:${day.date}:arrival_time`;
                              const statusLabel = planStatusLabel(planDay?.status);
                              const isOutsideEmployment = planDay ? !planDay.is_within_employment_period : false;
                              const isBlocked = Boolean(statusLabel) || isOutsideEmployment;
                              const statusClass =
                                planDay?.status === "HOLIDAY"
                                  ? " plan-table-cell--holiday"
                                  : planDay?.status === "OFF"
                                    ? " plan-table-cell--off"
                                    : "";
                              const shiftClass =
                                !planDay?.status && !isOutsideEmployment && value
                                  ? ` plan-table-cell--${planShiftTone(value)}`
                                  : "";

                              return (
                                <td
                                  className={`plan-table-cell${day.isWeekendOrHoliday ? " plan-table-cell--weekend" : ""}${
                                    successCells[cellKey] ? " plan-table-cell--success" : ""
                                  }${statusClass}${shiftClass}${isOutsideEmployment ? " plan-table-cell--outside" : ""}`}
                                  key={cellKey}
                                  onContextMenu={(event) => handleCellContextMenu(event, rowId, day.date)}
                                >
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9:]*"
                                    className="plan-table-input"
                                    aria-label={`${row.display_label}, ${day.number}. ${monthLabelText}, příchod`}
                                    title={
                                      isOutsideEmployment
                                        ? "Tento den je mimo období úvazku."
                                        : isBlocked
                                          ? `Den je označen jako ${statusLabel}.`
                                          : `Příchod pro ${row.display_label}, ${day.number}. ${monthLabelText}`
                                    }
                                    value={isBlocked ? "" : value}
                                    onChange={(event) =>
                                      handleInputChange(rowId, day.date, "arrival_time", event.target.value)
                                    }
                                    onBlur={() => handleInputBlur(rowId, day.date, "arrival_time")}
                                    onKeyDown={handleInputKeyDown}
                                    placeholder={
                                      isOutsideEmployment
                                        ? "Mimo úvazek"
                                        : isBlocked
                                          ? planStatusInputPlaceholder(planDay?.status) ?? timeFieldPlaceholder()
                                          : timeFieldPlaceholder()
                                    }
                                    maxLength={5}
                                    disabled={isBlocked}
                                  />
                                  {isOutsideEmployment ? <div className="plan-saving">Mimo období úvazku</div> : null}
                                  <div className="plan-saving">{savingCells[cellKey] ? "Ukládám…" : null}</div>
                                </td>
                              );
                            })}

                            <td className="plan-sum-cell" rowSpan={2}>
                              <div className="plan-sum-label">Celkem měsíc</div>
                              <div className="plan-sum-value">{totalHours} h</div>
                              {holidayMins > 0 ? (
                                <div className="plan-sum-meta">z toho {holidayHours} h dovolená</div>
                              ) : null}
                              <div className="plan-sum-meta">Počet dní dovolené: {holidayDays}</div>
                              <div className="plan-sum-meta">Fond {fundHours} h</div>
                            </td>
                          </tr>

                          <tr className="plan-table-row plan-table-row-departure">
                            {days.map((day) => {
                              const planDay = dayMap[day.date];
                              const value = planDay?.departure_time ?? "";
                              const cellKey = `${rowId}:${day.date}:departure_time`;
                              const statusLabel = planStatusLabel(planDay?.status);
                              const isOutsideEmployment = planDay ? !planDay.is_within_employment_period : false;
                              const isBlocked = Boolean(statusLabel) || isOutsideEmployment;
                              const statusClass =
                                planDay?.status === "HOLIDAY"
                                  ? " plan-table-cell--holiday"
                                  : planDay?.status === "OFF"
                                    ? " plan-table-cell--off"
                                    : "";
                              const shiftClass =
                                !planDay?.status && !isOutsideEmployment && planDay?.arrival_time
                                  ? ` plan-table-cell--${planShiftTone(planDay.arrival_time)}`
                                  : "";

                              return (
                                <td
                                  className={`plan-table-cell${day.isWeekendOrHoliday ? " plan-table-cell--weekend" : ""}${
                                    successCells[cellKey] ? " plan-table-cell--success" : ""
                                  }${statusClass}${shiftClass}${isOutsideEmployment ? " plan-table-cell--outside" : ""}`}
                                  key={cellKey}
                                  onContextMenu={(event) => handleCellContextMenu(event, rowId, day.date)}
                                >
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9:]*"
                                    className="plan-table-input"
                                    aria-label={`${row.display_label}, ${day.number}. ${monthLabelText}, odchod`}
                                    title={
                                      isOutsideEmployment
                                        ? "Tento den je mimo období úvazku."
                                        : isBlocked
                                          ? `Den je označen jako ${statusLabel}.`
                                          : `Odchod pro ${row.display_label}, ${day.number}. ${monthLabelText}`
                                    }
                                    value={isBlocked ? "" : value}
                                    onChange={(event) =>
                                      handleInputChange(rowId, day.date, "departure_time", event.target.value)
                                    }
                                    onBlur={() => handleInputBlur(rowId, day.date, "departure_time")}
                                    onKeyDown={handleInputKeyDown}
                                    placeholder={
                                      isOutsideEmployment
                                        ? "Mimo úvazek"
                                        : isBlocked
                                          ? planStatusInputPlaceholder(planDay?.status) ?? timeFieldPlaceholder()
                                          : timeFieldPlaceholder()
                                    }
                                    maxLength={5}
                                    disabled={isBlocked}
                                  />
                                  {isOutsideEmployment ? <div className="plan-saving">Mimo období úvazku</div> : null}
                                  <div className="plan-saving">{savingCells[cellKey] ? "Ukládám…" : null}</div>
                                </td>
                              );
                            })}
                          </tr>
                        </Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th className="plan-table-th plan-table-th--name">Obsazení</th>
                      {dailyPlanCoverage.map((coverage, index) => (
                        <td key={`coverage-${days[index]?.date ?? index}`} className="plan-table-foot-cell">
                          <strong>{coverage.planned}</strong>
                          <small>D {coverage.holiday} · V {coverage.off}</small>
                        </td>
                      ))}
                      <td className="plan-sum-cell">
                        <div className="plan-sum-label">Celkem</div>
                        <div className="plan-sum-value">{planOverview.planned}</div>
                        <div className="plan-sum-meta">D {planOverview.holiday} · V {planOverview.off}</div>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {contextMenu ? (
                <div className="plan-context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
                  <button type="button" onClick={() => handleDayStatusChange(contextMenu.employmentId, contextMenu.date, "HOLIDAY")}>
                    Označit jako DOVOLENÁ
                  </button>
                  <button type="button" onClick={() => handleDayStatusChange(contextMenu.employmentId, contextMenu.date, "OFF")}>
                    Označit jako VOLNO
                  </button>
                  <button type="button" onClick={() => handleDayStatusChange(contextMenu.employmentId, contextMenu.date, null)}>
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
                onConfirm={() => void confirmDayStatusChange()}
                onClose={() => {
                  setDayStatusDialog(null);
                  setRefreshTick((tick) => tick + 1);
                }}
              />
            </>
          )}
        </main>
      </div>
    </div>
  );
}
