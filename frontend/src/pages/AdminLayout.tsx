import React from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { adminLogout, getAdminMe } from "../api/admin";
import { BRAND_ASSETS } from "../brand/brand";
import Button from "../ui/Button";

type MeState = { kind: "loading" } | { kind: "anon" } | { kind: "auth"; username: string };

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const NAV_ITEMS = [
  { section: "Provoz", to: "/admin/prehled", label: "Přehled", description: "Rychlý stav provozu a zkrácené metriky." },
  { section: "Provoz", to: "/admin/users", label: "Uživatelé", description: "Účty zaměstnanců, úvazky a přístupy." },
  { section: "Provoz", to: "/admin/dochazka", label: "Docházka", description: "Ruční evidence docházky po jednotlivých úvazcích." },
  { section: "Provoz", to: "/admin/plan-sluzeb", label: "Plán služeb", description: "Měsíční rozpis směn a statusů dnů." },
  { section: "Výstupy", to: "/admin/tisky", label: "Tisky", description: "Preview dokumentů připravených pro tisk nebo kontrolu." },
  { section: "Výstupy", to: "/admin/export", label: "Export", description: "Stažení CSV a ZIP exportů pro další zpracování." },
  { section: "Systém", to: "/admin/settings", label: "Nastavení", description: "Pošta, pravidla docházky a diagnostika." },
  { section: "Systém", to: "/admin/instances", label: "Zařízení", description: "Správa zařízení, webových a mobilních instancí." },
  { section: "Systém", to: "/admin/integrace", label: "Integrace", description: "Napojení externích systémů a oprávnění klientů." },
];

const NAV_GROUPS = ["Provoz", "Výstupy", "Systém"].map((section) => ({
  section,
  items: NAV_ITEMS.filter((item) => item.section === section),
}));

function locationLabel(pathname: string) {
  const found = NAV_ITEMS.find((item) => pathname.startsWith(item.to));
  return found?.label ?? "Administrace";
}

function LoadingState() {
  return (
    <div className="kb-intro" role="status" aria-label="Načítání">
      <div className="kb-intro-card">
        <div className="kb-intro-top">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img src={BRAND_ASSETS.logoHorizontal} alt="" style={{ height: 38, width: "auto" }} />
          </div>
        </div>
        <div>
          <div className="kb-intro-title">Administrace</div>
          <div className="kb-intro-sub">Připravuji administraci…</div>
        </div>
        <div className="kb-spinner" aria-hidden="true" />
      </div>
    </div>
  );
}

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [me, setMe] = React.useState<MeState>({ kind: "loading" });
  const [navOpen, setNavOpen] = React.useState(false);

  React.useEffect(() => {
    setNavOpen(false);
  }, [location.pathname, location.search]);

  React.useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const response = await getAdminMe();
        if (!mounted) return;
        if (!response.authenticated || !response.username) {
          setMe({ kind: "anon" });
          navigate(`/admin/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
          return;
        }
        setMe({ kind: "auth", username: response.username });
      } catch {
        if (!mounted) return;
        setMe({ kind: "anon" });
        navigate(`/admin/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
      }
    })();
    return () => {
      mounted = false;
    };
  }, [location.pathname, location.search, navigate]);

  async function onLogout() {
    try {
      await adminLogout();
    } catch {
      // best effort
    } finally {
      navigate("/admin/login", { replace: true });
    }
  }

  // Dokud není auth potvrzená, nesmíme mountnout admin stránky,
  // jinak jejich datové hooky vyrábějí zbytečné 401 na login obrazovce.
  if (me.kind === "loading") {
    return <LoadingState />;
  }

  if (me.kind === "anon") {
    return null;
  }

  return (
    <div className="admin-shell">
      <button
        type="button"
        className={cx("admin-mobile-backdrop", navOpen && "is-open")}
        onClick={() => setNavOpen(false)}
        aria-label="Zavřít navigaci"
        tabIndex={navOpen ? 0 : -1}
      />
      <aside id="admin-navigation" className={cx("admin-sidebar", navOpen && "is-open")} aria-label="Admin navigace">
        <div className="admin-sidebar-brand">
          <img src={BRAND_ASSETS.logoHorizontal} alt="" className="admin-sidebar-logo" />
          <div>
            <div className="admin-sidebar-title">Administrace</div>
            <div className="admin-sidebar-subtitle">DOCHÁZKOVÝ SYSTÉM</div>
          </div>
        </div>

        <div className="admin-sidebar-section">
          <div className="admin-sidebar-caption">Přihlášený správce</div>
          <div className="admin-sidebar-user">{me.username}</div>
        </div>

        <nav className="admin-sidebar-nav">
          {NAV_GROUPS.map((group) => (
            <div key={group.section} className="admin-nav-group">
              <div className="admin-nav-group-label">{group.section}</div>
              {group.items.map((item) => (
                <NavLink key={item.to} to={item.to} className={({ isActive }) => cx("admin-sidebar-link", isActive && "active")} end={item.to === "/admin/prehled"}>
                  <span className="admin-sidebar-link-label">{item.label}</span>
                  <small className="admin-sidebar-link-copy">{item.description}</small>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div id="admin-sidebar-extra" className="kb-sidebar-extra" />

        <div className="admin-sidebar-footer">
          <div className="admin-sidebar-status">
            <span className="admin-status-pill admin-status-pill--live">Produkce</span>
            <div className="admin-sidebar-context">
              <span>Aktuální sekce</span>
              <strong>{locationLabel(location.pathname)}</strong>
            </div>
            <div className="admin-sidebar-meta">dagmar.hcasc.cz</div>
          </div>
          <Button type="button" variant="danger" style={{ width: "100%" }} onClick={() => void onLogout()} aria-label="Bezpečně odhlásit administraci">
            Odhlásit
          </Button>
        </div>

        <div id="admin-sidebar-bottom-extra" className="kb-sidebar-bottom-extra" />
      </aside>

      <div className="admin-content">
        <div className="admin-topbar">
          <div className="admin-topbar-context">
            <button
              type="button"
              className="admin-mobile-nav-toggle"
              onClick={() => setNavOpen((current) => !current)}
              aria-expanded={navOpen}
              aria-controls="admin-navigation"
            >
              <span aria-hidden="true">☰</span>
              <span>Menu</span>
            </button>
            <div className="admin-topbar-kicker">Produkční administrace</div>
            <div className="admin-topbar-meta">
              <span className="admin-status-pill admin-status-pill--live">{locationLabel(location.pathname)}</span>
              <span className="admin-topbar-presence">dagmar.hcasc.cz</span>
              <span className="admin-topbar-presence">{me.username}</span>
            </div>
          </div>
          <div className="admin-topbar-actions">
            <NavLink className="admin-mini-link" to="/admin/settings">
              Nastavení
            </NavLink>
            <NavLink className="admin-mini-link" to="/admin/instances">
              Zařízení
            </NavLink>
            <Button type="button" variant="danger" size="sm" onClick={() => void onLogout()}>
              Odhlásit
            </Button>
          </div>
        </div>

        <main className="admin-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
