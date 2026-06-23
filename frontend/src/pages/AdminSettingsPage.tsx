import React, { useEffect, useState } from "react";
import { adminGetSettings, adminGetSmtpSettings, adminSaveSmtpSettings, adminSetSettings, type SmtpSettings } from "../api/admin";
import { InlineNotice, MetricCard, PageHeader } from "../components/admin/AdminUI";
import Button from "../ui/Button";

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string") return err;
  return fallback;
}

export default function AdminSettingsPage() {
  const [smtp, setSmtp] = useState<SmtpSettings | null>(null);
  const [cutoff, setCutoff] = useState("17:00");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [savingMail, setSavingMail] = useState(false);
  const [savingRules, setSavingRules] = useState(false);

  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [security, setSecurity] = useState("SSL");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");

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
  }

  useEffect(() => {
    void load();
  }, []);

  async function onSaveMail(event: React.FormEvent) {
    event.preventDefault();
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
    <div className="admin-page-grid">
      <PageHeader
        eyebrow="Nastavení systému"
        title="Pošta a pravidla docházky"
        description="Správa odchozího SMTP i provozní hranice pro výpočet odpoledních hodin v jednom kontrolovaném prostoru."
      />

      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
      {info ? <InlineNotice tone="ok">{info}</InlineNotice> : null}

      <section className="admin-metric-grid">
        <MetricCard label="SMTP server" value={smtp?.host || "Nenastaveno"} hint="Aktivní host pro reset hesel" />
        <MetricCard label="Uložené heslo" value={smtp?.password_set ? "Ano" : "Ne"} tone={smtp?.password_set ? "ok" : "danger"} />
        <MetricCard label="Odesílatel" value={smtp?.from_name || smtp?.from_email || "Nenastaveno"} />
        <MetricCard label="Odpolední hranice" value={cutoff} hint="Používá se v docházce i přehledech" tone="accent" />
      </section>

      <div className="admin-overview-grid">
        <section className="admin-surface">
          <div className="admin-surface-head">
            <div>
              <div className="admin-surface-title">Pošta a doručování</div>
              <div className="admin-surface-subtitle">Nastavení SMTP pro obnovu hesel a interní provozní oznámení.</div>
            </div>
          </div>

          <form onSubmit={onSaveMail} className="admin-stack">
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
                <div className="kb-label">Heslo</div>
                <input className="kb-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={smtp?.password_set ? "Změnit heslo" : "Zadat heslo"} />
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

            <div className="admin-action-row">
              <Button type="submit" variant="primary" disabled={savingMail}>
                {savingMail ? "Ukládám…" : "Uložit poštu"}
              </Button>
            </div>
          </form>
        </section>

        <section className="admin-surface">
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
      </div>
    </div>
  );
}
