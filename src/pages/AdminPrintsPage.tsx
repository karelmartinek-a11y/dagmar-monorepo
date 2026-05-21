import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import { adminListUsers, type PortalUser } from "../api/admin";
import { employmentIsActiveInMonth } from "../utils/employmentActivity";

type DocType = "attendance" | "plan";
type EmploymentOption = PortalUser["employments"][number] & { user_name: string; user_is_active: boolean };

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function yyyyMm(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

export default function AdminPrintsPage() {
  const [users, setUsers] = useState<PortalUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docType, setDocType] = useState<DocType>("attendance");
  const [month, setMonth] = useState(() => yyyyMm(new Date()));
  const [showInactiveEmployments, setShowInactiveEmployments] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await adminListUsers();
        if (cancelled) return;
        setUsers(res.users);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Nepodařilo se načíst seznam úvazků.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const employments = useMemo<EmploymentOption[]>(
    () => users.flatMap((user) => user.employments.map((employment) => ({ ...employment, user_name: user.name, user_is_active: user.is_active }))),
    [users]
  );

  const parsedMonth = useMemo(() => {
    const match = /^(\d{4})-(\d{2})$/.exec(month);
    if (!match) return null;
    return { year: Number(match[1]), month: Number(match[2]) };
  }, [month]);

  const filtered = useMemo(() => {
    const visibleEmployments =
      parsedMonth && !showInactiveEmployments
        ? employments.filter((employment) => employmentIsActiveInMonth(employment, employment.user_is_active, parsedMonth.year, parsedMonth.month))
        : employments;
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return visibleEmployments;
    return visibleEmployments.filter((employment) => {
      const hay = `${employment.user_name} ${employment.label} ${employment.id}`.toLowerCase();
      return tokens.every((token) => hay.includes(token));
    });
  }, [employments, parsedMonth, query, showInactiveEmployments]);

  const toggle = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  function selectAllVisible() {
    setSelectedIds(filtered.map((employment) => employment.id));
  }

  function clearAll() {
    setSelectedIds([]);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!month || selectedIds.length === 0) return;
    const idsParam = encodeURIComponent(selectedIds.join(","));
    window.open(`/admin/tisky/preview?type=${docType}&month=${month}&ids=${idsParam}`, "_blank", "noopener");
  }

  return (
    <div className="card pad print-shell">
      <header className="print-hero">
        <div className="stack" style={{ gap: 6 }}>
          <span className="eyebrow">Administrace · Tisky</span>
          <h1 className="print-title">Tisky podle úvazků</h1>
          <p className="muted">Vyberte typ dokumentu, měsíc a konkrétní úvazky zaměstnanců.</p>
        </div>
        <div className="print-counter">
          <div className="counter-number">{selectedIds.length}</div>
          <div className="counter-label">vybraných úvazků</div>
        </div>
      </header>

      <form className="print-grid" onSubmit={onSubmit}>
        <section className="print-panel">
          <div className="panel-head">
            <div className="eyebrow">Krok 1</div>
            <div className="panel-title">Parametry tisku</div>
          </div>
          <div className="panel-body print-params">
            <div className="stack" style={{ gap: 10 }}>
              <span className="label">Typ dokumentu</span>
              <div className="pill-group">
                <label className={`pill ${docType === "attendance" ? "pill--active" : ""}`}>
                  <input type="radio" checked={docType === "attendance"} onChange={() => setDocType("attendance")} />
                  Evidence docházky
                </label>
                <label className={`pill ${docType === "plan" ? "pill--active" : ""}`}>
                  <input type="radio" checked={docType === "plan"} onChange={() => setDocType("plan")} />
                  Plán služeb
                </label>
              </div>
            </div>
            <label className="stack" style={{ gap: 6 }}>
              <span className="label">Měsíc</span>
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} required />
            </label>
          </div>
        </section>

        <section className="print-panel">
          <div className="panel-head">
            <div>
              <div className="eyebrow">Krok 2</div>
              <div className="panel-title">Výběr úvazků</div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn ghost" onClick={selectAllVisible} disabled={filtered.length === 0}>
                Označit vše
              </button>
              <button type="button" className="btn ghost" onClick={clearAll} disabled={selectedIds.length === 0}>
                Vyčistit
              </button>
            </div>
          </div>

          <div className="panel-body stack" style={{ gap: 12 }}>
            <div className="row" style={{ alignItems: "center", gap: 10 }}>
              <input
                type="search"
                className="input"
                placeholder="Hledat podle zaměstnance nebo názvu úvazku"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ flex: 1, minWidth: 260 }}
              />
              <div className="chip">
                {filtered.length} nalezeno · {selectedIds.length} vybráno
              </div>
            </div>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700 }}>
              <input type="checkbox" checked={showInactiveEmployments} onChange={(e) => setShowInactiveEmployments(e.target.checked)} />
              Zobrazit i neaktivní úvazky
            </label>

            <div className="print-list">
              {loading && <div className="muted">Načítám…</div>}
              {error && <div className="error">{error}</div>}
              {!loading && filtered.length === 0 ? <div className="muted">Nic nenalezeno.</div> : null}
              {filtered.map((employment) => (
                <label key={employment.id} className={`print-row ${selectedIds.includes(employment.id) ? "print-row--selected" : ""}`}>
                  <input type="checkbox" checked={selectedIds.includes(employment.id)} onChange={() => toggle(employment.id)} />
                  <div className="stack" style={{ gap: 2 }}>
                    <span className="print-name">{employment.label}</span>
                    <span className="muted small">
                      {employment.start_date} až {employment.end_date ?? "na dobu neurčitou"}
                    </span>
                    {parsedMonth && !employmentIsActiveInMonth(employment, employment.user_is_active, parsedMonth.year, parsedMonth.month) ? (
                      <span className="small" style={{ color: "#b45309", fontWeight: 700 }}>Neaktivní pro zvolený měsíc</span>
                    ) : null}
                  </div>
                </label>
              ))}
            </div>
          </div>
        </section>

        <section className="print-panel">
          <div className="panel-head">
            <div className="eyebrow">Krok 3</div>
            <div className="panel-title">Potvrzení a tisk</div>
          </div>
          <div className="panel-body row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div className="muted small">
              Vybraných úvazků: <strong>{selectedIds.length}</strong>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <NavLink to="/admin/users" className="btn ghost">
                Zpět
              </NavLink>
              <button type="submit" className="btn solid" disabled={selectedIds.length === 0 || !month}>
                Otevřít podklady k tisku
              </button>
            </div>
          </div>
        </section>
      </form>
    </div>
  );
}
