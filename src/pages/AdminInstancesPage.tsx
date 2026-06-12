import { useEffect, useMemo, useState } from "react";
import {
  adminActivateInstance,
  adminDeactivateInstance,
  adminDeleteInstance,
  adminDeletePendingInstances,
  adminListInstances,
  adminMergeInstances,
  adminRenameInstance,
  adminRevokeInstance,
  adminSetTemplate,
  type AdminInstance,
} from "../api/admin";
import type { EmploymentTemplate } from "../types/employment";
import { ConfirmDialog, EmptyState, FilterBar, InlineNotice, PageHeader, StateBadge, Toast } from "../components/admin/AdminUI";
import Button from "../ui/Button";

function errorMessage(err: unknown, fallback: string) {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

type StatusFilter = "ALL" | "PENDING" | "ACTIVE" | "REVOKED" | "DEACTIVATED";
type ActionState =
  | { kind: "none" }
  | { kind: "delete"; instance: AdminInstance }
  | { kind: "revoke"; instance: AdminInstance }
  | { kind: "deactivate"; instance: AdminInstance }
  | { kind: "deletePending" };

export default function AdminInstancesPage() {
  const [instances, setInstances] = useState<AdminInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [typeFilter, setTypeFilter] = useState<"ALL" | "WEB" | "ANDROID">("ALL");
  const [selected, setSelected] = useState<AdminInstance | null>(null);
  const [actionState, setActionState] = useState<ActionState>({ kind: "none" });
  const [draftName, setDraftName] = useState("");
  const [draftTemplate, setDraftTemplate] = useState<EmploymentTemplate>("DPP_DPC");
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [mergeSourceIds, setMergeSourceIds] = useState<string[]>([]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await adminListInstances();
      setInstances(res.instances);
      setSelected((current) => res.instances.find((item) => item.id === current?.id) ?? current);
    } catch (err) {
      setError(errorMessage(err, "Nepodařilo se načíst zařízení."));
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

  useEffect(() => {
    if (!selected) return;
    setDraftName(selected.display_name || "");
    setDraftTemplate(selected.employment_template);
    setMergeTargetId(selected.status === "ACTIVE" ? selected.id : "");
    setMergeSourceIds([]);
  }, [selected]);

  const filtered = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    return instances.filter((item) => {
      if (statusFilter !== "ALL" && item.status !== statusFilter) return false;
      if (typeFilter !== "ALL" && item.client_type !== typeFilter) return false;
      if (tokens.length === 0) return true;
      const hay = `${item.id} ${item.display_name || ""} ${item.client_type} ${item.status}`.toLowerCase();
      return tokens.every((token) => hay.includes(token));
    });
  }, [instances, query, statusFilter, typeFilter]);

  const pendingCount = instances.filter((item) => item.status === "PENDING").length;
  const mergeCandidates = useMemo(() => instances.filter((item) => item.status === "ACTIVE"), [instances]);

  async function runAction(work: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError(null);
    try {
      await work();
      setToast(success);
      setActionState({ kind: "none" });
      await load();
    } catch (err) {
      setError(errorMessage(err, "Operace nad instancí se nezdařila."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-page-grid">
      <PageHeader
        eyebrow="Zařízení a instance"
        title="Správa zařízení"
        description="Úplné ovládání backendových instancí zařízení včetně aktivace, merge, revokace a cleanupu pending registrací."
        actions={
          <div className="admin-action-stack">
            <Button type="button" variant="ghost" onClick={() => void load()} disabled={loading || busy}>
              Obnovit seznam
            </Button>
            <Button type="button" variant="danger" onClick={() => setActionState({ kind: "deletePending" })} disabled={pendingCount === 0 || busy}>
              Smazat všechny pending
            </Button>
          </div>
        }
      />

      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}

      <FilterBar>
        <input className="kb-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Hledat podle názvu, ID nebo typu zařízení" />
        <select className="kb-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
          <option value="ALL">Všechny stavy</option>
          <option value="PENDING">Pending</option>
          <option value="ACTIVE">Active</option>
          <option value="REVOKED">Revoked</option>
          <option value="DEACTIVATED">Deactivated</option>
        </select>
        <select className="kb-select" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as "ALL" | "WEB" | "ANDROID")}>
          <option value="ALL">Všechny typy</option>
          <option value="WEB">Web</option>
          <option value="ANDROID">Android</option>
        </select>
      </FilterBar>

      <div className="admin-split-layout">
        <section className="admin-surface">
          <div className="admin-surface-head">
            <div>
              <div className="admin-surface-title">Seznam instancí</div>
              <div className="admin-surface-subtitle">{filtered.length} z {instances.length} zařízení odpovídá filtru.</div>
            </div>
          </div>
          {loading ? (
            <InlineNotice>Načítám zařízení…</InlineNotice>
          ) : filtered.length === 0 ? (
            <EmptyState title="Žádné instance" description="Aktuální filtr nevrátil žádná zařízení." />
          ) : (
            <div className="admin-list">
              {filtered.map((item) => (
                <button key={item.id} type="button" className={`admin-selection-row${selected?.id === item.id ? " active" : ""}`} onClick={() => setSelected(item)}>
                  <div>
                    <div className="admin-list-title">{item.display_name || item.id}</div>
                    <div className="admin-list-subtitle">{item.client_type} · vytvořeno {new Date(item.created_at).toLocaleDateString("cs-CZ")}</div>
                  </div>
                  <StateBadge
                    tone={
                      item.status === "ACTIVE"
                        ? "ok"
                        : item.status === "PENDING"
                          ? "accent"
                          : item.status === "REVOKED"
                            ? "danger"
                            : "warning"
                    }
                  >
                    {item.status}
                  </StateBadge>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="admin-surface">
          <div className="admin-surface-head">
            <div>
              <div className="admin-surface-title">Detail a akce</div>
              <div className="admin-surface-subtitle">Vyberte instanci vlevo pro kompletní operace nad backendem.</div>
            </div>
          </div>
          {!selected ? (
            <EmptyState title="Není vybraná instance" description="Pro pokračování zvolte zařízení ze seznamu." />
          ) : (
            <div className="admin-stack">
              <div className="admin-definition-list">
                <div><span>ID</span><strong>{selected.id}</strong></div>
                <div><span>Typ klienta</span><strong>{selected.client_type}</strong></div>
                <div><span>Stav</span><strong>{selected.status}</strong></div>
                <div><span>Poslední aktivita</span><strong>{selected.last_seen_at ? new Date(selected.last_seen_at).toLocaleString("cs-CZ") : "neuvedeno"}</strong></div>
              </div>

              <div className="admin-form-section">
                <div className="admin-form-section-title">Základní úpravy</div>
                <div className="admin-form-grid">
                  <div>
                    <div className="kb-label">Zobrazovaný název</div>
                    <input className="kb-input" value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder="Např. Recepce iPad" />
                  </div>
                  <div>
                    <div className="kb-label">Výchozí šablona úvazku</div>
                    <select className="kb-select" value={draftTemplate} onChange={(event) => setDraftTemplate(event.target.value as EmploymentTemplate)}>
                      <option value="DPP_DPC">DPP / DPČ</option>
                      <option value="HPP">HPP</option>
                    </select>
                  </div>
                </div>
                <div className="admin-action-row">
                  {selected.status === "PENDING" ? (
                    <Button type="button" variant="primary" disabled={busy || !draftName.trim()} onClick={() => void runAction(() => adminActivateInstance(selected.id, draftName.trim(), draftTemplate), "Instance byla aktivována.")}>
                      Aktivovat
                    </Button>
                  ) : null}
                  {selected.status === "ACTIVE" ? (
                    <>
                      <Button type="button" variant="secondary" disabled={busy || !draftName.trim()} onClick={() => void runAction(() => adminRenameInstance(selected.id, draftName.trim()), "Název instance byl uložen.")}>
                        Přejmenovat
                      </Button>
                      <Button type="button" variant="secondary" disabled={busy} onClick={() => void runAction(() => adminSetTemplate(selected.id, draftTemplate), "Šablona instance byla změněna.")}>
                        Změnit šablonu
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>

              {selected.status === "ACTIVE" ? (
                <div className="admin-form-section">
                  <div className="admin-form-section-title">Sloučení instancí</div>
                  <div className="admin-form-grid">
                    <div>
                      <div className="kb-label">Cílová instance</div>
                      <select className="kb-select" value={mergeTargetId} onChange={(event) => setMergeTargetId(event.target.value)}>
                        {mergeCandidates.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.display_name || candidate.id}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <div className="kb-label">Zdrojové instance</div>
                      <div className="admin-checkbox-list">
                        {mergeCandidates.filter((candidate) => candidate.id !== mergeTargetId).map((candidate) => {
                          const checked = mergeSourceIds.includes(candidate.id);
                          return (
                            <label key={candidate.id} className="admin-checkbox-row">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) =>
                                  setMergeSourceIds((current) =>
                                    event.target.checked ? [...current, candidate.id] : current.filter((id) => id !== candidate.id),
                                  )
                                }
                              />
                              <span>{candidate.display_name || candidate.id}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  <InlineNotice tone="warning">Sloučení přesune docházku, plán, měsíční výběry i zámky na cílovou instanci podle backend pravidel.</InlineNotice>
                  <div className="admin-action-row">
                    <Button
                      type="button"
                      variant="primary"
                      disabled={busy || !mergeTargetId || mergeSourceIds.length === 0}
                      onClick={() => void runAction(() => adminMergeInstances(mergeTargetId, mergeSourceIds), "Instance byly sloučeny.")}
                    >
                      Sloučit vybrané instance
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="admin-action-row">
                {selected.status !== "REVOKED" ? (
                  <Button type="button" variant="danger" disabled={busy} onClick={() => setActionState({ kind: "revoke", instance: selected })}>
                    Revokovat
                  </Button>
                ) : null}
                {selected.status !== "DEACTIVATED" ? (
                  <Button type="button" variant="danger" disabled={busy} onClick={() => setActionState({ kind: "deactivate", instance: selected })}>
                    Deaktivovat
                  </Button>
                ) : null}
                <Button type="button" variant="danger" disabled={busy} onClick={() => setActionState({ kind: "delete", instance: selected })}>
                  Smazat instanci
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={actionState.kind === "delete"}
        title="Smazat instanci"
        description="Pokud instance ještě není revokovaná, backend ji před smazáním automaticky revokuje a zneplatní tokeny."
        confirmLabel="Smazat instanci"
        tone="danger"
        busy={busy}
        onClose={() => setActionState({ kind: "none" })}
        onConfirm={() =>
          actionState.kind === "delete"
            ? void runAction(() => adminDeleteInstance(actionState.instance.id), "Instance byla smazána.")
            : undefined
        }
      />
      <ConfirmDialog
        open={actionState.kind === "revoke"}
        title="Revokovat instanci"
        description="Revokace okamžitě zneplatní tokeny zařízení a změní jeho backendový stav."
        confirmLabel="Revokovat"
        tone="danger"
        busy={busy}
        onClose={() => setActionState({ kind: "none" })}
        onConfirm={() =>
          actionState.kind === "revoke"
            ? void runAction(() => adminRevokeInstance(actionState.instance.id), "Instance byla revokována.")
            : undefined
        }
      />
      <ConfirmDialog
        open={actionState.kind === "deactivate"}
        title="Deaktivovat instanci"
        description="Deaktivace ponechá instanci v evidenci, ale zneplatní její tokeny a zastaví další použití."
        confirmLabel="Deaktivovat"
        tone="danger"
        busy={busy}
        onClose={() => setActionState({ kind: "none" })}
        onConfirm={() =>
          actionState.kind === "deactivate"
            ? void runAction(() => adminDeactivateInstance(actionState.instance.id), "Instance byla deaktivována.")
            : undefined
        }
      />
      <ConfirmDialog
        open={actionState.kind === "deletePending"}
        title="Smazat všechny pending instance"
        description={`Bude odstraněno ${pendingCount} čekajících registrací zařízení.`}
        confirmLabel="Smazat pending"
        tone="danger"
        busy={busy}
        onClose={() => setActionState({ kind: "none" })}
        onConfirm={() => void runAction(() => adminDeletePendingInstances().then(() => undefined), "Pending instance byly smazány.")}
      />
      <Toast message={toast} tone="ok" />
    </div>
  );
}
