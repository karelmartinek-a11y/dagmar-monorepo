import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { adminGetSettings, adminListUsers, type PortalUser } from "../api/admin";
import { adminGetAttendanceMonth, type AdminAttendanceDay } from "../api/adminAttendance";
import { adminGetShiftPlanMonth, type ShiftPlanRow } from "../api/adminShiftPlan";
import {
  computeDayCalc,
  computeMonthStats,
  getCzechHolidayName,
  isWeekendDate,
  parseCutoffToMinutes,
  workingDaysInMonthCs,
} from "../utils/attendanceCalc";
import { employmentIncludesDay } from "../utils/employmentActivity";

type EmploymentInfo = PortalUser["employments"][number] & { user_name: string; user_is_active: boolean };
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
  return new Date(year, month - 1, 1).toLocaleDateString("cs-CZ", { month: "long", year: "numeric" });
}

function parseMonth(value: string): { year: number; month: number } | null {
  const match = /^([0-9]{4})-([0-9]{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
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

function errorMessage(err: unknown, fallback: string) {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
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
        const [userRes, settings] = await Promise.all([adminListUsers(), adminGetSettings()]);
        if (cancelled) return;
        const cutoffMinutes = parseCutoffToMinutes(settings.afternoon_cutoff || "17:00");
        const employments = userRes.users.flatMap((user) =>
          user.employments.map((employment) => ({ ...employment, user_name: user.name, user_is_active: user.is_active })),
        );
        const selected = employments.filter((employment) => idList.includes(employment.id));
        if (selected.length === 0) throw new Error("Nebyl nalezen žádný vybraný úvazek.");

        if (docType === "attendance") {
          const records: DocRecord[] = [];
          for (const employment of selected) {
            const res = await adminGetAttendanceMonth({
              employmentId: employment.id,
              year: parsedMonth.year,
              month: parsedMonth.month,
            });
            records.push({
              type: "attendance",
              employment,
              days: res.days,
              cutoffMinutes,
            });
          }
          if (!cancelled) setDocs(records);
          return;
        }

        const plan = await adminGetShiftPlanMonth({ year: parsedMonth.year, month: parsedMonth.month });
        if (cancelled) return;
        const rowById = new Map(plan.rows.map((row) => [row.employment_id, row]));
        const records: DocRecord[] = selected
          .map((employment) => {
            const row =
              rowById.get(employment.id) ??
              {
                employment_id: employment.id,
                user_name: employment.user_name,
                title: employment.title,
                employment_type: employment.employment_type,
                display_label: employment.label,
                days: dayList(parsedMonth.year, parsedMonth.month).map((day) => ({
                  date: day.date,
                  arrival_time: null,
                  departure_time: null,
                  status: null,
                  is_within_employment_period: employmentIncludesDay(employment, day.date),
                })),
              };
            return { type: "plan", employment, row } as DocRecord;
          })
          .filter(Boolean);
        setDocs(records);
      } catch (err) {
        if (!cancelled) setError(errorMessage(err, "Nepodařilo se načíst data pro tiskový náhled."));
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
      const sheets = Array.from(currentContainer!.querySelectorAll(".print-sheet")) as HTMLElement[];
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      for (let i = 0; i < sheets.length; i += 1) {
        const canvas = await html2canvas(sheets[i], { scale: 2, useCORS: true, backgroundColor: "#f3efe7" });
        const imgData = canvas.toDataURL("image/png");
        const ratio = Math.min(pageWidth / canvas.width, pageHeight / canvas.height);
        if (i > 0) pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, 0, canvas.width * ratio, canvas.height * ratio);
      }

      pdf.save(`tisky-${docType}-${month || "mesic"}.pdf`);
      setPdfGenerated(true);
      window.setTimeout(() => window.close(), 400);
    }

    void generatePdf().catch((err) => {
      setError(errorMessage(err, "Generování tiskového dokumentu selhalo."));
    });
  }, [loading, error, docs, docType, month, pdfGenerated]);

  const dayCache = useMemo(() => dayList(parsedMonth.year, parsedMonth.month), [parsedMonth]);
  const label = monthLabel(parsedMonth.year, parsedMonth.month);

  if (!parsed) {
    return <div className="print-preview-status">Neplatný údaj měsíce.</div>;
  }

  return (
    <div className="print-preview-page">
      <style>{`
        body { margin: 0; background: #f3efe7; color: #202225; font-family: "Segoe UI", sans-serif; }
        .print-preview-page { min-height: 100vh; padding: 24px 0 40px; }
        .print-preview-status {
          width: min(760px, calc(100vw - 32px));
          margin: 24px auto;
          padding: 20px 24px;
          border-radius: 20px;
          background: #fffdf8;
          border: 1px solid rgba(32, 34, 37, 0.12);
          box-shadow: 0 18px 44px rgba(32, 34, 37, 0.08);
        }
        .print-sheet {
          width: 210mm;
          min-height: 297mm;
          padding: 15mm 12mm;
          margin: 0 auto 14px;
          background: #fffdf8;
          box-shadow: 0 18px 44px rgba(32, 34, 37, 0.08);
          border-radius: 8px;
        }
        .print-sheet + .print-sheet { page-break-before: always; }
        .print-kicker {
          margin-bottom: 10px;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: #8e6b2d;
        }
        h1 { margin: 0 0 6px; font-size: 22px; }
        h2 { margin: 0 0 16px; font-size: 14px; color: #505862; font-weight: 600; }
        table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
        th, td { border: 1px solid rgba(32, 34, 37, 0.14); padding: 5px 6px; text-align: left; vertical-align: top; }
        th { background: #202225; color: #fffdf8; font-weight: 700; }
        .row-weekend { background: rgba(32, 34, 37, 0.04); }
        .row-holiday { background: rgba(142, 107, 45, 0.08); }
        .row-outside { background: rgba(187, 114, 52, 0.12); color: #8a4a11; }
        .print-summary {
          margin: 14px 0 16px;
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }
        .print-summary-box {
          padding: 12px;
          border-radius: 14px;
          background: rgba(32, 34, 37, 0.035);
          border: 1px solid rgba(32, 34, 37, 0.09);
        }
        .print-summary-label {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #6b7280;
        }
        .print-summary-value {
          margin-top: 6px;
          font-size: 18px;
          font-weight: 700;
        }
        .print-signature {
          margin-top: 14px;
          text-align: center;
          font-size: 10px;
          color: #6b7280;
        }
      `}</style>

      {loading ? <div className="print-preview-status">Načítám podklady pro tisk…</div> : null}
      {error ? <div className="print-preview-status">{error}</div> : null}

      <div ref={containerRef}>
        {docs.map((doc) => {
          if (doc.type === "attendance") {
            const stats = computeMonthStats(doc.days, doc.employment.employment_type, doc.cutoffMinutes);
            return (
              <div key={`attendance-${doc.employment.id}`} className="print-sheet">
                <div className="print-kicker">Operační cockpit hotelu</div>
                <h1>{label} · Evidence docházky</h1>
                <h2>{doc.employment.label}</h2>
                <div className="print-summary">
                  <div className="print-summary-box">
                    <div className="print-summary-label">Zaměstnanec</div>
                    <div className="print-summary-value">{doc.employment.user_name}</div>
                  </div>
                <div className="print-summary-box">
                  <div className="print-summary-label">Odpracováno</div>
                  <div className="print-summary-value">{formatHours(stats.totalMins)} h</div>
                </div>
                <div className="print-summary-box">
                  <div className="print-summary-label">Počet dní dovolené</div>
                  <div className="print-summary-value">{stats.vacationDays}</div>
                </div>
                <div className="print-summary-box">
                  <div className="print-summary-label">Odpolední cutoff</div>
                  <div className="print-summary-value">{String(doc.cutoffMinutes / 60).replace(".", ":")}</div>
                </div>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>Datum</th>
                      <th>Stav</th>
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
                        doc.cutoffMinutes,
                      );
                      const isOutsideEmployment = attendanceDay
                        ? !attendanceDay.is_within_employment_period
                        : !employmentIncludesDay(doc.employment, day.date);
                      const rowClass = isOutsideEmployment
                        ? "row-outside"
                        : calc.isWeekendOrHoliday
                          ? getCzechHolidayName(day.date)
                            ? "row-holiday"
                            : "row-weekend"
                          : "";
                      return (
                        <tr key={day.date} className={rowClass}>
                          <td>{formatDateLong(day.date)}</td>
                          <td>
                            {isOutsideEmployment
                              ? "Mimo období úvazku"
                              : attendanceDay?.planned_status === "HOLIDAY"
                                ? "DOVOLENÁ"
                                : attendanceDay?.planned_status === "OFF"
                                  ? "VOLNO"
                                  : getCzechHolidayName(day.date) ?? ""}
                          </td>
                          <td>{isOutsideEmployment ? "—" : attendanceDay?.planned_status ? "—" : attendanceDay?.arrival_time ?? ""}</td>
                          <td>{isOutsideEmployment ? "—" : attendanceDay?.planned_status ? "—" : attendanceDay?.departure_time ?? ""}</td>
                          <td>
                            {isOutsideEmployment
                              ? "—"
                              : attendanceDay?.planned_status === "HOLIDAY"
                                ? "8,0 h"
                                : calc.workedMins !== null
                                  ? `${formatHours(calc.workedMins)} h`
                                  : ""}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={5}>Odpracováno celkem: {formatHours(stats.totalMins)} h</td>
                    </tr>
                  </tfoot>
                </table>
                <div className="print-signature">Tento přehled byl vygenerován produkční administrací KájovoDagmar.</div>
              </div>
            );
          }

          return (
            <div key={`plan-${doc.employment.id}`} className="print-sheet">
              <div className="print-kicker">Operační cockpit hotelu</div>
              <h1>{label} · Plán služeb</h1>
              <h2>{doc.employment.label}</h2>
              <div className="print-summary">
                <div className="print-summary-box">
                  <div className="print-summary-label">Zaměstnanec</div>
                  <div className="print-summary-value">{doc.employment.user_name}</div>
                </div>
                <div className="print-summary-box">
                  <div className="print-summary-label">Fond</div>
                  <div className="print-summary-value">
                    {formatHours(workingDaysInMonthCs(parsedMonth.year, parsedMonth.month) * 8 * 60)} h
                  </div>
                </div>
                  <div className="print-summary-box">
                    <div className="print-summary-label">Typ úvazku</div>
                    <div className="print-summary-value">{doc.employment.employment_type}</div>
                  </div>
                  <div className="print-summary-box">
                    <div className="print-summary-label">Počet dní dovolené</div>
                    <div className="print-summary-value">{doc.row.days.filter((day) => day.status === "HOLIDAY").length}</div>
                  </div>
                </div>
              <table>
                <thead>
                  <tr>
                    <th>Datum</th>
                    <th>Den v týdnu</th>
                    <th>Stav</th>
                    <th>Příchod</th>
                    <th>Odchod</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.row.days.map((day) => {
                    const holidayName = getCzechHolidayName(day.date);
                    const weekend = isWeekendDate(day.date);
                    const rowClass = !day.is_within_employment_period
                      ? "row-outside"
                      : holidayName
                        ? "row-holiday"
                        : weekend
                          ? "row-weekend"
                          : "";
                    return (
                      <tr key={day.date} className={rowClass}>
                        <td>{formatDateLong(day.date)}</td>
                        <td>{parseLocalDate(day.date).toLocaleDateString("cs-CZ", { weekday: "long" })}</td>
                        <td>
                          {!day.is_within_employment_period
                            ? "Mimo období úvazku"
                            : day.status === "HOLIDAY"
                              ? "Dovolená"
                              : day.status === "OFF"
                                ? "Volno"
                                : holidayName ?? ""}
                        </td>
                        <td>{!day.is_within_employment_period ? "—" : day.arrival_time ?? ""}</td>
                        <td>{!day.is_within_employment_period ? "—" : day.departure_time ?? ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="print-signature">Tento přehled byl vygenerován produkční administrací KájovoDagmar.</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
