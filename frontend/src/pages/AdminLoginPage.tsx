import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { adminForgotPassword, adminLogin, getAdminMe } from "../api/admin";
import Button from "../ui/Button";
import { Card } from "../ui/Card";
import { APP_NAME_LONG, BRAND_ASSETS } from "../brand/brand";
import { InlineNotice } from "../components/admin/AdminUI";
import { getAdminFallbackPath, sanitizeAdminNextPath } from "../utils/adminLogin";

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

  const [email, setEmail] = useState("provoz@hotelchodovasc.cz");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sendingHelp, setSendingHelp] = useState(false);
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
      <div className="admin-login-panel">
        <div className="admin-login-brand">
          <img src={BRAND_ASSETS.logoHorizontal} alt="" className="admin-login-logo" />
          <div>
            <div className="admin-login-kicker">Produkční administrace</div>
            <div className="admin-login-title">Operační cockpit</div>
            <div className="admin-login-subtitle">{APP_NAME_LONG}</div>
          </div>
        </div>

        <Card className="kb-card-pad admin-login-card">
          {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
          {info ? <InlineNotice tone="ok">{info}</InlineNotice> : null}

          <form onSubmit={onSubmit} className="kb-stack" style={{ marginTop: 14 }}>
            <label className="kb-field" htmlFor="admin-login-email">
              <span className="kb-label">E-mail správce</span>
              <input id="admin-login-email" className="kb-input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jmeno@domena.cz" disabled={submitting} />
            </label>
            <label className="kb-field" htmlFor="admin-login-password">
              <span className="kb-label">Heslo správce</span>
              <input id="admin-login-password" className="kb-input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" disabled={submitting} />
            </label>

            <Button type="submit" disabled={submitting} variant="primary" style={{ width: "100%", justifyContent: "center" }}>
              {submitting ? "Přihlašuji…" : "Přihlásit"}
            </Button>
          </form>

          <div className="admin-login-support">
            <div>Přístup je určen pouze administrátorům na adrese <strong>provoz@hotelchodovasc.cz</strong>.</div>
            <div>Pokud heslo není dostupné, můžete poslat interní instrukce k přístupu bez reset tokenu.</div>
          </div>

          <div className="admin-login-actions">
            <Button type="button" variant="ghost" onClick={() => void onSendHelp()} disabled={sendingHelp}>
              {sendingHelp ? "Odesílám…" : "Poslat instrukce k přístupu"}
            </Button>
            <a href="mailto:provoz@hotelchodovasc.cz" className="admin-mini-link">
              Kontaktovat podporu
            </a>
          </div>
        </Card>
      </div>
    </div>
  );
}
