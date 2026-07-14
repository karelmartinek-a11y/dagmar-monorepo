import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, ArrowRight, Database, ServerCog } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { AdminUser } from "../api/types";
import { Panel, StatusMessage } from "../components/Primitives";

export function AdminOverviewPage(){
  const users=useQuery({queryKey:["admin-users"],queryFn:()=>api.admin<{users:AdminUser[]}>("/api/v1/admin/users")});
  const instances=useQuery({queryKey:["instances"],queryFn:()=>api.admin<any[]>("/api/v1/admin/instances")});
  const version=useQuery({queryKey:["version"],queryFn:()=>api.admin<{backend_deploy_tag:string;environment:string}>("/api/version")});
  const integrations=useQuery({queryKey:["integrations"],queryFn:()=>api.admin<any[]>("/api/v1/admin/integrations/clients")});
  const errors=[users,instances,version,integrations].filter(q=>q.isError);
  return <div className="page"><header className="page-heading"><div><p>Provozní centrum</p><h1>Přehled systému</h1></div><span className="badge badge--good"><Activity/>Systém odpovídá</span></header>{errors.length>0&&<StatusMessage kind="error" title="Část přehledu není dostupná">Dostupné moduly zůstávají zobrazené. Obnovte stránku pro nový pokus.</StatusMessage>}<div className="metrics"><div className="metric"><span>Uživatelé</span><strong>{users.data?.users.length??"–"}</strong><small>{users.data?.users.filter(u=>u.is_active).length??"–"} aktivních</small></div><div className="metric"><span>Zařízení</span><strong>{instances.data?.length??"–"}</strong><small>{instances.data?.filter(i=>i.status==="ACTIVE").length??"–"} aktivních</small></div><div className="metric"><span>Integrace</span><strong>{integrations.data?.length??"–"}</strong><small>{integrations.data?.filter(i=>i.status==="ACTIVE").length??"–"} aktivních</small></div><div className="metric"><span>Backend</span><strong>{version.data?.backend_deploy_tag??"–"}</strong><small>{version.data?.environment??"načítám"}</small></div></div><div className="split"><Panel title="Dnešní provoz"><ul className="list"><li><span>Docházkové listy</span><Link to="/admin/dochazka">Otevřít <ArrowRight size={16}/></Link></li><li><span>Plán služeb</span><Link to="/admin/plan-sluzeb">Otevřít <ArrowRight size={16}/></Link></li><li><span>Export a uzávěrka</span><Link to="/admin/export">Připravit <ArrowRight size={16}/></Link></li></ul></Panel><Panel title="Technický stav"><ul className="list"><li><span><ServerCog/> API namespace</span><strong>/api/v1/</strong></li><li><span><Database/> Datová autorita</span><strong>employment_id</strong></li><li><span><AlertTriangle/> Časové pásmo</span><strong>Europe/Prague</strong></li></ul></Panel></div></div>
}
