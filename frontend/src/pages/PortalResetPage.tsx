import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { portalResetPassword } from "../api/portal";
import { APP_NAME_LONG, BRAND_ASSETS } from "../brand/brand";
import AuthStatusIcon from "../components/AuthStatusIcon";

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string") return err;
  return fallback;
}

function getToken(search: string): string {
  const params = new URLSearchParams(search);
  return (params.get("token") || "").trim();
}

export default function PortalResetPage() {
  const loc = useLocation();
  const navigate = useNavigate();
  const token = getToken(loc.search);
  const loginPath = "/app";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => navigate(loginPath), 2500);
    return () => window.clearTimeout(timer);
  }, [navigate, success]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError("Odkaz není platný.");
      return;
    }
    if (!password.trim()) {
      setError("Zadejte nové heslo.");
      return;
    }
    if (password.length < 8) {
      setError("Nové heslo musí mít alespoň 8 znaků.");
      return;
    }
    setSaving(true);
    try {
      await portalResetPassword({ token, password });
      setSuccess(true);
    } catch (err: unknown) {
      setError(errorMessage(err, "Nastavení hesla se nezdařilo."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="reset-page">
      <div className="auth-workspace auth-workspace--reset">
        <aside className="auth-rail auth-rail--focus" aria-label="Postup obnovy přístupu">
          <div className="auth-rail-title">Postup obnovy</div>
          <ol className="auth-rail-list">
            <li>Ověření jednorázového odkazu</li>
            <li>Zadání nového hesla</li>
            <li>Uložení a potvrzení</li>
            <li>Návrat na přihlášení</li>
          </ol>
          <div className="auth-rail-note">Odkaz je platný 24 hodin. Token se nikdy nezobrazuje ani nepřenáší do pole formuláře.</div>
        </aside>

        <main className="auth-primary-card reset-card">
          <img src={BRAND_ASSETS.logoHorizontal} alt={APP_NAME_LONG} className="auth-card-logo" />
          <h1 className="auth-card-title">Nastavení nového hesla</h1>
          <p className="auth-card-description">Zadejte nové heslo pro zaměstnanecký portál. Po uložení budete vráceni na přihlášení.</p>

          {error || !token ? (
            <div className="auth-state auth-state--error" role="alert">
              <strong>Odkaz nelze použít</strong>
              {error ?? "Odkaz není platný nebo v něm chybí jednorázový token. Požádejte správce o nový odkaz."}
            </div>
          ) : null}

          {success ? (
            <div className="auth-state auth-state--success" role="status">
              <strong>Heslo bylo nastaveno</strong>
              Pokračujte na přihlášení do systému KájovoDagmar. Automatické přesměrování proběhne za okamžik.
              <div className="auth-state-action">
                <a href={loginPath} className="btn solid">Přejít na přihlášení</a>
              </div>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="kb-stack reset-form">
              <label className="kb-field" htmlFor="portal-reset-password">
                <span className="kb-label">Nové heslo</span>
                <input
                  id="portal-reset-password"
                  className="kb-input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Zadejte nové heslo"
                  autoComplete="new-password"
                  disabled={saving || !token}
                  aria-describedby="portal-reset-password-help"
                />
                <span id="portal-reset-password-help" className="auth-field-help">
                  Minimálně 8 znaků. Odkaz ani token se v poli nezobrazují.
                </span>
              </label>

              <div className="auth-state auth-state--info">
                <strong>Platnost odkazu: 24 hodin</strong>
                Nové heslo se projeví okamžitě. Nepoužívejte osobní údaje, název zařízení ani snadno odhadnutelné výrazy.
              </div>
              <button type="submit" className="btn solid" disabled={saving || !token}>
                {saving ? "Ukládám…" : "Uložit nové heslo"}
              </button>
              <a href={loginPath} className="admin-mini-link">Zpět na přihlášení</a>
            </form>
          )}
          <footer className="auth-card-footer"><span>KájovoDagmar</span><span>Europe/Prague</span></footer>
        </main>

        <aside className="auth-rail auth-rail--security" aria-label="Bezpečnost obnovy hesla">
          <div className="auth-assurance">
            <span className="auth-assurance-icon"><AuthStatusIcon name="key" /></span>
            <div><strong>Jednorázový token</strong><span>Odkaz nelze znovu použít po úspěšném nastavení hesla.</span></div>
          </div>
          <div className="auth-assurance">
            <span className="auth-assurance-icon"><AuthStatusIcon name="lock" /></span>
            <div><strong>Heslo zůstává skryté</strong><span>Formulář používá zabezpečený typ pole a správný autocomplete.</span></div>
          </div>
          <div className="auth-assurance">
            <span className="auth-assurance-icon"><AuthStatusIcon name="info" /></span>
            <div><strong>Bezpečný návrat</strong><span>Po dokončení vede tok výhradně na zaměstnanecké přihlášení.</span></div>
          </div>
        </aside>
      </div>
    </div>
  );
}
