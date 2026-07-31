import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import type { AttendanceDay, PortalSession } from "../api/types";
import { Brand } from "../components/Brand";
import { ExternalLoginButtons } from "../components/ExternalLoginButtons";
import { Button, Field, Panel, StatusMessage } from "../components/Primitives";
import { clearPortalSession, loadPortalSession, savePortalLogin, selectEmployment } from "../state/portalSession";

function Login({ onLogin }: { onLogin: (session: PortalSession) => void }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const providers = useQuery({ queryKey: ["external-providers"], queryFn: api.externalProviders, retry: false });
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try { onLogin(savePortalLogin(await api.portalLogin(email, password))); } catch (reason) { setError(reason instanceof Error ? reason.message : t("api.genericError")); }
  }
  return <main className="auth-page"><Brand /><form className="panel auth-panel" onSubmit={submit}><h1>{t("employee.login.title")}</h1><Field label={t("auth.email", "Pracovní e-mail")}><input aria-label={t("auth.email", "Pracovní e-mail")} type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></Field><Field label={t("auth.password", "Heslo")}><input aria-label={t("auth.password", "Heslo")} type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></Field>{error && <StatusMessage kind="error" title={error} />}<Button type="submit">{t("auth.actions.login", "Přihlásit se")}</Button><ExternalLoginButtons enabled={providers.data} getUrl={(provider) => api.externalLoginUrl("employee", provider, "/app")} portal="employee" /></form></main>;
}

function EventRow({ day, onChanged }: { day: AttendanceDay; onChanged: () => void }) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  async function remove(id: number) { setPending(true); try { await api.deleteAttendanceEvent(id); onChanged(); } finally { setPending(false); } }
  return <li className="attendance-event-list__item"><span>{day.date}</span><div>{day.events.map((event) => <span key={event.id} className="attendance-event"><strong>{event.event_type}</strong> {new Intl.DateTimeFormat("cs-CZ", { timeZone: "Europe/Prague", hour: "2-digit", minute: "2-digit" }).format(new Date(event.occurred_at))}<button type="button" aria-label={`${t("common.actions.delete")} ${event.event_type}`} disabled={pending} onClick={() => remove(event.id)}><Trash2 size={15} /></button></span>)}</div></li>;
}

export function EmployeePage() {
  const { t } = useTranslation();
  const [session, setSession] = useState<PortalSession | null>(() => loadPortalSession());
  const [month, setMonth] = useState(() => new Date());
  const employmentId = session?.selected_employment_id ?? null;
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["attendance", employmentId, month.getFullYear(), month.getMonth() + 1], queryFn: () => api.attendance(employmentId as number, month.getFullYear(), month.getMonth() + 1), enabled: employmentId !== null });
  useEffect(() => { document.title = `${t("common.appName")} · ${t("employee.page.title")}`; }, [t]);
  if (!session) return <Login onLogin={setSession} />;
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ["attendance"] }); };
  async function addEvent(type: "IN" | "OUT") { if (!employmentId) return; const occurred_at = new Date().toISOString(); await api.createAttendanceEvent({ employment_id: employmentId, occurred_at, event_type: type }); refresh(); }
  const days = query.data?.days ?? [];
  return <main className="app-shell"><header className="app-header"><Brand /><div className="app-header__actions"><select aria-label={t("employee.fields.employment")} value={employmentId ?? ""} onChange={(event) => setSession(selectEmployment(session, Number(event.target.value)))}>{session.available_employments.map((employment) => <option key={employment.id} value={employment.id}>{employment.label ?? employment.title}</option>)}</select><Button variant="quiet" onClick={() => { clearPortalSession(); setSession(null); }}><LogOut />{t("auth.actions.logout")}</Button></div></header><section className="page-content"><Panel title={query.data?.employment_label ?? t("employee.page.title")} actions={<div className="action-row"><Button onClick={() => addEvent("IN")}><Plus />IN</Button><Button onClick={() => addEvent("OUT")}><Plus />OUT</Button></div>}>{query.isPending ? <StatusMessage kind="loading" title={t("common.states.loading")} /> : query.error ? <StatusMessage kind="error" title={query.error.message} /> : <><div className="month-toolbar"><Button variant="quiet" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</Button><strong>{new Intl.DateTimeFormat("cs-CZ", { month: "long", year: "numeric" }).format(month)}</strong><Button variant="quiet" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</Button></div><ul className="attendance-event-list">{days.map((day) => <EventRow key={day.date} day={day} onChanged={refresh} />)}</ul></>}</Panel></section></main>;
}
