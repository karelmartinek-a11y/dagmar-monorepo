import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { adminForgotPassword, adminLogin, getAdminMe } from "../api/admin";
import { ApiError } from "../api/client";
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

function loginErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return "Neplatné přihlašovací údaje. Zkontrolujte e-mail a heslo správce.";
    if (err.status === 429) return "Byl překročen limit 10 pokusů za minutu. Chvíli vyčkejte a přihlášení opakujte.";
    if (err.status === 503) return "Admin účet není inicializován. Dokončete interní seed administrace a zkuste to znovu.";
    if (err.status === 400) return err.message || "Vyplňte e-mail správce a heslo.";
  }
  return errorMessage(err, "Přihlášení se nezdařilo.");
}

function helpErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status >= 500) {
    return "Instrukci se teď nepodařilo potvrdit. Použijte přímý kontakt na provozní podporu.";
  }
  return errorMessage(err, "Instrukce se nepodařilo odeslat.");
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
      setError(loginErrorMessage(err));
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
      setError(helpErrorMessage(err));
    } finally {
      setSendingHelp(false);
    }
  }

  const formState = checkingSession
    ? "Kontrola session"
    : submitting
      ? "Přihlašování"
      : error
        ? "Vyžaduje opravu"
        : info
          ? "Instrukce odeslány"
          : "Připraven k přihlášení";

  const stateCards = [
    {
      key: "session",
      icon: "shield" as const,
      title: "Kontrola existující session",
      detail: checkingSession ? "Ověřuji, zda už není administrace přihlášená." : "Session je zkontrolovaná a formulář může pokračovat.",
      tone: checkingSession ? "is-active" : "",
    },
    {
      key: "invalid",
      icon: "lock" as const,
      title: "Neplatné údaje",
      detail: "Při chybě zůstává zachovaný e-mail správce i bezpečný návrat na interní cestu.",
      tone: error && !error.includes("limit 10") && !error.includes("není inicializován") ? "is-error" : "",
    },
    {
      key: "limit",
      icon: "keyboard" as const,
      title: "Rate limit 10 / minuta",
      detail: "Opakované pokusy se po překročení limitu zastaví a uživateli vrátí jasné vysvětlení dalšího postupu.",
      tone: error?.includes("limit 10") ? "is-error" : "",
    },
    {
      key: "setup",
      icon: "info" as const,
      title: "Neinicializovaný admin účet 503",
      detail: "Pokud není seed administrace dokončený, obrazovka musí vrátit servisní stav, ne předstírat úspěch.",
      tone: error?.includes("není inicializován") ? "is-error" : "",
    },
    {
      key: "help",
      icon: "key" as const,
      title: "Pomoc s přístupem",
      detail: info
        ? "Instrukce byly potvrzeny stejnou odpovědí bez prozrazení stavu účtu."
        : "Tlačítko neposílá reset token, pouze bezpečnou interní instrukci a kontakt.",
      tone: info ? "is-success" : "",
    },
  ];

  return (
    <div className="admin-login-page admin-login-page--forensic">
      <section className="admin-login-shell" aria-labelledby="admin-login-workspace-title">
        <header className="admin-login-shell-head">
          <div>
            <strong id="admin-login-workspace-title">ADM-01 / Přihlášení administrátora</strong>
            <span>Samostatná vstupní obrazovka pro vytvoření admin session a bezpečný návrat na požadovanou interní routu.</span>
          </div>
          <div className="admin-login-shell-meta">
            <span>Route <strong>/admin/login</strong></span>
            <span>Role <strong>Administrátor</strong></span>
            <span>Návrat po přihlášení <strong>{nextPath}</strong></span>
          </div>
        </header>

        <div className="admin-login-board">
          <aside className="admin-login-context" aria-label="Provozní kontext administrace">
            <div className="admin-login-context-card">
              <div className="admin-login-context-kicker">Bezpečný vstup do administrace</div>
              <h2 className="admin-login-context-title">Přihlášení je oddělené od zaměstnaneckého portálu a pracuje jen s interní admin cestou.</h2>
              <p className="admin-login-context-copy">
                Po úspěchu se uživatel vrací pouze na sanitizovanou <code>{nextPath}</code> nebo na výchozí <code>/admin/prehled</code>.
              </p>
            </div>

            <div className="admin-login-context-card admin-login-context-card--accent">
              <div className="admin-login-context-row">
                <span className="admin-login-context-icon"><AuthStatusIcon name="shield" /></span>
                <div>
                  <strong>Admin session + CSRF</strong>
                  <span>Mutace zůstávají chráněné session cookie a CSRF kontrolou. Frontend nesmí předstírat úspěch bez potvrzení backendu.</span>
                </div>
              </div>
              <div className="admin-login-context-row">
                <span className="admin-login-context-icon"><AuthStatusIcon name="keyboard" /></span>
                <div>
                  <strong>Jediný povolený účet</strong>
                  <span>Aktuální web přijímá jako admin identitu pouze <strong>provoz@hotelchodovasc.cz</strong>.</span>
                </div>
              </div>
            </div>
          </aside>

          <Card className="admin-login-card auth-primary-card">
            <img src={BRAND_ASSETS.logoHorizontal} alt={APP_NAME_LONG} className="auth-card-logo" />
            <h1 className="auth-card-title">Přihlášení administrátora</h1>
            <p className="auth-card-description">Vstup je určen pouze pro interní správu hotelového provozu. Hlavní tok musí být čitelný na desktopu i mobilu bez zbytečných odboček.</p>

            <div className="admin-login-return-box">
              <span>Po přihlášení návrat na</span>
              <strong>{nextPath}</strong>
            </div>

            {checkingSession ? <div className="auth-state" role="status"><strong>Kontrola existující session</strong>Ověřuji, zda už není administrace přihlášená.</div> : null}
            {error ? <div className="auth-state auth-state--error" role="alert"><strong>Přihlášení se nezdařilo</strong>{error}</div> : null}
            {info ? <InlineNotice tone="ok">{info}</InlineNotice> : null}

            <form onSubmit={onSubmit} className="kb-stack admin-login-form">
              <label className="kb-field" htmlFor="admin-login-email">
                <span className="kb-label">E-mail správce</span>
                <input
                  id="admin-login-email"
                  className="kb-input"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="provoz@hotelchodovasc.cz"
                  disabled={submitting || checkingSession}
                  aria-invalid={Boolean(error && (!email || email.trim().toLowerCase() !== "provoz@hotelchodovasc.cz"))}
                />
                <small className="auth-field-help">Frontend předem hlídá, že administrace používá právě tuto provozní adresu.</small>
              </label>
              <label className="kb-field" htmlFor="admin-login-password">
                <span className="kb-label">Heslo správce</span>
                <input
                  id="admin-login-password"
                  className="kb-input"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  disabled={submitting || checkingSession}
                  aria-invalid={Boolean(error && !password)}
                />
              </label>

              <Button type="submit" disabled={submitting || checkingSession} variant="primary" style={{ width: "100%", justifyContent: "center" }}>
                {checkingSession ? "Kontroluji session…" : submitting ? "Přihlašuji…" : "Přihlásit"}
              </Button>
            </form>

            <div className="admin-login-support">
              <div>Přístup je určen pouze administrátorům na adrese <strong>provoz@hotelchodovasc.cz</strong>.</div>
              <div>Pokud heslo není dostupné, můžete poslat interní instrukce k přístupu bez reset tokenu a bez prozrazení stavu účtu.</div>
            </div>

            <div className="admin-login-actions auth-form-actions">
              <Button type="button" variant="ghost" onClick={() => void onSendHelp()} disabled={sendingHelp || checkingSession}>
                {sendingHelp ? "Odesílám…" : "Poslat instrukce k přístupu"}
              </Button>
              <a href="mailto:provoz@hotelchodovasc.cz" className="admin-mini-link">
                Kontaktovat podporu
              </a>
            </div>
          </Card>

          <aside className="admin-login-stateboard" aria-label="Stavové výřezy administrátorského loginu">
            {stateCards.map((card) => (
              <div key={card.key} className={`admin-login-state-card ${card.tone}`.trim()}>
                <span className="admin-login-state-card-icon"><AuthStatusIcon name={card.icon} /></span>
                <div>
                  <strong>{card.title}</strong>
                  <span>{card.detail}</span>
                </div>
              </div>
            ))}
          </aside>
        </div>

        <section className="admin-login-summary-strip" aria-label="Souhrn aktuálního stavu přihlášení">
          <div><span>Stav formuláře</span><strong>{formState}</strong></div>
          <div><span>Bezpečný návrat</span><strong>{nextPath}</strong></div>
          <div><span>Ochrana</span><strong>Session cookie + CSRF</strong></div>
        </section>
      </section>
    </div>
  );
}
