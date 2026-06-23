import React, { useState } from "react";
import { useLocation } from "react-router-dom";
import { portalResetPassword } from "../api/portal";

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
  const token = getToken(loc.search);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

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
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "linear-gradient(180deg, rgba(82, 85, 93, 0.1) 0%, rgba(82, 85, 93, 0.03) 40%, #ffffff 100%)",
      }}
    >
      <div className="reset-shell" style={{ gridTemplateColumns: "minmax(360px, 0.95fr) minmax(420px, 1.05fr)" }}>
        <aside className="reset-aside">
          <div className="eyebrow" style={{ background: "rgba(255,255,255,0.14)", color: "white" }}>
            Obnova přístupu
          </div>
          <h1 className="reset-aside-title">Nastavení nebo změna hesla</h1>
          <div className="reset-aside-text">
            Odkaz pro obnovu je platný 24 hodin. Po úspěšném uložení se můžete přihlásit novým heslem ve stejném zařízení i v administraci.
          </div>
          <div className="admin-note-box" style={{ background: "rgba(255,255,255,0.08)", borderColor: "rgba(255,255,255,0.14)" }}>
            <div className="admin-note-title" style={{ color: "white" }}>Doporučení</div>
            <div style={{ color: "rgba(255,255,255,0.82)", fontSize: 13, lineHeight: 1.7 }}>
              Zvolte heslo, které není odvoditelné z osobních údajů, názvu zařízení ani běžného slovníku. Nové heslo se projeví po uložení okamžitě.
            </div>
          </div>
        </aside>

        <div className="card pad" style={{ width: "100%", boxShadow: "var(--shadow-2)", alignSelf: "center", maxWidth: 560, justifySelf: "center" }}>
          <div style={{ fontSize: 22, fontWeight: 850 }}>Zadejte nové heslo</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4, lineHeight: 1.6 }}>
            Platnost odkazu je 24 hodin. Po uložení můžete pokračovat novým heslem.
          </div>

          {error ? (
            <div
              style={{
                border: "1px solid rgba(255,0,0,0.35)",
                background: "rgba(255,0,0,0.08)",
                borderRadius: 12,
                padding: 12,
                color: "var(--kb-red)",
                marginTop: 12,
                fontSize: 13,
              }}
            >
              {error}
            </div>
          ) : null}

          {success ? (
            <div
              style={{
                border: "1px solid rgba(38,43,49,0.35)",
                background: "rgba(38,43,49,0.1)",
                borderRadius: 12,
                padding: 12,
                color: "var(--kb-brand-ink-800)",
                marginTop: 12,
                fontSize: 13,
              }}
            >
              Heslo bylo nastaveno. Můžete se přihlásit.
            </div>
          ) : (
            <form onSubmit={onSubmit} className="stack" style={{ gap: 12, marginTop: 12 }}>
              <div>
                <div className="label">Nové heslo</div>
                <input
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Zadejte nové heslo"
                  autoComplete="new-password"
                  disabled={saving}
                  style={{ minHeight: 48 }}
                />
              </div>
              <div className="admin-note-box">
                <div className="admin-note-title">Požadovaný výsledek</div>
                <div style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>
                  Po úspěšném uložení se tato obrazovka potvrdí zprávou a přihlášení pak probíhá novým heslem.
                </div>
              </div>
              <button type="submit" className="btn solid" disabled={saving}>
                {saving ? "Ukládám…" : "Uložit heslo"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
