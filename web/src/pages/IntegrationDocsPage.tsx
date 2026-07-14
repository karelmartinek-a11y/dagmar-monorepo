import { Brand } from "../components/Brand";
import { Panel } from "../components/Primitives";

const endpoints = [
  ["GET", "/api/v1/integration/health", "Ověření tokenu a dostupnosti"],
  ["GET", "/api/v1/integration/employments", "Úvazky v povoleném datovém rozsahu"],
  ["GET", "/api/v1/integration/shift-plan", "Plán služeb, nejvýše 31 dní"],
  ["GET", "/api/v1/integration/attendances", "Docházkové záznamy, nejvýše 31 dní"],
  ["POST", "/api/v1/integration/attendances", "Vytvoření docházky podle employment_id"],
  ["PATCH", "/api/v1/integration/attendances/{attendance_id}", "Bezpečná změna docházky"],
  ["DELETE", "/api/v1/integration/attendances/{attendance_id}", "Smazání s auditním důvodem"],
  ["GET", "/api/v1/integration/punches", "Normalizované průchody"],
  ["GET", "/api/v1/integration/locks", "Měsíční zámky"],
] as const;

const paginationExample = JSON.stringify({ data: [], pagination: { limit: 100, offset: 0, total: 0 } }, null, 2);

export function IntegrationDocsPage() {
  return <main id="main-content"><header className="topbar"><Brand compact /><a href="/app">Zaměstnanecký portál</a><a href="/admin/login">Administrace</a></header><div className="page" style={{ padding: "clamp(1rem,5vw,5rem)" }}><header className="page-heading"><div><p>Veřejná technická dokumentace</p><h1>Integration API</h1><p>Oddělené bearer tokeny, explicitní scope, audit a datová vazba na <code>employment_id</code>.</p></div></header><div className="metrics"><div className="metric"><span>Namespace</span><strong>/api/v1</strong><small>stabilní verze</small></div><div className="metric"><span>Token</span><strong>dgi_…</strong><small>nikdy zaměstnanecký token</small></div><div className="metric"><span>Časové okno</span><strong>31</strong><small>dní na seznamový dotaz</small></div><div className="metric"><span>Formát seznamu</span><strong>2</strong><small>data + pagination</small></div></div><Panel title="Autentizace"><div className="panel-body"><pre className="secret">Authorization: Bearer dgi_vas_jednorazove_predany_token</pre><p>Token získáte od administrátora. Server ukládá pouze jeho hash a bezpečné identifikátory. Každý požadavek je auditován a může vrátit request ID.</p></div></Panel><Panel title="Endpointy"><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Metoda</th><th>Cesta</th><th>Význam</th></tr></thead><tbody>{endpoints.map(([method, path, meaning]) => <tr key={`${method}${path}`}><td><span className={`badge ${method === "GET" ? "badge--good" : "badge--warn"}`}>{method}</span></td><td><code>{path}</code></td><td>{meaning}</td></tr>)}</tbody></table></div></Panel><div className="split"><Panel title="Stránkování"><div className="panel-body"><pre className="secret">{paginationExample}</pre></div></Panel><Panel title="Chyby"><ul className="list"><li><span>401</span><strong>chybějící nebo neplatný token</strong></li><li><span>403</span><strong>scope nepovoluje operaci</strong></li><li><span>409</span><strong>konflikt doménových dat</strong></li><li><span>422</span><strong>neplatný vstup</strong></li><li><span>429</span><strong>překročený limit</strong></li></ul></Panel></div><p><a href="/api/v1/integration/openapi.json">Stáhnout přesný OpenAPI kontrakt</a></p></div></main>;
}
