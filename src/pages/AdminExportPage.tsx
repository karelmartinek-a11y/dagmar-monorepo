import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { adminExportBulkUrl, adminExportEmploymentUrl } from "../api/admin";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function monthToYYYYMM(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function parseYYYYMM(s: string): boolean {
  return /^([0-9]{4})-([0-9]{2})$/.test(s.trim());
}

export default function AdminExportPage() {
  const defaultMonth = useMemo(() => monthToYYYYMM(new Date()), []);
  const [month, setMonth] = useState<string>(defaultMonth);
  const [employmentId, setEmploymentId] = useState<string>("");

  const bulkUrl = useMemo(() => (parseYYYYMM(month) ? adminExportBulkUrl(month) : null), [month]);
  const singleUrl = useMemo(() => {
    if (!parseYYYYMM(month)) return null;
    const parsed = Number(employmentId.trim());
    if (!Number.isInteger(parsed) || parsed < 1) return null;
    return adminExportEmploymentUrl(month, parsed);
  }, [employmentId, month]);

  return (
    <div className="admin-page">
      <section className="card admin-hero">
        <div className="admin-hero-copy">
          <div className="eyebrow">Administrace · Export</div>
          <h1 className="admin-hero-title">Export evidence docházky</h1>
          <div className="admin-hero-text">Exporty se nově vztahují ke konkrétním úvazkům. Jednotlivý export očekává `employment_id`, hromadný export připraví všechny relevantní úvazky za zvolený měsíc.</div>
        </div>
      </section>

      <div className="admin-two-column">
        <section style={card}>
          <h2 style={h2}>Volba období</h2>
          <input value={month} onChange={(e) => setMonth(e.target.value)} placeholder="2026-03" style={input} />
        </section>

        <section style={card}>
          <h2 style={h2}>Jednotlivý export</h2>
          <div style={{ color: "rgba(35,41,44,0.7)", fontSize: 13, marginTop: 8 }}>Zadejte číselné `employment_id` konkrétního úvazku.</div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
            <input value={employmentId} onChange={(e) => setEmploymentId(e.target.value)} placeholder="např. 17" style={input} />
            <a href={singleUrl ?? "#"} style={{ ...btnPrimary, opacity: singleUrl ? 1 : 0.5, pointerEvents: singleUrl ? "auto" : "none", textDecoration: "none" }} download>
              Stáhnout export
            </a>
          </div>
        </section>

        <section style={card}>
          <h2 style={h2}>Hromadný export</h2>
          <a href={bulkUrl ?? "#"} style={{ ...btnPrimary, opacity: bulkUrl ? 1 : 0.5, pointerEvents: bulkUrl ? "auto" : "none", textDecoration: "none", marginTop: 12 }} download>
            Stáhnout balík
          </a>
        </section>
      </div>
    </div>
  );
}

const card: CSSProperties = {
  background: "white",
  border: "1px solid rgba(35,41,44,0.10)",
  borderRadius: 14,
  padding: 16,
  boxShadow: "0 8px 26px rgba(35,41,44,0.06)",
};

const h2: CSSProperties = {
  margin: 0,
  fontSize: 16,
  fontWeight: 800,
};

const input: CSSProperties = {
  height: 44,
  borderRadius: 12,
  border: "1px solid rgba(35,41,44,0.16)",
  padding: "0 12px",
  fontSize: 14,
  outline: "none",
};

const btnPrimary: CSSProperties = {
  height: 44,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 12,
  padding: "0 14px",
  fontWeight: 800,
  fontSize: 14,
  border: "1px solid rgba(38,43,49,0.25)",
  background: "linear-gradient(90deg, rgba(38,43,49,0.98), rgba(38,43,49,0.96))",
  color: "white",
};
