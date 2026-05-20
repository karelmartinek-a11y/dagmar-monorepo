import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { adminListUsers, type PortalUser } from "../api/admin";
import { adminGetAttendanceMonth, type AdminAttendanceDay } from "../api/adminAttendance";
import { adminGetShiftPlanMonth, type ShiftPlanRow } from "../api/adminShiftPlan";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { computeDayCalc, computeMonthStats, getCzechHolidayName, isWeekendDate, parseCutoffToMinutes, workingDaysInMonthCs } from "../utils/attendanceCalc";

type EmploymentInfo = PortalUser["employments"][number] & { user_name: string };
type AttendanceDoc = {
  type: "attendance";
  employment: EmploymentInfo;
  days: AdminAttendanceDay[];
  cutoffMinutes: number;
};
type PlanDoc = {
  type: "plan";
  employment: EmploymentInfo;
  row: ShiftPlanRow;
};
type DocRecord = AttendanceDoc | PlanDoc;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function monthLabel(year: number, month: number) {
  const dt = new Date(year, month - 1, 1);
  return dt.toLocaleDateString("cs-CZ", { month: "long", year: "numeric" });
}

function parseMonth(value: string): { year: number; month: number } | null {
  const m = /^([0-9]{4})-([0-9]{2})$/.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

function formatDateLong(dateIso: string) {
  const [y, m, d] = dateIso.split("-").map((x) => parseInt(x, 10));
  return new Date(y, m - 1, d).toLocaleDateString("cs-CZ", { day: "numeric", month: "long", year: "numeric" });
}

function parseLocalDate(dateIso: string) {
  const [y, m, d] = dateIso.split("-").map((x) => parseInt(x, 10));
  return new Date(y, m - 1, d);
}

function formatHours(mins: number) {
  return (mins / 60).toFixed(1).replace(".", ",");
}

function dayList(year: number, month: number) {
  const days: { date: string; dow: string }[] = [];
  const dt = new Date(year, month - 1, 1);
  while (dt.getMonth() === month - 1) {
    days.push({
      date: `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`,
      dow: dt.toLocaleDateString("cs-CZ", { weekday: "long" }),
    });
    dt.setDate(dt.getDate() + 1);
  }
  return days;
}

export default function AdminPrintPreviewPage() {
  const [params] = useSearchParams();
  const docType = params.get("type") === "plan" ? "plan" : "attendance";
  const month = params.get("month") ?? "";
  const idList = (params.get("ids") ?? "")
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
  const parsed = useMemo(() => parseMonth(month), [month]);
  const parsedMonth = useMemo(() => parsed ?? { year: 1970, month: 1 }, [parsed]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [pdfGenerated, setPdfGenerated] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!parsed || idList.length === 0) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const userRes = await adminListUsers();
        if (cancelled) return;
        const employments = userRes.users.flatMap((user) => user.employments.map((employment) => ({ ...employment, user_name: user.name })));
        const selected = employments.filter((employment) => idList.includes(employment.id));
        if (selected.length === 0) throw new Error("Nebyl nalezen žádný vybraný úvazek.");

        if (docType === "attendance") {
          const records: DocRecord[] = [];
          for (const employment of selected) {
            const res = await adminGetAttendanceMonth({ employmentId: employment.id, year: parsedMonth.year, month: parsedMonth.month });
            records.push({
              type: "attendance",
              employment,
              days: res.days,
              cutoffMinutes: parseCutoffToMinutes("17:00"),
            });
          }
          if (!cancelled) setDocs(records);
        } else {
          const plan = await adminGetShiftPlanMonth({ year: parsedMonth.year, month: parsedMonth.month });
          if (cancelled) return;
          const rows = plan.rows.filter((row) => idList.includes(row.employment_id));
          const records: DocRecord[] = rows
            .map((row) => {
              const employment = selected.find((item) => item.id === row.employment_id);
              if (!employment) return null;
              return { type: "plan", employment, row } as DocRecord;
            })
            .filter((item): item is DocRecord => item !== null);
          setDocs(records);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Nepodařilo se načíst data pro tisk.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [docType, idList, parsed, parsedMonth.month, parsedMonth.year]);

  useEffect(() => {
    if (loading || error || docs.length === 0 || pdfGenerated) return;
    const currentContainer = containerRef.current;
    if (!currentContainer) return;

    async function generatePdf() {
      const sheets = Array.from(currentContainer!.querySelectorAll(".sheet")) as HTMLElement[];
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      for (let i = 0; i < sheets.length; i++) {
        const canvas = await html2canvas(sheets[i], { scale: 2, useCORS: true });
        const imgData = canvas.toDataURL("image/png");
        const ratio = Math.min(pageWidth / canvas.width, pageHeight / canvas.height);
        if (i > 0) pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, 0, canvas.width * ratio, canvas.height * ratio);
      }

      pdf.save(`tisky-${docType}-${month || "mesic"}.pdf`);
      setPdfGenerated(true);
      window.setTimeout(() => window.close(), 400);
    }

    void generatePdf().catch((err) => setError(err instanceof Error ? err.message : "Generování tiskového dokumentu selhalo."));
  }, [loading, error, docs, docType, month, pdfGenerated]);

  const dayCache = useMemo(() => dayList(parsedMonth.year, parsedMonth.month), [parsedMonth]);
  const label = monthLabel(parsedMonth.year, parsedMonth.month);

  if (!parsed) return <div className="card">Neplatný údaj měsíce.</div>;

  return (
    <div style={{ padding: 0, margin: 0 }} ref={containerRef}>
      <style>{`
        body { background: #ffffff; }
        .sheet { width: 210mm; min-height: 297mm; padding: 15mm 12mm; margin: 6mm auto; background: white; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
        .sheet + .sheet { page-break-before: always; }
        h1 { margin: 0 0 4px 0; font-size: 18px; }
        h2 { margin: 0 0 12px 0; font-size: 14px; color: var(--kb-brand-ink-600); }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th, td { border: 1px solid rgba(82, 85, 93, 0.22); padding: 4px 6px; text-align: left; }
        th { background: var(--kb-text); color: #ffffff; font-weight: 600; }
        .row-weekend { background: rgba(82, 85, 93, 0.06); }
        .row-holiday { background: rgba(255,0,0,0.05); }
        .signature { margin-top: 14px; font-size: 10px; color: var(--kb-brand-ink-600); text-align: center; }
      `}</style>

      {loading ? <div className="card">Načítám data…</div> : null}
      {error ? <div className="card error">{error}</div> : null}

      {docs.map((doc) => {
        if (doc.type === "attendance") {
          const stats = computeMonthStats(doc.days, doc.employment.employment_type, doc.cutoffMinutes);
          return (
            <div key={`attendance-${doc.employment.id}`} className="sheet">
              <h1>{label} · EVIDENCE DOCHÁZKY</h1>
              <h2>{doc.employment.label}</h2>
              <table>
                <thead>
                  <tr>
                    <th>Datum</th>
                    <th>Příchod</th>
                    <th>Odchod</th>
                    <th>Celkem</th>
                  </tr>
                </thead>
                <tbody>
                  {dayCache.map((day) => {
                    const attendanceDay = doc.days.find((item) => item.date === day.date);
                    const calc = computeDayCalc(
                      {
                        date: day.date,
                        arrival_time: attendanceDay?.arrival_time ?? null,
                        departure_time: attendanceDay?.departure_time ?? null,
                        planned_status: attendanceDay?.planned_status ?? null,
                      },
                      doc.employment.employment_type,
                      doc.cutoffMinutes
                    );
                    const rowClass = calc.isWeekendOrHoliday ? (getCzechHolidayName(day.date) ? "row-holiday" : "row-weekend") : "";
                    return (
                      <tr key={day.date} className={rowClass}>
                        <td>{formatDateLong(day.date)}</td>
                        <td>{attendanceDay?.arrival_time ?? ""}</td>
                        <td>{attendanceDay?.departure_time ?? ""}</td>
                        <td>{calc.workedMins !== null ? `${formatHours(calc.workedMins)} h` : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4}>Odpracováno celkem: {formatHours(stats.totalMins)} h</td>
                  </tr>
                </tfoot>
              </table>
              <div className="signature">Tento přehled pro Vás zpracoval systém KájovoDagmar.</div>
            </div>
          );
        }

        return (
          <div key={`plan-${doc.employment.id}`} className="sheet">
            <h1>{label} · PLÁN SLUŽEB</h1>
            <h2>{doc.employment.label}</h2>
            <table>
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Den v týdnu</th>
                  <th>Příchod</th>
                  <th>Odchod</th>
                </tr>
              </thead>
              <tbody>
                {doc.row.days.map((day) => {
                  const holidayName = getCzechHolidayName(day.date);
                  const weekend = isWeekendDate(day.date);
                  const rowClass = holidayName ? "row-holiday" : weekend ? "row-weekend" : "";
                  return (
                    <tr key={day.date} className={rowClass}>
                      <td>{formatDateLong(day.date)}</td>
                      <td>{parseLocalDate(day.date).toLocaleDateString("cs-CZ", { weekday: "long" })}</td>
                      <td>{day.arrival_time ?? ""}</td>
                      <td>{day.departure_time ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>Fond: {formatHours(workingDaysInMonthCs(parsedMonth.year, parsedMonth.month) * 8 * 60)} h</td>
                </tr>
              </tfoot>
            </table>
          </div>
        );
      })}
    </div>
  );
}
