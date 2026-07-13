import { useEffect, useMemo, useState } from "react";
import { adminGetSettings, adminGetSmtpSettings, adminListInstances, adminListUsers, type AdminInstance, type PortalUser } from "../api/admin";
import { ActionLink, EmptyState, FilterBar, InlineNotice, MetricCard, PageHeader, StateBadge } from "../components/admin/AdminUI";
import { buildAdminOverviewSummary } from "../utils/adminOverview";
import Button from "../ui/Button";

function errorMessage(err: unknown, fallback: string) {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

function instanceStatusLabel(status: AdminInstance["status"]) {
  if (status === "ACTIVE") return "Aktivní";
  if (status === "PENDING") return "Čeká na aktivaci";
  if (status === "REVOKED") return "Revokováno";
  return "Deaktivováno";
}

export default function AdminOverviewPage() {
  const [users, setUsers] = useState<PortalUser[]>([]);
  const [instances, setInstances] = useState<AdminInstance[]>([]);
  const [smtp, setSmtp] = useState<Awaited<ReturnType<typeof adminGetSmtpSettings>> | null>(null);
  const [settings, setSettings] = useState<Awaited<ReturnType<typeof adminGetSettings>> | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [instancesError, setInstancesError] = useState<string | null>(null);
  const [smtpError, setSmtpError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadOverview(signal?: { cancelled: boolean }) {
    setLoading(true);
    setUsersError(null);
    setInstancesError(null);
    setSmtpError(null);
    setSettingsError(null);
    const [userRes, instanceRes, smtpRes, settingsRes] = await Promise.allSettled([
      adminListUsers(),
      adminListInstances(),
      adminGetSmtpSettings(),
      adminGetSettings(),
    ]);
    if (signal?.cancelled) return;

    if (userRes.status === "fulfilled") {
      setUsers(userRes.value.users);
    } else {
      setUsers([]);
      setUsersError(errorMessage(userRes.reason, "Nepodařilo se načíst uživatele."));
    }

    if (instanceRes.status === "fulfilled") {
      setInstances(instanceRes.value.instances);
    } else {
      setInstances([]);
      setInstancesError(errorMessage(instanceRes.reason, "Nepodařilo se načíst zařízení."));
    }

    if (smtpRes.status === "fulfilled") {
      setSmtp(smtpRes.value);
    } else {
      setSmtp(null);
      setSmtpError(errorMessage(smtpRes.reason, "Nepodařilo se načíst SMTP nastavení."));
    }

    if (settingsRes.status === "fulfilled") {
      setSettings(settingsRes.value);
    } else {
      setSettings(null);
      setSettingsError(errorMessage(settingsRes.reason, "Nepodařilo se načíst globální pravidla."));
    }

    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    void loadOverview({ cancelled }).catch((err) => {
      if (cancelled) return;
      setUsersError(errorMessage(err, "Nepodařilo se načíst přehled administrace."));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const summary = useMemo(() => buildAdminOverviewSummary(users, instances), [instances, users]);
  const anyPartialError = Boolean(usersError || instancesError || smtpError || settingsError);

  return (
    <div className="admin-page-grid admin-overview-page">
      <PageHeader
        eyebrow="Operační cockpit"
        title="Přehled administrace"
        description="Jedno místo pro účty, zařízení, provozní pravidla a rychlé zásahy nad produkčním provozem hotelu."
      >
        <FilterBar>
          <Button type="button" variant="ghost" onClick={() => void loadOverview()} disabled={loading}>
            {loading ? "Obnovuji…" : "Obnovit"}
          </Button>
        </FilterBar>
      </PageHeader>

      {anyPartialError ? (
        <InlineNotice tone="warning">
          Přehled je načtený jen částečně. Některé bloky zůstávají použitelné, ale jedna nebo více datových sad se nepodařilo načíst.
        </InlineNotice>
      ) : null}

      <section className="admin-metric-grid admin-overview-metrics">
        <MetricCard label="Aktivní účty" value={summary.activeUsers} hint={`${users.length} celkem`} tone="accent" />
        <MetricCard label="Účty bez hesla" value={summary.withoutPassword} hint="Vyžadují reset nebo ruční nastavení" tone={summary.withoutPassword ? "danger" : "default"} />
        <MetricCard label="Blokovaná přihlášení" value={summary.blockedUsers} hint="Omezení podle úvazku" tone={summary.blockedUsers ? "danger" : "default"} />
        <MetricCard label="Čekající zařízení" value={summary.pendingInstances.length} hint="Čekají na aktivaci" tone={summary.pendingInstances.length ? "accent" : "default"} />
        <MetricCard label="Aktivní zařízení" value={summary.activeInstances} hint="Povolená zařízení" tone="ok" />
        <MetricCard label="Revokovaná zařízení" value={summary.revokedInstances} hint="Zrušené přístupy" tone={summary.revokedInstances ? "danger" : "default"} />
        <MetricCard label="Deaktivovaná zařízení" value={summary.deactivatedInstances} hint="Dočasně vypnutá" tone={summary.deactivatedInstances ? "danger" : "default"} />
      </section>

      <div className="admin-overview-grid admin-overview-dashboard">
        <section className="admin-surface admin-overview-alerts">
          <div className="admin-surface-head">
            <div>
              <div className="admin-surface-title">Provozní upozornění</div>
              <div className="admin-surface-subtitle">Automaticky sestavené z aktuálních backend dat.</div>
            </div>
          </div>

          <div className="admin-stack">
            {usersError ? <InlineNotice tone="danger">{usersError}</InlineNotice> : null}
            {instancesError ? <InlineNotice tone="danger">{instancesError}</InlineNotice> : null}
            {summary.pendingInstances.length > 0 ? (
              <InlineNotice tone="warning">
                Čeká <strong>{summary.pendingInstances.length}</strong> zařízení na aktivaci. Přesuňte se do sekce <strong>Zařízení</strong> a rozhodněte o stavu.
              </InlineNotice>
            ) : null}
            {summary.withoutPassword > 0 ? (
              <InlineNotice tone="warning">
                <strong>{summary.withoutPassword}</strong> účtů stále nemá nastavené heslo. Doporučeno poslat reset hesla nebo heslo nastavit ručně.
              </InlineNotice>
            ) : null}
            {users.some((user) => user.login_status === "EMPLOYMENT_WINDOW_BLOCKED") ? (
              <InlineNotice tone="warning">
                Některé účty mají uzamčené přihlášení kvůli oknu úvazku. Zkontrolujte období v sekci <strong>Uživatelé</strong>.
              </InlineNotice>
            ) : null}
            {!loading && summary.pendingInstances.length === 0 && summary.withoutPassword === 0 && summary.blockedUsers === 0 ? (
              <EmptyState title="Provoz je v normálu" description="V přehledu nejsou žádné kritické položky vyžadující okamžitý zásah." />
            ) : null}
          </div>
        </section>

        <section className="admin-surface admin-overview-settings">
          <div className="admin-surface-head">
            <div>
              <div className="admin-surface-title">Pošta a pravidla docházky</div>
              <div className="admin-surface-subtitle">Souhrn nastavení, která mají přímý dopad na provoz.</div>
            </div>
          </div>
          <div className="admin-stack">
            {smtpError || settingsError ? <InlineNotice tone="danger">{[smtpError, settingsError].filter(Boolean).join(" ")}</InlineNotice> : null}
            <div className="admin-definition-list">
              <div>
                <span>SMTP server</span>
                <strong>{smtp?.host || "Nenastaveno"}</strong>
              </div>
              <div>
                <span>Uložené heslo</span>
                <strong>{smtp?.password_set ? "Ano" : "Ne"}</strong>
              </div>
              <div>
                <span>Odesílatel</span>
                <strong>{smtp?.from_name || smtp?.from_email || "Nenastaveno"}</strong>
              </div>
              <div>
                <span>Odpolední hranice</span>
                <strong>{settings?.afternoon_cutoff || "Nenastaveno"}</strong>
              </div>
            </div>
            <FilterBar>
              <ActionLink to="/admin/settings" label="Otevřít nastavení pošty" />
            </FilterBar>
          </div>
        </section>

        <section className="admin-surface admin-overview-devices">
          <div className="admin-surface-head">
            <div>
              <div className="admin-surface-title">Poslední aktivita zařízení</div>
              <div className="admin-surface-subtitle">Rychlá orientace bez nutnosti otevírat detail každé instance.</div>
            </div>
          </div>
          {instancesError ? (
            <InlineNotice tone="danger">{instancesError}</InlineNotice>
          ) : instances.length === 0 && !loading ? (
            <EmptyState title="Žádná zařízení" description="Backend momentálně nevrátil žádné registrované instance." />
          ) : (
            <div className="admin-list">
              {instances.slice(0, 8).map((instance) => (
                <div key={instance.id} className="admin-list-row">
                  <div>
                    <div className="admin-list-title">{instance.display_name || instance.id}</div>
                    <div className="admin-list-subtitle">{instance.client_type} · poslední kontakt {instance.last_seen_at ? new Date(instance.last_seen_at).toLocaleString("cs-CZ") : "nikdy"}</div>
                  </div>
                  <StateBadge
                    tone={
                      instance.status === "ACTIVE"
                        ? "ok"
                        : instance.status === "PENDING"
                          ? "accent"
                          : instance.status === "REVOKED"
                            ? "danger"
                            : "warning"
                    }
                  >
                    {instanceStatusLabel(instance.status)}
                  </StateBadge>
                </div>
              ))}
            </div>
          )}
          {summary.lastSeen ? <div className="admin-footnote">Naposledy aktivní zařízení: {new Date(summary.lastSeen).toLocaleString("cs-CZ")}</div> : null}
        </section>

        <section className="admin-surface admin-overview-actions">
          <div className="admin-surface-head">
            <div>
              <div className="admin-surface-title">Co může administrátor udělat</div>
              <div className="admin-surface-subtitle">Přímé vstupy do nejčastějších provozních úloh.</div>
            </div>
          </div>
          <div className="admin-action-stack">
            <ActionLink to="/admin/users" label="Spravovat uživatele" />
            <ActionLink to="/admin/instances" label="Spravovat zařízení" />
            <ActionLink to="/admin/plan-sluzeb" label="Zobrazit plán směn" />
            <ActionLink to="/admin/dochazka" label="Otevřít docházku" />
            <ActionLink to="/admin/tisky" label="Tiskové sestavy" />
            <ActionLink to="/admin/integrace" label="Integrační klienti" />
          </div>
        </section>
      </div>
    </div>
  );
}
