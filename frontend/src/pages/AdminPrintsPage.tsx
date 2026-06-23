import { useEffect, useMemo, useState } from "react";
import { adminListUsers, type PortalUser } from "../api/admin";
import { ActionLink, EmptyState, FilterBar, InlineNotice, MetricCard, PageHeader, StateBadge } from "../components/admin/AdminUI";
import { employmentIsActiveInMonth } from "../utils/employmentActivity";
import Button from "../ui/Button";

type DocType = "attendance" | "plan";
type EmploymentOption = PortalUser["employments"][number] & {
  user_name: string;
  user_is_active: boolean;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function yyyyMm(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function errorMessage(err: unknown, fallback: string) {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
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
    void adminListUsers()
      .then((res) => {
        if (cancelled) return;
        setUsers(res.users);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(errorMessage(err, "Nepodařilo se načíst seznam úvazků pro tisk."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const employments = useMemo<EmploymentOption[]>(
    () =>
      users.flatMap((user) =>
        user.employments.map((employment) => ({
          ...employment,
          user_name: user.name,
          user_is_active: user.is_active,
        })),
      ),
    [users],
  );

  const parsedMonth = useMemo(() => {
    const match = /^(\d{4})-(\d{2})$/.exec(month);
    if (!match) return null;
    return { year: Number(match[1]), month: Number(match[2]) };
  }, [month]);

  const filtered = useMemo(() => {
    const base =
      parsedMonth && !showInactiveEmployments
        ? employments.filter((employment) =>
            employmentIsActiveInMonth(employment, employment.user_is_active, parsedMonth.year, parsedMonth.month),
          )
        : employments;
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return base;
    return base.filter((employment) => {
      const hay = `${employment.user_name} ${employment.label} ${employment.id}`.toLowerCase();
      return tokens.every((token) => hay.includes(token));
    });
  }, [employments, parsedMonth, query, showInactiveEmployments]);

  const selectedEmployments = useMemo(
    () => filtered.filter((employment) => selectedIds.includes(employment.id)),
    [filtered, selectedIds],
  );

  const selectedVisibleCount = selectedEmployments.length;

  function toggle(id: number) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }

  function selectAllVisible() {
    setSelectedIds(filtered.map((employment) => employment.id));
  }

  function clearAll() {
    setSelectedIds([]);
  }

  function openPreview() {
    if (!month || selectedIds.length === 0) return;
    const idsParam = encodeURIComponent(selectedIds.join(","));
    window.open(`/admin/tisky/preview?type=${docType}&month=${month}&ids=${idsParam}`, "_blank", "noopener");
  }

  return (
    <div className="admin-page-grid">
      <PageHeader
        eyebrow="Tisky a podklady"
        title="Tiskové sestavy"
        description="Tříkrokový workflow pro výběr dokumentu, měsíce a přesné množiny úvazků bez slepých akcí."
        actions={
          <div className="admin-action-stack">
            <ActionLink to="/admin/export" label="Otevřít exporty" />
            <Button type="button" variant="primary" disabled={!month || selectedIds.length === 0} onClick={openPreview}>
              Otevřít preview
            </Button>
          </div>
        }
      />

      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}

      <section className="admin-metric-grid">
        <MetricCard label="Vybraných úvazků" value={selectedIds.length} hint="Bude předáno do preview routy." tone="accent" />
        <MetricCard label="Viditelných po filtru" value={filtered.length} hint="Po aplikaci fulltextu a aktivity." />
        <MetricCard label="Typ dokumentu" value={docType === "attendance" ? "Docházka" : "Plán služeb"} hint="Použije se existující generátor." />
      </section>

      <div className="admin-overview-grid">
        <section className="admin-surface">
          <div className="admin-surface-head">
            <div>
              <div className="admin-surface-title">Krok 1: Druh podkladu</div>
              <div className="admin-surface-subtitle">Volíte pouze existující tiskové režimy produkčního backendu.</div>
            </div>
          </div>
          <div className="admin-choice-grid">
            <button
              type="button"
              className={`admin-choice-card${docType === "attendance" ? " active" : ""}`}
              onClick={() => setDocType("attendance")}
            >
              <div className="admin-choice-title">Evidence docházky</div>
              <div className="admin-choice-copy">Denní výpis příchodů, odchodů a měsíčního součtu.</div>
            </button>
            <button
              type="button"
              className={`admin-choice-card${docType === "plan" ? " active" : ""}`}
              onClick={() => setDocType("plan")}
            >
              <div className="admin-choice-title">Plán služeb</div>
              <div className="admin-choice-copy">Tabulkový rozpis směn pro zvolený měsíc a množinu úvazků.</div>
            </button>
          </div>
          <div className="admin-form-grid">
            <div>
              <div className="kb-label">Měsíc</div>
              <input className="kb-input" type="month" value={month} onChange={(event) => setMonth(event.target.value)} required />
            </div>
            <div>
              <div className="kb-label">Aktivita úvazků</div>
              <label className="admin-checkbox-row">
                <input
                  type="checkbox"
                  checked={showInactiveEmployments}
                  onChange={(event) => setShowInactiveEmployments(event.target.checked)}
                />
                <span>Zobrazit i neaktivní úvazky pro zvolený měsíc</span>
              </label>
            </div>
          </div>
        </section>

        <section className="admin-surface">
          <div className="admin-surface-head">
            <div>
              <div className="admin-surface-title">Krok 2: Výběr úvazků</div>
              <div className="admin-surface-subtitle">Fulltext, select all a jasné označení neaktivních položek.</div>
            </div>
            <div className="admin-action-row">
              <Button type="button" variant="ghost" onClick={selectAllVisible} disabled={filtered.length === 0}>
                Označit vše
              </Button>
              <Button type="button" variant="ghost" onClick={clearAll} disabled={selectedIds.length === 0}>
                Vyčistit
              </Button>
            </div>
          </div>

          <FilterBar>
            <input
              className="kb-input"
              type="search"
              placeholder="Hledat podle zaměstnance nebo názvu úvazku"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <StateBadge tone="accent">
              {filtered.length} nalezeno / {selectedIds.length} vybráno
            </StateBadge>
          </FilterBar>

          {loading ? (
            <InlineNotice>Načítám dostupné úvazky…</InlineNotice>
          ) : filtered.length === 0 ? (
            <EmptyState title="Žádné úvazky" description="Aktuální kombinace filtru a měsíce nevrátila žádný tisknutelný úvazek." />
          ) : (
            <div className="admin-list">
              {filtered.map((employment) => {
                const activeInMonth =
                  parsedMonth === null ||
                  employmentIsActiveInMonth(employment, employment.user_is_active, parsedMonth.year, parsedMonth.month);
                const selected = selectedIds.includes(employment.id);
                return (
                  <label key={employment.id} className={`admin-selection-row admin-selection-row--checkbox${selected ? " active" : ""}`}>
                    <input type="checkbox" checked={selected} onChange={() => toggle(employment.id)} />
                    <div>
                      <div className="admin-list-title">{employment.user_name}</div>
                      <div className="admin-list-subtitle">
                        {employment.label} · ID {employment.id} · {employment.start_date} až {employment.end_date ?? "bez konce"}
                      </div>
                    </div>
                    <StateBadge tone={activeInMonth ? "ok" : "warning"}>
                      {activeInMonth ? "Aktivní v měsíci" : "Mimo období"}
                    </StateBadge>
                  </label>
                );
              })}
            </div>
          )}
        </section>

        <section className="admin-surface">
          <div className="admin-surface-head">
            <div>
              <div className="admin-surface-title">Krok 3: Souhrn a předání do preview</div>
              <div className="admin-surface-subtitle">Preview route běží mimo admin shell, ale dostává plně validní parametry.</div>
            </div>
          </div>
          <div className="admin-stack">
            <div className="admin-definition-list">
              <div>
                <span>Dokument</span>
                <strong>{docType === "attendance" ? "Evidence docházky" : "Plán služeb"}</strong>
              </div>
              <div>
                <span>Měsíc</span>
                <strong>{month || "nenastaven"}</strong>
              </div>
              <div>
                <span>Vybraných úvazků</span>
                <strong>{selectedIds.length}</strong>
              </div>
              <div>
                <span>Z viditelných položek</span>
                <strong>{selectedVisibleCount}</strong>
              </div>
            </div>

            {selectedEmployments.length === 0 ? (
              <EmptyState title="Zatím nic nevybráno" description="Před otevřením preview označte alespoň jeden úvazek." />
            ) : (
              <div className="admin-selection-summary">
                {selectedEmployments.slice(0, 8).map((employment) => (
                  <div key={employment.id} className="admin-selection-chip">
                    {employment.user_name} · {employment.label}
                  </div>
                ))}
                {selectedEmployments.length > 8 ? (
                  <div className="admin-footnote">A dalších {selectedEmployments.length - 8} úvazků.</div>
                ) : null}
              </div>
            )}

            <div className="admin-action-row">
              <Button type="button" variant="primary" disabled={!month || selectedIds.length === 0} onClick={openPreview}>
                Otevřít tiskové preview
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
