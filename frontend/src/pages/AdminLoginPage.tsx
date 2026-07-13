import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { adminForgotPassword, adminLogin, getAdminMe } from "../api/admin";
import Button from "../ui/Button";
import { Card } from "../ui/Card";
import { APP_NAME_LONG, BRAND_ASSETS } from "../brand/brand";
import { InlineNotice } from "../components/admin/AdminUI";
import { getAdminFallbackPath, sanitizeAdminNextPath } from "../utils/adminLogin";
import AuthStatusIcon from "../components/AuthStatusIcon";

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string") return err;
  return fallback;
}

export default function AdminLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const nextPath = useMemo(
    () => sanitizeAdminNextPath(location.search, window.location.origin) ?? getAdminFallbackPath(),
    [location.search],
  );

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sendingHelp, setSendingHelp] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const me = await getAdminMe();
        if (!mounted) return;
        if (me?.username) navigate(nextPath, { replace: true });
      } catch {
        // not logged in
      } finally {
        if (mounted) setCheckingSession(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [navigate, nextPath]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setInfo(null);
    if (!email || !password) {
      setError("Vyplňte e-mail a heslo.");
      return;
    }
    if (email.trim().toLowerCase() !== "provoz@hotelchodovasc.cz") {
      setError("Pro administraci použijte účet provoz@hotelchodovasc.cz.");
      return;
    }

    setSubmitting(true);
    try {
      await adminLogin({ username: email, password });
      navigate(nextPath, { replace: true });
    } catch (err: unknown) {
      setError(errorMessage(err, "Přihlášení se nezdařilo."));
    } finally {
      setSubmitting(false);
    }
  }

  async function onSendHelp() {
    setError(null);
    setInfo(null);
    setSendingHelp(true);
    try {
      await adminForgotPassword("provoz@hotelchodovasc.cz");
      setInfo("Instrukce k přístupu byly odeslány na provozní adresu administrace.");
    } catch (err) {
      setError(errorMessage(err, "Instrukce se nepodařilo odeslat."));
    } finally {
      setSendingHelp(false);
    }
  }

  return (
    <div className="admin-login-page">
      <div className="auth-workspace auth-workspace--admin admin-login-panel">
        <aside className="auth-rail auth-rail--focus" aria-label="Pokyny pro administrátora">
          <div className="auth-rail-title">Fokus a přístupnost</div>
          <ol className="auth-rail-list">
            <li>E-mail správce</li>
            <li>Heslo správce</li>
            <li>Přihlásit</li>
            <li>Pomoc s přístupem</li>
          </ol>
          <div className="auth-rail-note">Každé pole má programový popisek. Chyba zachová vyplněný e-mail.</div>
        </aside>

        <Card className="admin-login-card auth-primary-card">
          <img src={BRAND_ASSETS.logoHorizontal} alt={APP_NAME_LONG} className="auth-card-logo" />
          <h1 className="auth-card-title">Přihlášení administrátora</h1>
          <p className="auth-card-description">Po úspěšném přihlášení se bezpečně vrátíte na požadovanou admin stránku.</p>

          {checkingSession ? <div className="auth-state" role="status"><strong>Kontrola existující session</strong>Ověřuji, zda už není administrace přihlášená.</div> : null}
          {error ? <div className="auth-state auth-state--error" role="alert"><strong>Přihlášení se nezdařilo</strong>{error}</div> : null}
          {info ? <InlineNotice tone="ok">{info}</InlineNotice> : null}

          <form onSubmit={onSubmit} className="kb-stack" style={{ marginTop: 14 }}>
            <label className="kb-field" htmlFor="admin-login-email">
              <span className="kb-label">E-mail správce</span>
              <input id="admin-login-email" className="kb-input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jmeno@domena.cz" disabled={submitting || checkingSession} />
            </label>
            <label className="kb-field" htmlFor="admin-login-password">
              <span className="kb-label">Heslo správce</span>
              <input id="admin-login-password" className="kb-input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" disabled={submitting || checkingSession} />
            </label>

            <Button type="submit" disabled={submitting || checkingSession} variant="primary" style={{ width: "100%", justifyContent: "center" }}>
              {checkingSession ? "Kontroluji session…" : submitting ? "Přihlašuji…" : "Přihlásit"}
            </Button>
          </form>

          <div className="admin-login-support">
            <div>Přístup je určen pouze administrátorům na adrese <strong>provoz@hotelchodovasc.cz</strong>.</div>
            <div>Pokud heslo není dostupné, můžete poslat interní instrukce k přístupu bez reset tokenu.</div>
          </div>

          <div className="admin-login-actions auth-form-actions">
            <Button type="button" variant="ghost" onClick={() => void onSendHelp()} disabled={sendingHelp}>
              {sendingHelp ? "Odesílám…" : "Poslat instrukce k přístupu"}
            </Button>
            <a href="mailto:provoz@hotelchodovasc.cz" className="admin-mini-link">
              Kontaktovat podporu
            </a>
          </div>
        </Card>

        <aside className="auth-rail auth-rail--security" aria-label="Bezpečnost administrace">
          <div className="auth-assurance">
            <span className="auth-assurance-icon"><AuthStatusIcon name="shield" /></span>
            <div><strong>Admin session + CSRF</strong><span>Mutace jsou chráněné session cookie a CSRF kontrolou.</span></div>
          </div>
          <div className="auth-assurance">
            <span className="auth-assurance-icon"><AuthStatusIcon name="lock" /></span>
            <div><strong>Bez reset tokenu</strong><span>Pomoc s heslem posílá pouze bezpečnou interní instrukci.</span></div>
          </div>
          <div className="auth-assurance">
            <span className="auth-assurance-icon"><AuthStatusIcon name="info" /></span>
            <div><strong>Bezpečný návrat</strong><span>Parametr next je omezený na interní admin routy.</span></div>
          </div>
        </aside>
      </div>
    </div>
  );
}
