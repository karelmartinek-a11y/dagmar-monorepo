import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { CalendarCheck2, CalendarRange, Download, Gauge, KeyRound, Menu, PlugZap, Printer, Settings2, UsersRound, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { Brand } from "../components/Brand";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { Button } from "../components/Primitives";
import { useDateFormatter } from "../utils/format";

export function AdminShell() {
  const { t } = useTranslation();
  const dateFormatter = useDateFormatter({ dateStyle: "long" });
  const nav = [
    ["/admin/prehled", t("nav.overview"), Gauge], ["/admin/users", t("nav.users"), UsersRound],
    ["/admin/dochazka", t("nav.attendance"), CalendarCheck2], ["/admin/plan-sluzeb", t("nav.shiftPlan"), CalendarRange],
    ["/admin/export", t("nav.export"), Download], ["/admin/tisky", t("nav.prints"), Printer],
    ["/admin/settings", t("nav.settings"), Settings2],
    ["/admin/ucet", "Zabezpečení účtu", KeyRound],
    ["/admin/integrace", t("nav.integrations"), PlugZap],
  ] as const;
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const logout = async () => { await api.adminLogout(); navigate("/admin/login", { replace: true }); };
  return <div className="admin-layout">
    <aside className={`sidebar ${open ? "sidebar--open" : ""}`}>
      <div className="sidebar__head"><Brand compact /><Button className="sidebar__close" variant="quiet" aria-label={t("nav.menuClose")} onClick={() => setOpen(false)}><X /></Button></div>
      <nav aria-label={t("nav.adminLabel")}>{nav.map(([to, label, Icon]) => <NavLink key={to} to={to} onClick={() => setOpen(false)}><Icon /><span>{label}</span></NavLink>)}</nav>
      <div className="sidebar__foot"><span><i />{t("common.states.production")}</span><div className="sidebar__controls"><LanguageSwitcher compact /><button onClick={logout}>{t("nav.logoutAdmin")}</button></div></div>
    </aside>
    <div className="admin-stage">
      <header className="topbar"><Button variant="quiet" className="menu-button" aria-label={t("nav.menuOpen")} onClick={() => setOpen(true)}><Menu /></Button><span>{t("nav.adminCenter")}</span><div className="topbar__meta"><LanguageSwitcher compact /><time>{dateFormatter.format(new Date())}</time></div></header>
      <main id="main-content"><Outlet /></main>
    </div>
    {open && <button className="sidebar-backdrop" aria-label={t("nav.menuClose")} onClick={() => setOpen(false)} />}
  </div>;
}
