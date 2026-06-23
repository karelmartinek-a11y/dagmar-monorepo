import { useEffect, useMemo, useState } from "react";
import {
  adminCreateIntegrationClient,
  adminDisableIntegrationClient,
  adminEnableIntegrationClient,
  adminGetIntegrationClientDetail,
  adminGetIntegrationClientOptions,
  adminListIntegrationClients,
  adminRevokeIntegrationSecret,
  adminRotateIntegrationClient,
  adminUpdateIntegrationClient,
  type IntegrationClientDetail,
  type IntegrationClientListItem,
  type IntegrationClientOptions,
} from "../api/admin";
import { ConfirmDialog, EmptyState, InlineNotice, PageHeader, SidePanel, StateBadge, Toast } from "../components/admin/AdminUI";
import {
  applyPermissionProfile,
  buildDraftFromClient,
  buildEmptyIntegrationDraft,
  integrationScopeWarning,
  normalizeScopeSelection,
  type IntegrationDraft,
} from "../utils/adminIntegrations";
import Button from "../ui/Button";
import { employmentTemplateLabel } from "../utils/uiLabels";

function errorMessage(err: unknown, fallback: string) {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

type SecretModalState =
  | { kind: "closed" }
  | { kind: "open"; clientName: string; token: string; fingerprint: string | null; last4: string | null };

type ActionState =
  | { kind: "none" }
  | { kind: "disable"; client: IntegrationClientListItem }
  | { kind: "enable"; client: IntegrationClientListItem }
  | { kind: "revoke"; client: IntegrationClientListItem }
  | { kind: "rotate"; client: IntegrationClientListItem };

function statusTone(status: IntegrationClientListItem["status"]) {
  if (status === "ACTIVE") return "ok" as const;
  if (status === "DISABLED" || status === "EXPIRED") return "warning" as const;
  return "danger" as const;
}

function matchesKnownProfile(draft: IntegrationDraft, options: IntegrationClientOptions): string | null {
  const joined = normalizeScopeSelection(draft.selected_scope_ids).join(",");
  const match = options.permission_profiles.find((profile) => normalizeScopeSelection(profile.scopes).join(",") === joined);
  return match?.id ?? null;
}

function dateTimeLabel(value: string | null): string {
  if (!value) return "Nikdy";
  return new Date(value).toLocaleString("cs-CZ");
}

function initialOptionsState(): IntegrationClientOptions {
  return {
    name_rules: { min_length: 3, max_length: 80, allowed_hint: "", forbidden_hint: "" },
    scopes: [],
    permission_profiles: [],
    data_scope_modes: [],
    employees: [],
    employments: [],
    ip_restriction_modes: [],
    expiration_options: [],
    statuses: [],
  };
}

export default function AdminIntegrationsPage() {
  const [options, setOptions] = useState<IntegrationClientOptions>(initialOptionsState);
  const [clients, setClients] = useState<IntegrationClientListItem[]>([]);
  const [selectedClient, setSelectedClient] = useState<IntegrationClientDetail | null>(null);
  const [createDraft, setCreateDraft] = useState<IntegrationDraft | null>(null);
  const [editDraft, setEditDraft] = useState<IntegrationDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [actionState, setActionState] = useState<ActionState>({ kind: "none" });
  const [secretState, setSecretState] = useState<SecretModalState>({ kind: "closed" });

  async function loadBase() {
    setLoading(true);
    setError(null);
    try {
      const [nextOptions, nextClients] = await Promise.all([
        adminGetIntegrationClientOptions(),
        adminListIntegrationClients(),
      ]);
      setOptions(nextOptions);
      setClients(nextClients);
      setCreateDraft((current) => current ?? buildEmptyIntegrationDraft(nextOptions));
    } catch (err) {
      setError(errorMessage(err, "Nepodařilo se načíst nastavení integrací."));
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(clientId: number) {
    setDetailLoading(true);
    setError(null);
    try {
      const detail = await adminGetIntegrationClientDetail(clientId);
      setSelectedClient(detail);
      setEditDraft(buildDraftFromClient(detail));
    } catch (err) {
      setError(errorMessage(err, "Nepodařilo se načíst detail integrace."));
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    void loadBase();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const activeCount = useMemo(() => clients.filter((client) => client.status === "ACTIVE").length, [clients]);

  async function refreshClientsPreservingSelection(clientId?: number) {
    const nextClients = await adminListIntegrationClients();
    setClients(nextClients);
    if (clientId) {
      await loadDetail(clientId);
    }
  }

  async function onCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createDraft) return;
    setBusy(true);
    setError(null);
    try {
      const result = await adminCreateIntegrationClient({
        name: createDraft.name.trim(),
        selected_scope_ids: createDraft.selected_scope_ids,
        data_scope_mode: createDraft.data_scope_mode,
        selected_employee_ids: createDraft.selected_employee_ids,
        selected_employment_ids: createDraft.selected_employment_ids,
        include_inactive_employments: createDraft.include_inactive_employments,
        ip_restriction_mode: createDraft.ip_restriction_mode,
        expiration_choice: createDraft.expiration_choice,
        custom_expiration_date: createDraft.custom_expiration_date,
      });
      setSecretState({
        kind: "open",
        clientName: result.client.name,
        token: result.plaintext_token,
        fingerprint: result.client.active_secret_fingerprint,
        last4: result.client.active_secret_last4,
      });
      setSelectedClient(result.client);
      setEditDraft(buildDraftFromClient(result.client));
      await loadBase();
      setCreateDraft(buildEmptyIntegrationDraft(options));
      setToast("Integrace byla vytvořena.");
    } catch (err) {
      setError(errorMessage(err, "Nepodařilo se vytvořit integračního klienta."));
    } finally {
      setBusy(false);
    }
  }

  async function onSaveDetail() {
    if (!selectedClient || !editDraft) return;
    setBusy(true);
    setError(null);
    try {
      const result = await adminUpdateIntegrationClient(selectedClient.id, {
        name: editDraft.name.trim(),
        selected_scope_ids: editDraft.selected_scope_ids,
        data_scope_mode: editDraft.data_scope_mode,
        selected_employee_ids: editDraft.selected_employee_ids,
        selected_employment_ids: editDraft.selected_employment_ids,
        include_inactive_employments: editDraft.include_inactive_employments,
        ip_restriction_mode: editDraft.ip_restriction_mode,
        expiration_choice: editDraft.expiration_choice,
        custom_expiration_date: editDraft.custom_expiration_date,
      });
      setSelectedClient(result);
      setEditDraft(buildDraftFromClient(result));
      await refreshClientsPreservingSelection(result.id);
      setToast("Nastavení integrace bylo uloženo.");
    } catch (err) {
      setError(errorMessage(err, "Nepodařilo se uložit nastavení integrace."));
    } finally {
      setBusy(false);
    }
  }

  async function runAction(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      setActionState({ kind: "none" });
    } catch (err) {
      setError(errorMessage(err, "Operace nad integračním klientem selhala."));
    } finally {
      setBusy(false);
    }
  }

  function toggleScope(target: "create" | "edit", scopeId: string, checked: boolean) {
    const setter = target === "create" ? setCreateDraft : setEditDraft;
    setter((current) => {
      if (!current) return current;
      const nextScopeIds = checked
        ? normalizeScopeSelection([...current.selected_scope_ids, scopeId])
        : current.selected_scope_ids.filter((item) => item !== scopeId);
      return {
        ...current,
        selected_scope_ids: nextScopeIds,
        permission_profile_id: matchesKnownProfile({ ...current, selected_scope_ids: nextScopeIds }, options),
      };
    });
  }

  function toggleId(target: "create" | "edit", field: "selected_employee_ids" | "selected_employment_ids", id: number, checked: boolean) {
    const setter = target === "create" ? setCreateDraft : setEditDraft;
    setter((current) => {
      if (!current) return current;
      const currentIds = current[field];
      const nextIds = checked ? [...currentIds, id] : currentIds.filter((item) => item !== id);
      return { ...current, [field]: Array.from(new Set(nextIds)).sort((a, b) => a - b) };
    });
  }

  async function copyToken() {
    if (secretState.kind !== "open") return;
    try {
      await navigator.clipboard.writeText(secretState.token);
      setToast("Token byl zkopírován do schránky.");
    } catch {
      setToast("Token se nepodařilo zkopírovat.");
    }
  }

  return (
    <div className="admin-page-grid">
      <PageHeader
        eyebrow="Externí API"
        title="Integrace"
        description="Správce zadává ručně jen název integrace. Oprávnění, rozsah dat, IP režim i expirace se vybírají z validovaných možností."
        actions={
          <div className="admin-action-stack">
            <Button type="button" variant="ghost" onClick={() => void loadBase()} disabled={loading || busy}>
              Obnovit
            </Button>
          </div>
        }
      />

      <div className="admin-overview-grid">
        <section className="admin-surface">
          <div className="admin-surface-head">
            <div>
              <div className="admin-surface-title">Nová integrace</div>
              <div className="admin-surface-subtitle">Token se zobrazí jen jednou. Později uvidíte už jen fingerprint a poslední 4 znaky.</div>
            </div>
          </div>
          {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
          {loading || !createDraft ? (
            <InlineNotice>Načítám validované možnosti…</InlineNotice>
          ) : (
            <IntegrationForm
              draft={createDraft}
              options={options}
              busy={busy}
              titlePrefix="create"
              submitLabel="Vytvořit integraci"
              onChange={setCreateDraft}
              onSubmit={onCreate}
              onToggleScope={toggleScope}
              onToggleId={toggleId}
            />
          )}
        </section>

        <section className="admin-surface">
          <div className="admin-surface-head">
            <div>
              <div className="admin-surface-title">Existující integrace</div>
              <div className="admin-surface-subtitle">{clients.length} klientů, z toho {activeCount} aktivních.</div>
            </div>
          </div>
          {loading ? (
            <InlineNotice>Načítám integrační klienty…</InlineNotice>
          ) : clients.length === 0 ? (
            <EmptyState title="Žádné integrace" description="Zatím nebyla vytvořena žádná integrační klientská aplikace." />
          ) : (
            <div className="admin-list">
              {clients.map((client) => (
                <div key={client.id} className="admin-list-row">
                  <div>
                    <div className="admin-list-title">{client.name}</div>
                    <div className="admin-list-subtitle">{client.scope_summary}</div>
                    <div className="admin-list-subtitle">{client.data_scope_summary} · {client.ip_restriction_summary}</div>
                    <div className="admin-list-subtitle">
                      Exspirace {dateTimeLabel(client.expires_at)} · Poslední použití {dateTimeLabel(client.last_used_at)}
                    </div>
                  </div>
                  <div className="admin-action-stack">
                    <StateBadge tone={statusTone(client.status)}>{client.status_label}</StateBadge>
                    <div className="admin-action-row">
                      <Button type="button" variant="secondary" onClick={() => void loadDetail(client.id)} disabled={busy}>
                        Otevřít nastavení
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => setActionState({ kind: "rotate", client })} disabled={busy}>
                        Rotovat token
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <SidePanel
        open={selectedClient !== null}
        title={selectedClient?.name ?? "Detail integrace"}
        subtitle={selectedClient ? `${selectedClient.status_label} · ${selectedClient.scope_summary}` : undefined}
        onClose={() => {
          setSelectedClient(null);
          setEditDraft(null);
        }}
        footer={
          selectedClient && editDraft ? (
            <div className="admin-action-row">
              <Button type="button" variant="primary" onClick={() => void onSaveDetail()} disabled={busy}>
                Uložit změny
              </Button>
              {selectedClient.status === "ACTIVE" || selectedClient.status === "EXPIRED" ? (
                <Button type="button" variant="ghost" onClick={() => setActionState({ kind: "disable", client: selectedClient })} disabled={busy}>
                  Deaktivovat
                </Button>
              ) : null}
              {selectedClient.status === "DISABLED" ? (
                <Button type="button" variant="secondary" onClick={() => setActionState({ kind: "enable", client: selectedClient })} disabled={busy}>
                  Aktivovat
                </Button>
              ) : null}
              {selectedClient.status !== "REVOKED" ? (
                <Button type="button" variant="danger" onClick={() => setActionState({ kind: "revoke", client: selectedClient })} disabled={busy}>
                  Revokovat
                </Button>
              ) : null}
            </div>
          ) : undefined
        }
      >
        {detailLoading || !selectedClient || !editDraft ? (
          <InlineNotice>Načítám detail integrace…</InlineNotice>
        ) : (
          <div className="admin-stack">
            <section className="admin-surface">
              <div className="admin-surface-head">
                <div>
                  <div className="admin-surface-title">Audit a provozní informace</div>
                  <div className="admin-surface-subtitle">Jen bezpečně zobrazitelné údaje z backend audit logu.</div>
                </div>
              </div>
              <div className="admin-form-grid">
                <div>
                  <div className="kb-label">Fingerprint tokenu</div>
                  <div>{selectedClient.active_secret_fingerprint || "—"}</div>
                </div>
                <div>
                  <div className="kb-label">Poslední 4 znaky</div>
                  <div>{selectedClient.active_secret_last4 || "—"}</div>
                </div>
                <div>
                  <div className="kb-label">Počet posledních požadavků</div>
                  <div>{selectedClient.audit_summary.request_count}</div>
                </div>
                <div>
                  <div className="kb-label">Poslední zdrojová IP</div>
                  <div>{selectedClient.audit_summary.last_source_ip || "—"}</div>
                </div>
                <div>
                  <div className="kb-label">Poslední path</div>
                  <div>{selectedClient.audit_summary.last_path || "—"}</div>
                </div>
                <div>
                  <div className="kb-label">Poslední chyba</div>
                  <div>
                    {selectedClient.audit_summary.last_error
                      ? `${selectedClient.audit_summary.last_error.status_code} ${selectedClient.audit_summary.last_error.error_code ?? ""}`.trim()
                      : "Bez poslední chyby"}
                  </div>
                </div>
              </div>
            </section>
            <section className="admin-surface">
              <div className="admin-surface-head">
                <div>
                  <div className="admin-surface-title">Nastavení integrace</div>
                  <div className="admin-surface-subtitle">Změna nastavení token automaticky nerotuje.</div>
                </div>
              </div>
              <IntegrationForm
                draft={editDraft}
                options={options}
                busy={busy}
                titlePrefix="edit"
                submitLabel="Uložit"
                onChange={setEditDraft}
                onSubmit={(event) => {
                  event.preventDefault();
                  void onSaveDetail();
                }}
                onToggleScope={toggleScope}
                onToggleId={toggleId}
              />
            </section>
          </div>
        )}
      </SidePanel>

      <ConfirmDialog
        open={actionState.kind !== "none"}
        title={
          actionState.kind === "disable"
            ? "Deaktivovat integraci"
            : actionState.kind === "enable"
              ? "Aktivovat integraci"
              : actionState.kind === "revoke"
                ? "Revokovat tokeny integrace"
                : actionState.kind === "rotate"
                  ? "Rotovat token integrace"
                  : ""
        }
        description={
          actionState.kind === "rotate"
            ? "Starý token přestane podle backend implementace okamžitě platit a nový plaintext token se ukáže jen jednou."
            : actionState.kind === "revoke"
              ? "Revokace zneplatní všechny aktivní tokeny vybraného klienta."
              : "Tato změna upraví produkční stav integračního klienta."
        }
        confirmLabel={
          actionState.kind === "disable"
            ? "Deaktivovat"
            : actionState.kind === "enable"
              ? "Aktivovat"
              : actionState.kind === "revoke"
                ? "Revokovat"
                : "Rotovat"
        }
        tone={actionState.kind === "revoke" ? "danger" : "default"}
        busy={busy}
        onClose={() => setActionState({ kind: "none" })}
        onConfirm={() =>
          void runAction(async () => {
            if (actionState.kind === "disable") {
              await adminDisableIntegrationClient(actionState.client.id);
              await refreshClientsPreservingSelection(selectedClient?.id);
              setToast("Integrace byla deaktivována.");
              return;
            }
            if (actionState.kind === "enable") {
              await adminEnableIntegrationClient(actionState.client.id);
              await refreshClientsPreservingSelection(selectedClient?.id);
              setToast("Integrace byla aktivována.");
              return;
            }
            if (actionState.kind === "revoke") {
              await adminRevokeIntegrationSecret(actionState.client.id);
              await refreshClientsPreservingSelection(selectedClient?.id);
              setToast("Tokeny integrace byly revokovány.");
              return;
            }
            if (actionState.kind === "rotate") {
              const result = await adminRotateIntegrationClient(actionState.client.id);
              setSecretState({
                kind: "open",
                clientName: result.client.name,
                token: result.plaintext_token,
                fingerprint: result.client.active_secret_fingerprint,
                last4: result.client.active_secret_last4,
              });
              await refreshClientsPreservingSelection(result.client.id);
              setToast("Token byl úspěšně rotován.");
            }
          })
        }
      />

      <ConfirmDialog
        open={secretState.kind === "open"}
        title="Jednorázově zobrazený token"
        description={
          secretState.kind === "open" ? (
            <div className="admin-stack">
              <div>Klient: <strong>{secretState.clientName}</strong></div>
              <div>Tento token už později v administraci neuvidíte. Předávejte ho jen bezpečným kanálem cílovému systému.</div>
              <div className="admin-dialog-stat-value" style={{ wordBreak: "break-all" }}>{secretState.token}</div>
              <div>Fingerprint: {secretState.fingerprint || "—"} · last4: {secretState.last4 || "—"}</div>
              <div className="admin-action-row">
                <Button type="button" variant="secondary" onClick={() => void copyToken()}>
                  Kopírovat token
                </Button>
              </div>
            </div>
          ) : undefined
        }
        confirmLabel="Zavřít"
        onConfirm={() => setSecretState({ kind: "closed" })}
        onClose={() => setSecretState({ kind: "closed" })}
      />

      <Toast message={toast} tone="ok" />
    </div>
  );
}

function IntegrationForm(props: {
  draft: IntegrationDraft;
  options: IntegrationClientOptions;
  busy: boolean;
  titlePrefix: "create" | "edit";
  submitLabel: string;
  onChange: React.Dispatch<React.SetStateAction<IntegrationDraft | null>>;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onToggleScope: (target: "create" | "edit", scopeId: string, checked: boolean) => void;
  onToggleId: (
    target: "create" | "edit",
    field: "selected_employee_ids" | "selected_employment_ids",
    id: number,
    checked: boolean,
  ) => void;
}) {
  const { draft, options, titlePrefix, busy, onChange } = props;

  return (
    <form className="admin-stack" onSubmit={props.onSubmit}>
      <section className="admin-stack">
        <div>
          <label className="kb-label" htmlFor={`${titlePrefix}-integration-name`}>Název integrace</label>
          <input
            id={`${titlePrefix}-integration-name`}
            className="kb-input"
            value={draft.name}
            onChange={(event) => onChange((current) => current ? { ...current, name: event.target.value } : current)}
            placeholder="Např. Mzdový export hotelu"
            required
          />
          <div className="admin-surface-subtitle">{options.name_rules.allowed_hint} {options.name_rules.forbidden_hint}</div>
        </div>
      </section>

      <section className="admin-stack">
        <div className="kb-label">Profil oprávnění</div>
        <select
          className="kb-select"
          value={draft.permission_profile_id ?? ""}
          onChange={(event) => onChange((current) => current ? applyPermissionProfile(current, event.target.value, options) : current)}
        >
          <option value="">Vlastní kombinace oprávnění</option>
          {options.permission_profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>{profile.label}</option>
          ))}
        </select>
        <div className="admin-checkbox-list">
          {options.scopes.map((scope) => {
            const checked = draft.selected_scope_ids.includes(scope.id);
            const fieldId = `${titlePrefix}-scope-${scope.id}`;
            return (
              <label key={scope.id} className="admin-checkbox-row" htmlFor={fieldId}>
                <input
                  id={fieldId}
                  type="checkbox"
                  checked={checked}
                  disabled={!scope.available}
                  onChange={(event) => props.onToggleScope(titlePrefix, scope.id, event.target.checked)}
                />
                <span>
                  <strong>{scope.label}</strong>
                  <div>{scope.description}</div>
                  <div>{scope.data_access}</div>
                  <div>{scope.when_to_enable}</div>
                  <div>Riziko: {scope.risk}</div>
                  {integrationScopeWarning(scope.id) ? <InlineNotice tone="warning">{integrationScopeWarning(scope.id)}</InlineNotice> : null}
                  {!scope.available ? <div>{scope.unavailable_reason}</div> : null}
                </span>
              </label>
            );
          })}
        </div>
      </section>

      <section className="admin-stack">
        <div className="kb-label">Rozsah dat</div>
        {options.data_scope_modes.map((mode) => {
          const fieldId = `${titlePrefix}-scope-mode-${mode.id}`;
          return (
            <label key={mode.id} className="admin-checkbox-row" htmlFor={fieldId}>
              <input
                id={fieldId}
                type="radio"
                name={`${titlePrefix}-data-scope-mode`}
                checked={draft.data_scope_mode === mode.id}
                onChange={() => onChange((current) => current ? { ...current, data_scope_mode: mode.id as IntegrationDraft["data_scope_mode"] } : current)}
              />
              <span>
                <strong>{mode.label}</strong>
                <div>{mode.description}</div>
              </span>
            </label>
          );
        })}
        {draft.data_scope_mode === "SELECTED_EMPLOYEES" ? (
          <div className="admin-stack">
            <label className="admin-checkbox-row" htmlFor={`${titlePrefix}-include-inactive`}>
              <input
                id={`${titlePrefix}-include-inactive`}
                type="checkbox"
                checked={draft.include_inactive_employments}
                onChange={(event) => onChange((current) => current ? { ...current, include_inactive_employments: event.target.checked } : current)}
              />
              <span>
                <strong>Včetně neaktivních úvazků vybraných zaměstnanců</strong>
                <div>Docházka, plán služeb i zámky jsou stále vedené podle employment_id konkrétních úvazků.</div>
              </span>
            </label>
            <div className="admin-checkbox-list">
              {options.employees.map((employee) => (
                <label key={employee.id} className="admin-checkbox-row" htmlFor={`${titlePrefix}-employee-${employee.id}`}>
                  <input
                    id={`${titlePrefix}-employee-${employee.id}`}
                    type="checkbox"
                    checked={draft.selected_employee_ids.includes(employee.id)}
                    onChange={(event) => props.onToggleId(titlePrefix, "selected_employee_ids", employee.id, event.target.checked)}
                  />
                  <span>
                    <strong>{employee.label}</strong>
                    <div>{employee.email || "Bez e-mailu"} · {employee.active_employment_count}/{employee.employment_count} aktivních úvazků</div>
                    <div>{employee.employment_labels.join(" | ")}</div>
                  </span>
                </label>
              ))}
            </div>
          </div>
        ) : null}
        {draft.data_scope_mode === "SELECTED_EMPLOYMENTS" ? (
          <div className="admin-checkbox-list">
            {options.employments.map((employment) => (
              <label key={employment.id} className="admin-checkbox-row" htmlFor={`${titlePrefix}-employment-${employment.id}`}>
                <input
                  id={`${titlePrefix}-employment-${employment.id}`}
                  type="checkbox"
                  checked={draft.selected_employment_ids.includes(employment.id)}
                  onChange={(event) => props.onToggleId(titlePrefix, "selected_employment_ids", employment.id, event.target.checked)}
                />
                <span>
                  <strong>{employment.label}</strong>
                  <div>{employmentTemplateLabel(employment.employment_type)} · {employment.start_date}{employment.end_date ? ` až ${employment.end_date}` : ""}</div>
                  <div>{employment.is_active ? "Aktivní úvazek" : "Neaktivní úvazek"} · Data se předávají podle employment_id.</div>
                </span>
              </label>
            ))}
          </div>
        ) : null}
      </section>

      <section className="admin-form-grid">
        <div>
          <label className="kb-label" htmlFor={`${titlePrefix}-ip-mode`}>IP omezení</label>
          <select
            id={`${titlePrefix}-ip-mode`}
            className="kb-select"
            value={draft.ip_restriction_mode}
            onChange={(event) => onChange((current) => current ? { ...current, ip_restriction_mode: event.target.value as IntegrationDraft["ip_restriction_mode"] } : current)}
          >
            {options.ip_restriction_modes.map((mode) => (
              <option key={mode.id} value={mode.id} disabled={!mode.editable && mode.id !== draft.ip_restriction_mode}>
                {mode.label}
              </option>
            ))}
          </select>
          <div className="admin-surface-subtitle">
            {options.ip_restriction_modes.find((item) => item.id === draft.ip_restriction_mode)?.description}
          </div>
        </div>
        <div>
          <label className="kb-label" htmlFor={`${titlePrefix}-expiration`}>Platnost tokenu</label>
          <select
            id={`${titlePrefix}-expiration`}
            className="kb-select"
            value={draft.expiration_choice}
            onChange={(event) => onChange((current) => current ? { ...current, expiration_choice: event.target.value as IntegrationDraft["expiration_choice"] } : current)}
          >
            {options.expiration_options.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
          <div className="admin-surface-subtitle">
            {options.expiration_options.find((item) => item.id === draft.expiration_choice)?.description}
          </div>
          {draft.expiration_choice === "CUSTOM_DATE" ? (
            <div style={{ marginTop: 12 }}>
              <label className="kb-label" htmlFor={`${titlePrefix}-custom-expiration`}>Vlastní datum expirace</label>
              <input
                id={`${titlePrefix}-custom-expiration`}
                className="kb-input"
                type="date"
                value={draft.custom_expiration_date ?? ""}
                onChange={(event) => onChange((current) => current ? { ...current, custom_expiration_date: event.target.value || null } : current)}
              />
            </div>
          ) : null}
        </div>
      </section>

      <div className="admin-action-row">
        <Button type="submit" variant="primary" disabled={busy || !draft.name.trim()}>
          {busy ? "Ukládám…" : props.submitLabel}
        </Button>
      </div>
    </form>
  );
}
