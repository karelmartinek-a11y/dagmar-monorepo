import { FormEvent, useState } from "react";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { Brand } from "../components/Brand";
import { Button, Field, StatusMessage } from "../components/Primitives";

function AuthFrame({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <main className="auth-page"><section className="auth-story"><Brand /><div><h1>Čas má svůj <span>řád.</span></h1><p>Přehledná docházka, plán služeb a provozní jistota v jednom soustředěném pracovním prostoru.</p></div><small>Europe/Prague · bezpečný provoz</small></section><section className="auth-board"><div className="auth-card"><h2>{title}</h2><p>{description}</p>{children}</div></section></main>;
}

export function AdminLoginPage() {
  const [username, setUsername] = useState(""); const [password, setPassword] = useState("");
  const [error, setError] = useState(""); const [pending, setPending] = useState(false);
  const navigate = useNavigate(); const location = useLocation();
  const next = new URLSearchParams(location.search).get("next");
  const safeNext = next?.startsWith("/admin/") && !next.startsWith("//") ? next : "/admin/prehled";
  const submit = async (event: FormEvent) => { event.preventDefault(); setError(""); setPending(true); try { await api.adminLogin(username, password); navigate(safeNext, { replace:true }); } catch (e) { setError(e instanceof Error ? e.message : "Přihlášení se nezdařilo."); } finally { setPending(false); } };
  return <AuthFrame title="Vstup do administrace" description="Přihlášení je chráněno serverovou session a CSRF kontrolou."><form onSubmit={submit}><Field label="Přihlašovací jméno administrátora"><input type="text" autoComplete="username" required value={username} onChange={e=>setUsername(e.target.value)} /></Field><Field label="Heslo"><input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} /></Field>{error && <StatusMessage kind="error" title="Přihlášení nebylo přijato">{error}</StatusMessage>}<Button disabled={pending}>{pending ? "Ověřuji…" : "Přihlásit do administrace"}</Button></form></AuthFrame>;
}

export function ResetPage() {
  const [params] = useSearchParams(); const token = params.get("token") ?? "";
  const [password, setPassword] = useState(""); const [repeat, setRepeat] = useState(""); const [state, setState] = useState<"idle"|"pending"|"done">("idle"); const [error,setError]=useState("");
  const submit=async(e:FormEvent)=>{e.preventDefault();setError("");if(password.length<8){setError("Heslo musí mít alespoň 8 znaků.");return}if(password!==repeat){setError("Hesla se neshodují.");return}setState("pending");try{await api.portalReset(token,password);setState("done")}catch(err){setError(err instanceof Error?err.message:"Reset se nezdařil.");setState("idle")}};
  return <AuthFrame title="Nové přístupové heslo" description="Odkaz lze použít jednou a má omezenou platnost.">{state==="done"?<><StatusMessage kind="success" title="Heslo bylo změněno">Nyní se můžete přihlásit v zaměstnaneckém portálu.</StatusMessage><a className="button button--primary" href="/app">Pokračovat k přihlášení</a></>:<form onSubmit={submit}><Field label="Nové heslo" hint="Nejméně 8 znaků"><input type="password" autoComplete="new-password" required value={password} onChange={e=>setPassword(e.target.value)} /></Field><Field label="Zopakujte heslo"><input type="password" autoComplete="new-password" required value={repeat} onChange={e=>setRepeat(e.target.value)} /></Field>{!token&&<StatusMessage kind="error" title="Odkaz není úplný">Chybí bezpečný resetovací token.</StatusMessage>}{error&&<StatusMessage kind="error" title="Heslo nelze změnit">{error}</StatusMessage>}<Button disabled={!token||state==="pending"}>{state==="pending"?"Ukládám…":"Nastavit nové heslo"}</Button></form>}</AuthFrame>;
}

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const location=useLocation(); const query=useQuery({queryKey:["admin-me"],queryFn:api.adminMe,retry:false,staleTime:30_000});
  if(query.isPending)return <main className="auth-page"><section className="auth-story"><Brand /></section><section className="auth-board"><StatusMessage kind="loading" title="Ověřuji administrátorskou session" /></section></main>;
  if(query.isError||!query.data?.authenticated)return <Navigate to={`/admin/login?next=${encodeURIComponent(location.pathname+location.search)}`} replace />;
  return children;
}

export function NotFoundPage(){return <AuthFrame title="Tato cesta neexistuje" description="Požadovaná stránka není součástí systému KájovoDagmar."><a className="button button--primary" href="/app">Zpět do portálu</a></AuthFrame>}
