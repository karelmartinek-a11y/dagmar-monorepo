import { KeyboardEvent, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Lock, Save, Unlock } from "lucide-react";
import { api, ApiError } from "../api/client";
import type { AttendanceMatrixRow } from "../api/types";
import { Button, Field, Modal, Panel, StatusMessage } from "../components/Primitives";
import { MonthControl } from "../components/MonthControl";
import { asPragueDate, getCalendarDayTone, getHolidayLabel, getWeekdayLongLabel } from "../utils/calendar";
import { formatHours, normalizeMinutes } from "../utils/timeMath";
import { normalizeTimeInput } from "../utils/timeInput";

type AttendanceEditState = { employmentId: number; date: string };
type ShiftPlanDay = { date: string; arrival_time: string | null; departure_time: string | null; status: string | null; is_within_employment_period: boolean };
type ShiftPlanRow = { employment_id: number; user_id: number; user_name: string; title: string; employment_type: string; display_label: string; start_date: string; end_date: string | null; is_active_in_month: boolean; employee_plan_edit_allowed: boolean; employee_plan_edit_override: boolean | null; days: ShiftPlanDay[] };
type ActiveEmployment = { id: number; display_label: string; employment_type: string; start_date: string; end_date: string | null; is_active_in_month: boolean };
type PlanMonth = { year: number; month: number; employee_plan_edit_default: boolean; selected_employment_ids: number[]; available_employments: ActiveEmployment[]; rows: ShiftPlanRow[] };
type DayStatusDraft = { employment_id: number; date: string; status: string | null; confirm_delete_conflicts?: boolean };

const statusLabels: Record<string, string> = { HOLIDAY: "Dovolená", OFF: "Volno" };

function rowSummaryLabel(row: { user_name: string; employment_type: string; employment_label?: string; display_label?: string; employment_title?: string }) {
  const secondary = row.employment_title ? `${row.employment_title} · ${row.employment_type}` : row.employment_type;
  return <div className="matrix-user"><strong>{row.user_name}</strong><small>{row.display_label ?? row.employment_label}</small><span>{secondary}</span></div>;
}

function dayHeader(day: { date: string }) {
  const date = asPragueDate(day.date);
  const tone = getCalendarDayTone(date);
  return { date, tone, weekday: getWeekdayLongLabel(date), holiday: getHolidayLabel(date) };
}

function employmentCalendarMinutes(days: Array<{ date: string; is_within_employment_period: boolean }>): number {
  return days.reduce((total, day) => {
    const date = asPragueDate(day.date);
    return day.is_within_employment_period && getCalendarDayTone(date) === "work" ? total + 8 * 60 : total;
  }, 0);
}

function ShiftPlanSummaryCell({ row }: { row: ShiftPlanRow }) {
  const plannedMinutes = row.days.reduce((total, day) => total + normalizeMinutes(day.arrival_time, day.departure_time), 0);
  const holidayDays = row.days.filter((day) => day.status === "HOLIDAY").length;
  const calendarMinutes = employmentCalendarMinutes(row.days);
  return <div className="matrix-total"><strong>{formatHours(plannedMinutes)}</strong><small>Plán</small><span>{formatHours(calendarMinutes)} kalendář</span><span>{holidayDays} d dovolené</span></div>;
}

function EmployeePlanEditControl({ row, pending, onToggle }: { row: ShiftPlanRow; pending: boolean; onToggle: (row: ShiftPlanRow) => void }) {
  return <div className="matrix-user__actions">
    <span className={`badge ${row.employee_plan_edit_allowed ? "badge--good" : "badge--warn"}`}>{row.employee_plan_edit_allowed ? "Plán povolen" : "Plán zakázán"}</span>
    <Button variant="quiet" className="matrix-user__lock" disabled={pending} onClick={() => onToggle(row)}>{row.employee_plan_edit_allowed ? <Lock /> : <Unlock />}{row.employee_plan_edit_allowed ? "Zakázat plán" : "Povolit plán"}</Button>
    {row.employee_plan_edit_override !== null && <small>Individuální pravidlo</small>}
  </div>;
}

function TimeRangeEditor({
  initialArrival,
  initialDeparture,
  disabled,
  onCancel,
  onSave,
}: {
  initialArrival: string | null;
  initialDeparture: string | null;
  disabled: boolean;
  onCancel: () => void;
  onSave: (draft: { arrival_time: string | null; departure_time: string | null }) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [arrival, setArrival] = useState(initialArrival ?? "");
  const [departure, setDeparture] = useState(initialDeparture ?? "");
  const [invalidField, setInvalidField] = useState<"arrival" | "departure" | null>(null);

  const commit = () => {
    const normalizedArrival = normalizeTimeInput(arrival);
    if (normalizedArrival === null) {
      setInvalidField("arrival");
      return false;
    }
    const normalizedDeparture = normalizeTimeInput(departure);
    if (normalizedDeparture === null) {
      setInvalidField("departure");
      return false;
    }
    setInvalidField(null);
    onSave({
      arrival_time: normalizedArrival || null,
      departure_time: normalizedDeparture || null,
    });
    return true;
  };

  const finish = () => {
    if (commit()) onCancel();
  };

  const onBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (wrapperRef.current?.contains(event.relatedTarget as Node | null)) return;
    if (disabled) {
      onCancel();
      return;
    }
    finish();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    finish();
  };

  return <div ref={wrapperRef} className="matrix-editor" onBlur={onBlur}>
    <input autoFocus inputMode="numeric" className={invalidField === "arrival" ? "matrix-editor__input matrix-editor__input--invalid" : "matrix-editor__input"} disabled={disabled} placeholder="0:00" value={arrival} onChange={(event) => setArrival(event.target.value)} onKeyDown={onKeyDown} />
    <input inputMode="numeric" className={invalidField === "departure" ? "matrix-editor__input matrix-editor__input--invalid" : "matrix-editor__input"} disabled={disabled} placeholder="0:00" value={departure} onChange={(event) => setDeparture(event.target.value)} onKeyDown={onKeyDown} />
  </div>;
}

function EmploymentSelectionDropdown({
  items,
  selectedIds,
  onToggle,
  onSave,
  pending,
}: {
  items: ActiveEmployment[];
  selectedIds: number[];
  onToggle: (employmentId: number, checked: boolean) => void;
  onSave: () => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  return <div className="selection-dropdown">
    <button type="button" className="selection-dropdown__trigger" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
      <span>{selectedIds.length} úvazků ve výběru</span>
      <ChevronDown />
    </button>
    {open && <div className="selection-dropdown__menu">
      <div className="selection-dropdown__list">
        {items.map((item) => <label key={item.id} className="selection-dropdown__item">
          <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={(event) => onToggle(item.id, event.target.checked)} />
          <span>
            <strong>{item.display_label}</strong>
            <small>{item.employment_type} · {item.start_date} — {item.end_date ?? "bez konce"}</small>
          </span>
          {selectedIds.includes(item.id) && <Check />}
        </label>)}
      </div>
      <div className="selection-dropdown__footer">
        <Button variant="quiet" onClick={() => setOpen(false)}>Zavřít</Button>
        <Button disabled={pending} onClick={() => { onSave(); setOpen(false); }}><Save />Uložit výběr</Button>
      </div>
    </div>}
  </div>;
}

export function AdminAttendancePage() {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<AttendanceEditState | null>(null);
  const [lockTarget, setLockTarget] = useState<AttendanceMatrixRow | null>(null);
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["admin-attendance", month.getFullYear(), month.getMonth() + 1], queryFn: () => api.admin<{ year: number; month: number; rows: AttendanceMatrixRow[] }>(`/api/v1/admin/attendance/month?year=${month.getFullYear()}&month=${month.getMonth() + 1}`) });
  const attendanceMutation = useMutation({
    mutationFn: (body: { employment_id: number; date: string; arrival_time: string | null; departure_time: string | null }) => api.admin("/api/v1/admin/attendance", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-attendance"] });
      setEditing(null);
    },
  });
  const lockMutation = useMutation({
    mutationFn: (body: { employment_id: number; year: number; month: number; locked: boolean }) => api.admin(`/api/v1/admin/attendance/${body.locked ? "unlock" : "lock"}`, { method: "POST", body: JSON.stringify({ employment_id: body.employment_id, year: body.year, month: body.month }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-attendance"] });
      setLockTarget(null);
    },
  });

  const rows = useMemo(() => (query.data?.rows ?? []).filter((row) => `${row.user_name} ${row.employment_label}`.toLowerCase().includes(search.toLowerCase())), [query.data?.rows, search]);
  const days = rows[0]?.days ?? query.data?.rows[0]?.days ?? [];

  return <div className="page">
    <header className="page-heading"><div><p>Kontrola skutečně odpracovaného času</p><h1>Docházkové listy</h1></div><MonthControl value={month} onChange={setMonth} /></header>
    <Panel>
      <div className="toolbar">
        <Field label="Filtrovat úvazky"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Jméno nebo úvazek" /></Field>
        <span className="badge">{rows.length} úvazků</span>
      </div>
      {query.isPending ? <div className="panel-body"><StatusMessage kind="loading" title="Sestavuji měsíční matici" /></div> : query.error ? <div className="panel-body"><StatusMessage kind="error" title="Docházku nelze načíst">{query.error.message}</StatusMessage></div> : rows.length === 0 ? <div className="panel-body"><StatusMessage kind="empty" title="Pro filtr nejsou žádné úvazky" /></div> : <div className="data-table-wrap"><table className="data-table matrix matrix--calendar"><thead><tr><th className="matrix__sticky-left">Zaměstnanec / úvazek</th>{days.map((day) => { const header = dayHeader(day); return <th key={day.date} className={`matrix__day-head matrix__day-head--${header.tone}`}><strong>{header.date.getDate()}.</strong><span>{header.weekday}</span>{header.holiday && <small>{header.holiday}</small>}</th>; })}</tr></thead><tbody>{rows.map((row) => <tr key={row.employment_id} className={row.is_active_in_month ? "" : "inactive"}><td className="matrix__sticky-left">{rowSummaryLabel(row)}<div className="matrix-user__actions"><span className={`badge ${row.locked ? "badge--warn" : "badge--good"}`}>{row.locked ? "Uzamčeno" : "Otevřeno"}</span><Button variant="quiet" className="matrix-user__lock" onClick={() => setLockTarget(row)}>{row.locked ? <Unlock /> : <Lock />}{row.locked ? "Odemknout" : "Uzamknout"}</Button></div></td>{row.days.map((day) => { const isEditing = editing?.employmentId === row.employment_id && editing.date === day.date; const disabled = row.locked || !day.is_within_employment_period || Boolean(day.planned_status); return <td key={day.date} className={`day-cell day-cell--${getCalendarDayTone(asPragueDate(day.date))} ${disabled ? "day-cell--readonly" : ""}`}>{isEditing ? <TimeRangeEditor initialArrival={day.arrival_time} initialDeparture={day.departure_time} disabled={disabled || attendanceMutation.isPending} onCancel={() => setEditing(null)} onSave={(draft) => attendanceMutation.mutate({ employment_id: row.employment_id, date: day.date, ...draft })} /> : <button type="button" className="day-cell__button" disabled={disabled} onClick={() => !disabled && setEditing({ employmentId: row.employment_id, date: day.date })}><strong>{day.arrival_time ?? "–"}</strong><span>{day.departure_time ?? "–"}</span>{day.planned_status && <small>{statusLabels[day.planned_status] ?? day.planned_status}</small>}</button>}</td>; })}</tr>)}</tbody></table></div>}
    </Panel>
    {(attendanceMutation.error || lockMutation.error) && <StatusMessage kind="error" title="Operaci nelze dokončit">{(attendanceMutation.error ?? lockMutation.error)?.message}</StatusMessage>}
    {lockTarget && <Modal title={lockTarget.locked ? "Odemknout měsíc?" : "Uzamknout měsíc?"} description={`${lockTarget.employment_label} · ${month.getMonth() + 1}/${month.getFullYear()}. ${lockTarget.locked ? "Po odemknutí bude možné záznamy měnit." : "Po uzamčení budou záznamy pouze pro čtení."}`} confirmLabel={lockTarget.locked ? "Odemknout" : "Uzamknout"} onClose={() => setLockTarget(null)} onConfirm={() => lockMutation.mutate({ employment_id: lockTarget.employment_id, year: month.getFullYear(), month: month.getMonth() + 1, locked: lockTarget.locked })} />}
  </div>;
}

export function AdminShiftPlanPage() {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selection, setSelection] = useState<number[] | null>(null);
  const [editing, setEditing] = useState<AttendanceEditState | null>(null);
  const [statusMenu, setStatusMenu] = useState<AttendanceEditState | null>(null);
  const [conflict, setConflict] = useState<DayStatusDraft | null>(null);
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["shift-plan", month.getFullYear(), month.getMonth() + 1], queryFn: () => api.admin<PlanMonth>(`/api/v1/admin/shift-plan?year=${month.getFullYear()}&month=${month.getMonth() + 1}`) });
  const timeMutation = useMutation({
    mutationFn: (body: { employment_id: number; date: string; arrival_time: string | null; departure_time: string | null }) => api.admin("/api/v1/admin/shift-plan", { method: "PUT", body: JSON.stringify({ ...body, status: null }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shift-plan"] });
      setEditing(null);
    },
  });
  const statusMutation = useMutation({
    mutationFn: (body: DayStatusDraft) => api.admin("/api/v1/admin/day-status", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shift-plan"] });
      setStatusMenu(null);
      setConflict(null);
    },
    onError: (error, body) => {
      if (error instanceof ApiError && error.conflict && !body.confirm_delete_conflicts) {
        setConflict(body);
      }
    },
  });
  const selectionMutation = useMutation({
    mutationFn: (employmentIds: number[]) => api.admin("/api/v1/admin/shift-plan/selection", { method: "PUT", body: JSON.stringify({ year: month.getFullYear(), month: month.getMonth() + 1, employment_ids: employmentIds }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shift-plan"] });
      setSelection(null);
    },
  });
  const editPermissionMutation = useMutation({
    mutationFn: (body: { employment_id?: number; allow_employee_edits: boolean }) => api.admin("/api/v1/admin/shift-plan/edit-permission", { method: "PUT", body: JSON.stringify({ year: month.getFullYear(), month: month.getMonth() + 1, ...body }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shift-plan"] }),
  });

  const activeSelection = useMemo(() => selection ?? query.data?.selected_employment_ids ?? [], [query.data?.selected_employment_ids, selection]);
  const rows = useMemo(() => (query.data?.rows ?? []).filter((row) => activeSelection.includes(row.employment_id)), [activeSelection, query.data?.rows]);
  const days = query.data?.rows[0]?.days ?? [];
  const toggle = (employmentId: number, checked: boolean) => setSelection((current) => {
    const baseline = current ?? query.data?.selected_employment_ids ?? [];
    return checked ? [...baseline, employmentId] : baseline.filter((item) => item !== employmentId);
  });

  return <div className="page">
    <header className="page-heading"><div><p>Budoucí kapacita a stav dne</p><h1>Plán služeb</h1></div><MonthControl value={month} onChange={(value) => { setMonth(value); setSelection(null); setEditing(null); setStatusMenu(null); }} /></header>
    {query.data && <Panel title="Výběr úvazků pro zobrazení" actions={<EmploymentSelectionDropdown items={query.data.available_employments} selectedIds={activeSelection} onToggle={toggle} onSave={() => selectionMutation.mutate(activeSelection)} pending={selectionMutation.isPending} />}>
      <div className="panel-body panel-body--compact">
        <p className="panel-note">Vybraný seznam se po uložení zachová i při dalším přihlášení na jiném zařízení.</p>
      </div>
    </Panel>}
    {query.data && <Panel title="Zaměstnanecké zadávání plánu" actions={<Button variant={query.data.employee_plan_edit_default ? "danger" : "quiet"} disabled={editPermissionMutation.isPending} onClick={() => editPermissionMutation.mutate({ allow_employee_edits: !query.data!.employee_plan_edit_default })}>{query.data.employee_plan_edit_default ? <Lock /> : <Unlock />}{query.data.employee_plan_edit_default ? "Zakázat všem" : "Povolit všem"}</Button>}>
      <div className="panel-body panel-body--compact">
        <p className="panel-note">Globální pravidlo platí pro celý měsíc. Individuální přepínač u úvazku níže může konkrétnímu zaměstnanci plán povolit nebo zakázat samostatně.</p>
      </div>
    </Panel>}
    <Panel>
      {query.isPending ? <div className="panel-body"><StatusMessage kind="loading" title="Načítám plán služeb" /></div> : query.error ? <div className="panel-body"><StatusMessage kind="error" title="Plán nelze načíst">{query.error.message}</StatusMessage></div> : rows.length === 0 ? <div className="panel-body"><StatusMessage kind="empty" title="Pro tento měsíc není vybrán žádný úvazek">Vyberte alespoň jeden úvazek v dropdownu nad maticí.</StatusMessage></div> : <div className="data-table-wrap"><table className="data-table matrix matrix--calendar matrix--with-tail"><thead><tr><th className="matrix__sticky-left">Zaměstnanec / úvazek</th>{days.map((day) => { const header = dayHeader(day); return <th key={day.date} className={`matrix__day-head matrix__day-head--${header.tone}`}><strong>{header.date.getDate()}.</strong><span>{header.weekday}</span>{header.holiday && <small>{header.holiday}</small>}</th>; })}<th className="matrix__summary-head">Součet</th><th className="matrix__sticky-right">Zaměstnanec / úvazek</th></tr></thead><tbody>{rows.map((row) => <tr key={row.employment_id} className={row.is_active_in_month ? "" : "inactive"}><td className="matrix__sticky-left">{rowSummaryLabel(row)}<EmployeePlanEditControl row={row} pending={editPermissionMutation.isPending} onToggle={(item) => editPermissionMutation.mutate({ employment_id: item.employment_id, allow_employee_edits: !item.employee_plan_edit_allowed })} /></td>{row.days.map((day) => { const isEditing = editing?.employmentId === row.employment_id && editing.date === day.date; const menuOpen = statusMenu?.employmentId === row.employment_id && statusMenu.date === day.date; const disabled = !day.is_within_employment_period; return <td key={day.date} className={`day-cell day-cell--${getCalendarDayTone(asPragueDate(day.date))} ${disabled ? "day-cell--readonly" : ""}`} onContextMenu={(event) => { if (disabled) return; event.preventDefault(); setStatusMenu({ employmentId: row.employment_id, date: day.date }); setEditing(null); }}>{isEditing ? <TimeRangeEditor initialArrival={day.arrival_time} initialDeparture={day.departure_time} disabled={disabled || timeMutation.isPending} onCancel={() => setEditing(null)} onSave={(draft) => timeMutation.mutate({ employment_id: row.employment_id, date: day.date, ...draft })} /> : <button type="button" className="day-cell__button" disabled={disabled} onClick={() => { if (disabled) return; setEditing({ employmentId: row.employment_id, date: day.date }); setStatusMenu(null); }}><strong>{day.arrival_time ?? "–"}</strong><span>{day.departure_time ?? "–"}</span>{day.status && <small>{statusLabels[day.status] ?? day.status}</small>}</button>}{menuOpen && <div className="matrix-menu"><button type="button" onClick={() => statusMutation.mutate({ employment_id: row.employment_id, date: day.date, status: null })}>Pracovní den</button><button type="button" onClick={() => statusMutation.mutate({ employment_id: row.employment_id, date: day.date, status: "HOLIDAY" })}>Dovolená</button><button type="button" onClick={() => statusMutation.mutate({ employment_id: row.employment_id, date: day.date, status: "OFF" })}>Volno</button></div>}</td>; })}<td className="matrix__summary"><ShiftPlanSummaryCell row={row} /></td><td className="matrix__sticky-right">{rowSummaryLabel(row)}<EmployeePlanEditControl row={row} pending={editPermissionMutation.isPending} onToggle={(item) => editPermissionMutation.mutate({ employment_id: item.employment_id, allow_employee_edits: !item.employee_plan_edit_allowed })} /></td></tr>)}</tbody></table></div>}
    </Panel>
    {(timeMutation.error || selectionMutation.error || statusMutation.error || editPermissionMutation.error) && !conflict && <StatusMessage kind="error" title="Plán nelze uložit">{(timeMutation.error ?? selectionMutation.error ?? statusMutation.error ?? editPermissionMutation.error)?.message}</StatusMessage>}
    {conflict && <Modal title="Nahradit existující údaje stavem dne?" description="Zvolený celodenní stav je v konfliktu s evidovanou docházkou nebo časovým plánem. Potvrzením budou konfliktní hodnoty odstraněny." confirmLabel="Nahradit údaje" danger onClose={() => setConflict(null)} onConfirm={() => statusMutation.mutate({ ...conflict, confirm_delete_conflicts: true })} />}
  </div>;
}
