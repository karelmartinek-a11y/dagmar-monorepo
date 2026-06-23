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
  { to: "/admin/prehled", label: "Přehled" },
  { to: "/admin/users", label: "Uživatelé" },
  { to: "/admin/dochazka", label: "Docházka" },
  { to: "/admin/plan-sluzeb", label: "Plán služeb" },
  { to: "/admin/tisky", label: "Tisky" },
  { to: "/admin/export", label: "Export" },
  { to: "/admin/settings", label: "Nastavení" },
  { to: "/admin/instances", label: "Zařízení" },
  { to: "/admin/integrace", label: "Integrace" },
];

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
          <div className="kb-intro-title">Operační cockpit</div>
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
      <aside className="admin-sidebar" aria-label="Admin navigace">
        <div className="admin-sidebar-brand">
          <img src={BRAND_ASSETS.logoHorizontal} alt="" className="admin-sidebar-logo" />
          <div>
            <div className="admin-sidebar-title">KájovoDagmar</div>
            <div className="admin-sidebar-subtitle">Operační cockpit hotelu</div>
          </div>
        </div>

        <div className="admin-sidebar-section">
          <div className="admin-sidebar-caption">Přihlášený správce</div>
          <div className="admin-sidebar-user">{me.username}</div>
        </div>

        <nav className="admin-sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => cx("admin-sidebar-link", isActive && "active")} end={item.to === "/admin/prehled"}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div id="admin-sidebar-extra" className="kb-sidebar-extra" />

        <div className="admin-sidebar-footer">
          <div className="admin-sidebar-context">
            <span>Aktuální sekce</span>
            <strong>{locationLabel(location.pathname)}</strong>
          </div>
          <Button type="button" variant="primary" style={{ width: "100%" }} onClick={() => void onLogout()}>
            Odhlásit
          </Button>
        </div>

        <div id="admin-sidebar-bottom-extra" className="kb-sidebar-bottom-extra" />
      </aside>

      <div className="admin-content">
        <div className="admin-topbar">
          <div>
            <div className="admin-topbar-kicker">Produkční administrace</div>
            <div className="admin-topbar-title">{locationLabel(location.pathname)}</div>
          </div>
          <div className="admin-topbar-actions">
            <NavLink className="admin-mini-link" to="/admin/settings">
              Nastavení
            </NavLink>
            <NavLink className="admin-mini-link" to="/admin/instances">
              Zařízení
            </NavLink>
          </div>
        </div>

        <main className="admin-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
