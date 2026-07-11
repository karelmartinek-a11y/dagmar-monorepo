import { useEffect, useMemo, useState } from "react";
import { adminExportBulkUrl, adminExportEmploymentUrl, adminListUsers } from "../api/admin";
import { Breadcrumbs, FilterBar, InlineNotice, PageHeader } from "../components/admin/AdminUI";
import { formatIsoMonthForDisplay, parseCzechMonthToIso } from "../utils/date";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function monthToYYYYMM(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function errorMessage(err: unknown, fallback: string) {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export default function AdminExportPage() {
  const defaultMonth = useMemo(() => monthToYYYYMM(new Date()), []);
  const [month, setMonth] = useState<string>(defaultMonth);
  const [monthInput, setMonthInput] = useState<string>(() => formatIsoMonthForDisplay(defaultMonth));
  const [monthError, setMonthError] = useState<string | null>(null);
  const [employmentId, setEmploymentId] = useState<string>("");
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<Array<{ id: number; label: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void adminListUsers()
      .then((response) => {
        if (cancelled) return;
        setOptions(
          response.users.flatMap((user) =>
            user.employments.map((employment) => ({
              id: employment.id,
              label: `${employment.label} · ${employment.start_date}${employment.end_date ? ` až ${employment.end_date}` : ""}`,
            })),
          ),
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setError(errorMessage(err, "Nepodařilo se načíst seznam úvazků pro export."));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return options;
    return options.filter((option) => tokens.every((token) => option.label.toLowerCase().includes(token) || String(option.id).includes(token)));
  }, [options, query]);

  const bulkUrl = useMemo(() => adminExportBulkUrl(month), [month]);
  const singleUrl = useMemo(() => {
    const parsed = Number(employmentId.trim());
    if (!Number.isInteger(parsed) || parsed < 1) return null;
    return adminExportEmploymentUrl(month, parsed);
  }, [employmentId, month]);

  function commitMonthInput() {
    const parsed = parseCzechMonthToIso(monthInput);
    if (!parsed) {
      setMonthError("Měsíc zadejte ve formátu mm.rrrr, například 06.2026.");
      return;
    }
    setMonthError(null);
    setMonth(parsed);
    setMonthInput(formatIsoMonthForDisplay(parsed));
  }

  return (
    <div className="admin-page-grid">
      <PageHeader
        eyebrow="Exporty a podklady"
        title="Export evidence docházky"
        description="Export je určen pro stažení CSV a ZIP souborů do dalších systémů. Pro čitelný náhled dokumentů a tisk použijte sekci Tisky."
      >
        <Breadcrumbs items={[{ label: "Administrace", to: "/admin/prehled" }, { label: "Export" }]} />
      </PageHeader>

      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}

      <div className="admin-overview-grid">
        <section className="admin-surface">
          <div className="admin-surface-head">
            <div>
              <div className="admin-surface-title">Parametry exportu</div>
              <div className="admin-surface-subtitle">Nastavte období a případně vyberte konkrétní úvazek.</div>
            </div>
          </div>
          <div className="admin-form-grid">
            <div>
              <label className="kb-field" htmlFor="admin-export-month">
                <span className="kb-label">Měsíc</span>
                <input
                  id="admin-export-month"
                  className="kb-input"
                  value={monthInput}
                  onChange={(e) => {
                    setMonthInput(e.target.value);
                    if (monthError) setMonthError(null);
                  }}
                  onBlur={commitMonthInput}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitMonthInput();
                    }
                  }}
                  placeholder="např. 06.2026"
                  inputMode="numeric"
                  aria-invalid={monthError ? "true" : "false"}
                  aria-describedby={monthError ? "admin-export-month-error" : "admin-export-month-help"}
                />
              </label>
              {monthError ? (
                <div id="admin-export-month-error" className="admin-field-error">
                  {monthError}
                </div>
              ) : (
                <div id="admin-export-month-help" className="kb-help">
                  Export se vytvoří pro období {formatIsoMonthForDisplay(month)}.
                </div>
              )}
            </div>
            <div>
              <label className="kb-field" htmlFor="admin-export-employment-id">
                <span className="kb-label">Vybrané employment ID</span>
                <input
                  id="admin-export-employment-id"
                  className="kb-input"
                  value={employmentId}
                  onChange={(e) => setEmploymentId(e.target.value)}
                  placeholder="např. 17"
                  inputMode="numeric"
                />
              </label>
            </div>
          </div>
          <FilterBar>
            <a href={singleUrl ?? "#"} className="admin-action-link" style={singleUrl ? undefined : { opacity: 0.5, pointerEvents: "none" }} download>
              Stáhnout jednotlivý export
            </a>
            <a href={bulkUrl ?? "#"} className="admin-action-link" style={bulkUrl ? undefined : { opacity: 0.5, pointerEvents: "none" }} download>
              Stáhnout hromadný ZIP
            </a>
          </FilterBar>
        </section>

        <section className="admin-surface">
          <div className="admin-surface-head">
            <div>
              <div className="admin-surface-title">Lookup helper úvazků</div>
              <div className="admin-surface-subtitle">Vyberte existující úvazek místo ručního dohledávání ID.</div>
            </div>
          </div>
          <label className="kb-field" htmlFor="admin-export-employment-search">
            <span className="kb-label">Hledat úvazek</span>
            <input
              id="admin-export-employment-search"
              className="kb-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Hledat podle jména, typu nebo čísla úvazku"
            />
          </label>
          <div className="admin-list" style={{ marginTop: 12 }}>
            {filtered.slice(0, 20).map((option) => (
              <button key={option.id} type="button" className={`admin-selection-row${employmentId === String(option.id) ? " active" : ""}`} onClick={() => setEmploymentId(String(option.id))}>
                <div>
                  <div className="admin-list-title">{option.label}</div>
                  <div className="admin-list-subtitle">employment_id: {option.id}</div>
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
