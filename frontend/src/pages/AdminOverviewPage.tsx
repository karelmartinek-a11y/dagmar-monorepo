import { useEffect, useMemo, useState } from "react";
import { adminGetSettings, adminGetSmtpSettings, adminListInstances, adminListUsers, type AdminInstance, type PortalUser } from "../api/admin";
import { ActionLink, EmptyState, FilterBar, InlineNotice, MetricCard, PageHeader, StateBadge } from "../components/admin/AdminUI";
import { buildAdminOverviewSummary } from "../utils/adminOverview";

function errorMessage(err: unknown, fallback: string) {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export default function AdminOverviewPage() {
  const [users, setUsers] = useState<PortalUser[]>([]);
  const [instances, setInstances] = useState<AdminInstance[]>([]);
  const [smtp, setSmtp] = useState<Awaited<ReturnType<typeof adminGetSmtpSettings>> | null>(null);
  const [settings, setSettings] = useState<Awaited<ReturnType<typeof adminGetSettings>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all([adminListUsers(), adminListInstances(), adminGetSmtpSettings(), adminGetSettings()])
      .then(([userRes, instanceRes, smtpRes, settingsRes]) => {
        if (cancelled) return;
        setUsers(userRes.users);
        setInstances(instanceRes.instances);
        setSmtp(smtpRes);
        setSettings(settingsRes);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(errorMessage(err, "Nepodařilo se načíst přehled administrace."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const summary = useMemo(() => buildAdminOverviewSummary(users, instances), [instances, users]);

  return (
    <div className="admin-page-grid">
      <PageHeader
        eyebrow="Operační cockpit"
        title="Přehled administrace"
        description="Jedno místo pro účty, zařízení, provozní pravidla a rychlé zásahy nad produkčním provozem hotelu."
      />

      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}

      <section className="admin-metric-grid">
        <MetricCard label="Aktivní účty" value={summary.activeUsers} hint={`${users.length} celkem`} tone="accent" />
        <MetricCard label="Účty bez hesla" value={summary.withoutPassword} hint="Vyžadují reset nebo ruční nastavení" tone={summary.withoutPassword ? "danger" : "default"} />
        <MetricCard label="Blokovaná přihlášení" value={summary.blockedUsers} hint="Omezení podle úvazku" tone={summary.blockedUsers ? "danger" : "default"} />
        <MetricCard label="Čekající zařízení" value={summary.pendingInstances.length} hint="Čekají na aktivaci" tone={summary.pendingInstances.length ? "accent" : "default"} />
        <MetricCard label="Aktivní zařízení" value={summary.activeInstances} hint="Povolená zařízení" tone="ok" />
        <MetricCard label="Revokovaná zařízení" value={summary.revokedInstances} hint="Zrušené přístupy" tone={summary.revokedInstances ? "danger" : "default"} />
        <MetricCard label="Deaktivovaná zařízení" value={summary.deactivatedInstances} hint="Dočasně vypnutá" tone={summary.deactivatedInstances ? "danger" : "default"} />
      </section>

      <div className="admin-overview-grid">
        <section className="admin-surface admin-overview-alerts">
          <div className="admin-surface-head">
            <div>
              <div className="admin-surface-title">Provozní upozornění</div>
              <div className="admin-surface-subtitle">Automaticky sestavené z aktuálních backend dat.</div>
            </div>
          </div>

          <div className="admin-stack">
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
          {instances.length === 0 && !loading ? (
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
                    {instance.status}
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
