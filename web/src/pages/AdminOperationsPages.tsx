import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, KeyRound, Plus, Power, Printer, RefreshCw, Save, ShieldOff } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { AdminUser } from "../api/types";
import { Button, Field, Modal, Panel, StatusMessage } from "../components/Primitives";
import { asPragueDate, getCalendarDayTone, getWeekdayLongLabel } from "../utils/calendar";
import { formatHours, normalizeMinutes } from "../utils/timeMath";

type AdminAttendanceResponse = Awaited<ReturnType<typeof loadAttendanceMonth>>;
type AdminShiftPlanResponse = Awaited<ReturnType<typeof loadShiftPlanMonth>>;

type Settings = { afternoon_cutoff: string };
type Smtp = { host: string | null; port: number | null; security: string | null; username: string | null; from_email: string | null; from_name: string | null; password_set: boolean };
type IntegrationOptions = { scopes: Array<{ id: string; label: string; description: string; available: boolean }>; data_scope_modes: Array<{ id: string; label: string; description?: string; supports_inactive_toggle?: boolean }>; employees: Array<{ id: number; label: string }>; employments: Array<{ id: number; label: string }>; ip_restriction_modes: Array<{ id: string; label: string; editable: boolean }>; expiration_options: Array<{ id: string; label: string; requires_custom_date?: boolean }> };
type IntegrationOperation = { title?: string; description?: string; path: string; method?: "POST" | "PUT"; body?: unknown };

function loadAttendanceMonth(year: number, month: number) {
  return api.admin<{ year: number; month: number; rows: Array<{ employment_id: number; user_name: string; employment_label: string; employment_title: string; employment_type: string; locked: boolean; days: Array<{ date: string; arrival_time: string | null; departure_time: string | null; planned_arrival_time: string | null; planned_departure_time: string | null; planned_status: string | null }> }> }>(`/api/v1/admin/attendance/month?year=${year}&month=${month}`);
}

function loadShiftPlanMonth(year: number, month: number) {
  return api.admin<{ year: number; month: number; selected_employment_ids: number[]; rows: Array<{ employment_id: number; user_id: number; user_name: string; title: string; employment_type: string; display_label: string; days: Array<{ date: string; arrival_time: string | null; departure_time: string | null; status: string | null }> }> }>(`/api/v1/admin/shift-plan?year=${year}&month=${month}`);
}

function monthParts(month: string): [number, number] {
  const [year, monthNumber] = month.split("-").map(Number);
  return [year, monthNumber];
}

function isAfternoonShift(start: string | null, cutoff: string): boolean {
  if (!start) return false;
  return start >= cutoff;
}

function printSummaryRows(attendance: AdminAttendanceResponse["rows"], shiftPlan: AdminShiftPlanResponse["rows"], cutoff: string) {
  const shiftPlanByEmployment = new Map(shiftPlan.map((row) => [row.employment_id, row]));
  return attendance.map((row) => {
    const planRow = shiftPlanByEmployment.get(row.employment_id);
    const plannedMinutes = (planRow?.days ?? []).reduce((total, day) => total + normalizeMinutes(day.arrival_time, day.departure_time), 0);
    const actualMinutes = row.days.reduce((total, day) => total + normalizeMinutes(day.arrival_time, day.departure_time), 0);
    const holidayDays = (planRow?.days ?? []).filter((day) => day.status === "HOLIDAY").length;
    const offDays = (planRow?.days ?? []).filter((day) => day.status === "OFF").length;
    const afternoonShifts = (planRow?.days ?? []).filter((day) => isAfternoonShift(day.arrival_time, cutoff)).length;
    const filledDays = row.days.filter((day) => day.arrival_time || day.departure_time).length;
    return {
      employment_id: row.employment_id,
      user_name: row.user_name,
      label: row.employment_label,
      plannedMinutes,
      actualMinutes,
      holidayDays,
      offDays,
      afternoonShifts,
      filledDays,
      days: row.days,
      planDays: planRow?.days ?? [],
    };
  });
}

function filteredEmployments(users: AdminUser[]) {
  return users.flatMap((user) => (user.employments ?? []).map((employment) => ({ ...employment, user_name: user.name })));
}

export function AdminExportPage() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [employment, setEmployment] = useState("");
  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => api.admin<{ users: AdminUser[] }>("/api/v1/admin/users") });
  const employments = filteredEmployments(users.data?.users ?? []);
  const href = employment ? `/api/v1/admin/export?month=${month}&employment_id=${employment}` : `/api/v1/admin/export?month=${month}&bulk=true`;
  return <div className="page"><header className="page-heading"><div><p>Podklady pro mzdy a archivaci</p><h1>Export docházky</h1></div></header><div className="split"><Panel title="Parametry exportu"><div className="panel-body form-grid"><Field label="Měsíc"><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field><Field label="Rozsah"><select value={employment} onChange={(e) => setEmployment(e.target.value)}><option value="">Všechny relevantní úvazky · ZIP</option>{employments.map((item) => <option key={item.id} value={item.id}>{item.user_name} · {item.title} · {item.employment_type}</option>)}</select></Field><div className="full action-row"><a className="button button--primary" href={href}><Download />Stáhnout {employment ? "CSV" : "ZIP"}</a></div></div></Panel><Panel title="Co soubor obsahuje"><ul className="list"><li><span>Datová vazba</span><strong>employment_id</strong></li><li><span>Časový rozsah</span><strong>{month}</strong></li><li><span>Sloupce</span><strong>docházka · plán · stav</strong></li><li><span>Kódování</span><strong>UTF-8</strong></li></ul></Panel></div></div>;
}

export function AdminPrintsPage() {
  const navigate = useNavigate();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [kind, setKind] = useState<"summary" | "detail">("summary");
  const [scope, setScope] = useState<"all" | "selected">("all");
  const [selectedEmploymentIds, setSelectedEmploymentIds] = useState<number[]>([]);
  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => api.admin<{ users: AdminUser[] }>("/api/v1/admin/users") });
  const employments = filteredEmployments(users.data?.users ?? []);
  const toggleEmployment = (employmentId: number, checked: boolean) => setSelectedEmploymentIds((current) => checked ? [...current, employmentId] : current.filter((item) => item !== employmentId));
  const selectedQuery = scope === "selected" && selectedEmploymentIds.length > 0 ? `&employments=${selectedEmploymentIds.join(",")}` : "";

  return <div className="page"><header className="page-heading"><div><p>Tiskové sestavy</p><h1>Příprava tisku</h1></div></header><div className="split"><Panel title="Dokument"><div className="panel-body form-grid"><Field label="Typ sestavy"><select value={kind} onChange={(e) => setKind(e.target.value as "summary" | "detail")}><option value="summary">Hromadná sumarizace profilů</option><option value="detail">Docházkový list po úvazcích</option></select></Field><Field label="Měsíc"><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field><Field label="Rozsah tisku"><select value={scope} onChange={(e) => setScope(e.target.value as "all" | "selected")}><option value="all">Všechny profily</option><option value="selected">Jen vybrané profily</option></select></Field>{scope === "selected" && <div className="full admin-chip-grid">{employments.map((employment) => <label key={employment.id} className={`admin-chip admin-chip--checkbox ${selectedEmploymentIds.includes(employment.id) ? "admin-chip--active" : ""}`}><input type="checkbox" checked={selectedEmploymentIds.includes(employment.id)} onChange={(event) => toggleEmployment(employment.id, event.target.checked)} /><strong>{employment.user_name}</strong><span>{employment.title}</span><small>{employment.employment_type}</small></label>)}</div>}<div className="full action-row"><Button disabled={scope === "selected" && selectedEmploymentIds.length === 0} onClick={() => navigate(`/admin/tisky/preview?month=${month}&kind=${kind}${selectedQuery}`)}><Printer />Otevřít náhled</Button></div></div></Panel><Panel title="Co náhled vytiskne"><div className="panel-body stack"><p>{kind === "summary" ? "Jednu souhrnnou sestavu se stavem naplánovaných a odpracovaných hodin, dovolené, volna a odpoledních směn pro každý vybraný profil." : "Jednu samostatnou A4 stránku pro každý vybraný úvazek s denním rozpisem a měsíčním souhrnem v zápatí."}</p><p>Náhled používá živá data z administrace a nativní dialog prohlížeče umožní tisk i bezpečné uložení do PDF.</p></div></Panel></div></div>;
}

export function AdminPrintPreviewPage() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const month = params.get("month") ?? new Date().toISOString().slice(0, 7);
  const kind = (params.get("kind") as "summary" | "detail" | null) ?? "summary";
  const selectedEmploymentIds = (params.get("employments") ?? "").split(",").filter(Boolean).map(Number);
  const [year, monthNumber] = monthParts(month);
  const attendance = useQuery({ queryKey: ["print-attendance", month], queryFn: () => loadAttendanceMonth(year, monthNumber) });
  const shiftPlan = useQuery({ queryKey: ["print-plan", month], queryFn: () => loadShiftPlanMonth(year, monthNumber) });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.admin<Settings>("/api/v1/admin/settings") });
  const rows = useMemo(() => {
    if (!attendance.data || !shiftPlan.data) return [];
    const allowedIds = selectedEmploymentIds.length > 0 ? new Set(selectedEmploymentIds) : null;
    return printSummaryRows(attendance.data.rows, shiftPlan.data.rows, settings.data?.afternoon_cutoff ?? "12:00")
      .filter((row) => !allowedIds || allowedIds.has(row.employment_id));
  }, [attendance.data, selectedEmploymentIds, settings.data?.afternoon_cutoff, shiftPlan.data]);

  return <div className="page">
    <header className="page-heading no-print"><div><p>Kontrola před výstupem</p><h1>Náhled sestavy</h1></div><Button onClick={() => window.print()}><Printer />Tisk / uložit PDF</Button></header>
    {(attendance.isPending || shiftPlan.isPending || settings.isPending) && <StatusMessage kind="loading" title="Připravuji tisková data" />}
    {(attendance.error || shiftPlan.error || settings.error) && <StatusMessage kind="error" title="Náhled nelze vytvořit">{(attendance.error ?? shiftPlan.error ?? settings.error)?.message}</StatusMessage>}
    {attendance.data && shiftPlan.data && settings.data && kind === "summary" && <article className="print-sheet"><header className="print-sheet__header"><div><h1>KájovoDagmar</h1><p>Hromadná sumarizace profilů · {month}</p></div><strong>{rows.length} profilů</strong></header><table><thead><tr><th>Zaměstnanec / úvazek</th><th>Plán</th><th>Odpracováno</th><th>Dovolená</th><th>Volno</th><th>Odpolední</th><th>Vyplněno</th></tr></thead><tbody>{rows.map((row) => <tr key={row.employment_id}><td>{row.user_name}<br /><small>{row.label}</small></td><td>{formatHours(row.plannedMinutes)}</td><td>{formatHours(row.actualMinutes)}</td><td>{row.holidayDays} d</td><td>{row.offDays} d</td><td>{row.afternoonShifts}</td><td>{row.filledDays} dnů</td></tr>)}</tbody></table><footer><p>Vygenerováno {new Intl.DateTimeFormat("cs-CZ", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Prague" }).format(new Date())}</p></footer></article>}
    {attendance.data && shiftPlan.data && settings.data && kind === "detail" && rows.map((row) => <article key={row.employment_id} className="print-sheet print-sheet--page"><header className="print-sheet__header"><div><h1>KájovoDagmar</h1><p>Docházkový list · {month}</p></div><div className="print-sheet__identity"><strong>{row.user_name}</strong><small>{row.label}</small></div></header><table><thead><tr><th>Datum</th><th>Den</th><th>Plán</th><th>Docházka</th><th>Stav</th></tr></thead><tbody>{row.days.map((day) => { const planDay = row.planDays.find((item) => item.date === day.date); const date = asPragueDate(day.date); return <tr key={day.date} className={`print-day print-day--${getCalendarDayTone(date)}`}><td>{day.date}</td><td>{getWeekdayLongLabel(date)}</td><td>{planDay?.status ? (planDay.status === "HOLIDAY" ? "Dovolená" : "Volno") : `${planDay?.arrival_time ?? "–"} – ${planDay?.departure_time ?? "–"}`}</td><td>{`${day.arrival_time ?? "–"} – ${day.departure_time ?? "–"}`}</td><td>{planDay?.status === "HOLIDAY" ? "Dovolená" : planDay?.status === "OFF" ? "Volno" : day.planned_status === "HOLIDAY" ? "Dovolená" : day.planned_status === "OFF" ? "Volno" : ""}</td></tr>; })}</tbody></table><footer className="print-summary"><div><span>Plán hodin</span><strong>{formatHours(row.plannedMinutes)}</strong></div><div><span>Odpracováno</span><strong>{formatHours(row.actualMinutes)}</strong></div><div><span>Dovolená</span><strong>{row.holidayDays} d</strong></div><div><span>Volno</span><strong>{row.offDays} d</strong></div><div><span>Odpolední</span><strong>{row.afternoonShifts}</strong></div></footer></article>)}
  </div>;
}

export function AdminSettingsPage() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.admin<Settings>("/api/v1/admin/settings") });
  const smtp = useQuery({ queryKey: ["smtp"], queryFn: () => api.admin<Smtp>("/api/v1/admin/smtp") });
  const version = useQuery({ queryKey: ["version"], queryFn: () => api.admin<{ backend_deploy_tag: string; environment: string }>("/api/version") });
  const mutation = useMutation({ mutationFn: ({ path, body }: { path: string; body: unknown }) => api.admin(path, { method: "PUT", body: JSON.stringify(body) }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings"] }); qc.invalidateQueries({ queryKey: ["smtp"] }); } });
  return <div className="page"><header className="page-heading"><div><p>Pravidla a diagnostika</p><h1>Nastavení systému</h1></div><span className="badge badge--good">Backend {version.data?.backend_deploy_tag ?? "…"}</span></header>{mutation.isSuccess && <StatusMessage kind="success" title="Nastavení bylo uloženo" />}{mutation.error && <StatusMessage kind="error" title="Nastavení nelze uložit">{mutation.error.message}</StatusMessage>}<div className="split"><Panel title="Provozní pravidla">{settings.data ? <SettingsForm value={settings.data} onSave={(body) => mutation.mutate({ path: "/api/v1/admin/settings", body })} /> : <div className="panel-body"><StatusMessage kind="loading" title="Načítám pravidla" /></div>}</Panel><Panel title="SMTP konfigurace">{smtp.data ? <SmtpForm value={smtp.data} onSave={(body) => mutation.mutate({ path: "/api/v1/admin/smtp", body })} /> : <div className="panel-body"><StatusMessage kind="loading" title="Načítám SMTP" /></div>}</Panel></div></div>;
}

function SettingsForm({ value, onSave }: { value: Settings; onSave: (body: unknown) => void }) {
  const [cutoff, setCutoff] = useState(value.afternoon_cutoff);
  return <div className="panel-body"><Field label="Začátek odpoledních hodin"><input type="time" value={cutoff} onChange={(e) => setCutoff(e.target.value)} /></Field><div className="action-row"><Button onClick={() => onSave({ afternoon_cutoff: cutoff })}><Save />Uložit pravidlo</Button></div></div>;
}

function SmtpForm({ value, onSave }: { value: Smtp; onSave: (body: unknown) => void }) {
  const [form, setForm] = useState({ ...value, password: "" });
  const set = (key: string, val: string | number) => setForm((current) => ({ ...current, [key]: val }));
  return <div className="panel-body form-grid"><Field label="Server"><input value={form.host ?? ""} onChange={(e) => set("host", e.target.value)} /></Field><Field label="Port"><input type="number" value={form.port ?? ""} onChange={(e) => set("port", Number(e.target.value))} /></Field><Field label="Zabezpečení"><select value={form.security ?? "SSL"} onChange={(e) => set("security", e.target.value)}><option>SSL</option><option>STARTTLS</option><option>NONE</option></select></Field><Field label="Uživatel"><input value={form.username ?? ""} onChange={(e) => set("username", e.target.value)} /></Field><Field label="Nové heslo" hint={value.password_set ? "Heslo je nastaveno; prázdné pole jej zachová." : "Heslo zatím není nastaveno."}><input type="password" value={form.password} onChange={(e) => set("password", e.target.value)} /></Field><Field label="E-mail odesílatele"><input type="email" value={form.from_email ?? ""} onChange={(e) => set("from_email", e.target.value)} /></Field><div className="full action-row"><Button onClick={() => onSave(form)}><Save />Uložit SMTP</Button></div></div>;
}

export function AdminIntegrationsPage() {
  const qc = useQueryClient();
  const [create, setCreate] = useState(false);
  const [secret, setSecret] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<IntegrationOperation | null>(null);
  const clients = useQuery({ queryKey: ["integrations"], queryFn: () => api.admin<any[]>("/api/v1/admin/integrations/clients") });
  const options = useQuery({ queryKey: ["integration-options"], queryFn: () => api.admin<IntegrationOptions>("/api/v1/admin/integrations/clients/options") });
  const detail = useQuery({ queryKey: ["integration-detail", selectedId], queryFn: () => api.admin<any>(`/api/v1/admin/integrations/clients/${selectedId}`), enabled: selectedId !== null });
  const mutation = useMutation({ mutationFn: (operation: IntegrationOperation) => api.admin<any>(operation.path, { method: operation.method ?? "POST", body: operation.body ? JSON.stringify(operation.body) : undefined }), onSuccess: (data) => { if (data.plaintext_token) setSecret(data.plaintext_token); qc.invalidateQueries({ queryKey: ["integrations"] }); qc.invalidateQueries({ queryKey: ["integration-detail"] }); setCreate(false); setConfirm(null); } });
  const run = (operation: IntegrationOperation) => operation.title ? setConfirm(operation) : mutation.mutate(operation);
  return <div className="page"><header className="page-heading"><div><p>Strojové přístupy a scope</p><h1>Integrační klienti</h1></div><Button onClick={() => { setCreate(true); setSelectedId(null); }}><Plus />Nový klient</Button></header>{secret && <Panel title="Nový token · zobrazí se pouze nyní"><div className="panel-body stack"><div className="secret">{secret}</div><div className="action-row"><Button variant="quiet" onClick={async () => navigator.clipboard.writeText(secret)}><Copy />Kopírovat</Button><Button onClick={() => setSecret("")}>Token jsem bezpečně uložil</Button></div></div></Panel>}<div className="split"><Panel title={`Klienti · ${clients.data?.length ?? 0}`}>{clients.isPending ? <div className="panel-body"><StatusMessage kind="loading" title="Načítám integrace" /></div> : clients.data?.length ? <ul className="list">{clients.data.map((item) => <li key={item.id}><button className="row-action" onClick={() => { setSelectedId(item.id); setCreate(false); }}>{item.name}</button><span className={`badge ${item.status === "ACTIVE" ? "badge--good" : "badge--warn"}`}>{item.status_label ?? item.status}</span></li>)}</ul> : <div className="panel-body"><StatusMessage kind="empty" title="Zatím není vytvořen klient" /></div>}</Panel><Panel title={create ? "Nový klient" : detail.data?.name ?? "Inspektor integrace"}>{create && options.data ? <IntegrationForm options={options.data} onSubmit={(body) => run({ path: "/api/v1/admin/integrations/clients", body })} /> : detail.isPending && selectedId ? <div className="panel-body"><StatusMessage kind="loading" title="Načítám konfiguraci klienta" /></div> : detail.data && options.data ? <div className="stack"><IntegrationForm key={detail.data.updated_at} options={options.data} value={detail.data} onSubmit={(body) => run({ path: `/api/v1/admin/integrations/clients/${detail.data.id}`, method: "PUT", body })} /><div className="panel-body action-row action-row--wrap"><Button variant="quiet" onClick={() => run({ title: "Rotovat token?", description: "Všechny dosavadní tokeny klienta budou okamžitě zneplatněny.", path: `/api/v1/admin/integrations/clients/${detail.data.id}/rotate` })}><RefreshCw />Rotovat token</Button><Button variant="danger" onClick={() => run({ title: detail.data.status === "DISABLED" ? "Povolit klienta?" : "Dočasně zakázat klienta?", description: "Změna se projeví při následujícím integračním požadavku.", path: `/api/v1/admin/integrations/clients/${detail.data.id}/${detail.data.status === "DISABLED" ? "enable" : "disable"}` })}><Power />{detail.data.status === "DISABLED" ? "Povolit" : "Zakázat"}</Button><Button variant="danger" onClick={() => run({ title: "Odvolat aktivní token?", description: "Klient nebude moci API použít, dokud nevytvoříte nový token rotací.", path: `/api/v1/admin/integrations/clients/${detail.data.id}/revoke-secret` })}><ShieldOff />Odvolat token</Button></div></div> : <div className="panel-body"><StatusMessage kind="empty" title="Vyberte klienta nebo vytvořte nový" /></div>}</Panel></div>{mutation.error && <StatusMessage kind="error" title="Operaci nelze dokončit">{mutation.error.message}</StatusMessage>}{confirm && <Modal title={confirm.title ?? "Potvrdit operaci"} description={confirm.description ?? ""} confirmLabel="Potvrdit změnu" danger onClose={() => setConfirm(null)} onConfirm={() => mutation.mutate(confirm)} />}</div>;
}

function IntegrationForm({ options, value, onSubmit }: { options: IntegrationOptions; value?: any; onSubmit: (body: unknown) => void }) {
  const config = value?.configuration;
  const [name, setName] = useState(value?.name ?? "");
  const [scopes, setScopes] = useState<string[]>(config?.selected_scope_ids ?? []);
  const [dataMode, setDataMode] = useState(config?.data_scope_mode ?? options.data_scope_modes[0]?.id ?? "ALL_ACTIVE_EMPLOYMENTS");
  const [employeeIds, setEmployeeIds] = useState<number[]>(config?.selected_employee_ids ?? []);
  const [employmentIds, setEmploymentIds] = useState<number[]>(config?.selected_employment_ids ?? []);
  const [includeInactive, setIncludeInactive] = useState(config?.include_inactive_employments ?? false);
  const [ipMode, setIpMode] = useState(config?.ip_restriction_mode ?? options.ip_restriction_modes[0]?.id ?? "NONE");
  const [expiration, setExpiration] = useState(config?.expiration_choice ?? options.expiration_options[0]?.id ?? "NONE");
  const [customDate, setCustomDate] = useState(config?.custom_expiration_date ?? "");
  const toggle = <T,>(items: T[], item: T, checked: boolean) => checked ? [...items, item] : items.filter((current) => current !== item);
  const submit = (event: FormEvent) => { event.preventDefault(); onSubmit({ name, selected_scope_ids: scopes, data_scope_mode: dataMode, selected_employee_ids: employeeIds, selected_employment_ids: employmentIds, include_inactive_employments: includeInactive, ip_restriction_mode: ipMode, expiration_choice: expiration, custom_expiration_date: expiration === "CUSTOM_DATE" ? customDate || null : null }); };
  return <form className="panel-body stack" onSubmit={submit}><Field label="Název klienta"><input required minLength={3} value={name} onChange={(event) => setName(event.target.value)} /></Field><fieldset><legend>Oprávnění</legend>{options.scopes.filter((scope) => scope.available).map((scope) => <label key={scope.id} className="field"><span><input type="checkbox" checked={scopes.includes(scope.id)} onChange={(event) => setScopes(toggle(scopes, scope.id, event.target.checked))} /> {scope.label}</span><small>{scope.description}</small></label>)}</fieldset><Field label="Rozsah dat"><select value={dataMode} onChange={(event) => setDataMode(event.target.value)}>{options.data_scope_modes.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}</select></Field>{dataMode === "SELECTED_EMPLOYEES" && <fieldset><legend>Vybrané osoby</legend>{options.employees.map((employee) => <label key={employee.id} className="field"><span><input type="checkbox" checked={employeeIds.includes(employee.id)} onChange={(event) => setEmployeeIds(toggle(employeeIds, employee.id, event.target.checked))} /> {employee.label}</span></label>)}<label className="field"><span><input type="checkbox" checked={includeInactive} onChange={(event) => setIncludeInactive(event.target.checked)} /> Zahrnout neaktivní úvazky</span></label></fieldset>}{dataMode === "SELECTED_EMPLOYMENTS" && <fieldset><legend>Vybrané úvazky</legend>{options.employments.map((employment) => <label key={employment.id} className="field"><span><input type="checkbox" checked={employmentIds.includes(employment.id)} onChange={(event) => setEmploymentIds(toggle(employmentIds, employment.id, event.target.checked))} /> {employment.label}</span></label>)}</fieldset>}<div className="form-grid"><Field label="IP omezení"><select value={ipMode} onChange={(event) => setIpMode(event.target.value)}>{options.ip_restriction_modes.map((mode) => <option key={mode.id} value={mode.id} disabled={!mode.editable && mode.id !== ipMode}>{mode.label}</option>)}</select></Field><Field label="Expirace"><select value={expiration} onChange={(event) => setExpiration(event.target.value)}>{options.expiration_options.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field>{expiration === "CUSTOM_DATE" && <Field label="Datum expirace"><input required type="date" value={customDate} onChange={(event) => setCustomDate(event.target.value)} /></Field>}</div><Button disabled={!name || scopes.length === 0}>{value ? <Save /> : <KeyRound />}{value ? "Uložit konfiguraci" : "Vytvořit a zobrazit token"}</Button></form>;
}
