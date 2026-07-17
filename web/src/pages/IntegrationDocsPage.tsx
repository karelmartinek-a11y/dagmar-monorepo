import { Brand } from "../components/Brand";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { Panel } from "../components/Primitives";

const endpoints = [
  ["GET", "/api/v1/integration/health", "integrationDocs.endpointMeanings.health"],
  ["GET", "/api/v1/integration/employments", "integrationDocs.endpointMeanings.employments"],
  ["GET", "/api/v1/integration/shift-plan", "integrationDocs.endpointMeanings.shiftPlan"],
  ["GET", "/api/v1/integration/attendances", "integrationDocs.endpointMeanings.attendances"],
  ["POST", "/api/v1/integration/attendances", "integrationDocs.endpointMeanings.createAttendance"],
  ["PATCH", "/api/v1/integration/attendances/{attendance_id}", "integrationDocs.endpointMeanings.updateAttendance"],
  ["DELETE", "/api/v1/integration/attendances/{attendance_id}", "integrationDocs.endpointMeanings.deleteAttendance"],
  ["GET", "/api/v1/integration/punches", "integrationDocs.endpointMeanings.punches"],
  ["GET", "/api/v1/integration/locks", "integrationDocs.endpointMeanings.locks"],
] as const;

const paginationExample = JSON.stringify({ data: [], pagination: { limit: 100, offset: 0, total: 0 } }, null, 2);

export function IntegrationDocsPage() {
  const { t } = useTranslation();
  return <main id="main-content"><header className="topbar"><Brand compact /><div className="topbar__meta"><LanguageSwitcher compact /><a href="/app">{t("nav.employeePortal")}</a><a href="/admin/login">{t("nav.admin")}</a></div></header><div className="page" style={{ padding: "clamp(1rem,5vw,5rem)" }}><header className="page-heading"><div><p>{t("integrationDocs.eyebrow")}</p><h1>{t("integrationDocs.title")}</h1><p>{t("integrationDocs.description")} <code>employment_id</code>.</p></div></header><div className="metrics"><div className="metric"><span>{t("integrationDocs.metrics.namespace")}</span><strong>/api/v1</strong><small>{t("integrationDocs.metrics.stableVersion")}</small></div><div className="metric"><span>{t("integrationDocs.metrics.token")}</span><strong>dgi_…</strong><small>{t("integrationDocs.metrics.tokenNote")}</small></div><div className="metric"><span>{t("integrationDocs.metrics.window")}</span><strong>31</strong><small>{t("integrationDocs.metrics.windowNote")}</small></div><div className="metric"><span>{t("integrationDocs.metrics.listFormat")}</span><strong>2</strong><small>{t("integrationDocs.metrics.listFormatNote")}</small></div></div><Panel title={t("integrationDocs.auth.title")}><div className="panel-body"><pre className="secret">Authorization: Bearer dgi_vas_jednorazove_predany_token</pre><p>{t("integrationDocs.auth.body")}</p></div></Panel><Panel title={t("integrationDocs.endpoints.title")}><div className="data-table-wrap"><table className="data-table"><thead><tr><th>{t("integrationDocs.endpoints.method")}</th><th>{t("integrationDocs.endpoints.path")}</th><th>{t("integrationDocs.endpoints.meaning")}</th></tr></thead><tbody>{endpoints.map(([method, path, meaningKey]) => <tr key={`${method}${path}`}><td><span className={`badge ${method === "GET" ? "badge--good" : "badge--warn"}`}>{method}</span></td><td><code>{path}</code></td><td>{t(meaningKey)}</td></tr>)}</tbody></table></div></Panel><div className="split"><Panel title={t("integrationDocs.pagination")}><div className="panel-body"><pre className="secret">{paginationExample}</pre></div></Panel><Panel title={t("integrationDocs.errors.title")}><ul className="list"><li><span>401</span><strong>{t("integrationDocs.errors.unauthorized")}</strong></li><li><span>403</span><strong>{t("integrationDocs.errors.forbidden")}</strong></li><li><span>409</span><strong>{t("integrationDocs.errors.conflict")}</strong></li><li><span>422</span><strong>{t("integrationDocs.errors.invalid")}</strong></li><li><span>429</span><strong>{t("integrationDocs.errors.rateLimit")}</strong></li></ul></Panel></div><p><a href="/api/v1/integration/openapi.json">{t("integrationDocs.downloadOpenApi")}</a></p></div></main>;
}
