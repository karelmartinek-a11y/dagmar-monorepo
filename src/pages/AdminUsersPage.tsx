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
import type { EmploymentTemplate } from "../types/employment";

type EmploymentFormState = {
  title: string;
  employment_type: EmploymentTemplate;
  start_date: string;
  end_date: string;
  is_indefinite: boolean;
};

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string") return err;
  return fallback;
}

function loginStatusLabel(user: PortalUser): string {
  if (user.login_status === "ACTIVE") return "Aktivní";
  if (user.login_status === "DEACTIVATED") return "Deaktivovaný";
  return "Zamítnut přihlášením kvůli úvazku";
}

function loginStatusTone(user: PortalUser): React.CSSProperties {
  if (user.login_status === "ACTIVE") {
    return { background: "rgba(16,185,129,0.09)", borderColor: "rgba(16,185,129,0.24)", color: "#047857" };
  }
  if (user.login_status === "DEACTIVATED") {
    return { background: "rgba(239,68,68,0.09)", borderColor: "rgba(239,68,68,0.24)", color: "#b91c1c" };
  }
  return { background: "rgba(245,158,11,0.12)", borderColor: "rgba(245,158,11,0.28)", color: "#b45309" };
}

function emptyEmploymentForm(): EmploymentFormState {
  return {
    title: "",
    employment_type: "DPP_DPC",
    start_date: "",
    end_date: "",
    is_indefinite: true,
  };
}

function fromEmployment(employment: AdminEmployment): EmploymentFormState {
  return {
    title: employment.title,
    employment_type: employment.employment_type,
    start_date: employment.start_date,
    end_date: employment.end_date ?? "",
    is_indefinite: employment.end_date === null,
  };
}

function isUserEditDirty(
  user: PortalUser,
  draft: { name: string; email: string; phone: string; password: string; is_active: boolean }
): boolean {
  return (
    draft.name !== user.name ||
    draft.email !== user.email ||
    draft.phone !== (user.phone ?? "") ||
    draft.password.trim() !== "" ||
    draft.is_active !== user.is_active
  );
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<PortalUser[]>([]);
  const [showInactiveUsers, setShowInactiveUsers] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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

  const activeUserCount = useMemo(() => users.filter((user) => user.login_status === "ACTIVE").length, [users]);
  const blockedUserCount = useMemo(() => users.filter((user) => user.login_status === "EMPLOYMENT_WINDOW_BLOCKED").length, [users]);
  const visibleUsers = useMemo(() => (showInactiveUsers ? users : users.filter((user) => user.is_active)), [showInactiveUsers, users]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      setError("Vyplňte jméno a e-mail.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await adminCreateUser({
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
  }

  function cancelEdit() {
    setEditingUserId(null);
    setEditName("");
    setEditEmail("");
    setEditPhone("");
    setEditPassword("");
    setEditIsActive(true);
  }

  async function onUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!editingUserId) return;
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
      cancelEdit();
      await load();
    } catch (err: unknown) {
      setError(errorMessage(err, "Uložení změn se nezdařilo."));
    } finally {
      setSaving(false);
    }
  }

  async function sendReset(userId: number) {
    setSaving(true);
    setError(null);
    try {
      await adminSendUserReset(userId);
    } catch (err: unknown) {
      setError(errorMessage(err, "Odeslání odkazu se nezdařilo."));
    } finally {
      setSaving(false);
    }
  }

  async function deleteUser(user: PortalUser) {
    const confirmed = window.confirm(`Smazat uživatele ${user.name}? Smažou se i jeho úvazky a navázaná evidence.`);
    if (!confirmed) return;
    setSaving(true);
    setError(null);
    try {
      await adminDeleteUser(user.id);
      if (editingUserId === user.id) cancelEdit();
      await load();
    } catch (err: unknown) {
      setError(errorMessage(err, "Smazání uživatele se nezdařilo."));
    } finally {
      setSaving(false);
    }
  }

  async function unlockUser(user: PortalUser) {
    setSaving(true);
    setError(null);
    try {
      await adminUnlockUser(user.id);
      await load();
    } catch (err: unknown) {
      setError(errorMessage(err, "Odblokování účtu se nezdařilo."));
    } finally {
      setSaving(false);
    }
  }

  function updateNewEmploymentForm(userId: number, next: Partial<EmploymentFormState>) {
    setEmploymentForms((prev) => ({
      ...prev,
      [userId]: { ...(prev[userId] ?? emptyEmploymentForm()), ...next },
    }));
  }

  function updateExistingEmploymentForm(employmentId: number, next: Partial<EmploymentFormState>, fallback: AdminEmployment) {
    setEmploymentDrafts((prev) => ({
      ...prev,
      [employmentId]: { ...(prev[employmentId] ?? fromEmployment(fallback)), ...next },
    }));
  }

  async function createEmployment(userId: number) {
    const form = employmentForms[userId] ?? emptyEmploymentForm();
    if (!form.title.trim() || !form.start_date) {
      setError("Nový úvazek musí mít název a datum začátku.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await adminCreateEmployment(userId, {
        title: form.title.trim(),
        employment_type: form.employment_type,
        start_date: form.start_date,
        end_date: form.is_indefinite ? null : form.end_date || null,
        is_active: true,
      });
      setEmploymentForms((prev) => ({ ...prev, [userId]: emptyEmploymentForm() }));
      await load();
    } catch (err: unknown) {
      setError(errorMessage(err, "Vytvoření úvazku se nezdařilo."));
    } finally {
      setSaving(false);
    }
  }

  async function saveEmployment(user: PortalUser, employment: AdminEmployment) {
    const draft = employmentDrafts[employment.id] ?? fromEmployment(employment);
    if (!draft.title.trim() || !draft.start_date) {
      setError("Úvazek musí mít název a datum začátku.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await adminUpdateEmployment(employment.id, {
        title: draft.title.trim(),
        employment_type: draft.employment_type,
        start_date: draft.start_date,
        end_date: draft.is_indefinite ? null : draft.end_date || null,
        is_active: true,
      });
      setEditingEmploymentId(null);
      await load();
    } catch (err: unknown) {
      const conflict = err as EmploymentPeriodConflict;
      if (conflict?.code === "employment_period_conflict") {
        const problemRange =
          conflict.problem_range_start && conflict.problem_range_end
            ? ` Problematické období: ${conflict.problem_range_start} až ${conflict.problem_range_end}.`
            : "";
        const confirmed = window.confirm(
          `Změna období úvazku uživatele ${user.name} smaže záznamy mimo nové období.\n\n` +
            `Docházka mimo období: ${conflict.attendance_count}\n` +
            `Plán služeb mimo období: ${conflict.shift_plan_count}\n` +
            `Zámky měsíců mimo období: ${conflict.attendance_lock_count}\n` +
            `Výběry plánu mimo období: ${conflict.shift_plan_selection_count}\n` +
            `${problemRange}\n\n` +
            `Pokračovat a trvale smazat záznamy mimo nové období úvazku?`
        );
        if (!confirmed) {
          setSaving(false);
          return;
        }
        try {
          await adminUpdateEmployment(employment.id, {
            title: draft.title.trim(),
            employment_type: draft.employment_type,
            start_date: draft.start_date,
            end_date: draft.is_indefinite ? null : draft.end_date || null,
            is_active: true,
            confirm_delete_out_of_range: true,
          });
          setEditingEmploymentId(null);
          await load();
        } catch (retryError: unknown) {
          setError(errorMessage(retryError, "Potvrzená změna úvazku se nezdařila."));
        } finally {
          setSaving(false);
        }
        return;
      }
      setError(errorMessage(err, "Úprava úvazku se nezdařila."));
    } finally {
      setSaving(false);
    }
  }

  async function removeEmployment(employment: AdminEmployment) {
    const confirmed = window.confirm(`Opravdu smazat úvazek „${employment.label}“?`);
    if (!confirmed) return;
    setSaving(true);
    setError(null);
    try {
      await adminDeleteEmployment(employment.id);
      await load();
    } catch (err: unknown) {
      const conflict = err as EmploymentDeleteConflict;
      if (conflict?.code === "employment_delete_conflict") {
        const confirmedDelete = window.confirm(
          `Úvazek obsahuje navázaná data.\n\n` +
            `Docházka: ${conflict.attendance_count}\n` +
            `Plán služeb: ${conflict.shift_plan_count}\n` +
            `Zámky měsíců: ${conflict.attendance_lock_count}\n` +
            `Výběry plánu: ${conflict.shift_plan_selection_count}\n` +
            `Připomínky: ${conflict.reminder_count}\n\n` +
            `Opravdu chcete úvazek i s těmito daty trvale smazat?`
        );
        if (!confirmedDelete) {
          setSaving(false);
          return;
        }
        try {
          await adminDeleteEmployment(employment.id, { confirm_delete_related: true });
          await load();
        } catch (retryError: unknown) {
          setError(errorMessage(retryError, "Smazání úvazku se nezdařilo."));
        } finally {
          setSaving(false);
        }
        return;
      }
      setError(errorMessage(err, "Smazání úvazku se nezdařilo. Pokud má data, ukončete ho datem."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-page">
      <section className="card admin-hero">
        <div className="admin-hero-copy">
          <div className="eyebrow">Administrace · Uživatelé</div>
          <h1 className="admin-hero-title">Účty zaměstnanců a úvazky</h1>
          <div className="admin-hero-text">
            Účet zaměstnance je oddělený od jeho úvazků. Přihlášení, plán služeb i evidence docházky se nyní řídí konkrétním vybraným úvazkem.
          </div>
        </div>
        <div className="admin-kpis">
          <div className="admin-kpi">
            <div className="admin-kpi-value">{users.length}</div>
            <div className="admin-kpi-label">Celkem uživatelů</div>
          </div>
          <div className="admin-kpi">
            <div className="admin-kpi-value">{activeUserCount}</div>
            <div className="admin-kpi-label">Může se přihlásit</div>
          </div>
          <div className="admin-kpi">
            <div className="admin-kpi-value">{blockedUserCount}</div>
            <div className="admin-kpi-label">Zablokováno úvazkem</div>
          </div>
        </div>
      </section>

      {error ? (
        <div style={{ border: "1px solid rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.08)", borderRadius: 12, padding: 12, color: "#b91c1c" }}>
          {error}
        </div>
      ) : null}

      <div className="admin-two-column">
        <section className="card pad admin-side-card">
          <div style={{ fontSize: 18, fontWeight: 850 }}>Nový uživatel</div>
          <div style={{ color: "var(--muted)", marginTop: 4 }}>Vytvoří účet zaměstnance. Úvazky se přidávají zvlášť přímo u uživatele.</div>
          <form onSubmit={onCreate} className="stack" style={{ gap: 12, marginTop: 12 }}>
            <div className="admin-form-grid">
              <div>
                <div className="label">Jméno</div>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Např. Jan Novák" />
              </div>
              <div>
                <div className="label">E-mail</div>
                <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jan@example.cz" />
              </div>
              <div>
                <div className="label">Telefon</div>
                <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+420..." />
              </div>
              <div>
                <div className="label">Role</div>
                <select className="input" value="employee" disabled>
                  <option value="employee">Zaměstnanec</option>
                </select>
              </div>
              <div>
                <div className="label">Počáteční heslo</div>
                <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="volitelné" />
              </div>
              <label style={{ display: "grid", gap: 6, alignContent: "end" }}>
                <span className="label">Ruční aktivace</span>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setIsActive((value) => !value)}
                  style={isActive ? undefined : { borderColor: "rgba(239,68,68,0.28)", color: "#b91c1c" }}
                >
                  {isActive ? "Aktivovat" : "Deaktivovat"}
                </button>
              </label>
            </div>
            <button type="submit" className="btn solid" disabled={saving}>
              {saving ? "Ukládám…" : "Přidat uživatele"}
            </button>
          </form>
        </section>

        <section className="card pad">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontWeight: 850 }}>Seznam uživatelů</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                Ruční deaktivace účtu zůstává zachovaná. Přihlašovací stav se navíc odvozuje z přístupového okna nad úvazky.
              </div>
            </div>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700 }}>
              <input type="checkbox" checked={showInactiveUsers} onChange={(e) => setShowInactiveUsers(e.target.checked)} />
              Zobrazit i neaktivní
            </label>
          </div>
          {loading ? <div style={{ marginTop: 12, color: "var(--muted)" }}>Načítám…</div> : null}
          {!loading ? <div style={{ marginTop: 10, fontSize: 12, color: "var(--muted)" }}>Zobrazeno {visibleUsers.length} z {users.length} uživatelů.</div> : null}

          <div style={{ display: "grid", gap: 16, marginTop: 14 }}>
            {visibleUsers.map((user) => {
              const createForm = employmentForms[user.id] ?? emptyEmploymentForm();
              const userEditDirty =
                editingUserId === user.id
                  ? isUserEditDirty(user, {
                      name: editName,
                      email: editEmail,
                      phone: editPhone,
                      password: editPassword,
                      is_active: editIsActive,
                    })
                  : false;
              return (
                <div key={user.id} style={{ border: "1px solid var(--kb-border)", borderRadius: 16, padding: 16, display: "grid", gap: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontWeight: 850, fontSize: 18 }}>{user.name}</div>
                      <div style={{ color: "var(--muted)", marginTop: 4 }}>{user.email}</div>
                      {user.phone ? <div style={{ color: "var(--muted)", marginTop: 2 }}>{user.phone}</div> : null}
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
                      <span className="chip">{user.role === "employee" ? "Zaměstnanec" : user.role}</span>
                      <span className="chip" style={loginStatusTone(user)}>
                        {loginStatusLabel(user)}
                      </span>
                      <span className="chip" style={user.has_password ? { background: "rgba(16,185,129,0.09)", borderColor: "rgba(16,185,129,0.24)", color: "#047857" } : undefined}>
                        {user.has_password ? "Heslo nastaveno" : "Bez hesla"}
                      </span>
                    </div>
                  </div>

                  {user.login_status_reason ? <div style={{ fontSize: 12, color: "var(--muted)" }}>{user.login_status_reason}</div> : null}

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" className="btn sm" onClick={() => startEdit(user)} disabled={saving}>
                      Upravit účet
                    </button>
                    <button type="button" className="btn sm" onClick={() => sendReset(user.id)} disabled={saving}>
                      Poslat reset hesla
                    </button>
                    <button type="button" className="btn sm" onClick={() => unlockUser(user)} disabled={saving || !user.is_locked}>
                      Odblokovat
                    </button>
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() =>
                        adminUpdateUser(user.id, { is_active: !user.is_active, role: "employee" }).then(load).catch((err) => setError(errorMessage(err, "Změna aktivace se nezdařila.")))
                      }
                      disabled={saving}
                      style={!user.is_active ? undefined : { borderColor: "rgba(239,68,68,0.28)", color: "#b91c1c" }}
                    >
                      {user.is_active ? "Deaktivovat" : "Aktivovat"}
                    </button>
                    <button type="button" className="btn sm" onClick={() => deleteUser(user)} disabled={saving} style={{ borderColor: "rgba(239,68,68,0.28)", color: "#b91c1c" }}>
                      Smazat uživatele
                    </button>
                  </div>

                  {editingUserId === user.id ? (
                    <form onSubmit={onUpdate} className="stack" style={{ gap: 12 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 10,
                          flexWrap: "wrap",
                          alignItems: "center",
                          padding: "10px 12px",
                          borderRadius: 12,
                          background: userEditDirty ? "rgba(245,158,11,0.1)" : "rgba(35,41,44,0.04)",
                          border: userEditDirty ? "1px solid rgba(245,158,11,0.24)" : "1px solid rgba(35,41,44,0.08)",
                        }}
                      >
                        <div style={{ fontSize: 13, color: userEditDirty ? "#b45309" : "var(--muted)", fontWeight: 700 }}>
                          {userEditDirty ? "Změny profilu čekají na uložení." : "Profil je beze změn."}
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button type="button" className="btn" onClick={cancelEdit} disabled={saving}>
                            Zrušit
                          </button>
                          <button type="submit" className="btn solid" disabled={saving || !userEditDirty}>
                            {saving ? "Ukládám…" : "Uložit profil"}
                          </button>
                        </div>
                      </div>
                      <div className="admin-form-grid">
                        <div>
                          <div className="label">Jméno</div>
                          <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)} />
                        </div>
                        <div>
                          <div className="label">E-mail</div>
                          <input className="input" type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} />
                        </div>
                        <div>
                          <div className="label">Telefon</div>
                          <input className="input" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} />
                        </div>
                        <div>
                          <div className="label">Nové heslo</div>
                          <input className="input" type="password" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} placeholder="ponechte prázdné" />
                        </div>
                        <label style={{ display: "grid", gap: 6, alignContent: "end" }}>
                          <span className="label">Ruční aktivace</span>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => setEditIsActive((value) => !value)}
                            style={editIsActive ? undefined : { borderColor: "rgba(239,68,68,0.28)", color: "#b91c1c" }}
                          >
                            {editIsActive ? "Aktivovat" : "Deaktivovat"}
                          </button>
                        </label>
                      </div>
                    </form>
                  ) : null}

                  <section style={{ display: "grid", gap: 10 }}>
                    <div style={{ fontWeight: 800 }}>Úvazky</div>
                    {user.employments.length === 0 ? <div style={{ fontSize: 13, color: "var(--muted)" }}>Uživatel zatím nemá žádný úvazek.</div> : null}
                    {user.employments.map((employment) => {
                      const isEditing = editingEmploymentId === employment.id;
                      const draft = employmentDrafts[employment.id] ?? fromEmployment(employment);
                      return (
                        <div key={employment.id} style={{ border: "1px solid rgba(35,41,44,0.12)", borderRadius: 14, padding: 12, display: "grid", gap: 10 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                            <div>
                              <div style={{ fontWeight: 700 }}>{employment.label}</div>
                              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                                {employment.start_date} až {employment.end_date ?? "na dobu neurčitou"}
                              </div>
                            </div>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <button type="button" className="btn sm" onClick={() => setEditingEmploymentId(isEditing ? null : employment.id)}>
                                {isEditing ? "Zavřít" : "Upravit úvazek"}
                              </button>
                              <button type="button" className="btn sm" onClick={() => removeEmployment(employment)} style={{ borderColor: "rgba(239,68,68,0.28)", color: "#b91c1c" }}>
                                Smazat
                              </button>
                            </div>
                          </div>

                          {isEditing ? (
                            <div className="admin-form-grid">
                              <div>
                                <div className="label">Název úvazku</div>
                                <input className="input" value={draft.title} onChange={(e) => updateExistingEmploymentForm(employment.id, { title: e.target.value }, employment)} />
                              </div>
                              <div>
                                <div className="label">Typ</div>
                                <select className="input" value={draft.employment_type} onChange={(e) => updateExistingEmploymentForm(employment.id, { employment_type: e.target.value as EmploymentTemplate }, employment)}>
                                  <option value="DPP_DPC">DPP/DPČ</option>
                                  <option value="HPP">HPP</option>
                                </select>
                              </div>
                              <div>
                                <div className="label">Začátek</div>
                                <input className="input" type="date" value={draft.start_date} onChange={(e) => updateExistingEmploymentForm(employment.id, { start_date: e.target.value }, employment)} />
                              </div>
                              <div>
                                <div className="label">Konec</div>
                                <input className="input" type="date" disabled={draft.is_indefinite} value={draft.end_date} onChange={(e) => updateExistingEmploymentForm(employment.id, { end_date: e.target.value }, employment)} />
                              </div>
                              <label style={{ display: "grid", gap: 6, alignContent: "end" }}>
                                <span className="label">Na dobu neurčitou</span>
                                <input type="checkbox" checked={draft.is_indefinite} onChange={(e) => updateExistingEmploymentForm(employment.id, { is_indefinite: e.target.checked }, employment)} />
                              </label>
                              <div style={{ display: "flex", alignItems: "end" }}>
                                <button type="button" className="btn solid" onClick={() => saveEmployment(user, employment)} disabled={saving}>
                                  Uložit úvazek
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}

                    <div style={{ borderTop: "1px solid rgba(35,41,44,0.08)", paddingTop: 12, display: "grid", gap: 10 }}>
                      <div style={{ fontWeight: 700 }}>Přidat úvazek</div>
                      <div className="admin-form-grid">
                        <div>
                          <div className="label">Název úvazku</div>
                          <input className="input" value={createForm.title} onChange={(e) => updateNewEmploymentForm(user.id, { title: e.target.value })} placeholder="Např. Recepce" />
                        </div>
                        <div>
                          <div className="label">Typ</div>
                          <select className="input" value={createForm.employment_type} onChange={(e) => updateNewEmploymentForm(user.id, { employment_type: e.target.value as EmploymentTemplate })}>
                            <option value="DPP_DPC">DPP/DPČ</option>
                            <option value="HPP">HPP</option>
                          </select>
                        </div>
                        <div>
                          <div className="label">Začátek</div>
                          <input className="input" type="date" value={createForm.start_date} onChange={(e) => updateNewEmploymentForm(user.id, { start_date: e.target.value })} />
                        </div>
                        <div>
                          <div className="label">Konec</div>
                          <input className="input" type="date" disabled={createForm.is_indefinite} value={createForm.end_date} onChange={(e) => updateNewEmploymentForm(user.id, { end_date: e.target.value })} />
                        </div>
                        <label style={{ display: "grid", gap: 6, alignContent: "end" }}>
                          <span className="label">Na dobu neurčitou</span>
                          <input type="checkbox" checked={createForm.is_indefinite} onChange={(e) => updateNewEmploymentForm(user.id, { is_indefinite: e.target.checked })} />
                        </label>
                        <div style={{ display: "flex", alignItems: "end" }}>
                          <button type="button" className="btn solid" onClick={() => createEmployment(user.id)} disabled={saving}>
                            Přidat úvazek
                          </button>
                        </div>
                      </div>
                    </div>
                  </section>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
