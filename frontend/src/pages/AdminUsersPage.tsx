import React, { useEffect, useMemo, useState } from "react";
import {
  adminCreateEmployment,
  adminCreateUser,
  adminDeleteEmployment,
  adminDeleteUser,
  adminListUsers,
  adminSendUserReset,
  adminUnlockUser,
  adminUpdateEmployment,
  adminUpdateUser,
  type AdminEmployment,
  type EmploymentDeleteConflict,
  type EmploymentPeriodConflict,
  type PortalUser,
} from "../api/admin";
import { Breadcrumbs, ConfirmDialog, EmptyState, FilterBar, InlineNotice, MetricCard, PageHeader, StateBadge, Toast } from "../components/admin/AdminUI";
import type { EmploymentTemplate } from "../types/employment";
import Button from "../ui/Button";
import { formatIsoDateForDisplay, parseCzechDateToIso } from "../utils/date";

type EmploymentFormState = {
  title: string;
  employment_type: EmploymentTemplate;
  start_date: string;
  end_date: string;
  is_indefinite: boolean;
};

type UserFormErrors = Partial<Record<"name" | "email" | "phone" | "password", string>>;
type EmploymentFormErrors = Partial<Record<"title" | "start_date" | "end_date", string>>;

type DialogState =
  | { kind: "none" }
  | { kind: "deleteUser"; user: PortalUser }
  | { kind: "deleteEmployment"; employment: AdminEmployment }
  | { kind: "employmentUpdateConflict"; user: PortalUser; employment: AdminEmployment; conflict: EmploymentPeriodConflict; draft: EmploymentFormState }
  | { kind: "employmentDeleteConflict"; employment: AdminEmployment; conflict: EmploymentDeleteConflict };

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string") return err;
  return fallback;
}

function loginStatusLabel(user: PortalUser): string {
  if (user.login_status === "ACTIVE") return "Aktivní přihlášení";
  if (user.login_status === "DEACTIVATED") return "Ručně deaktivováno";
  return "Blokováno oknem úvazku";
}

function emptyEmploymentForm(): EmploymentFormState {
  return { title: "", employment_type: "DPP_DPC", start_date: "", end_date: "", is_indefinite: true };
}

function fromEmployment(employment: AdminEmployment): EmploymentFormState {
  return {
    title: employment.title,
    employment_type: employment.employment_type,
    start_date: formatIsoDateForDisplay(employment.start_date),
    end_date: formatIsoDateForDisplay(employment.end_date),
    is_indefinite: employment.end_date === null,
  };
}

function userTone(user: PortalUser): "ok" | "danger" | "warning" {
  if (user.login_status === "ACTIVE") return "ok";
  if (user.login_status === "DEACTIVATED") return "danger";
  return "warning";
}

function validateEmail(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) return "E-mail je povinný.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return "Zadejte platný e-mail ve formátu jmeno@domena.cz.";
  return null;
}

function validatePhone(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) return null;
  if (!/^\+?\d[\d\s]{8,15}$/.test(normalized)) return "Telefon zadejte jako české nebo mezinárodní číslo, například +420 777 888 999.";
  return null;
}

function validateEmploymentDraft(form: EmploymentFormState): EmploymentFormErrors {
  const next: EmploymentFormErrors = {};
  if (!form.title.trim()) next.title = "Název úvazku je povinný.";
  const startIso = parseCzechDateToIso(form.start_date);
  if (!startIso) next.start_date = "Datum začátku zadejte ve formátu dd.mm.rrrr, například 01.06.2026.";
  const endIso = form.is_indefinite ? null : parseCzechDateToIso(form.end_date);
  if (!form.is_indefinite && !endIso) next.end_date = "Datum konce zadejte ve formátu dd.mm.rrrr, nebo zapněte dobu neurčitou.";
  if (startIso && endIso && endIso < startIso) next.end_date = "Datum konce nesmí být dříve než datum začátku.";
  return next;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<PortalUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [showInactiveUsers, setShowInactiveUsers] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [createErrors, setCreateErrors] = useState<UserFormErrors>({});
  const [editErrors, setEditErrors] = useState<UserFormErrors>({});
  const [newEmploymentErrors, setNewEmploymentErrors] = useState<Record<number, EmploymentFormErrors>>({});
  const [editEmploymentErrors, setEditEmploymentErrors] = useState<Record<number, EmploymentFormErrors>>({});
  const [highlightUserId, setHighlightUserId] = useState<number | null>(null);
  const [highlightEmploymentId, setHighlightEmploymentId] = useState<number | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [isActive, setIsActive] = useState(true);

  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);

  const [employmentForms, setEmploymentForms] = useState<Record<number, EmploymentFormState>>({});
  const [editingEmploymentId, setEditingEmploymentId] = useState<number | null>(null);
  const [employmentDrafts, setEmploymentDrafts] = useState<Record<number, EmploymentFormState>>({});

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await adminListUsers();
      setUsers(res.users || []);
      setSelectedUserId((current) => (res.users.some((user) => user.id === current) ? current : res.users[0]?.id ?? null));
    } catch (err: unknown) {
      setError(errorMessage(err, "Nepodařilo se načíst uživatele."));
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const activeUserCount = useMemo(() => users.filter((user) => user.login_status === "ACTIVE").length, [users]);
  const blockedUserCount = useMemo(() => users.filter((user) => user.login_status === "EMPLOYMENT_WINDOW_BLOCKED").length, [users]);
  const withoutPasswordCount = useMemo(() => users.filter((user) => !user.has_password).length, [users]);

  const visibleUsers = useMemo(() => {
    const base = showInactiveUsers ? users : users.filter((user) => user.is_active);
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return base;
    return base.filter((user) => {
      const hay = `${user.name} ${user.email} ${user.phone ?? ""}`.toLowerCase();
      return tokens.every((token) => hay.includes(token));
    });
  }, [query, showInactiveUsers, users]);

  const selectedUser = useMemo(() => users.find((user) => user.id === selectedUserId) ?? null, [selectedUserId, users]);

  async function onCreate(event: React.FormEvent) {
    event.preventDefault();
    const nextErrors: UserFormErrors = {};
    if (!name.trim()) nextErrors.name = "Jméno je povinné.";
    const emailError = validateEmail(email);
    if (emailError) nextErrors.email = emailError;
    const phoneError = validatePhone(phone);
    if (phoneError) nextErrors.phone = phoneError;
    if (password.trim() && password.trim().length < 8) nextErrors.password = "Počáteční heslo musí mít alespoň 8 znaků.";
    setCreateErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await adminCreateUser({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || null,
        role: "employee",
        password: password.trim() || null,
        is_active: isActive,
      });
      setName("");
      setEmail("");
      setPhone("");
      setPassword("");
      setIsActive(true);
      setCreateErrors({});
      setHighlightUserId(created.id);
      setSelectedUserId(created.id);
      setToast("Uživatel byl vytvořen.");
      await load();
    } catch (err: unknown) {
      setError(errorMessage(err, "Uložení se nezdařilo."));
    } finally {
      setSaving(false);
    }
  }

  function startEdit(user: PortalUser) {
    setEditingUserId(user.id);
    setEditName(user.name);
    setEditEmail(user.email);
    setEditPhone(user.phone ?? "");
    setEditPassword("");
    setEditIsActive(user.is_active);
    setEditErrors({});
  }

  async function onUpdate(event: React.FormEvent) {
    event.preventDefault();
    if (!editingUserId) return;
    const nextErrors: UserFormErrors = {};
    if (!editName.trim()) nextErrors.name = "Jméno je povinné.";
    const emailError = validateEmail(editEmail);
    if (emailError) nextErrors.email = emailError;
    const phoneError = validatePhone(editPhone);
    if (phoneError) nextErrors.phone = phoneError;
    if (editPassword.trim() && editPassword.trim().length < 8) nextErrors.password = "Nové heslo musí mít alespoň 8 znaků.";
    setEditErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setSaving(true);
    setError(null);
    try {
      await adminUpdateUser(editingUserId, {
        name: editName.trim(),
        email: editEmail.trim(),
        phone: editPhone.trim() || null,
        password: editPassword.trim() || undefined,
        role: "employee",
        is_active: editIsActive,
      });
      setToast("Profil uživatele byl uložen.");
      setEditingUserId(null);
      await load();
    } catch (err: unknown) {
      setError(errorMessage(err, "Uložení změn se nezdařilo."));
    } finally {
      setSaving(false);
    }
  }

  function updateNewEmploymentForm(userId: number, next: Partial<EmploymentFormState>) {
    setEmploymentForms((prev) => ({ ...prev, [userId]: { ...(prev[userId] ?? emptyEmploymentForm()), ...next } }));
  }

  function updateExistingEmploymentForm(employmentId: number, next: Partial<EmploymentFormState>, fallback: AdminEmployment) {
    setEmploymentDrafts((prev) => ({ ...prev, [employmentId]: { ...(prev[employmentId] ?? fromEmployment(fallback)), ...next } }));
  }

  async function createEmployment(userId: number) {
    const form = employmentForms[userId] ?? emptyEmploymentForm();
    const errors = validateEmploymentDraft(form);
    setNewEmploymentErrors((prev) => ({ ...prev, [userId]: errors }));
    if (Object.keys(errors).length > 0) {
      return;
    }
    const startIso = parseCzechDateToIso(form.start_date);
    const endIso = form.is_indefinite ? null : parseCzechDateToIso(form.end_date);
    if (!startIso) return;
    setSaving(true);
    setError(null);
    try {
      const created = await adminCreateEmployment(userId, {
        title: form.title.trim(),
        employment_type: form.employment_type,
        start_date: startIso,
        end_date: form.is_indefinite ? null : endIso,
        is_active: true,
      });
      setEmploymentForms((prev) => ({ ...prev, [userId]: emptyEmploymentForm() }));
      setNewEmploymentErrors((prev) => ({ ...prev, [userId]: {} }));
      setHighlightEmploymentId(created.id);
      setToast("Úvazek byl přidán.");
      await load();
    } catch (err: unknown) {
      setError(errorMessage(err, "Vytvoření úvazku se nezdařilo."));
    } finally {
      setSaving(false);
    }
  }

  async function saveEmployment(user: PortalUser, employment: AdminEmployment) {
    const draft = employmentDrafts[employment.id] ?? fromEmployment(employment);
    const errors = validateEmploymentDraft(draft);
    setEditEmploymentErrors((prev) => ({ ...prev, [employment.id]: errors }));
    if (Object.keys(errors).length > 0) {
      return;
    }
    const startIso = parseCzechDateToIso(draft.start_date);
    const endIso = draft.is_indefinite ? null : parseCzechDateToIso(draft.end_date);
    if (!startIso) return;
    setSaving(true);
    setError(null);
    try {
      await adminUpdateEmployment(employment.id, {
        title: draft.title.trim(),
        employment_type: draft.employment_type,
        start_date: startIso,
        end_date: draft.is_indefinite ? null : endIso,
        is_active: true,
      });
      setEditingEmploymentId(null);
      setToast("Úvazek byl uložen.");
      await load();
    } catch (err: unknown) {
      const conflict = err as EmploymentPeriodConflict;
      if (conflict?.code === "employment_period_conflict") {
        setDialog({ kind: "employmentUpdateConflict", user, employment, conflict, draft });
      } else {
        setError(errorMessage(err, "Úprava úvazku se nezdařila."));
      }
    } finally {
      setSaving(false);
    }
  }

  async function confirmEmploymentPeriodConflict() {
    if (dialog.kind !== "employmentUpdateConflict") return;
    const { employment, draft } = dialog;
    setSaving(true);
    setError(null);
    try {
      await adminUpdateEmployment(employment.id, {
        title: draft.title.trim(),
        employment_type: draft.employment_type,
        start_date: parseCzechDateToIso(draft.start_date) ?? draft.start_date,
        end_date: draft.is_indefinite ? null : parseCzechDateToIso(draft.end_date),
        is_active: true,
        confirm_delete_out_of_range: true,
      });
      setDialog({ kind: "none" });
      setEditingEmploymentId(null);
      setToast("Kolizní změna úvazku byla potvrzena a uložena.");
      await load();
    } catch (err) {
      setError(errorMessage(err, "Potvrzená změna úvazku se nezdařila."));
    } finally {
      setSaving(false);
    }
  }

  async function deleteEmployment(employment: AdminEmployment) {
    setSaving(true);
    setError(null);
    try {
      await adminDeleteEmployment(employment.id);
      setToast("Úvazek byl smazán.");
      await load();
    } catch (err: unknown) {
      const conflict = err as EmploymentDeleteConflict;
      if (conflict?.code === "employment_delete_conflict") {
        setDialog({ kind: "employmentDeleteConflict", employment, conflict });
      } else {
        setError(errorMessage(err, "Smazání úvazku se nezdařilo."));
      }
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeleteEmploymentConflict() {
    if (dialog.kind !== "employmentDeleteConflict") return;
    setSaving(true);
    setError(null);
    try {
      await adminDeleteEmployment(dialog.employment.id, { confirm_delete_related: true });
      setDialog({ kind: "none" });
      setToast("Úvazek i navázaná data byly smazány.");
      await load();
    } catch (err) {
      setError(errorMessage(err, "Smazání úvazku se nezdařilo."));
    } finally {
      setSaving(false);
    }
  }

  async function sendReset(userId: number) {
    setSaving(true);
    setError(null);
    try {
      await adminSendUserReset(userId);
      setToast("Reset hesla byl odeslán.");
    } catch (err: unknown) {
      setError(errorMessage(err, "Odeslání odkazu se nezdařilo."));
    } finally {
      setSaving(false);
    }
  }

  async function unlockUser(userId: number) {
    setSaving(true);
    setError(null);
    try {
      await adminUnlockUser(userId);
      setToast("Účet byl odblokován.");
      await load();
    } catch (err: unknown) {
      setError(errorMessage(err, "Odblokování účtu se nezdařilo."));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(user: PortalUser) {
    setSaving(true);
    setError(null);
    try {
      await adminUpdateUser(user.id, { is_active: !user.is_active, role: "employee" });
      setToast(user.is_active ? "Účet byl deaktivován." : "Účet byl aktivován.");
      await load();
    } catch (err) {
      setError(errorMessage(err, "Změna aktivace se nezdařila."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-page-grid">
      <PageHeader
        eyebrow="Účty a přístupy"
        title="Uživatelé a úvazky"
        description="Správa zaměstnaneckých účtů a jejich úvazků v jednom split-view pracovním prostoru."
      >
        <Breadcrumbs items={[{ label: "Administrace", to: "/admin/prehled" }, { label: "Uživatelé" }]} />
      </PageHeader>

      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}

      <section className="admin-metric-grid">
        <MetricCard label="Celkem uživatelů" value={users.length} />
        <MetricCard label="Aktivní přihlášení" value={activeUserCount} tone="ok" />
        <MetricCard label="Blokováno úvazkem" value={blockedUserCount} tone={blockedUserCount ? "danger" : "default"} />
        <MetricCard label="Bez hesla" value={withoutPasswordCount} tone={withoutPasswordCount ? "danger" : "default"} />
      </section>

      <div className="admin-split-layout">
        <section className="admin-surface">
          <div className="admin-surface-head">
            <div>
              <div className="admin-surface-title">Filtr a seznam osob</div>
              <div className="admin-surface-subtitle">Vyberte účet vlevo, detail a úvazky se otevřou v pravém panelu.</div>
            </div>
          </div>

          <FilterBar>
            <label className="kb-field" style={{ flex: "1 1 320px" }}>
              <span className="kb-label">Hledat uživatele</span>
              <input className="kb-input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Např. Novák nebo +420 777 888 999" />
            </label>
            <label className="admin-checkbox-row">
              <input type="checkbox" checked={showInactiveUsers} onChange={(e) => setShowInactiveUsers(e.target.checked)} />
              <span>Zobrazit i neaktivní</span>
            </label>
          </FilterBar>

          <form onSubmit={onCreate} className="admin-form-section">
            <div className="admin-form-section-title">Nový uživatel</div>
            <div className="admin-form-grid">
                  <div>
                    <div className="kb-label">Jméno</div>
                    <input className="kb-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Např. Jan Novák" aria-invalid={createErrors.name ? "true" : "false"} />
                    {createErrors.name ? <div className="admin-field-error">{createErrors.name}</div> : null}
                  </div>
                  <div>
                    <div className="kb-label">E-mail</div>
                    <input className="kb-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jan.novak@firma.cz" aria-invalid={createErrors.email ? "true" : "false"} autoComplete="email" />
                    {createErrors.email ? <div className="admin-field-error">{createErrors.email}</div> : null}
                  </div>
                  <div>
                    <div className="kb-label">Telefon</div>
                    <input className="kb-input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Např. +420 777 888 999" aria-invalid={createErrors.phone ? "true" : "false"} autoComplete="tel" />
                    {createErrors.phone ? <div className="admin-field-error">{createErrors.phone}</div> : null}
                  </div>
                  <div>
                    <div className="kb-label">Počáteční heslo</div>
                    <input className="kb-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Volitelné, min. 8 znaků" aria-invalid={createErrors.password ? "true" : "false"} autoComplete="new-password" />
                    {createErrors.password ? <div className="admin-field-error">{createErrors.password}</div> : null}
                  </div>
                </div>
            <div className="admin-action-row">
              <Button type="button" variant="ghost" onClick={() => setIsActive((value) => !value)}>
                {isActive ? "Ruční aktivace zapnutá" : "Ruční aktivace vypnutá"}
              </Button>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? "Ukládám…" : "Přidat uživatele"}
              </Button>
            </div>
          </form>

          {loading ? (
            <InlineNotice>Načítám uživatele…</InlineNotice>
          ) : visibleUsers.length === 0 ? (
            <EmptyState title="Žádní uživatelé" description="Aktuální filtr nevrátil žádný účet." />
          ) : (
            <div className="admin-list">
              {visibleUsers.map((user) => (
                <button key={user.id} type="button" className={`admin-selection-row${selectedUserId === user.id ? " active" : ""}${highlightUserId === user.id ? " admin-selection-row--highlight" : ""}`} onClick={() => setSelectedUserId(user.id)}>
                  <div>
                    <div className="admin-list-title">{user.name}</div>
                    <div className="admin-list-subtitle">{user.email}</div>
                  </div>
                  <StateBadge tone={userTone(user)}>{loginStatusLabel(user)}</StateBadge>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="admin-surface">
          <div className="admin-surface-head">
            <div>
              <div className="admin-surface-title">Detail účtu a úvazků</div>
              <div className="admin-surface-subtitle">Pracujte v kontextu jedné osoby, bez skrytých dopadů a slepých akcí.</div>
            </div>
          </div>

          {!selectedUser ? (
            <EmptyState title="Není vybraný účet" description="Vyberte uživatele ze seznamu vlevo." />
          ) : (
            <div className="admin-stack">
              <div className="admin-definition-list">
                <div><span>E-mail</span><strong>{selectedUser.email}</strong></div>
                <div><span>Telefon</span><strong>{selectedUser.phone || "neuvedeno"}</strong></div>
                <div><span>Heslo</span><strong>{selectedUser.has_password ? "Nastaveno" : "Bez hesla"}</strong></div>
                <div><span>Přihlášení</span><strong>{loginStatusLabel(selectedUser)}</strong></div>
              </div>

              <div className="admin-badge-row">
                <StateBadge tone={selectedUser.is_active ? "ok" : "danger"}>{selectedUser.is_active ? "Ruční aktivace zapnutá" : "Ručně deaktivováno"}</StateBadge>
                <StateBadge tone={selectedUser.has_password ? "ok" : "warning"}>{selectedUser.has_password ? "Heslo připraveno" : "Chybí heslo"}</StateBadge>
                <StateBadge tone={userTone(selectedUser)}>{loginStatusLabel(selectedUser)}</StateBadge>
              </div>

              {selectedUser.login_status_reason ? <InlineNotice tone="warning">{selectedUser.login_status_reason}</InlineNotice> : null}

              <div className="admin-action-row">
                <Button type="button" variant="ghost" onClick={() => startEdit(selectedUser)}>Upravit účet</Button>
                <Button type="button" variant="ghost" onClick={() => void sendReset(selectedUser.id)} disabled={saving}>Poslat reset hesla</Button>
                <Button type="button" variant="ghost" onClick={() => void unlockUser(selectedUser.id)} disabled={saving || !selectedUser.is_locked}>Odblokovat</Button>
              </div>
              <div className="admin-action-row admin-action-row--split">
                <Button type="button" variant="secondary" onClick={() => void toggleActive(selectedUser)} disabled={saving}>
                  {selectedUser.is_active ? "Deaktivovat" : "Aktivovat"}
                </Button>
                <Button type="button" variant="danger" onClick={() => setDialog({ kind: "deleteUser", user: selectedUser })} disabled={saving} aria-label={`Smazat uživatele ${selectedUser.name}`}>
                  Smazat uživatele
                </Button>
              </div>

              {editingUserId === selectedUser.id ? (
                <form onSubmit={onUpdate} className="admin-form-section">
                  <div className="admin-form-section-title">Úprava profilu</div>
                  <div className="admin-form-grid">
                    <div>
                      <div className="kb-label">Jméno</div>
                      <input className="kb-input" value={editName} onChange={(e) => setEditName(e.target.value)} aria-invalid={editErrors.name ? "true" : "false"} />
                      {editErrors.name ? <div className="admin-field-error">{editErrors.name}</div> : null}
                    </div>
                    <div>
                      <div className="kb-label">E-mail</div>
                      <input className="kb-input" type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} aria-invalid={editErrors.email ? "true" : "false"} />
                      {editErrors.email ? <div className="admin-field-error">{editErrors.email}</div> : null}
                    </div>
                    <div>
                      <div className="kb-label">Telefon</div>
                      <input className="kb-input" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} aria-invalid={editErrors.phone ? "true" : "false"} />
                      {editErrors.phone ? <div className="admin-field-error">{editErrors.phone}</div> : null}
                    </div>
                    <div>
                      <div className="kb-label">Nové heslo</div>
                      <input className="kb-input" type="password" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} placeholder="Ponechte prázdné pro zachování stávajícího hesla" aria-invalid={editErrors.password ? "true" : "false"} autoComplete="new-password" />
                      {editErrors.password ? <div className="admin-field-error">{editErrors.password}</div> : null}
                    </div>
                  </div>
                  <div className="admin-action-row">
                    <Button type="button" variant="ghost" onClick={() => setEditingUserId(null)}>Zavřít editor</Button>
                    <Button type="button" variant="ghost" onClick={() => setEditIsActive((value) => !value)}>
                      {editIsActive ? "Ruční aktivace zapnutá" : "Ruční aktivace vypnutá"}
                    </Button>
                    <Button type="submit" variant="primary" disabled={saving}>{saving ? "Ukládám…" : "Uložit profil"}</Button>
                  </div>
                </form>
              ) : null}

              <div className="admin-form-section">
                <div className="admin-form-section-title">Úvazky</div>
                {selectedUser.employments.length === 0 ? <EmptyState title="Žádný úvazek" description="Tento účet zatím nemá přiřazené žádné období ani typ práce." /> : null}
                <div className="admin-stack">
                  {selectedUser.employments.map((employment) => {
                    const isEditing = editingEmploymentId === employment.id;
                    const draft = employmentDrafts[employment.id] ?? fromEmployment(employment);
                    return (
                      <section key={employment.id} className={`admin-subsurface${highlightEmploymentId === employment.id ? " admin-subsurface--highlight" : ""}`}>
                        <div className="admin-surface-head">
                          <div>
                            <div className="admin-surface-title">{employment.label}</div>
                            <div className="admin-surface-subtitle">
                              {employment.start_date} až {employment.end_date ?? "na dobu neurčitou"}
                            </div>
                          </div>
                          <div className="admin-action-row">
                            <Button type="button" variant="ghost" onClick={() => setEditingEmploymentId(isEditing ? null : employment.id)}>
                              {isEditing ? "Zavřít" : "Upravit úvazek"}
                            </Button>
                            <Button type="button" variant="danger" onClick={() => setDialog({ kind: "deleteEmployment", employment })}>
                              Smazat
                            </Button>
                          </div>
                        </div>

                        {isEditing ? (
                          <div className="admin-form-grid">
                            <div>
                              <div className="kb-label">Název úvazku</div>
                              <input className="kb-input" value={draft.title} onChange={(e) => updateExistingEmploymentForm(employment.id, { title: e.target.value }, employment)} />
                            </div>
                            <div>
                              <div className="kb-label">Typ</div>
                              <select className="kb-select" value={draft.employment_type} onChange={(e) => updateExistingEmploymentForm(employment.id, { employment_type: e.target.value as EmploymentTemplate }, employment)}>
                                <option value="DPP_DPC">DPP / DPČ</option>
                                <option value="HPP">HPP</option>
                              </select>
                            </div>
                            <div>
                              <div className="kb-label">Začátek</div>
                              <input className="kb-input" value={draft.start_date} onChange={(e) => updateExistingEmploymentForm(employment.id, { start_date: e.target.value }, employment)} placeholder="např. 01.06.2026" aria-invalid={editEmploymentErrors[employment.id]?.start_date ? "true" : "false"} inputMode="numeric" />
                              {editEmploymentErrors[employment.id]?.start_date ? <div className="admin-field-error">{editEmploymentErrors[employment.id]?.start_date}</div> : null}
                            </div>
                            <div>
                              <div className="kb-label">Konec</div>
                              <input className="kb-input" disabled={draft.is_indefinite} value={draft.end_date} onChange={(e) => updateExistingEmploymentForm(employment.id, { end_date: e.target.value }, employment)} placeholder="např. 30.06.2026" aria-invalid={editEmploymentErrors[employment.id]?.end_date ? "true" : "false"} inputMode="numeric" />
                              {editEmploymentErrors[employment.id]?.end_date ? <div className="admin-field-error">{editEmploymentErrors[employment.id]?.end_date}</div> : null}
                            </div>
                            <label className="admin-checkbox-row">
                              <input type="checkbox" checked={draft.is_indefinite} onChange={(e) => updateExistingEmploymentForm(employment.id, { is_indefinite: e.target.checked }, employment)} />
                              <span>Na dobu neurčitou</span>
                            </label>
                            <div className="admin-action-row">
                              <Button type="button" variant="primary" onClick={() => void saveEmployment(selectedUser, employment)} disabled={saving}>
                                Uložit úvazek
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </section>
                    );
                  })}
                </div>
              </div>

              <div className="admin-form-section">
                <div className="admin-form-section-title">Přidat úvazek</div>
                <div className="admin-form-grid">
                  <div>
                    <div className="kb-label">Název úvazku</div>
                    <input className="kb-input" value={(employmentForms[selectedUser.id] ?? emptyEmploymentForm()).title} onChange={(e) => updateNewEmploymentForm(selectedUser.id, { title: e.target.value })} placeholder="Např. Recepce" aria-invalid={newEmploymentErrors[selectedUser.id]?.title ? "true" : "false"} />
                    {newEmploymentErrors[selectedUser.id]?.title ? <div className="admin-field-error">{newEmploymentErrors[selectedUser.id]?.title}</div> : null}
                  </div>
                  <div>
                    <div className="kb-label">Typ</div>
                    <select className="kb-select" value={(employmentForms[selectedUser.id] ?? emptyEmploymentForm()).employment_type} onChange={(e) => updateNewEmploymentForm(selectedUser.id, { employment_type: e.target.value as EmploymentTemplate })}>
                      <option value="DPP_DPC">DPP / DPČ</option>
                      <option value="HPP">HPP</option>
                    </select>
                  </div>
                  <div>
                    <div className="kb-label">Začátek</div>
                    <input className="kb-input" value={(employmentForms[selectedUser.id] ?? emptyEmploymentForm()).start_date} onChange={(e) => updateNewEmploymentForm(selectedUser.id, { start_date: e.target.value })} placeholder="např. 01.06.2026" aria-invalid={newEmploymentErrors[selectedUser.id]?.start_date ? "true" : "false"} inputMode="numeric" />
                    {newEmploymentErrors[selectedUser.id]?.start_date ? <div className="admin-field-error">{newEmploymentErrors[selectedUser.id]?.start_date}</div> : null}
                  </div>
                  <div>
                    <div className="kb-label">Konec</div>
                    <input className="kb-input" disabled={(employmentForms[selectedUser.id] ?? emptyEmploymentForm()).is_indefinite} value={(employmentForms[selectedUser.id] ?? emptyEmploymentForm()).end_date} onChange={(e) => updateNewEmploymentForm(selectedUser.id, { end_date: e.target.value })} placeholder="např. 30.06.2026" aria-invalid={newEmploymentErrors[selectedUser.id]?.end_date ? "true" : "false"} inputMode="numeric" />
                    {newEmploymentErrors[selectedUser.id]?.end_date ? <div className="admin-field-error">{newEmploymentErrors[selectedUser.id]?.end_date}</div> : null}
                  </div>
                  <label className="admin-checkbox-row">
                    <input type="checkbox" checked={(employmentForms[selectedUser.id] ?? emptyEmploymentForm()).is_indefinite} onChange={(e) => updateNewEmploymentForm(selectedUser.id, { is_indefinite: e.target.checked })} />
                    <span>Na dobu neurčitou</span>
                  </label>
                </div>
                <div className="admin-action-row">
                  <Button type="button" variant="primary" onClick={() => void createEmployment(selectedUser.id)} disabled={saving}>
                    Přidat úvazek
                  </Button>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={dialog.kind === "deleteUser"}
        title="Smazat uživatele"
        description={`Účet ${dialog.kind === "deleteUser" ? dialog.user.name : ""} bude odstraněn i se všemi úvazky a navázanou evidencí.`}
        confirmLabel="Smazat uživatele"
        tone="danger"
        busy={saving}
        confirmTextLabel="Pro potvrzení napište SMAZAT"
        confirmTextValue="SMAZAT"
        onClose={() => setDialog({ kind: "none" })}
        onConfirm={() =>
          dialog.kind === "deleteUser"
            ? void (async () => {
                setSaving(true);
                try {
                  await adminDeleteUser(dialog.user.id);
                  setDialog({ kind: "none" });
                  setToast("Uživatel byl smazán.");
                  setEditingUserId(null);
                  await load();
                } catch (err) {
                  setError(errorMessage(err, "Smazání uživatele se nezdařilo."));
                } finally {
                  setSaving(false);
                }
              })()
            : undefined
        }
      />

      <ConfirmDialog
        open={dialog.kind === "deleteEmployment"}
        title="Smazat úvazek"
        description={dialog.kind === "deleteEmployment" ? `Opravdu smazat úvazek „${dialog.employment.label}“?` : ""}
        confirmLabel="Smazat úvazek"
        tone="danger"
        busy={saving}
        onClose={() => setDialog({ kind: "none" })}
        onConfirm={() => (dialog.kind === "deleteEmployment" ? void deleteEmployment(dialog.employment) : undefined)}
      />

      <ConfirmDialog
        open={dialog.kind === "employmentUpdateConflict"}
        title="Potvrdit kolizní změnu období"
        description={
          dialog.kind === "employmentUpdateConflict"
            ? `Změna období úvazku uživatele ${dialog.user.name} smaže data mimo nové období${dialog.conflict.problem_range_start && dialog.conflict.problem_range_end ? ` (${dialog.conflict.problem_range_start} až ${dialog.conflict.problem_range_end})` : ""}.`
            : ""
        }
        confirmLabel="Potvrdit a smazat kolize"
        tone="danger"
        busy={saving}
        details={
          dialog.kind === "employmentUpdateConflict"
            ? [
                { label: "Docházka mimo období", value: dialog.conflict.attendance_count },
                { label: "Plán služeb mimo období", value: dialog.conflict.shift_plan_count },
                { label: "Zámky měsíců", value: dialog.conflict.attendance_lock_count },
                { label: "Výběry plánu", value: dialog.conflict.shift_plan_selection_count },
                { label: "Připomínky", value: dialog.conflict.reminder_count },
              ]
            : undefined
        }
        onClose={() => setDialog({ kind: "none" })}
        onConfirm={() => void confirmEmploymentPeriodConflict()}
      />

      <ConfirmDialog
        open={dialog.kind === "employmentDeleteConflict"}
        title="Úvazek obsahuje navázaná data"
        description="Backend potvrdil, že před smazáním je potřeba výslovně schválit odstranění všech navázaných záznamů."
        confirmLabel="Smazat úvazek i data"
        tone="danger"
        busy={saving}
        details={
          dialog.kind === "employmentDeleteConflict"
            ? [
                { label: "Docházka", value: dialog.conflict.attendance_count },
                { label: "Plán služeb", value: dialog.conflict.shift_plan_count },
                { label: "Zámky měsíců", value: dialog.conflict.attendance_lock_count },
                { label: "Výběry plánu", value: dialog.conflict.shift_plan_selection_count },
                { label: "Připomínky", value: dialog.conflict.reminder_count },
              ]
            : undefined
        }
        onClose={() => setDialog({ kind: "none" })}
        onConfirm={() => void confirmDeleteEmploymentConflict()}
      />

      <Toast message={toast} tone="ok" />
    </div>
  );
}
