import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, ArrowRight, Database, ServerCog } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { AdminUser } from "../api/types";
import { Panel, StatusMessage } from "../components/Primitives";

export function AdminOverviewPage(){
  const { t } = useTranslation();
  const users=useQuery({queryKey:["admin-users"],queryFn:()=>api.admin<{users:AdminUser[]}>("/api/v1/admin/users")});
  const version=useQuery({queryKey:["version"],queryFn:()=>api.admin<{backend_deploy_tag:string;environment:string}>("/api/version")});
  const integrations=useQuery({queryKey:["integrations"],queryFn:()=>api.admin<any[]>("/api/v1/admin/integrations/clients")});
  const errors=[users,version,integrations].filter(q=>q.isError);
  return <div className="page"><header className="page-heading"><div><p>{t("overview.eyebrow")}</p><h1>{t("overview.title")}</h1></div><span className="badge badge--good"><Activity/>{t("overview.healthy")}</span></header>{errors.length>0&&<StatusMessage kind="error" title={t("common.status.partUnavailable")}>{t("common.status.refreshRetry")}</StatusMessage>}<div className="metrics metrics--triple"><div className="metric"><span>{t("overview.metrics.users")}</span><strong>{users.data?.users.length??t("common.states.notAvailable")}</strong><small>{users.data?.users.filter(u=>u.is_active).length??t("common.states.notAvailable")} {t("overview.metrics.activeSuffix")}</small></div><div className="metric"><span>{t("overview.metrics.integrations")}</span><strong>{integrations.data?.length??t("common.states.notAvailable")}</strong><small>{integrations.data?.filter(i=>i.status==="ACTIVE").length??t("common.states.notAvailable")} {t("overview.metrics.activeSuffix")}</small></div><div className="metric"><span>{t("overview.metrics.backend")}</span><strong>{version.data?.backend_deploy_tag??t("common.states.notAvailable")}</strong><small>{version.data?.environment??t("overview.metrics.loadingEnvironment")}</small></div></div><div className="split"><Panel title={t("overview.panels.today")}><ul className="list"><li><span>{t("overview.links.attendance")}</span><Link to="/admin/dochazka">{t("common.actions.open")} <ArrowRight size={16}/></Link></li><li><span>{t("overview.links.shiftPlan")}</span><Link to="/admin/plan-sluzeb">{t("common.actions.open")} <ArrowRight size={16}/></Link></li><li><span>{t("overview.links.export")}</span><Link to="/admin/export">{t("common.actions.prepare")} <ArrowRight size={16}/></Link></li></ul></Panel><Panel title={t("overview.panels.technical")}><ul className="list"><li><span><ServerCog/> {t("overview.technical.apiNamespace")}</span><strong>/api/v1/</strong></li><li><span><Database/> {t("overview.technical.dataAuthority")}</span><strong>employment_id</strong></li><li><span><AlertTriangle/> {t("overview.technical.timezone")}</span><strong>Europe/Prague</strong></li></ul></Panel></div></div>
}
