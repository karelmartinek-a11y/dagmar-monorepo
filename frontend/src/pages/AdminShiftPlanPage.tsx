import { ChangeEvent, Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import { ConfirmDialog } from "../components/admin/AdminUI";
import { getCzechHolidayName, isWeekendDate, workingDaysInMonthCs } from "../utils/attendanceCalc";
import { isValidTimeOrEmpty, normalizeTime } from "../utils/timeInput";
import { planStatusInputPlaceholder, planStatusLabel } from "../utils/planStatus";
import { employmentTemplateLabel, timeFieldPlaceholder } from "../utils/uiLabels";

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

export default function AdminShiftPlanPage() {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  });
  const [plan, setPlan] = useState<ShiftPlanMonth | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savingCells, setSavingCells] = useState<Record<string, boolean>>({});
  const [successCells, setSuccessCells] = useState<Record<string, boolean>>({});
  const [refreshTick, setRefreshTick] = useState(0);
  const [tableScrollWidth, setTableScrollWidth] = useState(0);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [instanceQuery, setInstanceQuery] = useState("");
  const [showInactiveEmployments, setShowInactiveEmployments] = useState(false);
  const [sidebarBottomTarget, setSidebarBottomTarget] = useState<HTMLElement | null>(null);
  const [dayStatusDialog, setDayStatusDialog] = useState<DayStatusDialogState | null>(null);
  const successTimeouts = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const tableWrapperRef = useRef<HTMLDivElement | null>(null);
  const topScrollRef = useRef<HTMLDivElement | null>(null);
  const bottomScrollRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    if (typeof document === "undefined") return;
    setSidebarBottomTarget(document.getElementById("admin-sidebar-bottom-extra"));
  }, []);

  useLayoutEffect(() => {
    const wrapper = tableWrapperRef.current;
    if (!wrapper) return;

    const updateWidth = () => setTableScrollWidth(wrapper.scrollWidth);
    updateWidth();

    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            updateWidth();
          })
        : null;

    if (observer) {
      observer.observe(wrapper);
    }

    const handleResize = () => updateWidth();
    if (typeof window !== "undefined") {
      window.addEventListener("resize", handleResize);
    }

    return () => {
      observer?.disconnect();
      if (typeof window !== "undefined") {
        window.removeEventListener("resize", handleResize);
      }
    };
  }, [days.length, plan?.rows.length]);

  useEffect(() => {
    const wrapper = tableWrapperRef.current;
    const top = topScrollRef.current;
    const bottom = bottomScrollRef.current;
    if (!wrapper) return;

    const syncScroller = (source: HTMLDivElement) => {
      const scrollLeft = source.scrollLeft;

      wrapper.scrollLeft = scrollLeft;
      if (top && source !== top) {
        top.scrollLeft = scrollLeft;
      }
      if (bottom && source !== bottom) {
        bottom.scrollLeft = scrollLeft;
      }
    };

    const onWrapperScroll = () => syncScroller(wrapper);
    const onTopScroll = () => {
      if (top) syncScroller(top);
    };
    const onBottomScroll = () => {
      if (bottom) syncScroller(bottom);
    };

    wrapper.addEventListener("scroll", onWrapperScroll);
    top?.addEventListener("scroll", onTopScroll);
    bottom?.addEventListener("scroll", onBottomScroll);

    return () => {
      wrapper.removeEventListener("scroll", onWrapperScroll);
      top?.removeEventListener("scroll", onTopScroll);
      bottom?.removeEventListener("scroll", onBottomScroll);
    };
  }, [plan?.rows.length]);

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
        return showInactiveEmployments || meta.is_active_in_month;
      }),
    [activeEmployments, plan?.rows, showInactiveEmployments],
  );

  const handleMonthChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (!event.target.value) return;
    setMonth(event.target.value);
  };

  const scrollTableTo = (left: number) => {
    const wrapper = tableWrapperRef.current;
    if (!wrapper) return;
    const maxLeft = Math.max(0, wrapper.scrollWidth - wrapper.clientWidth);
    wrapper.scrollTo({ left: Math.max(0, Math.min(left, maxLeft)), behavior: "smooth" });
  };

  const scrollTableBy = (delta: number) => {
    const wrapper = tableWrapperRef.current;
    if (!wrapper) return;
    scrollTableTo(wrapper.scrollLeft + delta);
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
      {sidebarBottomTarget ? createPortal(instancePicker, sidebarBottomTarget) : null}
      <div className="plan-top-row">
        <div>
          <div className="page-title">Plán služeb</div>
          <div className="plan-instruction">
            Rozvržení tabulky odpovídá listu plánu směn: vlevo zůstává jméno, vpravo měsíční celkem a posouvají se
            pouze dny uprostřed.
          </div>
        </div>

        <div className="plan-month-picker">
          <label className="label" htmlFor="plan-month-input">
            Vyberte měsíc
          </label>
          <input id="plan-month-input" className="input" type="month" value={month} onChange={handleMonthChange} />
          <div className="help">{monthLabelText}</div>
        </div>
      </div>

      <div className="plan-layout">
        <main className="plan-main">
          <div className="plan-toolbar">
            <div className="plan-toolbar-summary">
              <div className="plan-toolbar-count">
                {filteredEmployments.length} / {activeEmployments.length} úvazků
              </div>
              <div className="plan-toolbar-filter">
                {instanceQuery.trim() ? (
                  <>
                    Filtr: <strong>{instanceQuery.trim()}</strong>
                  </>
                ) : (
                  showInactiveEmployments ? "Včetně neaktivních úvazků" : "Jen aktivní úvazky pro zvolený měsíc"
                )}
              </div>
            </div>
            <div className="plan-toolbar-actions">
              <button type="button" className="plan-jump-btn" onClick={() => scrollTableTo(0)} title="Přejít na začátek měsíce">
                Na začátek
              </button>
              <button
                type="button"
                className="plan-jump-btn"
                onClick={() => scrollTableBy(-(tableWrapperRef.current?.clientWidth ?? 0))}
                title="Posunout tabulku o jednu obrazovku vlevo"
              >
                O stránku vlevo
              </button>
              <button
                type="button"
                className="plan-jump-btn"
                onClick={() => scrollTableBy(tableWrapperRef.current?.clientWidth ?? 0)}
                title="Posunout tabulku o jednu obrazovku vpravo"
              >
                O stránku vpravo
              </button>
              <button
                type="button"
                className="plan-jump-btn"
                onClick={() => scrollTableTo((tableWrapperRef.current?.scrollWidth ?? 0) / 2)}
                title="Přejít do středu měsíce"
              >
                Na střed
              </button>
              <button
                type="button"
                className="plan-jump-btn"
                onClick={() =>
                  scrollTableTo((tableWrapperRef.current?.scrollWidth ?? 0) - (tableWrapperRef.current?.clientWidth ?? 0))
                }
                title="Přejít na konec měsíce"
              >
                Na konec
              </button>
            </div>
          </div>

          {loading ? <div className="plan-loading">Načítám plán…</div> : null}
          {!loading && error ? <div className="plan-error">{error}</div> : null}
          {saveError ? <div className="plan-error">{saveError}</div> : null}

          {rows.length === 0 ? (
            <div className="plan-empty-state">
              Vyberte zařízení nahoře a vytvořte plán. Každá osoba má dva řádky, horní pro příchody a spodní pro odchody.
            </div>
          ) : (
            <>
              <div className="plan-table-top-scroll" ref={topScrollRef}>
                <div style={{ width: tableScrollWidth }} />
              </div>

              <div className="plan-table-wrapper" ref={tableWrapperRef}>
                <table className="plan-table">
                  <colgroup>
                    <col style={{ width: 280 }} />
                    {days.map((day) => (
                      <col key={`col-${day.date}`} style={{ width: 70 }} />
                    ))}
                    <col style={{ width: 140 }} />
                  </colgroup>

                  <thead>
                    <tr className="plan-table-head plan-table-head--numbers">
                      <th className="plan-table-th plan-table-th--name" rowSpan={2}>
                        Jméno
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
                    {rows.map((row) => {
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
                            <td className="plan-name-cell" rowSpan={2}>
                              <div className="plan-name">{row.display_label}</div>
                              <div className="plan-name-meta">{employmentTemplateLabel(row.employment_type)}</div>
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

                              return (
                                <td
                                  className={`plan-table-cell${day.isWeekendOrHoliday ? " plan-table-cell--weekend" : ""}${
                                    successCells[cellKey] ? " plan-table-cell--success" : ""
                                  }${statusClass}${isOutsideEmployment ? " plan-table-cell--outside" : ""}`}
                                  key={cellKey}
                                  onContextMenu={(event) => handleCellContextMenu(event, rowId, day.date)}
                                >
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9:]*"
                                    className="plan-table-input"
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

                              return (
                                <td
                                  className={`plan-table-cell${day.isWeekendOrHoliday ? " plan-table-cell--weekend" : ""}${
                                    successCells[cellKey] ? " plan-table-cell--success" : ""
                                  }${statusClass}${isOutsideEmployment ? " plan-table-cell--outside" : ""}`}
                                  key={cellKey}
                                  onContextMenu={(event) => handleCellContextMenu(event, rowId, day.date)}
                                >
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9:]*"
                                    className="plan-table-input"
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
                </table>
              </div>

              <div className="plan-table-bottom-scroll" ref={bottomScrollRef}>
                <div style={{ width: tableScrollWidth }} />
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
