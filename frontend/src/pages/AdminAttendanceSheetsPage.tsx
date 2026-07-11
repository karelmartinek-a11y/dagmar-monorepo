import { type MouseEvent, useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import { adminGetSettings } from "../api/admin";
import {
  adminGetAttendanceMatrixMonth,
  adminGetAttendanceMonth,
  adminLockAttendance,
  adminUnlockAttendance,
  adminUpsertAttendance,
  adminUpsertDayStatus,
  type AdminAttendanceDay,
  type AdminAttendanceMatrixRow,
} from "../api/adminAttendance";
import { ApiError } from "../api/client";
import type { ShiftPlanDayStatus } from "../api/adminShiftPlan";
import { Breadcrumbs, ConfirmDialog, EmptyState, InlineNotice } from "../components/admin/AdminUI";
import { computeDayCalc, computeMonthStats, getCzechHolidayName, isWeekendDate, parseCutoffToMinutes } from "../utils/attendanceCalc";
import { formatIsoDateForDisplay } from "../utils/date";
import { employmentTemplateLabel, timeFieldPlaceholder } from "../utils/uiLabels";
import { isValidTimeOrEmpty, normalizeTime } from "../utils/timeInput";
import { planStatusInputPlaceholder, planStatusLabel } from "../utils/planStatus";
import Button from "../ui/Button";

type SelectedCell = { employmentId: number; date: string };
type AttendanceContextMenu = { x: number; y: number; employmentId: number; date: string };
type DayStatusDialogState = {
  employmentId: number;
  date: string;
  status: ShiftPlanDayStatus;
  attendanceExists: boolean;
  shiftPlanExists: boolean;
};

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function yyyyMm(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function parseYYYYMM(value: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

function addMonths(yyyyMmStr: string, delta: number) {
  const parsed = parseYYYYMM(yyyyMmStr);
  if (!parsed) return yyyyMmStr;
  const next = new Date(parsed.year, parsed.month - 1, 1);
  next.setMonth(next.getMonth() + delta);
  return yyyyMm(next);
}

function monthDays(year: number, month: number) {
  const days: { date: string; number: string; weekday: string; isWeekend: boolean; holidayName: string | null }[] = [];
  const current = new Date(year, month - 1, 1);
  while (current.getMonth() === month - 1) {
    const date = `${current.getFullYear()}-${pad2(current.getMonth() + 1)}-${pad2(current.getDate())}`;
    days.push({
      date,
      number: String(current.getDate()),
      weekday: current.toLocaleDateString("cs-CZ", { weekday: "short" }),
      isWeekend: isWeekendDate(date),
      holidayName: getCzechHolidayName(date),
    });
    current.setDate(current.getDate() + 1);
  }
  return days;
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string") return err;
  return fallback;
}

function formatHours(mins: number) {
  return (mins / 60).toFixed(1);
}

function cellTone(day: AdminAttendanceDay) {
  if (!day.is_within_employment_period) return "is-outside";
  if (day.planned_status === "HOLIDAY") return "is-holiday";
  if (day.planned_status === "OFF") return "is-off";
  if ((day.planned_arrival_time || day.planned_departure_time) && (!day.arrival_time || !day.departure_time)) return "is-warning";
  if (day.arrival_time || day.departure_time) return "is-present";
  if (day.planned_arrival_time || day.planned_departure_time) return "is-planned";
  return "is-empty";
}

function shiftAbbrev(day: AdminAttendanceDay) {
  if (day.planned_status === "HOLIDAY") return "D";
  if (day.planned_status === "OFF") return "V";
  if (!day.planned_arrival_time && !day.planned_departure_time) return "—";
  const start = day.planned_arrival_time ?? "";
  if (start >= "22:00" || start < "06:00") return "N";
  if (start >= "14:00") return "O";
  return "R";
}

type EmploymentTypeFilter = "all" | "HPP" | "DPP_DPC";
type AttendanceStateFilter = "all" | "present" | "planned" | "warning" | "holiday" | "off" | "locked";

function hasAttendanceState(row: AdminAttendanceMatrixRow, state: AttendanceStateFilter) {
  if (state === "all") return true;
  if (state === "locked") return row.locked;
  return row.days.some((day) => {
    if (state === "present") return Boolean(day.arrival_time || day.departure_time);
    if (state === "planned") return Boolean(day.planned_arrival_time || day.planned_departure_time);
    if (state === "warning") return Boolean((day.planned_arrival_time || day.planned_departure_time) && (!day.arrival_time || !day.departure_time));
    if (state === "holiday") return day.planned_status === "HOLIDAY";
    if (state === "off") return day.planned_status === "OFF";
    return true;
  });
}

export default function AdminAttendanceSheetsPage() {
  const [month, setMonth] = useState(() => yyyyMm(new Date()));
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [employmentTypeFilter, setEmploymentTypeFilter] = useState<EmploymentTypeFilter>("all");
  const [stateFilter, setStateFilter] = useState<AttendanceStateFilter>("all");
  const [rows, setRows] = useState<AdminAttendanceMatrixRow[]>([]);
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  const [editingCell, setEditingCell] = useState<SelectedCell | null>(null);
  const [contextMenu, setContextMenu] = useState<AttendanceContextMenu | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [afternoonCutoff, setAfternoonCutoff] = useState("17:00");
  const [draftArrival, setDraftArrival] = useState("");
  const [draftDeparture, setDraftDeparture] = useState("");
  const [dayStatusDialog, setDayStatusDialog] = useState<DayStatusDialogState | null>(null);

  const parsedMonth = useMemo(() => parseYYYYMM(month), [month]);
  const year = parsedMonth?.year ?? new Date().getFullYear();
  const monthNum = parsedMonth?.month ?? new Date().getMonth() + 1;
  const cutoffMinutes = useMemo(() => parseCutoffToMinutes(afternoonCutoff), [afternoonCutoff]);
  const days = useMemo(() => monthDays(year, monthNum), [year, monthNum]);
  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }, []);

  const filteredRows = useMemo(() => {
    const tokens = query.trim().toLocaleLowerCase("cs-CZ").split(/\s+/).filter(Boolean);
    return rows.filter((row) => {
      if (!showInactive && !row.is_active_in_month) return false;
      if (employmentTypeFilter !== "all" && row.employment_type !== employmentTypeFilter) return false;
      if (!hasAttendanceState(row, stateFilter)) return false;
      if (tokens.length === 0) return true;
      const hay = `${row.user_name} ${row.employment_label} ${row.employment_title} ${row.employment_id} ${row.employment_type}`.toLocaleLowerCase("cs-CZ");
      return tokens.every((token) => hay.includes(token));
    });
  }, [employmentTypeFilter, query, rows, showInactive, stateFilter]);

  const selectedRow = useMemo(
    () => rows.find((row) => row.employment_id === selected?.employmentId) ?? filteredRows[0] ?? null,
    [filteredRows, rows, selected?.employmentId],
  );
  const selectedDay = useMemo(() => selectedRow?.days.find((day) => day.date === selected?.date) ?? null, [selected?.date, selectedRow]);

  const monthStats = useMemo(() => {
    return filteredRows.reduce(
      (acc, row) => {
        const stats = computeMonthStats(row.days, row.employment_type, cutoffMinutes);
        acc.workedMins += stats.totalMins;
        acc.holidayDays += stats.vacationDays;
        acc.afternoonMins += stats.afternoonMins;
        row.days.forEach((day) => {
          const plannedCalc = computeDayCalc({ date: day.date, arrival_time: day.planned_arrival_time ?? null, departure_time: day.planned_departure_time ?? null, planned_status: day.planned_status }, row.employment_type, cutoffMinutes);
          acc.plannedMins += (plannedCalc.workedMins ?? 0) + (day.planned_status === "HOLIDAY" ? 8 * 60 : 0);
          if (day.arrival_time || day.departure_time) acc.presentDays += 1;
          if (day.planned_arrival_time || day.planned_departure_time || day.planned_status) acc.plannedDays += 1;
          if ((day.planned_arrival_time || day.planned_departure_time) && (!day.arrival_time || !day.departure_time)) acc.warningDays += 1;
          if (day.planned_status === "OFF") acc.offDays += 1;
        });
        if (row.locked) acc.lockedRows += 1;
        return acc;
      },
      { workedMins: 0, plannedMins: 0, presentDays: 0, plannedDays: 0, warningDays: 0, holidayDays: 0, offDays: 0, afternoonMins: 0, lockedRows: 0 },
    );
  }, [cutoffMinutes, filteredRows]);

  const dailyCoverage = useMemo(() => {
    return days.map((day) =>
      filteredRows.reduce(
        (acc, row) => {
        const item = row.days.find((entry) => entry.date === day.date);
          if (!item) return acc;
          if (item.arrival_time || item.departure_time) acc.present += 1;
          if (item.planned_arrival_time || item.planned_departure_time || item.planned_status) acc.planned += 1;
          if ((item.planned_arrival_time || item.planned_departure_time) && (!item.arrival_time || !item.departure_time)) acc.warning += 1;
          return acc;
        },
        { present: 0, planned: 0, warning: 0 },
      ),
    );
  }, [days, filteredRows]);

  async function reloadMonth() {
    if (!parsedMonth) return;
    setLoading(true);
    setError(null);
    try {
      const [matrix, settings] = await Promise.all([
        adminGetAttendanceMatrixMonth({ year: parsedMonth.year, month: parsedMonth.month }),
        adminGetSettings(),
      ]);
      setRows(matrix.rows);
      if (settings.afternoon_cutoff) setAfternoonCutoff(settings.afternoon_cutoff);
      setSelected((current) => {
        if (current && matrix.rows.some((row) => row.employment_id === current.employmentId)) return current;
        const first = matrix.rows.find((row) => row.is_active_in_month) ?? matrix.rows[0];
        return first ? { employmentId: first.employment_id, date: `${parsedMonth.year}-${pad2(parsedMonth.month)}-01` } : null;
      });
      setEditingCell(null);
      setContextMenu(null);
    } catch (err) {
      setError(errorMessage(err, "Evidence docházky se nepodařilo načíst."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reloadMonth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  useEffect(() => {
    setDraftArrival(selectedDay?.arrival_time ?? "");
    setDraftDeparture(selectedDay?.departure_time ?? "");
  }, [selectedDay]);

  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
        setEditingCell(null);
      }
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

  async function refreshOneRow(employmentId: number) {
    if (!parsedMonth) return;
    const response = await adminGetAttendanceMonth({ employmentId, year: parsedMonth.year, month: parsedMonth.month });
    setRows((prev) =>
      prev.map((row) =>
        row.employment_id === employmentId
          ? {
              ...row,
              locked: response.locked,
              days: response.days,
            }
          : row,
      ),
    );
  }

  async function saveSelectedDay() {
    if (!selectedRow || !selectedDay) return;
    const arrival = normalizeTime(draftArrival);
    const departure = normalizeTime(draftDeparture);
    if (!isValidTimeOrEmpty(arrival) || !isValidTimeOrEmpty(departure)) {
      setError("Čas zadejte například jako 08:30 nebo pole nechte prázdné.");
      return;
    }
    if (selectedRow.locked) {
      setError("Měsíc je uzamčený. Docházku pro tento úvazek nelze upravit.");
      return;
    }
    if (selectedDay.planned_status) {
      setError(`Do dne označeného jako ${planStatusLabel(selectedDay.planned_status)?.toLocaleUpperCase("cs-CZ")} nelze zapisovat docházku.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await adminUpsertAttendance({
        employment_id: selectedRow.employment_id,
        date: selectedDay.date,
        arrival_time: arrival ? arrival : null,
        departure_time: departure ? departure : null,
      });
      await refreshOneRow(selectedRow.employment_id);
      setSuccess("Docházka byla uložena.");
      setEditingCell(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : errorMessage(err, "Uložení se nezdařilo."));
    } finally {
      setSaving(false);
    }
  }

  async function setDayStatus(status: ShiftPlanDayStatus | null, cell: SelectedCell | null = selected) {
    if (!cell) return;
    const row = rows.find((item) => item.employment_id === cell.employmentId);
    const day = row?.days.find((item) => item.date === cell.date);
    if (!row || !day) return;
    setSaving(true);
    setError(null);
    setContextMenu(null);
    setSelected(cell);
    try {
      await adminUpsertDayStatus({ employment_id: row.employment_id, date: day.date, status });
      await refreshOneRow(row.employment_id);
      setEditingCell(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.body?.detail && typeof err.body.detail !== "string" && status) {
        const detail = err.body.detail as { attendance_exists?: boolean; shift_plan_exists?: boolean };
        setDayStatusDialog({
          employmentId: row.employment_id,
          date: day.date,
          status,
          attendanceExists: Boolean(detail.attendance_exists),
          shiftPlanExists: Boolean(detail.shift_plan_exists),
        });
        return;
      }
      setError(errorMessage(err, "Změna stavu dne se nezdařila."));
    } finally {
      setSaving(false);
    }
  }

  async function setMonthLock(cell: SelectedCell | null, nextLocked: boolean) {
    if (!cell || !parsedMonth) return;
    const row = rows.find((item) => item.employment_id === cell.employmentId);
    if (!row) return;
    setSaving(true);
    setError(null);
    setContextMenu(null);
    setSelected(cell);
    try {
      if (nextLocked) {
        await adminLockAttendance({ employment_id: row.employment_id, year: parsedMonth.year, month: parsedMonth.month });
      } else {
        await adminUnlockAttendance({ employment_id: row.employment_id, year: parsedMonth.year, month: parsedMonth.month });
      }
      await refreshOneRow(row.employment_id);
      setEditingCell(null);
      setSuccess(nextLocked ? "Měsíc byl uzamčen." : "Měsíc byl odemčen.");
    } catch (err) {
      setError(errorMessage(err, "Změna zámku se nezdařila."));
    } finally {
      setSaving(false);
    }
  }

  function openInlineEditor(row: AdminAttendanceMatrixRow, day: AdminAttendanceDay) {
    const cell = { employmentId: row.employment_id, date: day.date };
    setSelected(cell);
    setEditingCell(cell);
    setDraftArrival(day.arrival_time ?? "");
    setDraftDeparture(day.departure_time ?? "");
  }

  function openCellMenu(event: MouseEvent, row: AdminAttendanceMatrixRow, day: AdminAttendanceDay) {
    event.preventDefault();
    const cell = { employmentId: row.employment_id, date: day.date };
    setSelected(cell);
    setEditingCell(null);
    setContextMenu({ x: event.clientX, y: event.clientY, ...cell });
  }

  async function confirmDayStatusChange() {
    if (!dayStatusDialog) return;
    try {
      await adminUpsertDayStatus({
        employment_id: dayStatusDialog.employmentId,
        date: dayStatusDialog.date,
        status: dayStatusDialog.status,
        confirm_delete_conflicts: true,
      });
      setDayStatusDialog(null);
      await refreshOneRow(dayStatusDialog.employmentId);
    } catch (err) {
      setError(errorMessage(err, "Potvrzená změna stavu dne se nezdařila."));
    }
  }

  return (
    <div className="ops-page">
      <Breadcrumbs items={[{ label: "Administrace", to: "/admin/prehled" }, { label: "Docházka" }]} />
      <header className="ops-header">
        <div>
          <h1>Měsíční přehled docházky</h1>
          <p>Matice zobrazuje skutečný plán, docházku, absence a zámky podle employment_id.</p>
        </div>
        <div className="ops-actions">
          <NavLink className="ops-btn" to="/admin/export">Export</NavLink>
          <NavLink className="ops-btn" to="/admin/tisky">Tisk</NavLink>
          <NavLink className="ops-btn" to="/admin/settings">Nastavení</NavLink>
        </div>
      </header>

      <section className="ops-stat-strip" aria-label="Souhrn aktuálního filtru">
        <div><span>Zaměstnanci</span><strong>{filteredRows.length}</strong></div>
        <div><span>Odpracováno</span><strong>{formatHours(monthStats.workedMins)} h</strong></div>
        <div><span>Plán</span><strong>{formatHours(monthStats.plannedMins)} h</strong></div>
        <div><span>Saldo</span><strong>{formatHours(monthStats.workedMins - monthStats.plannedMins)} h</strong></div>
        <div><span>Upozornění</span><strong>{monthStats.warningDays}</strong></div>
        <div><span>Zámky</span><strong>{monthStats.lockedRows}</strong></div>
      </section>

      <section className="ops-toolbar" aria-label="Filtry měsíčního přehledu">
        <Button type="button" variant="ghost" size="sm" onClick={() => setMonth((value) => addMonths(value, -1))}>Předchozí</Button>
        <input className="ops-input ops-input--month" type="month" value={month} onChange={(event) => setMonth(event.target.value)} aria-label="Měsíc docházky" />
        <Button type="button" variant="ghost" size="sm" onClick={() => setMonth((value) => addMonths(value, 1))}>Další</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setMonth(yyyyMm(new Date()))}>Dnes</Button>
        <label className="ops-select-field">
          <span>Typ úvazku</span>
          <select className="ops-input" value={employmentTypeFilter} onChange={(event) => setEmploymentTypeFilter(event.target.value as EmploymentTypeFilter)}>
            <option value="all">Všechny úvazky</option>
            <option value="HPP">HPP</option>
            <option value="DPP_DPC">DPP / DPČ</option>
          </select>
        </label>
        <label className="ops-select-field">
          <span>Stav</span>
          <select className="ops-input" value={stateFilter} onChange={(event) => setStateFilter(event.target.value as AttendanceStateFilter)}>
            <option value="all">Všechny stavy</option>
            <option value="present">Přítomnost</option>
            <option value="planned">Plán směny</option>
            <option value="warning">Chyba / upozornění</option>
            <option value="holiday">Dovolená</option>
            <option value="off">Volno</option>
            <option value="locked">Uzamčeno</option>
          </select>
        </label>
        <input className="ops-input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Hledat zaměstnance, úvazek nebo ID" aria-label="Hledat zaměstnance" />
        <label className="ops-check">
          <input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />
          <span>Včetně neaktivních</span>
        </label>
      </section>

      <div className="ops-legend" aria-label="Legenda">
        <span><i className="ops-dot ops-dot--present" />Přítomen</span>
        <span><i className="ops-dot ops-dot--planned" />Jen plán</span>
        <span><i className="ops-dot ops-dot--holiday" />Dovolená</span>
        <span><i className="ops-dot ops-dot--off" />Volno</span>
        <span><i className="ops-dot ops-dot--warning" />Chybí průchod</span>
        <span><i className="ops-dot ops-dot--locked" />Uzamčeno</span>
      </div>

      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
      {success ? <InlineNotice tone="ok">{success}</InlineNotice> : null}
      {loading ? <InlineNotice>Načítám měsíční přehled…</InlineNotice> : null}

      <div className="ops-workspace">
        <aside className="ops-employee-panel" aria-label="Zaměstnanci">
          <div className="ops-panel-title">Zaměstnanci <span>{filteredRows.length}</span></div>
          <div className="ops-employee-list">
            {filteredRows.map((row, index) => (
              <button
                key={row.employment_id}
                type="button"
                className={`ops-employee-row${selectedRow?.employment_id === row.employment_id ? " is-selected" : ""}`}
                onClick={() => setSelected({ employmentId: row.employment_id, date: selectedDay?.date ?? days[0]?.date ?? "" })}
              >
                <span className="ops-index">{index + 1}</span>
                <span className="ops-avatar" aria-hidden="true">{row.user_name.slice(0, 2).toLocaleUpperCase("cs-CZ")}</span>
                <span>
                  <strong>{row.user_name}</strong>
                  <small>{row.employment_title} · ID {row.employment_id}</small>
                </span>
              </button>
            ))}
            {!loading && filteredRows.length === 0 ? <EmptyState title="Žádní zaměstnanci" description="Filtr neodpovídá žádnému úvazku v měsíci." /> : null}
          </div>
        </aside>

        <main className="ops-main-matrix">
          <div className="ops-table-wrap" tabIndex={0} aria-label="Měsíční matice docházky s horizontálním posunem">
            <table className="ops-matrix">
              <thead>
                <tr>
                  <th className="ops-sticky-col ops-sticky-col--compact">Řádek</th>
                  {days.map((day) => (
                    <th key={day.date} className={`${day.isWeekend || day.holidayName ? "is-weekend" : ""}${day.date === today ? " is-today" : ""}`}>
                      <span>{day.number}</span>
                      <small>{day.weekday}</small>
                    </th>
                  ))}
                  <th className="ops-summary-col">Odpracováno</th>
                  <th className="ops-summary-col">Plán</th>
                  <th className="ops-summary-col">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, rowIndex) => {
                  const stats = computeMonthStats(row.days, row.employment_type, cutoffMinutes);
                  const plannedMins = row.days.reduce((acc, day) => {
                    const calc = computeDayCalc({ date: day.date, arrival_time: day.planned_arrival_time ?? null, departure_time: day.planned_departure_time ?? null, planned_status: day.planned_status }, row.employment_type, cutoffMinutes);
                    return acc + (calc.workedMins ?? 0) + (day.planned_status === "HOLIDAY" ? 8 * 60 : 0);
                  }, 0);
                  const saldo = stats.totalMins - plannedMins;
                  return (
                    <tr key={row.employment_id}>
                      <th className="ops-sticky-col ops-name-head ops-name-head--compact" scope="row" aria-label={`${row.user_name}, ${employmentTemplateLabel(row.employment_type)}, ${row.employment_title}`}>
                        <strong>{rowIndex + 1}</strong>
                        <small>{row.locked ? "Zámek" : employmentTemplateLabel(row.employment_type)}</small>
                        {row.locked ? <span className="ops-lock">Zámek</span> : null}
                      </th>
                      {days.map((day) => {
                        const item = row.days.find((entry) => entry.date === day.date);
                        if (!item) return <td key={day.date} />;
                        const selectedCell = selected?.employmentId === row.employment_id && selected.date === day.date;
                        const isEditing = editingCell?.employmentId === row.employment_id && editingCell.date === day.date;
                        return (
                          <td key={day.date} className={`${cellTone(item)}${day.date === today ? " is-today" : ""}${selectedCell ? " is-selected" : ""}`}>
                            {isEditing ? (
                              <form
                                className="ops-inline-editor"
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  void saveSelectedDay();
                                }}
                                onContextMenu={(event) => openCellMenu(event, row, item)}
                              >
                                <span className="ops-shift">{shiftAbbrev(item)}</span>
                                <input
                                  className="ops-cell-input"
                                  value={draftArrival}
                                  inputMode="numeric"
                                  placeholder={timeFieldPlaceholder()}
                                  aria-label={`${row.user_name}, ${formatIsoDateForDisplay(day.date)}, příchod`}
                                  disabled={saving || row.locked || Boolean(item.planned_status)}
                                  onChange={(event) => setDraftArrival(event.target.value)}
                                />
                                <input
                                  className="ops-cell-input"
                                  value={draftDeparture}
                                  inputMode="numeric"
                                  placeholder={timeFieldPlaceholder()}
                                  aria-label={`${row.user_name}, ${formatIsoDateForDisplay(day.date)}, odchod`}
                                  disabled={saving || row.locked || Boolean(item.planned_status)}
                                  onChange={(event) => setDraftDeparture(event.target.value)}
                                />
                                <div className="ops-cell-actions">
                                  <button type="submit" disabled={saving || row.locked || Boolean(item.planned_status)} aria-label="Uložit docházku v buňce">
                                    Uložit
                                  </button>
                                  <button type="button" onClick={() => setEditingCell(null)} aria-label="Zavřít editaci buňky">
                                    ×
                                  </button>
                                </div>
                              </form>
                            ) : (
                              <button
                                type="button"
                                className="ops-cell-btn"
                                onClick={() => openInlineEditor(row, item)}
                                onContextMenu={(event) => openCellMenu(event, row, item)}
                                aria-label={`${row.user_name}, ${formatIsoDateForDisplay(day.date)}, plán ${shiftAbbrev(item)}, skutečnost ${item.arrival_time ?? "bez příchodu"} až ${item.departure_time ?? "bez odchodu"}`}
                              >
                                <span className="ops-shift">{shiftAbbrev(item)}</span>
                                <span className="ops-times">
                                  {item.planned_status ? planStatusInputPlaceholder(item.planned_status) : item.arrival_time || item.departure_time ? `${item.arrival_time ?? "—"} ${item.departure_time ?? "—"}` : item.planned_arrival_time || item.planned_departure_time ? `${item.planned_arrival_time ?? "—"} ${item.planned_departure_time ?? "—"}` : "—"}
                                </span>
                                {row.locked ? <span className="ops-cell-lock" aria-label="Uzamčeno">▣</span> : null}
                              </button>
                            )}
                          </td>
                        );
                      })}
                      <td className="ops-summary-col">{formatHours(stats.totalMins)} h</td>
                      <td className="ops-summary-col">{formatHours(plannedMins)} h</td>
                      <td className={`ops-summary-col${saldo < 0 ? " is-negative" : saldo > 0 ? " is-positive" : ""}`}>{saldo === 0 ? "0.0 h" : `${saldo > 0 ? "+" : ""}${formatHours(saldo)} h`}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th className="ops-sticky-col ops-sticky-col--compact">Přítomno</th>
                  {dailyCoverage.map((count, index) => <td key={days[index]?.date ?? index}>{count.present}</td>)}
                  <td className="ops-summary-col">{formatHours(monthStats.workedMins)} h</td>
                  <td className="ops-summary-col">{formatHours(monthStats.plannedMins)} h</td>
                  <td className="ops-summary-col">{formatHours(monthStats.workedMins - monthStats.plannedMins)} h</td>
                </tr>
                <tr>
                  <th className="ops-sticky-col ops-sticky-col--compact">Plán / var.</th>
                  {dailyCoverage.map((count, index) => <td key={`warn-${days[index]?.date ?? index}`}>{count.planned}/{count.warning}</td>)}
                  <td className="ops-summary-col">{monthStats.presentDays} dnů</td>
                  <td className="ops-summary-col">{monthStats.plannedDays} dnů</td>
                  <td className="ops-summary-col">{monthStats.warningDays} chyb</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </main>
      </div>

      {contextMenu ? (
        <div className="ops-context-menu" style={{ top: contextMenu.y, left: contextMenu.x }} role="menu" aria-label="Celodenní nepřítomnost">
          <button type="button" role="menuitem" disabled={saving} onClick={() => void setDayStatus("HOLIDAY", contextMenu)}>
            Označit DOVOLENÁ
          </button>
          <button type="button" role="menuitem" disabled={saving} onClick={() => void setDayStatus("OFF", contextMenu)}>
            Označit VOLNO
          </button>
          <button type="button" role="menuitem" disabled={saving} onClick={() => void setDayStatus(null, contextMenu)}>
            Zrušit stav dne
          </button>
          {(() => {
            const row = rows.find((item) => item.employment_id === contextMenu.employmentId);
            return row ? (
              <button type="button" role="menuitem" disabled={saving} onClick={() => void setMonthLock(contextMenu, !row.locked)}>
                {row.locked ? "Odemknout měsíc" : "Uzamknout měsíc"}
              </button>
            ) : null;
          })()}
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
          if (selectedRow) void refreshOneRow(selectedRow.employment_id);
        }}
      />
    </div>
  );
}
