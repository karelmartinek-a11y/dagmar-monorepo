import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { CalendarCheck2, CalendarRange, Download, Gauge, Menu, PlugZap, Printer, Settings2, UsersRound, X } from "lucide-react";
import { api } from "../api/client";
import { Brand } from "../components/Brand";
import { Button } from "../components/Primitives";

const nav = [
  ["/admin/prehled", "Přehled", Gauge], ["/admin/users", "Uživatelé", UsersRound],
  ["/admin/dochazka", "Docházka", CalendarCheck2], ["/admin/plan-sluzeb", "Plán služeb", CalendarRange],
  ["/admin/export", "Export", Download], ["/admin/tisky", "Tisky", Printer],
  ["/admin/settings", "Nastavení", Settings2],
  ["/admin/integrace", "Integrace", PlugZap],
] as const;

export function AdminShell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const logout = async () => { await api.adminLogout(); navigate("/admin/login", { replace: true }); };
  return <div className="admin-layout">
    <aside className={`sidebar ${open ? "sidebar--open" : ""}`}>
      <div className="sidebar__head"><Brand compact /><Button className="sidebar__close" variant="quiet" aria-label="Zavřít navigaci" onClick={() => setOpen(false)}><X /></Button></div>
      <nav aria-label="Administrace">{nav.map(([to, label, Icon]) => <NavLink key={to} to={to} onClick={() => setOpen(false)}><Icon /><span>{label}</span></NavLink>)}</nav>
      <div className="sidebar__foot"><span><i />Produkční provoz</span><button onClick={logout}>Odhlásit administraci</button></div>
    </aside>
    <div className="admin-stage">
      <header className="topbar"><Button variant="quiet" className="menu-button" aria-label="Otevřít navigaci" onClick={() => setOpen(true)}><Menu /></Button><span>Centrální řízení docházky</span><time>{new Intl.DateTimeFormat("cs-CZ", { dateStyle: "long", timeZone: "Europe/Prague" }).format(new Date())}</time></header>
      <main id="main-content"><Outlet /></main>
    </div>
    {open && <button className="sidebar-backdrop" aria-label="Zavřít navigaci" onClick={() => setOpen(false)} />}
  </div>;
}
