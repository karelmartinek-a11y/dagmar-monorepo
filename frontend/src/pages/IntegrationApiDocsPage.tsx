const baseUrl = "https://dagmar.hcasc.cz/api/v1/integration";
const placeholderToken = "dgi_REPLACE_WITH_TOKEN";

const scopes = [
  ["integration:health", "Přístup na health check integračního API."],
  ["employments:read", "Čtení seznamu úvazků."],
  ["shift_plan:read", "Čtení plánu směn."],
  ["attendance:read", "Čtení denní docházky."],
  ["attendance:create", "Vytvoření nového docházkového záznamu pro existující employment_id a datum."],
  ["attendance:update", "Částečná úprava existujícího docházkového záznamu."],
  ["attendance:delete", "Smazání existujícího docházkového záznamu."],
  ["punches:read", "Čtení odvozených průchodů."],
  ["locks:read", "Čtení měsíčních zámků docházky."],
  ["openapi:read", "Stažení chráněného OpenAPI JSON integračního API."],
] as const;

const endpoints = [
  {
    path: "GET /health",
    scope: "integration:health",
    purpose: "Ověření tokenu a dostupnosti API.",
    params: "Bez query parametrů.",
    note: "Vrací service name, API verzi, contract version a timezone.",
  },
  {
    path: "GET /employments",
    scope: "employments:read",
    purpose: "Seznam úvazků dostupných pro klienta.",
    params: "Volitelné: employment_id, employee_id, active, date_from, date_to, limit, cursor.",
    note: "Date filtry jen omezují průnik období úvazku. Endpoint nemá pevný 31denní limit.",
  },
  {
    path: "GET /shift-plan",
    scope: "shift_plan:read",
    purpose: "Plán směn v období.",
    params: "Povinné: date_from, date_to. Volitelné: employment_id, employee_id, include_locks, limit, cursor.",
    note: "Maximální období je 31 dnů.",
  },
  {
    path: "GET /attendances",
    scope: "attendance:read",
    purpose: "Denní docházka v období.",
    params: "Povinné: date_from, date_to. Volitelné: employment_id, employee_id, include_plan, include_locks, include_punches, include_corrections, limit, cursor.",
    note: "Maximální období je 31 dnů. include_corrections aktuálně vrací correction_status: not_tracked.",
  },
  {
    path: "POST /attendances",
    scope: "attendance:create",
    purpose: "Vytvoření nového docházkového záznamu.",
    params: "JSON body: employment_id, date, arrival_time?, departure_time?.",
    note: "Pokud docházka pro employment_id + date už existuje, API vrátí 409 duplicate_attendance.",
  },
  {
    path: "PATCH /attendances/{attendance_id}",
    scope: "attendance:update",
    purpose: "Částečná úprava docházkového záznamu.",
    params: "JSON body: arrival_time?, departure_time?, expected_updated_at?.",
    note: "Lze měnit jen skutečně uložené časy docházky. Ostatní pole jsou technická nebo systémová.",
  },
  {
    path: "DELETE /attendances/{attendance_id}",
    scope: "attendance:delete",
    purpose: "Smazání docházkového záznamu.",
    params: "Volitelné JSON body: expected_updated_at.",
    note: "Mazání respektuje stejný datový rozsah jako čtení a nikdy neobchází zamčené období.",
  },
  {
    path: "GET /punches",
    scope: "punches:read",
    purpose: "Odvozené průchody z denní docházky.",
    params: "Povinné: date_from, date_to. Volitelné: employment_id, employee_id, event_type, limit, cursor.",
    note: "Vrací pouze ARRIVAL a DEPARTURE odvozené z attendance. Nejde o raw terminálové eventy.",
  },
  {
    path: "GET /locks",
    scope: "locks:read",
    purpose: "Měsíční zámky docházky.",
    params: "Zadejte year+month nebo date_from+date_to. Dále volitelně employment_id, employee_id, limit, cursor.",
    note: "Vrací pouze existující zámky.",
  },
  {
    path: "GET /openapi.json",
    scope: "openapi:read",
    purpose: "Strojově čitelný popis integračního API.",
    params: "Bez query parametrů.",
    note: "Endpoint je chráněný tokenem a scope openapi:read.",
  },
] as const;

const errorRows = [
  ["400", "invalid_request", "Neplatné nebo chybějící parametry."],
  ["400", "validation_error", "Neplatný JSON payload nebo neplatný formát hodnot."],
  ["400", "invalid_attendance_payload", "Payload neobsahuje žádné zapisovatelné pole docházky."],
  ["400", "period_too_large", "Období na shift-plan, attendances nebo punches přesáhlo 31 dnů."],
  ["401", "missing_token", "Požadavek neposlal bearer token."],
  ["401", "invalid_token", "Token neodpovídá aktivnímu secretu nebo má neplatný formát."],
  ["403", "client_disabled", "Klient je zakázaný nebo expiroval."],
  ["403", "ip_forbidden", "IP adresa není v allowlistu klienta."],
  ["403", "insufficient_scope", "Klient nemá potřebný scope nebo žádá data mimo povolený rozsah."],
  ["404", "not_found", "Požadovaný úvazek nebo docházkový záznam nebyl nalezen."],
  ["409", "conflict", "Docházka byla mezitím změněna nebo datum neleží v platném období úvazku."],
  ["409", "duplicate_attendance", "Docházka pro employment_id + date už existuje."],
  ["409", "attendance_locked", "Docházka spadá do zamčeného období a nelze ji měnit."],
  ["429", "rate_limited", "Byl překročen limit požadavků."],
  ["500", "internal_error", "Došlo k interní chybě."],
] as const;

const sampleError = `{
  "error": {
    "code": "attendance_locked",
    "message": "Docházka za zvolené období je uzamčena.",
    "request_id": "0f86d61ffe3d448d91981d8cb373e766"
  }
}`;

const createExample = `curl -sS \\
  -X POST \\
  -H "Authorization: Bearer ${placeholderToken}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "employment_id": 101,
    "date": "2026-06-12",
    "arrival_time": "08:00",
    "departure_time": "16:30"
  }' \\
  ${baseUrl}/attendances`;

const patchExample = `curl -sS \\
  -X PATCH \\
  -H "Authorization: Bearer ${placeholderToken}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "departure_time": "16:45",
    "expected_updated_at": "2026-06-23T09:14:00Z"
  }' \\
  ${baseUrl}/attendances/501`;

const deleteExample = `curl -sS \\
  -X DELETE \\
  -H "Authorization: Bearer ${placeholderToken}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "expected_updated_at": "2026-06-23T09:14:00Z"
  }' \\
  ${baseUrl}/attendances/501`;

export default function IntegrationApiDocsPage() {
  return (
    <main className="integration-docs">
      <section className="integration-docs-hero">
        <div className="integration-docs-hero-copy">
          <div className="integration-docs-eyebrow">Integrační API pro docházku</div>
          <h1>Dokumentace integračního API Dagmar</h1>
          <p>
            Veřejná partnerská dokumentace k externímu API pod <code>/api/v1/integration</code>. API umožňuje bezpečně číst
            úvazky, plán směn, docházku, odvozené průchody a zámky. Zápisová část se týká výhradně docházky a nikdy
            neslouží pro správu uživatelů, zaměstnanců, úvazků, hesel, plánů služeb ani zámků.
          </p>
          <div className="integration-docs-badges">
            <span>Base URL: {baseUrl}</span>
            <span>API verze: v1</span>
            <span>Contract version: 2026-06-23</span>
            <span>Datum dokumentace: 2026-06-23</span>
          </div>
        </div>
        <aside className="integration-docs-summary">
          <div className="integration-docs-summary-title">Rychlý start</div>
          <ol>
            <li>Získejte od správce Dagmar integrační bearer token.</li>
            <li>Posílejte jej v hlavičce <code>Authorization: Bearer {placeholderToken}</code>.</li>
            <li>Začněte endpointem <code>/health</code>.</li>
            <li>Potom si podle přidělených scopes zapněte read-only nebo write scénáře pro docházku.</li>
          </ol>
          <p className="integration-docs-small">
            Admin session cookie ani zaměstnanecký bearer token zde nefungují. Používejte pouze integrační tokeny s prefixem
            <code> dgi_</code>.
          </p>
        </aside>
      </section>

      <section className="integration-docs-grid">
        <article className="integration-docs-card">
          <h2>Bezpečnostní model</h2>
          <ul>
            <li>Každý klient má vlastní integrační token, scopes a datový rozsah.</li>
            <li>Zápisové scopes negarantuje čtení ani naopak. Správce je přiděluje explicitně.</li>
            <li>Klient zapisuje pouze docházku vedenou podle <code>employment_id</code>.</li>
            <li>API respektuje zamčené měsíce a neobchází je potichu.</li>
            <li>Write operace se auditují detailněji než běžné read requesty.</li>
          </ul>
        </article>

        <article className="integration-docs-card">
          <h2>Skutečný model docházky</h2>
          <ul>
            <li>Jeden docházkový záznam je svázán s <code>employment_id</code> a jedním kalendářním datem.</li>
            <li>Unikátní invariant je <code>employment_id + date</code>.</li>
            <li>Zapisovatelná pole jsou aktuálně jen <code>arrival_time</code> a <code>departure_time</code>.</li>
            <li>Technická pole jako <code>id</code>, <code>created_at</code>, <code>updated_at</code> nebo <code>instance_id</code> nejsou přímo zapisovatelná.</li>
            <li>Model dnes neobsahuje veřejně zapisovatelné poznámky, korekce, absence ani další doménové flagy.</li>
          </ul>
        </article>
      </section>

      <section className="integration-docs-card">
        <h2>Scopes a oprávnění</h2>
        <div className="integration-docs-table-wrap">
          <table className="integration-docs-table">
            <thead>
              <tr>
                <th>Scope</th>
                <th>Význam</th>
              </tr>
            </thead>
            <tbody>
              {scopes.map(([scope, description]) => (
                <tr key={scope}>
                  <td><code>{scope}</code></td>
                  <td>{description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="integration-docs-note">
          Klient může být navíc omezený na konkrétní <code>employment_id</code> a <code>employee_id</code>. Write request mimo
          povolený rozsah vrátí <code>403 insufficient_scope</code>.
        </p>
      </section>

      <section className="integration-docs-card">
        <h2>Endpointy</h2>
        <div className="integration-docs-endpoints">
          {endpoints.map((endpoint) => (
            <article key={endpoint.path} className="integration-docs-endpoint">
              <div className="integration-docs-endpoint-head">
                <h3>{endpoint.path}</h3>
                <span>{endpoint.scope}</span>
              </div>
              <p>{endpoint.purpose}</p>
              <p><strong>Parametry:</strong> {endpoint.params}</p>
              <p><strong>Poznámka:</strong> {endpoint.note}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="integration-docs-grid">
        <article className="integration-docs-card">
          <h2>Zámky, konflikty a idempotence</h2>
          <ul>
            <li>Zamčené období vrací <code>409 attendance_locked</code>.</li>
            <li>Duplicitní vytvoření stejného <code>employment_id + date</code> vrací <code>409 duplicate_attendance</code>.</li>
            <li>Pro update a delete lze poslat <code>expected_updated_at</code> a zabránit přepsání cizí změny.</li>
            <li>Pokud klient pošle zastaralé <code>expected_updated_at</code>, API vrátí <code>409 conflict</code>.</li>
            <li>Samostatný upsert endpoint v této verzi není podporovaný.</li>
          </ul>
        </article>

        <article className="integration-docs-card">
          <h2>Co API neumí</h2>
          <ul>
            <li>Neumí spravovat uživatele, zaměstnance ani úvazky.</li>
            <li>Neumí měnit plán služeb ani měsíční zámky.</li>
            <li>Neumí měnit technická a auditní pole docházky.</li>
            <li><code>/changes</code> stále není implementovaný endpoint.</li>
          </ul>
        </article>
      </section>

      <section className="integration-docs-card">
        <h2>Chybové odpovědi</h2>
        <div className="integration-docs-table-wrap">
          <table className="integration-docs-table">
            <thead>
              <tr>
                <th>HTTP</th>
                <th>Kód</th>
                <th>Význam</th>
              </tr>
            </thead>
            <tbody>
              {errorRows.map(([statusCode, code, meaning]) => (
                <tr key={`${statusCode}-${code}`}>
                  <td>{statusCode}</td>
                  <td><code>{code}</code></td>
                  <td>{meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <pre><code>{sampleError}</code></pre>
      </section>

      <section className="integration-docs-grid">
        <article className="integration-docs-card">
          <h2>Ukázky zápisu</h2>
          <h3>Vytvoření docházky</h3>
          <pre><code>{createExample}</code></pre>
          <h3>Úprava docházky</h3>
          <pre><code>{patchExample}</code></pre>
          <h3>Smazání docházky</h3>
          <pre><code>{deleteExample}</code></pre>
        </article>

        <article className="integration-docs-card">
          <h2>Limity a audit</h2>
          <ul>
            <li><code>shift-plan</code>, <code>attendances</code> a <code>punches</code> mají maximum 31 dnů.</li>
            <li><code>health</code> má limit 60 požadavků za minutu.</li>
            <li>Datové endpointy mají limit 120 požadavků za minutu.</li>
            <li><code>openapi.json</code> má limit 10 požadavků za minutu.</li>
            <li>Write operace auditují klienta, request id, endpoint, attendance_id, employment_id, datum, předchozí stav, nový stav, IP, user agent a výsledek.</li>
          </ul>
        </article>
      </section>
    </main>
  );
}
