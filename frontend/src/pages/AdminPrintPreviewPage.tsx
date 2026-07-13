import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
import { BRAND_ASSETS } from "../brand/brand";

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

const A4_WIDTH_PX = (210 / 25.4) * 96;
const A4_HEIGHT_PX = (297 / 25.4) * 96;

function getPreviewScale() {
  if (typeof window === "undefined") return 1;
  const viewportWidth = Math.min(window.innerWidth, document.documentElement.clientWidth || window.innerWidth);
  const availableWidth = viewportWidth <= 760 ? viewportWidth - 32 : Math.min(640, viewportWidth - 410);
  return Math.min(0.72, Math.max(0.2, availableWidth / A4_WIDTH_PX));
}

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
  const idsParam = params.get("ids") ?? "";
  const idList = useMemo(
    () =>
      idsParam
        .split(",")
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isInteger(item) && item > 0),
    [idsParam],
  );
  const parsed = useMemo(() => parseMonth(month), [month]);
  const parsedMonth = useMemo(() => parsed ?? { year: 1970, month: 1 }, [parsed]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [pdfGenerated, setPdfGenerated] = useState(false);
  const [previewScale, setPreviewScale] = useState(getPreviewScale);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const updatePreviewScale = () => setPreviewScale(getPreviewScale());
    updatePreviewScale();
    window.addEventListener("resize", updatePreviewScale);
    return () => window.removeEventListener("resize", updatePreviewScale);
  }, []);

  useEffect(() => {
    setPdfGenerated(false);
    setDocs([]);
    if (!parsed || idList.length === 0) {
      setLoading(false);
      setError(null);
      return;
    }
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
    const renderContainer = currentContainer;

    async function generatePdf() {
      renderContainer.classList.add("print-pdf-rendering");
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
      const sheets = Array.from(renderContainer.querySelectorAll(".print-sheet")) as HTMLElement[];
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      try {
        for (let i = 0; i < sheets.length; i += 1) {
          const canvas = await html2canvas(sheets[i], { scale: 2, useCORS: true, backgroundColor: "#f3efe7" });
          const imgData = canvas.toDataURL("image/png");
          const ratio = Math.min(pageWidth / canvas.width, pageHeight / canvas.height);
          if (i > 0) pdf.addPage();
          pdf.addImage(imgData, "PNG", 0, 0, canvas.width * ratio, canvas.height * ratio);
        }
      } finally {
        renderContainer.classList.remove("print-pdf-rendering");
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
  const generationStep = error ? 0 : loading ? 1 : docs.length === 0 ? 0 : pdfGenerated ? 4 : 3;
  const generationStatus = !parsed
    ? "Neplatný údaj měsíce"
    : error
    ? "Generování zastaveno"
    : loading
      ? "Načítám data úvazků"
      : pdfGenerated
        ? "PDF bylo vygenerováno"
        : docs.length > 0
          ? "Vykresluji A4 listy"
          : "Čekám na platné parametry";
  const steps = ["Načtení dat", "Render A4 listů", "Generování PDF", "Automatické stažení"];

  return (
    <div className="print-preview-page">
      <style>{`
        body { margin: 0; background: #020a15; color: #f4f7f9; font-family: "Montserrat", "Segoe UI", sans-serif; }
        .print-preview-page {
          min-height: 100vh;
          padding: 14px;
          background:
            radial-gradient(circle at 12% 0%, rgba(43, 151, 144, 0.08), transparent 28%),
            #020a15;
        }
        .print-cockpit {
          width: min(1480px, 100%);
          margin: 0 auto;
          border: 1px solid #2c3746;
          border-radius: 8px;
          overflow: hidden;
          background: rgba(5, 15, 24, 0.96);
          box-shadow: 0 22px 60px rgba(0, 0, 0, 0.34);
        }
        .print-cockpit-header {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 18px;
          align-items: center;
          padding: 11px 14px;
          border-bottom: 1px solid #2c3746;
          background: #0d1922;
        }
        .print-cockpit-brand {
          display: flex;
          min-width: 0;
          align-items: center;
          gap: 13px;
        }
        .print-cockpit-brand img { width: 106px; height: auto; }
        .print-cockpit-brand strong {
          min-width: 0;
          padding-left: 13px;
          border-left: 1px solid #2c3746;
          font-size: 14px;
          letter-spacing: 0.01em;
        }
        .print-cockpit-route {
          display: grid;
          grid-template-columns: auto auto;
          gap: 3px 16px;
          color: #a3adca;
          font-size: 9px;
        }
        .print-cockpit-route b { color: #f4f7f9; }
        .print-input-summary {
          display: grid;
          grid-template-columns: minmax(240px, 0.7fr) minmax(0, 1.3fr);
          gap: 1px;
          border-bottom: 1px solid #2c3746;
          background: #2c3746;
        }
        .print-input-block {
          min-width: 0;
          padding: 10px 14px;
          background: #07131d;
        }
        .print-input-block strong,
        .print-section-heading strong {
          display: block;
          margin-bottom: 7px;
          color: #f4f7f9;
          font-size: 10px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .print-input-lines {
          display: flex;
          flex-wrap: wrap;
          gap: 6px 18px;
          color: #a3adca;
          font-size: 9px;
          line-height: 1.45;
        }
        .print-input-lines span { overflow-wrap: anywhere; }
        .print-input-lines b { color: #f4f7f9; }
        .print-progress-region {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 250px;
          gap: 8px;
          padding: 8px;
          border-bottom: 1px solid #2c3746;
        }
        .print-progress-panel,
        .print-diagnostics,
        .print-preview-panel,
        .print-state-panel {
          border: 1px solid #2c3746;
          border-radius: 6px;
          background: #091722;
        }
        .print-progress-panel { padding: 11px; }
        .print-progress-steps {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 8px;
        }
        .print-progress-step {
          position: relative;
          display: grid;
          grid-template-columns: 26px minmax(0, 1fr);
          gap: 7px;
          align-items: center;
          min-width: 0;
          color: #707788;
          font-size: 9px;
        }
        .print-progress-step::after {
          content: "";
          position: absolute;
          left: 31px;
          right: -4px;
          bottom: -10px;
          height: 2px;
          background: #27343a;
        }
        .print-progress-step:last-child::after { display: none; }
        .print-progress-number {
          width: 24px;
          height: 24px;
          display: grid;
          place-items: center;
          border: 1px solid #2c3746;
          border-radius: 50%;
          color: #a3adca;
          background: #0d1922;
          font-size: 10px;
          font-weight: 800;
        }
        .print-progress-step.is-active { color: #f4f7f9; }
        .print-progress-step.is-active .print-progress-number {
          border-color: #2b9790;
          color: #b8eeea;
          background: #143c3a;
        }
        .print-progress-step.is-active::after { background: #2b9790; }
        .print-progress-bar {
          height: 5px;
          margin-top: 17px;
          overflow: hidden;
          border: 1px solid #2c3746;
          border-radius: 999px;
          background: #020a15;
        }
        .print-progress-bar span {
          display: block;
          width: var(--print-progress);
          height: 100%;
          background: #2b9790;
          transition: width 180ms ease;
        }
        .print-progress-caption {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          margin-top: 7px;
          color: #a3adca;
          font-size: 9px;
        }
        .print-diagnostics { padding: 10px 11px; }
        .print-diagnostics h2,
        .print-state-panel h2 {
          margin: 0 0 8px;
          font-size: 11px;
        }
        .print-diagnostics dl,
        .print-state-panel dl { margin: 0; }
        .print-diagnostics dl > div,
        .print-state-panel dl > div {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          padding: 5px 0;
          border-bottom: 1px solid rgba(163, 173, 202, 0.13);
        }
        .print-diagnostics dt,
        .print-diagnostics dd,
        .print-state-panel dt,
        .print-state-panel dd { margin: 0; font-size: 9px; }
        .print-diagnostics dt,
        .print-state-panel dt { color: #a3adca; }
        .print-diagnostics dd,
        .print-state-panel dd {
          min-width: 0;
          color: #f4f7f9;
          font-weight: 750;
          text-align: right;
          overflow-wrap: anywhere;
        }
        .print-preview-layout {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 250px;
          gap: 8px;
          padding: 8px;
          align-items: start;
        }
        .print-preview-panel { min-width: 0; overflow: hidden; }
        .print-section-heading {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: center;
          padding: 9px 11px;
          border-bottom: 1px solid #2c3746;
          color: #a3adca;
          font-size: 9px;
        }
        .print-section-heading strong { margin: 0; }
        .print-preview-list {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(min(100%, 520px), 1fr));
          gap: 10px;
          padding: 10px;
          justify-items: center;
        }
        .print-preview-empty {
          min-height: 220px;
          display: grid;
          place-items: center;
          padding: 24px;
          color: #a3adca;
          text-align: center;
          font-size: 11px;
        }
        .print-state-panel { padding: 11px; }
        .print-state-banner {
          display: grid;
          gap: 4px;
          margin-top: 10px;
          padding: 9px;
          border: 1px solid #2c3746;
          border-radius: 5px;
          color: #b8eeea;
          background: #143c3a;
        }
        .print-state-banner.is-error {
          color: #ffb1aa;
          background: #3f2427;
          border-color: #8f4b50;
        }
        .print-state-banner strong { font-size: 10px; }
        .print-state-banner span { color: inherit; font-size: 8px; line-height: 1.45; }
        .print-cockpit-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          align-items: center;
          padding: 9px;
          border-top: 1px solid #2c3746;
          color: #a3adca;
          font-size: 8px;
        }
        .print-close-button {
          min-height: 32px;
          padding: 7px 13px;
          border: 1px solid #2c3746;
          border-radius: 5px;
          color: #f4f7f9;
          background: #1c2835;
          font: inherit;
          font-size: 9px;
          font-weight: 800;
          cursor: pointer;
        }
        .print-preview-status {
          margin: 10px;
          padding: 13px 14px;
          border: 1px solid #2c3746;
          border-radius: 6px;
          color: #a3adca;
          background: #0d1922;
          font-size: 11px;
        }
        .print-sheet-frame {
          margin: 0;
          overflow: visible;
          border: 1px solid #2c3746;
          border-radius: 6px;
          background: #020a15;
          box-shadow: 0 16px 34px rgba(0, 0, 0, 0.3);
        }
        .print-sheet {
          width: 210mm;
          min-height: 297mm;
          padding: 15mm 12mm;
          margin: 0;
          background: #fffdf8;
          box-shadow: 0 18px 44px rgba(32, 34, 37, 0.08);
          border-radius: 8px;
          transform-origin: top left;
        }
        .print-sheet-frame + .print-sheet-frame { page-break-before: always; }
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
        @media screen and (max-width: 820px) {
          .print-preview-page { padding: 6px; overflow-x: hidden; }
          .print-cockpit-header,
          .print-input-summary,
          .print-progress-region,
          .print-preview-layout { grid-template-columns: 1fr; }
          .print-cockpit-header { align-items: start; }
          .print-cockpit-route { grid-template-columns: 1fr; }
          .print-progress-steps { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 8px; }
          .print-progress-step:nth-child(2)::after { display: none; }
          .print-preview-list { display: block; padding: 6px; }
          .print-sheet-frame { margin: 0 auto 8px; }
          .print-section-heading { align-items: flex-start; flex-direction: column; }
          .print-cockpit-actions { justify-content: stretch; flex-direction: column; align-items: stretch; }
          .print-close-button { width: 100%; }
          .print-sheet-frame { overflow: hidden; }
          .print-pdf-rendering .print-sheet-frame {
            width: 210mm !important;
            min-height: 297mm !important;
            overflow: visible;
          }
          .print-pdf-rendering .print-sheet { transform: none !important; }
        }
      `}</style>
      <div className="print-cockpit">
        <header className="print-cockpit-header">
          <div className="print-cockpit-brand">
            <img src={BRAND_ASSETS.logoHorizontal} alt="KájovoDagmar DOCHÁZKOVÝ SYSTÉM" />
            <strong>ADM-08 / Generování a stažení PDF</strong>
          </div>
          <div className="print-cockpit-route" aria-label="Kontext obrazovky">
            <span>Route</span><b>/admin/tisky/preview</b>
            <span>Role</span><b>Administrátor</b>
          </div>
        </header>

        <section className="print-input-summary" aria-label="Souhrn vstupních parametrů">
          <div className="print-input-block">
            <strong>Parametry (query)</strong>
            <div className="print-input-lines">
              <span>?type=<b>{docType}</b></span>
              <span>?month=<b>{month || "—"}</b></span>
              <span>?ids=<b>{idList.length > 0 ? idList.join(", ") : "—"}</b></span>
            </div>
          </div>
          <div className="print-input-block">
            <strong>Souhrn vstupu</strong>
            <div className="print-input-lines">
              <span>Typ dokumentu: <b>{docType === "attendance" ? "Docházka" : "Plán služeb"}</b></span>
              <span>Vybrané úvazky: <b>{idList.length}</b></span>
              <span>Měsíc: <b>{month || "—"}</b></span>
              <span>Načtené listy: <b>{docs.length}</b></span>
            </div>
          </div>
        </section>

        <section className="print-progress-region" aria-label="Průběh generování PDF">
          <div className="print-progress-panel">
            <div className="print-progress-steps">
              {steps.map((step, index) => (
                <div key={step} className={`print-progress-step ${generationStep >= index + 1 ? "is-active" : ""}`}>
                  <span className="print-progress-number">{index + 1}</span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
            <div className="print-progress-bar" style={{ "--print-progress": `${Math.max(4, generationStep * 25)}%` } as CSSProperties}>
              <span />
            </div>
            <div className="print-progress-caption"><span>{generationStatus}</span><span>{docs.length} / {idList.length} listů</span></div>
          </div>
          <aside className="print-diagnostics" aria-label="Diagnostika aktuálního stavu">
            <h2>Diagnostika</h2>
            <dl>
              <div><dt>Výběr</dt><dd>{idList.length} úvazků</dd></div>
              <div><dt>Načteno</dt><dd>{docs.length} listů</dd></div>
              <div><dt>Typ</dt><dd>{docType === "attendance" ? "Docházka" : "Plán"}</dd></div>
              <div><dt>Stav</dt><dd>{!parsed ? "Neplatný měsíc" : error ? "Chyba" : loading ? "Načítání" : pdfGenerated ? "Staženo" : docs.length > 0 ? "Generování" : "Čeká"}</dd></div>
            </dl>
          </aside>
        </section>

        <section className="print-preview-layout">
          <main className="print-preview-panel">
            <div className="print-section-heading"><strong>Náhled tiskových listů</strong><span>Každý list = 1 úvazek · světlý A4 výstup</span></div>
            {loading ? <div className="print-preview-status">Načítám podklady pro tisk…</div> : null}
            {!parsed ? <div className="print-preview-status">Neplatný údaj měsíce. Použijte formát RRRR-MM.</div> : null}
            {error ? <div className="print-preview-status">{error}</div> : null}
            {parsed && !loading && !error && docs.length === 0 ? <div className="print-preview-empty">Čekám na platné parametry a vybrané úvazky.</div> : null}

            <div ref={containerRef} className="print-preview-list">
        {docs.map((doc) => {
          if (doc.type === "attendance") {
            const stats = computeMonthStats(doc.days, doc.employment.employment_type, doc.cutoffMinutes);
            return (
              <div
                key={`attendance-${doc.employment.id}`}
                className="print-sheet-frame"
                style={{ width: A4_WIDTH_PX * previewScale, minHeight: A4_HEIGHT_PX * previewScale }}
              >
              <div className="print-sheet" style={{ transform: `scale(${previewScale})` }}>
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
              </div>
            );
          }

          return (
            <div
              key={`plan-${doc.employment.id}`}
              className="print-sheet-frame"
              style={{ width: A4_WIDTH_PX * previewScale, minHeight: A4_HEIGHT_PX * previewScale }}
            >
            <div className="print-sheet" style={{ transform: `scale(${previewScale})` }}>
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
            </div>
          );
        })}
            </div>
          </main>

          <aside className="print-state-panel" aria-label="Stav generování">
            <h2>Aktuální stav</h2>
            <dl>
              <div><dt>Dokument</dt><dd>{docType === "attendance" ? "Docházka" : "Plán služeb"}</dd></div>
              <div><dt>Měsíc</dt><dd>{month || "—"}</dd></div>
              <div><dt>Soubor</dt><dd>tisky-{docType}-{month || "mesic"}.pdf</dd></div>
              <div><dt>Stažení</dt><dd>{pdfGenerated ? "Dokončeno" : "Automatické"}</dd></div>
            </dl>
            <div className={`print-state-banner ${error || !parsed ? "is-error" : ""}`} role="status">
              <strong>{!parsed ? "Neplatný měsíc" : error ? "Generování selhalo" : generationStatus}</strong>
              <span>{!parsed ? "Měsíc musí být ve formátu RRRR-MM." : error || (pdfGenerated ? "PDF je připravené a okno se může bezpečně zavřít." : "PDF se po vykreslení všech listů stáhne automaticky.")}</span>
            </div>
          </aside>
        </section>

        <footer className="print-cockpit-actions">
          <span>Po úspěšném stažení se okno automaticky zavře. Při chybě zůstává otevřené pro diagnostiku.</span>
          <button type="button" className="print-close-button" onClick={() => window.close()}>Zavřít okno</button>
        </footer>
      </div>
    </div>
  );
}
