import React, { useEffect, useState } from "react";
import { adminGetSettings, adminGetSmtpSettings, adminSaveSmtpSettings, adminSetSettings, type SmtpSettings } from "../api/admin";
import { Breadcrumbs, InlineNotice, MetricCard, PageHeader } from "../components/admin/AdminUI";
import Button from "../ui/Button";

type FrontendVersionPayload = {
  frontend_commit?: string;
};

type BackendVersionPayload = {
  backend_deploy_tag?: string;
  environment?: string;
};

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string") return err;
  return fallback;
}

function deploymentMatchLabel(frontendCommit: string | null, backendCommit: string | null) {
  if (!frontendCommit || !backendCommit) return "Diagnostika neúplná";
  if (frontendCommit === backendCommit) return "Shodné build ID";
  return "Frontend a backend běží na různých revizích";
}

export default function AdminSettingsPage() {
  const [smtp, setSmtp] = useState<SmtpSettings | null>(null);
  const [cutoff, setCutoff] = useState("17:00");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);
  const [savingMail, setSavingMail] = useState(false);
  const [savingRules, setSavingRules] = useState(false);
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(false);

  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [security, setSecurity] = useState("SSL");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [frontendCommit, setFrontendCommit] = useState<string | null>(null);
  const [backendCommit, setBackendCommit] = useState<string | null>(null);
  const [deploymentEnv, setDeploymentEnv] = useState<string | null>(null);

  async function loadDiagnostics() {
    setLoadingDiagnostics(true);
    setDiagnosticsError(null);
    try {
      const [frontendResp, backendResp] = await Promise.allSettled([
        fetch("/frontend-version.json", { cache: "no-store" }),
        fetch("/api/version", { cache: "no-store" }),
      ]);

      if (frontendResp.status === "fulfilled" && frontendResp.value.ok) {
        const data = (await frontendResp.value.json()) as FrontendVersionPayload;
        setFrontendCommit(data.frontend_commit || null);
      } else {
        setFrontendCommit(null);
      }

      if (backendResp.status === "fulfilled" && backendResp.value.ok) {
        const data = (await backendResp.value.json()) as BackendVersionPayload;
        setBackendCommit(data.backend_deploy_tag || null);
        setDeploymentEnv(data.environment || null);
      } else {
        setBackendCommit(null);
        setDeploymentEnv(null);
      }

      if (
        (frontendResp.status === "rejected" || (frontendResp.status === "fulfilled" && !frontendResp.value.ok)) ||
        (backendResp.status === "rejected" || (backendResp.status === "fulfilled" && !backendResp.value.ok))
      ) {
        setDiagnosticsError("Jedna nebo více verzí nasazení nejsou momentálně dostupné.");
      }
    } catch (err) {
      setDiagnosticsError(errorMessage(err, "Diagnostiku nasazení se nepodařilo načíst."));
    } finally {
      setLoadingDiagnostics(false);
    }
  }

  async function load() {
    setError(null);
    try {
      const [smtpConfig, settings] = await Promise.all([adminGetSmtpSettings(), adminGetSettings()]);
      setSmtp(smtpConfig);
      setHost(smtpConfig.host || "");
      setPort(smtpConfig.port ? String(smtpConfig.port) : "");
      setSecurity(smtpConfig.security || "SSL");
      setUsername(smtpConfig.username || "");
      setFromEmail(smtpConfig.from_email || "");
      setFromName(smtpConfig.from_name || "");
      setCutoff(settings.afternoon_cutoff || "17:00");
    } catch (err: unknown) {
      setError(errorMessage(err, "Nelze načíst administrativní nastavení."));
    }
    await loadDiagnostics();
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSaveMail(event: React.FormEvent) {
    event.preventDefault();
    if (port.trim()) {
      const nextPort = Number(port);
      if (!Number.isInteger(nextPort) || nextPort <= 0 || nextPort > 65535) {
        setError("Port SMTP zadejte jako celé číslo od 1 do 65535.");
        return;
      }
    }
    setSavingMail(true);
    setError(null);
    setInfo(null);
    try {
      const response = await adminSaveSmtpSettings({
        host: host.trim() || null,
        port: port.trim() ? Number(port) : null,
        security,
        username: username.trim() || null,
        password: password.trim() || null,
        from_email: fromEmail.trim() || null,
        from_name: fromName.trim() || null,
      });
      setSmtp(response);
      setPassword("");
      setInfo("Nastavení pošty bylo uloženo.");
    } catch (err: unknown) {
      setError(errorMessage(err, "Uložení pošty se nezdařilo."));
    } finally {
      setSavingMail(false);
    }
  }

  async function onSaveRules(event: React.FormEvent) {
    event.preventDefault();
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(cutoff.trim())) {
      setError("Odpolední hranici zadejte přesně ve formátu HH:MM, například 17:00.");
      return;
    }
    setSavingRules(true);
    setError(null);
    setInfo(null);
    try {
      await adminSetSettings(cutoff);
      setInfo("Provozní pravidla docházky byla uložena.");
    } catch (err: unknown) {
      setError(errorMessage(err, "Uložení pravidel docházky se nezdařilo."));
    } finally {
      setSavingRules(false);
    }
  }

  return (
    <div className="admin-page-grid admin-settings-page">
      <PageHeader
        eyebrow="Nastavení systému"
        title="Pošta a pravidla docházky"
        description="Správa odchozího SMTP i provozní hranice pro výpočet odpoledních hodin v jednom kontrolovaném prostoru."
      >
        <Breadcrumbs items={[{ label: "Administrace", to: "/admin/prehled" }, { label: "Nastavení" }]} />
      </PageHeader>

      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
      {info ? <InlineNotice tone="ok">{info}</InlineNotice> : null}

      <section className="admin-metric-grid">
        <MetricCard label="SMTP server" value={smtp?.host || "Nenastaveno"} hint="Aktivní host pro reset hesel" />
        <MetricCard label="Uložené heslo" value={smtp?.password_set ? "Ano" : "Ne"} tone={smtp?.password_set ? "ok" : "danger"} />
        <MetricCard label="Odesílatel" value={smtp?.from_name || smtp?.from_email || "Nenastaveno"} />
        <MetricCard label="Odpolední hranice" value={cutoff} hint="Používá se v docházce i přehledech" tone="accent" />
      </section>

      <div className="admin-overview-grid admin-settings-grid">
        <section className="admin-surface admin-settings-surface">
          <div className="admin-surface-head">
            <div>
              <div className="admin-surface-title">Pošta a doručování</div>
              <div className="admin-surface-subtitle">Nastavení SMTP pro obnovu hesel a interní provozní oznámení.</div>
            </div>
          </div>

          <form onSubmit={onSaveMail} className="admin-stack">
            <div className="admin-settings-password-state">
              <strong>{smtp?.password_set ? "Uložené heslo existuje" : "Uložené heslo zatím není nastavené"}</strong>
              <span>Do pole „Nové heslo SMTP“ pište jen novou hodnotu. Prázdné pole zachová stávající secret.</span>
            </div>
            <div className="admin-form-grid">
              <div>
                <div className="kb-label">Server odchozí pošty</div>
                <input className="kb-input" value={host} onChange={(e) => setHost(e.target.value)} placeholder="mail.example.cz" />
              </div>
              <div>
                <div className="kb-label">Port</div>
                <input className="kb-input" value={port} onChange={(e) => setPort(e.target.value)} placeholder="587" />
              </div>
              <div>
                <div className="kb-label">Zabezpečení spojení</div>
                <select className="kb-select" value={security} onChange={(e) => setSecurity(e.target.value)}>
                  <option value="SSL">Šifrované spojení</option>
                  <option value="STARTTLS">Navázání šifrování po připojení</option>
                  <option value="NONE">Bez šifrování</option>
                </select>
              </div>
              <div>
                <div className="kb-label">Přihlašovací jméno</div>
                <input className="kb-input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="user@example.cz" />
              </div>
              <div>
                <div className="kb-label">Nové heslo SMTP</div>
                <input className="kb-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={smtp?.password_set ? "Ponechte prázdné pro zachování stávajícího hesla" : "Zadat nové heslo"} />
              </div>
              <div>
                <div className="kb-label">Odesílací e-mail</div>
                <input className="kb-input" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="noreply@hotelchodovasc.cz" />
              </div>
              <div>
                <div className="kb-label">Jméno odesílatele</div>
                <input className="kb-input" value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Hotel Chodov ASC" />
              </div>
            </div>

            <InlineNotice>
              UI zobrazuje pouze informaci, zda heslo existuje. Samotný secret se nikdy nevrací zpět do formuláře.
            </InlineNotice>
            <div className="admin-action-row">
              <Button type="submit" variant="primary" disabled={savingMail}>
                {savingMail ? "Ukládám…" : "Uložit poštu"}
              </Button>
            </div>
          </form>
        </section>

        <section className="admin-surface admin-settings-surface">
          <div className="admin-surface-head">
            <div>
              <div className="admin-surface-title">Provozní pravidla docházky</div>
              <div className="admin-surface-subtitle">Hodnoty, které přímo ovlivňují výpočty a souhrny v administraci.</div>
            </div>
          </div>

          <form onSubmit={onSaveRules} className="admin-stack">
            <div className="admin-form-grid">
              <div>
                <div className="kb-label">Odpolední hranice (HH:MM)</div>
                <input className="kb-input" value={cutoff} onChange={(e) => setCutoff(e.target.value)} placeholder="17:00" />
              </div>
            </div>
            <InlineNotice>
              Tato hodnota se používá při výpočtu odpoledních hodin v evidenci docházky i v měsíčních souhrnech.
            </InlineNotice>
            <div className="admin-action-row">
              <Button type="submit" variant="primary" disabled={savingRules}>
                {savingRules ? "Ukládám…" : "Uložit pravidla"}
              </Button>
            </div>
          </form>
        </section>

        <section className="admin-surface admin-settings-surface">
          <div className="admin-surface-head">
            <div>
              <div className="admin-surface-title">Diagnostika nasazení</div>
              <div className="admin-surface-subtitle">Porovnání frontendové a backendové verze plus běžícího prostředí.</div>
            </div>
          </div>

          <div className="admin-stack">
            {diagnosticsError ? <InlineNotice tone="danger">{diagnosticsError}</InlineNotice> : null}

            <div className="admin-definition-list">
              <div>
                <span>Frontend commit</span>
                <strong>{frontendCommit || "Nedostupné"}</strong>
              </div>
              <div>
                <span>Backend commit</span>
                <strong>{backendCommit || "Nedostupné"}</strong>
              </div>
              <div>
                <span>Prostředí</span>
                <strong>{deploymentEnv || "Nedostupné"}</strong>
              </div>
              <div>
                <span>Stav shody</span>
                <strong>{deploymentMatchLabel(frontendCommit, backendCommit)}</strong>
              </div>
            </div>

            <InlineNotice tone={frontendCommit && backendCommit && frontendCommit === backendCommit ? "ok" : "warning"}>
              {frontendCommit && backendCommit && frontendCommit === backendCommit
                ? "Frontend i backend hlásí shodné build ID."
                : "Frontend a backend nejsou spárované stejným build ID, nebo jedna z verzí není dostupná."}
            </InlineNotice>

            <div className="admin-action-row">
              <Button type="button" variant="ghost" onClick={() => void loadDiagnostics()} disabled={loadingDiagnostics}>
                {loadingDiagnostics ? "Obnovuji diagnostiku…" : "Znovu načíst diagnostiku"}
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
