import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BriefcaseBusiness, KeyRound, Plus, Save, ShieldCheck, Trash2, UserRound, UserX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../api/client";
import type { AdminUser, Employment } from "../api/types";
import { Button, Field, Modal, Panel, StatusMessage } from "../components/Primitives";
import { useDateFormatter } from "../utils/format";

type UserList = { users: AdminUser[] };
type Operation = { path: string; options: RequestInit; success: string };

export function AdminUsersPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const lastLoginFormatter = useDateFormatter({ dateStyle: "medium", timeStyle: "short" });
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<number | "new" | null>(null);
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
      if (selectedUserId !== "new") setSelectedUserId(null);
    },
    onError: (error, operation) => {
      setConfirm(null);
      if (error instanceof ApiError && error.conflict && operation.options.method === "DELETE") {
        setConfirm({
          title: t("users.confirmDeleteEmployment.title"),
          description: t("users.confirmDeleteEmployment.description"),
          operation: { ...operation, options: { ...operation.options, body: JSON.stringify({ confirm_delete_related: true }) } },
        });
      } else if (error instanceof ApiError && error.conflict && operation.options.method === "PUT" && operation.path.includes("/employments/")) {
        const payload = JSON.parse(String(operation.options.body ?? "{}")) as Record<string, unknown>;
        setConfirm({
          title: t("users.confirmChangeRange.title"),
          description: t("users.confirmChangeRange.description"),
          operation: { ...operation, options: { ...operation.options, body: JSON.stringify({ ...payload, confirm_delete_out_of_range: true }) } },
        });
      }
    },
  });

  const users = useMemo(
    () => (query.data?.users ?? []).filter((user) => `${user.name} ${user.email}`.toLowerCase().includes(search.toLowerCase())),
    [query.data?.users, search],
  );
  const selected = selectedUserId && selectedUserId !== "new" ? users.find((user) => user.id === selectedUserId) ?? query.data?.users.find((user) => user.id === selectedUserId) ?? null : null;

  const removeUser = (user: AdminUser) =>
    setConfirm({
      title: t("users.deleteUserTitle", { name: user.name }),
      description: t("users.deleteUserDescription"),
      operation: { path: `/api/v1/admin/users/${user.id}`, options: { method: "DELETE" }, success: t("users.removed") },
    });

  return <div className="page">
    <header className="page-heading">
      <div><p>{t("users.eyebrow")}</p><h1>{t("users.title")}</h1></div>
      <Button onClick={() => { setSelectedUserId("new"); setEditingUser(false); setEmployment(null); }}><Plus />{t("users.new")}</Button>
    </header>
    {notice && <StatusMessage kind="success" title={t("common.status.saved")}>{notice}</StatusMessage>}
    {mutation.error && !confirm && <StatusMessage kind="error" title={t("common.status.changeFailed")}>{mutation.error.message}</StatusMessage>}
    <Panel title={t("users.picker")}>
      <div className="panel-body admin-user-picker">
        <Field label={t("users.filter")}>
          <input placeholder={t("users.filterPlaceholder")} value={search} onChange={(event) => setSearch(event.target.value)} />
        </Field>
        <Field label={t("users.displayedUser")}>
          <select value={selectedUserId === "new" ? "new" : selectedUserId ?? ""} onChange={(event) => { const value = event.target.value; setEmployment(null); setEditingUser(false); setSelectedUserId(value === "new" ? "new" : value ? Number(value) : null); }}>
            <option value="">{t("users.chooseUser")}</option>
            <option value="new">{t("users.newUser")}</option>
            {users.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.email}</option>)}
          </select>
        </Field>
        <span className="badge">{t("users.results", { count: users.length })}</span>
      </div>
    </Panel>
    <Panel title={selectedUserId === "new" ? t("users.newUser") : selected ? selected.name : t("users.detail")}>
      {query.isPending ? <div className="panel-body"><StatusMessage kind="loading" title={t("users.loading")} /></div> : selectedUserId === "new" ? <UserForm onSubmit={(payload) => mutation.mutate({ path: "/api/v1/admin/users", options: { method: "POST", body: JSON.stringify(payload) }, success: t("users.created") })} /> : selected ? <div className="panel-body stack">
        <section className="admin-profile">
          <div className="admin-profile__hero">
            <div>
              <span className={`badge ${selected.is_active ? "badge--good" : "badge--warn"}`}><UserRound />{selected.role}</span>
              <h2>{selected.name}</h2>
              <p>{selected.email}{selected.phone ? ` · ${selected.phone}` : ""}</p>
            </div>
            <div className="admin-profile__facts">
              <div><span>{t("users.profile.lastLogin")}</span><strong>{selected.last_login_at ? lastLoginFormatter.format(new Date(selected.last_login_at)) : t("users.profile.neverLoggedIn")}</strong></div>
              <div><span>{t("users.profile.employments")}</span><strong>{selected.employments?.length ?? 0}</strong></div>
              <div><span>{t("users.profile.accessState")}</span><strong>{selected.is_active ? t("users.profile.accessEnabled") : t("users.profile.accessDisabled")}</strong></div>
            </div>
          </div>
          <div className="action-row action-row--wrap">
            <Button variant="quiet" onClick={() => setEditingUser((value) => !value)}><UserRound />{editingUser ? t("users.profile.toggleEditClose") : t("users.profile.toggleEditOpen")}</Button>
            <Button variant="quiet" onClick={() => setEmployment("new")}><BriefcaseBusiness />{t("users.profile.addEmployment")}</Button>
            <Button variant="quiet" onClick={() => mutation.mutate({ path: `/api/v1/admin/users/${selected.id}/unlock`, options: { method: "POST" }, success: t("users.unlocked") })}><ShieldCheck />{t("users.profile.unlock")}</Button>
            <Button variant="quiet" onClick={() => setConfirm({ title: t("users.profile.resetPasswordTitle"), description: t("users.profile.resetPasswordDescription", { email: selected.email }), operation: { path: `/api/v1/admin/users/${selected.id}/send-reset`, options: { method: "POST" }, success: t("users.resetSent") } })}><KeyRound />{t("users.profile.resetPassword")}</Button>
            <Button variant="danger" onClick={() => removeUser(selected)}><UserX />{t("users.profile.remove")}</Button>
          </div>
        </section>
        {editingUser && <UserEditForm value={selected} onSubmit={(payload) => mutation.mutate({ path: `/api/v1/admin/users/${selected.id}`, options: { method: "PUT", body: JSON.stringify(payload) }, success: t("users.updated") })} />}
        <section className="admin-profile__section">
          <header className="admin-profile__section-header">
            <h3>{t("users.employmentSection.title")}</h3>
            <small>{t("users.employmentSection.description")}</small>
          </header>
          {(selected.employments ?? []).length === 0 ? <StatusMessage kind="empty" title={t("users.employmentSection.empty")} /> : <div className="admin-chip-grid">{(selected.employments ?? []).map((item) => <button key={item.id} type="button" className={`admin-chip ${employment !== "new" && employment?.id === item.id ? "admin-chip--active" : ""}`} onClick={() => setEmployment(item)}><strong>{item.title}</strong><span>{item.employment_type}</span><small>{item.start_date} — {item.end_date ?? t("common.states.noEnd")}</small></button>)}</div>}
        </section>
        {employment && <EmploymentForm value={employment === "new" ? undefined : employment} onSubmit={(payload) => mutation.mutate({ path: employment === "new" ? `/api/v1/admin/users/${selected.id}/employments` : `/api/v1/admin/employments/${employment.id}`, options: { method: employment === "new" ? "POST" : "PUT", body: JSON.stringify(payload) }, success: employment === "new" ? t("users.employmentCreated") : t("users.employmentUpdated") })} onDelete={employment === "new" ? undefined : () => setConfirm({ title: t("users.employmentDelete.title", { title: employment.title }), description: t("users.employmentDelete.description"), operation: { path: `/api/v1/admin/employments/${employment.id}`, options: { method: "DELETE", body: JSON.stringify({ confirm_delete_related: false }) }, success: t("users.employmentRemoved") } })} />}
      </div> : <div className="panel-body"><StatusMessage kind="empty" title={t("users.detailEmpty.title")}>{t("users.detailEmpty.body")}</StatusMessage></div>}
    </Panel>
    {confirm && <Modal title={confirm.title} description={confirm.description} confirmLabel={t("common.modal.confirmOperation")} danger onClose={() => setConfirm(null)} onConfirm={() => mutation.mutate(confirm.operation)} />}
  </div>;
}

function UserForm({ onSubmit }: { onSubmit: (payload: Record<string, unknown>) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit({ name, email, phone: phone || null, password: password || null, role: "employee", is_active: true });
  };
  return <form className="panel-body form-grid" onSubmit={submit}>
    <Field label={t("users.fields.name")}><input required value={name} onChange={(event) => setName(event.target.value)} /></Field>
    <Field label={t("users.fields.email")}><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
    <Field label={t("users.fields.phone")}><input value={phone} onChange={(event) => setPhone(event.target.value)} /></Field>
    <Field label={t("users.fields.initialPassword")} hint={t("users.fields.initialPasswordHint")}><input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
    <div className="full action-row"><Button>{t("users.actions.createUser")}</Button></div>
  </form>;
}

function UserEditForm({ value, onSubmit }: { value: AdminUser; onSubmit: (payload: Record<string, unknown>) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(value.name);
  const [email, setEmail] = useState(value.email);
  const [phone, setPhone] = useState(value.phone ?? "");
  const [active, setActive] = useState(value.is_active);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit({ name, email, phone, role: value.role, is_active: active });
  };
  return <form className="form-grid inspector-form" onSubmit={submit}>
    <Field label={t("users.fields.name")}><input required value={name} onChange={(event) => setName(event.target.value)} /></Field>
    <Field label={t("users.fields.email")}><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
    <Field label={t("users.fields.phone")}><input value={phone} onChange={(event) => setPhone(event.target.value)} /></Field>
    <label className="field"><span><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> {t("users.fields.activeAccess")}</span></label>
    <div className="full action-row"><Button><Save />{t("users.actions.saveUser")}</Button></div>
  </form>;
}

function EmploymentForm({ value, onSubmit, onDelete }: { value?: Employment; onSubmit: (payload: Record<string, unknown>) => void; onDelete?: () => void }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(value?.title ?? "");
  const [type, setType] = useState(value?.employment_type ?? "HPP");
  const [start, setStart] = useState(value?.start_date ?? new Date().toISOString().slice(0, 10));
  const [end, setEnd] = useState(value?.end_date ?? "");
  const [active, setActive] = useState(value?.is_active ?? true);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit({ title, employment_type: type, start_date: start, end_date: end || null, is_active: active });
  };
  return <form className="form-grid inspector-form" onSubmit={submit}>
    <Field label={t("users.fields.employmentTitle")}><input required value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
    <Field label={t("users.fields.employmentType")}><select value={type} onChange={(event) => setType(event.target.value)}><option value="HPP">HPP</option><option value="DPP_DPC">DPP / DPČ</option></select></Field>
    <Field label={t("users.fields.validFrom")}><input required type="date" value={start} onChange={(event) => setStart(event.target.value)} /></Field>
    <Field label={t("users.fields.validTo")}><input type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></Field>
    <label className="field full"><span><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> {t("users.fields.activeEmployment")}</span></label>
    <div className="full action-row action-row--wrap"><Button><BriefcaseBusiness />{value ? t("users.actions.saveEmployment") : t("users.actions.createEmployment")}</Button>{onDelete && <Button type="button" variant="danger" onClick={onDelete}><Trash2 />{t("users.actions.deleteEmployment")}</Button>}</div>
  </form>;
}
