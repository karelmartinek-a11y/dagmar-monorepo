import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BriefcaseBusiness, KeyRound, Plus, Save, ShieldCheck, Trash2, UserRound, UserX } from "lucide-react";
import { api, ApiError } from "../api/client";
import type { AdminUser, Employment } from "../api/types";
import { Button, Field, Modal, Panel, StatusMessage } from "../components/Primitives";

type UserList = { users: AdminUser[] };
type Operation = { path: string; options: RequestInit; success: string };

export function AdminUsersPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingUser, setEditingUser] = useState(false);
  const [employment, setEmployment] = useState<Employment | "new" | null>(null);
  const [confirm, setConfirm] = useState<null | { title: string; description: string; operation: Operation }>(null);
  const [notice, setNotice] = useState("");
  const query = useQuery({ queryKey: ["admin-users"], queryFn: () => api.admin<UserList>("/api/v1/admin/users") });
  const mutation = useMutation({
    mutationFn: (operation: Operation) => api.admin(operation.path, operation.options),
    onSuccess: (_data, operation) => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      setNotice(operation.success);
      setConfirm(null);
      setEmployment(null);
      setEditingUser(false);
      setSelected(null);
    },
    onError: (error, operation) => {
      setConfirm(null);
      if (error instanceof ApiError && error.conflict && operation.options.method === "DELETE") {
        setConfirm({
          title: "Smazat úvazek včetně navázaných dat?",
          description: "Úvazek obsahuje docházku, plán, zámky nebo připomínky. Potvrzením budou tyto vazby nevratně odstraněny.",
          operation: { ...operation, options: { ...operation.options, body: JSON.stringify({ confirm_delete_related: true }) } },
        });
      } else if (error instanceof ApiError && error.conflict && operation.options.method === "PUT" && operation.path.includes("/employments/")) {
        const payload = JSON.parse(String(operation.options.body ?? "{}")) as Record<string, unknown>;
        setConfirm({
          title: "Změnit období a odstranit data mimo nový rozsah?",
          description: "Nové období úvazku vylučuje část docházky, plánu, zámků nebo připomínek. Potvrzením budou pouze záznamy mimo nové období nevratně odstraněny.",
          operation: { ...operation, options: { ...operation.options, body: JSON.stringify({ ...payload, confirm_delete_out_of_range: true }) } },
        });
      }
    },
  });
  const users = (query.data?.users ?? []).filter((user) => `${user.name} ${user.email}`.toLowerCase().includes(search.toLowerCase()));
  const removeUser = (user: AdminUser) => setConfirm({
    title: `Odstranit ${user.name}?`,
    description: "Tato operace může ovlivnit navázané úvazky. Backend odmítne nebezpečné smazání bez splnění všech podmínek.",
    operation: { path: `/api/v1/admin/users/${user.id}`, options: { method: "DELETE" }, success: "Uživatel byl odstraněn." },
  });

  return <div className="page">
    <header className="page-heading"><div><p>Identity a pracovní vztahy</p><h1>Uživatelé a úvazky</h1></div><Button onClick={() => { setCreating(true); setSelected(null); setEmployment(null); setEditingUser(false); }}><Plus />Nový uživatel</Button></header>
    {notice && <StatusMessage kind="success" title="Uloženo">{notice}</StatusMessage>}
    {mutation.error && !confirm && <StatusMessage kind="error" title="Změnu nelze dokončit">{mutation.error.message}</StatusMessage>}
    <div className="split">
      <Panel title={`Seznam · ${users.length}`} actions={<label className="field"><span className="sr-only">Hledat</span><input placeholder="Hledat jméno nebo e-mail" value={search} onChange={(event) => setSearch(event.target.value)} /></label>}>
        {query.isPending ? <div className="panel-body"><StatusMessage kind="loading" title="Načítám uživatele" /></div> : users.length === 0 ? <div className="panel-body"><StatusMessage kind="empty" title="Žádný uživatel neodpovídá filtru" /></div> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Jméno</th><th>Přístup</th><th>Úvazky</th><th>Stav</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><button className="row-action" onClick={() => { setSelected(user); setCreating(false); setEmployment(null); setEditingUser(false); }}>{user.name}</button><br /><small>{user.email}</small></td><td>{user.role}</td><td>{user.employments?.length ?? user.employment_count ?? 0}</td><td><span className={`badge ${user.is_active ? "badge--good" : "badge--warn"}`}>{user.is_active ? "Aktivní" : "Vypnutý"}</span></td></tr>)}</tbody></table></div>}
      </Panel>
      <Panel title={creating ? "Nový uživatel" : selected ? "Detail uživatele" : "Inspektor"}>
        {creating ? <UserForm onSubmit={(payload) => mutation.mutate({ path: "/api/v1/admin/users", options: { method: "POST", body: JSON.stringify(payload) }, success: "Uživatel byl vytvořen." })} /> : selected ? <div className="panel-body stack">
          <div><span className="badge badge--good"><UserRound />{selected.role}</span><h2>{selected.name}</h2><p>{selected.email}{selected.phone ? ` · ${selected.phone}` : ""}</p></div>
          <div className="action-row"><Button variant="quiet" onClick={() => setEditingUser(value => !value)}><UserRound />{editingUser ? "Zavřít editaci" : "Upravit uživatele"}</Button><Button variant="quiet" onClick={() => setEmployment("new")}><BriefcaseBusiness />Přidat úvazek</Button></div>
          {editingUser && <UserEditForm value={selected} onSubmit={(payload) => mutation.mutate({ path: `/api/v1/admin/users/${selected.id}`, options: { method: "PUT", body: JSON.stringify(payload) }, success: "Uživatel byl upraven." })} />}
          <ul className="list">{(selected.employments ?? []).map((item) => <li key={item.id}><button className="row-action" onClick={() => setEmployment(item)}>{item.title} · {item.employment_type}</button><strong>{item.start_date} — {item.end_date ?? "bez konce"}</strong></li>)}</ul>
          {employment && <EmploymentForm value={employment === "new" ? undefined : employment} onSubmit={(payload) => mutation.mutate({ path: employment === "new" ? `/api/v1/admin/users/${selected.id}/employments` : `/api/v1/admin/employments/${employment.id}`, options: { method: employment === "new" ? "POST" : "PUT", body: JSON.stringify(payload) }, success: employment === "new" ? "Úvazek byl vytvořen." : "Úvazek byl upraven." })} onDelete={employment === "new" ? undefined : () => setConfirm({ title: `Odstranit úvazek ${employment.title}?`, description: "Nejprve bezpečně ověříme, zda úvazek nemá navázaná data.", operation: { path: `/api/v1/admin/employments/${employment.id}`, options: { method: "DELETE", body: JSON.stringify({ confirm_delete_related: false }) }, success: "Úvazek byl odstraněn." } })} />}
          <div className="action-row"><Button variant="quiet" onClick={() => mutation.mutate({ path: `/api/v1/admin/users/${selected.id}/unlock`, options: { method: "POST" }, success: "Uživatel byl odemknut." })}><ShieldCheck />Odemknout</Button><Button variant="quiet" onClick={() => setConfirm({ title: "Odeslat reset hesla?", description: `Na adresu ${selected.email} bude odeslán jednorázový odkaz.`, operation: { path: `/api/v1/admin/users/${selected.id}/send-reset`, options: { method: "POST" }, success: "Reset hesla byl odeslán." } })}><KeyRound />Reset</Button><Button variant="danger" onClick={() => removeUser(selected)}><UserX />Odstranit</Button></div>
        </div> : <div className="panel-body"><StatusMessage kind="empty" title="Vyberte uživatele">Detail, úvazky a bezpečné akce se zobrazí zde.</StatusMessage></div>}
      </Panel>
    </div>
    {confirm && <Modal title={confirm.title} description={confirm.description} confirmLabel="Potvrdit operaci" danger onClose={() => setConfirm(null)} onConfirm={() => mutation.mutate(confirm.operation)} />}
  </div>;
}

function UserForm({ onSubmit }: { onSubmit: (payload: Record<string, unknown>) => void }) {
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [phone, setPhone] = useState(""); const [password, setPassword] = useState("");
  const submit = (event: FormEvent) => { event.preventDefault(); onSubmit({ name, email, phone: phone || null, password: password || null, role: "employee", is_active: true }); };
  return <form className="panel-body form-grid" onSubmit={submit}><Field label="Jméno"><input required value={name} onChange={(event) => setName(event.target.value)} /></Field><Field label="E-mail"><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></Field><Field label="Telefon"><input value={phone} onChange={(event) => setPhone(event.target.value)} /></Field><Field label="Počáteční heslo" hint="Volitelné, nejméně 8 znaků"><input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} /></Field><div className="full action-row"><Button>Vytvořit uživatele</Button></div></form>;
}

function UserEditForm({ value, onSubmit }: { value: AdminUser; onSubmit: (payload: Record<string, unknown>) => void }) {
  const [name, setName] = useState(value.name); const [email, setEmail] = useState(value.email); const [phone, setPhone] = useState(value.phone ?? ""); const [active, setActive] = useState(value.is_active);
  const submit = (event: FormEvent) => { event.preventDefault(); onSubmit({ name, email, phone, role: value.role, is_active: active }); };
  return <form className="form-grid inspector-form" onSubmit={submit}><Field label="Jméno"><input required value={name} onChange={(event) => setName(event.target.value)} /></Field><Field label="E-mail"><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></Field><Field label="Telefon"><input value={phone} onChange={(event) => setPhone(event.target.value)} /></Field><label className="field"><span><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> Aktivní přístup</span></label><div className="full action-row"><Button><Save />Uložit uživatele</Button></div></form>;
}

function EmploymentForm({ value, onSubmit, onDelete }: { value?: Employment; onSubmit: (payload: Record<string, unknown>) => void; onDelete?: () => void }) {
  const [title, setTitle] = useState(value?.title ?? ""); const [type, setType] = useState(value?.employment_type ?? "HPP"); const [start, setStart] = useState(value?.start_date ?? new Date().toISOString().slice(0, 10)); const [end, setEnd] = useState(value?.end_date ?? ""); const [active, setActive] = useState(value?.is_active ?? true);
  const submit = (event: FormEvent) => { event.preventDefault(); onSubmit({ title, employment_type: type, start_date: start, end_date: end || null, is_active: active }); };
  return <form className="form-grid inspector-form" onSubmit={submit}><Field label="Název úvazku"><input required value={title} onChange={(event) => setTitle(event.target.value)} /></Field><Field label="Typ"><select value={type} onChange={(event) => setType(event.target.value)}><option value="HPP">HPP</option><option value="DPP_DPC">DPP / DPČ</option></select></Field><Field label="Platný od"><input required type="date" value={start} onChange={(event) => setStart(event.target.value)} /></Field><Field label="Platný do"><input type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></Field><label className="field full"><span><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> Aktivní úvazek</span></label><div className="full action-row"><Button><BriefcaseBusiness />{value ? "Uložit úvazek" : "Vytvořit úvazek"}</Button>{onDelete && <Button type="button" variant="danger" onClick={onDelete}><Trash2 />Odstranit úvazek</Button>}</div></form>;
}
