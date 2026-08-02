import { useState } from "react";
import { Download, Printer, Settings, ShieldCheck } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Field, Panel, StatusMessage } from "../components/Primitives";
import { api } from "../api/client";
import type {
  AdminAttendanceSheet,
  AttendanceDay,
  AttendanceMonth,
  MetricKey,
} from "../api/types";
import { asPragueDate, getWeekdayLongLabel } from "../utils/calendar";
import { formatHours as formatHoursValue } from "../utils/hoursFormat";

type EmploymentChoice = {
  id: number;
  user_name: string;
  title: string;
  employment_type: string;
  display_label?: string;
  is_active_in_month?: boolean;
};
type ShiftPlanResponse = {
  year: number;
  month: number;
  selected_employment_ids: number[];
  available_employments: EmploymentChoice[];
  rows: ShiftPlanRow[];
};
type ShiftPlanRow = {
  employment_id: number;
  display_label: string;
  shift_plan_locked: boolean;
  days: ShiftPlanDay[];
  summary: {
    planned_hours: number;
    scheduled_days: number;
    holiday_days: number;
    off_days: number;
  };
};
type ShiftPlanDay = {
  date: string;
  arrival_time: string | null;
  departure_time: string | null;
  status: string | null;
  is_carryover: boolean;
  carryover_departure_time: string | null;
  is_within_employment_period: boolean;
  planned_hours: number;
  planned_state: string;
};
type PrintType = "attendance" | "shift_plan";

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthParts(value: string) {
  const [year, month] = value.split("-").map(Number);
  return { year, month };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

const PRINT_EVENT_COLUMNS = 4;

function formatEventTime(day: AttendanceDay, index: number) {
  const event = day.events[index];
  if (!event) return "—";
  const time = new Intl.DateTimeFormat("cs-CZ", {
    timeZone: "Europe/Prague",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(event.occurred_at));
  const extra =
    index === PRINT_EVENT_COLUMNS - 1 && day.events.length > PRINT_EVENT_COLUMNS
      ? ` +${day.events.length - PRINT_EVENT_COLUMNS}`
      : "";
  return `${event.event_type} ${time}${extra}`;
}

const metricLabels: Record<MetricKey, string> = {
  total: "Celkem",
  afternoon: "Odpoledne",
  night: "Noc",
  weekend: "Víkend",
  public_holiday: "Svátek",
};
const attendanceStatusLabels: Record<string, string> = {
  HOLIDAY: "Dovolená",
  SICKNESS: "Nemoc",
  OFF: "Volno",
  PARAGRAPH: "Paragraf",
};
const formatMetric = (value: { hours: number } | null | undefined) =>
  value == null ? "—" : formatHoursValue(value.hours, "cs-CZ");

function AttendancePrint({
  sheets,
  kind,
}: {
  sheets: AttendanceMonth[];
  kind: "summary" | "detail";
}) {
  return (
    <div
      className={`print-sheet print-sheet--attendance-detail ${kind === "summary" ? "print-sheet--attendance-summary" : ""}`}
    >
      {sheets.map((sheet) => (
        <article className="print-attendance-card" key={sheet.employment_id}>
          <header>
            <h2>{sheet.employment_label}</h2>
            <p>Docházkový list · {kind === "summary" ? "souhrn" : "detail"}</p>
          </header>
          <table className="print-attendance-table">
            <colgroup>
              <col className="print-attendance-col-date" />
              {Array.from({ length: PRINT_EVENT_COLUMNS }, (_, index) => (
                <col className="print-attendance-col-event" key={index} />
              ))}
              {sheet.display_metrics.map((key) => (
                <col className="print-attendance-col-metric" key={key} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th>Datum / den</th>
                {Array.from({ length: PRINT_EVENT_COLUMNS }, (_, index) => (
                  <th key={index}>Průchod {index + 1}</th>
                ))}
                {sheet.display_metrics.map((key) => (
                  <th key={key}>{metricLabels[key]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheet.days.map((day) => {
                const date = asPragueDate(day.date);
                return (
                  <tr
                    className={`print-day--${day.calendar_tone}`}
                    key={day.date}
                  >
                    <td>
                      <strong>
                        {new Intl.DateTimeFormat("cs-CZ", {
                          day: "numeric",
                          month: "numeric",
                        }).format(date)}
                      </strong>
                      <span>{getWeekdayLongLabel(date, "cs")}</span>
                      {day.public_holiday_label && (
                        <small>{day.public_holiday_label}</small>
                      )}
                      {day.effective_status && (
                        <small className="print-day-status">
                          {attendanceStatusLabels[day.effective_status] ?? day.effective_status}
                        </small>
                      )}
                    </td>
                    {Array.from({ length: PRINT_EVENT_COLUMNS }, (_, index) => (
                      <td className="print-event-cell" key={index}>
                        {formatEventTime(day, index)}
                      </td>
                    ))}
                    {sheet.display_metrics.map((key) => (
                      <td key={key}>{formatMetric(day.worked?.[key])}</td>
                    ))}
                  </tr>
                );
              })}
              <tr className="print-attendance-total">
                <th colSpan={1 + PRINT_EVENT_COLUMNS}>Součet</th>
                {sheet.display_metrics.map((key) => (
                  <th key={key}>{formatMetric(sheet.worked?.[key])}</th>
                ))}
              </tr>
            </tbody>
          </table>
        </article>
      ))}
    </div>
  );
}

export function AdminExportPage() {
  const { t } = useTranslation();
  const [month, setMonth] = useState(currentMonth());
  const [employment, setEmployment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { year, month: monthNumber } = monthParts(month);
  const attendance = useQuery({
    queryKey: ["admin-export-employments", year, monthNumber],
    queryFn: () =>
      api.admin<{ data: AdminAttendanceSheet[] }>(
        `/api/v1/admin/attendance/month?year=${year}&month=${monthNumber}`,
      ),
  });
  const choices = attendance.data?.data ?? [];
  const download = async () => {
    setError(null);
    try {
      const path = employment
        ? `/api/v1/admin/export?month=${month}&employment_id=${employment}`
        : `/api/v1/admin/export?month=${month}&bulk=true`;
      const result = await api.adminBlob(path);
      downloadBlob(
        result.blob,
        result.filename ??
          (employment ? `dochazka_${month}.csv` : `export_${month}.zip`),
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Export se nepodařilo vytvořit.",
      );
    }
  };
  return (
    <div className="page">
      <header className="page-heading">
        <div>
          <p>{t("adminOps.export.eyebrow")}</p>
          <h1>{t("adminOps.export.title")}</h1>
        </div>
      </header>
      <div className="split">
        <Panel title={t("adminOps.export.params")}>
          <div className="panel-body form-grid">
            <Field label={t("adminOps.export.month")}>
              <input
                type="month"
                value={month}
                onChange={(event) => {
                  setMonth(event.target.value);
                  setEmployment("");
                }}
              />
            </Field>
            <Field label={t("adminOps.export.scope")}>
              <select
                value={employment}
                onChange={(event) => setEmployment(event.target.value)}
              >
                <option value="">{t("adminOps.export.allZip")}</option>
                {choices.map((item) => (
                  <option key={item.employment_id} value={item.employment_id}>
                    {item.user_name} · {item.employment_title} ·{" "}
                    {item.employment_type}
                  </option>
                ))}
              </select>
            </Field>
            <div className="full action-row">
              <Button onClick={download}>
                <Download />
                {t("adminOps.export.download")} {employment ? "CSV" : "ZIP"}
              </Button>
            </div>
            {attendance.isPending && (
              <div className="full">
                <StatusMessage
                  kind="loading"
                  title={t("common.states.loading")}
                />
              </div>
            )}
            {attendance.isError && (
              <div className="full">
                <StatusMessage
                  kind="error"
                  title={t("adminOps.export.loadFailed")}
                />
              </div>
            )}
            {error && (
              <div className="full">
                <StatusMessage
                  kind="error"
                  title={t("adminOps.export.loadFailed")}
                >
                  {error}
                </StatusMessage>
              </div>
            )}
          </div>
        </Panel>
        <Panel title={t("adminOps.export.contains")}>
          <ul className="list">
            <li>
              <span>{t("adminOps.export.dataBinding")}</span>
              <strong>employment_id</strong>
            </li>
            <li>
              <span>{t("adminOps.export.timeRange")}</span>
              <strong>{month}</strong>
            </li>
            <li>
              <span>{t("adminOps.export.columns")}</span>
              <strong>{t("adminOps.export.columnValue")}</strong>
            </li>
            <li>
              <span>{t("adminOps.export.encoding")}</span>
              <strong>UTF-8</strong>
            </li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}

export function AdminPrintsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [month, setMonth] = useState(currentMonth());
  const [type, setType] = useState<PrintType>("attendance");
  const [kind, setKind] = useState<"summary" | "detail">("summary");
  const [selected, setSelected] = useState<number[] | null>(null);
  const { year, month: monthNumber } = monthParts(month);
  const plan = useQuery({
    queryKey: ["admin-print-plan", year, monthNumber],
    queryFn: () =>
      api.admin<ShiftPlanResponse>(
        `/api/v1/admin/shift-plan?year=${year}&month=${monthNumber}`,
      ),
    enabled: type === "shift_plan",
  });
  const attendance = useQuery({
    queryKey: ["admin-print-attendance", year, monthNumber],
    queryFn: () =>
      api.admin<{ data: AdminAttendanceSheet[] }>(
        `/api/v1/admin/attendance/month?year=${year}&month=${monthNumber}`,
      ),
    enabled: type === "attendance",
  });
  const choices: EmploymentChoice[] =
    type === "shift_plan"
      ? (plan.data?.available_employments ?? [])
      : (attendance.data?.data ?? []).map((item) => ({
          id: item.employment_id,
          user_name: item.user_name,
          title: item.employment_title,
          employment_type: item.employment_type,
          display_label: item.employment_label,
          is_active_in_month: item.is_active_in_month,
        }));
  const defaultIds = choices
    .filter((item) => item.is_active_in_month !== false)
    .map((item) => item.id);
  const selectedIds = selected ?? defaultIds;
  const toggle = (id: number) =>
    setSelected((current) => {
      const base = current ?? defaultIds;
      return base.includes(id)
        ? base.filter((item) => item !== id)
        : [...base, id];
    });
  const openPreview = () =>
    navigate(
      `/admin/tisky/preview?month=${month}&type=${type}&kind=${kind}&employments=${selectedIds.join(",")}`,
    );
  const isLoading =
    type === "shift_plan" ? plan.isPending : attendance.isPending;
  const isError = type === "shift_plan" ? plan.isError : attendance.isError;
  return (
    <div className="page">
      <header className="page-heading">
        <div>
          <p>{t("adminOps.prints.eyebrow")}</p>
          <h1>{t("adminOps.prints.title")}</h1>
        </div>
      </header>
      <div className="split">
        <Panel title={t("adminOps.prints.document")}>
          <div className="panel-body form-grid">
            <Field label={t("adminOps.prints.reportType")}>
              <select
                value={type}
                onChange={(event) => {
                  setType(event.target.value as PrintType);
                  setSelected(null);
                }}
              >
                <option value="attendance">
                  {t("adminOps.prints.attendanceType")}
                </option>
                <option value="shift_plan">
                  {t("adminOps.prints.shiftPlanType")}
                </option>
              </select>
            </Field>
            {type === "attendance" && (
              <Field label={t("adminOps.prints.reportVariant")}>
                <select
                  value={kind}
                  onChange={(event) =>
                    setKind(event.target.value as "summary" | "detail")
                  }
                >
                  <option value="summary">
                    {t("adminOps.prints.summary")}
                  </option>
                  <option value="detail">{t("adminOps.prints.detail")}</option>
                </select>
              </Field>
            )}
            <Field label={t("adminOps.prints.month")}>
              <input
                type="month"
                value={month}
                onChange={(event) => {
                  setMonth(event.target.value);
                  setSelected(null);
                }}
              />
            </Field>
            <div className="full">
              <div className="action-row action-row--wrap">
                <Button
                  type="button"
                  variant="quiet"
                  onClick={() => setSelected(defaultIds)}
                >
                  {t("adminOps.prints.selectAllEmployments")}
                </Button>
                <Button
                  type="button"
                  variant="quiet"
                  onClick={() => setSelected([])}
                >
                  {t("adminOps.prints.clearEmployments")}
                </Button>
                <span className="badge">
                  {t("adminOps.prints.selectedEmploymentsCount", {
                    count: selectedIds.length,
                  })}
                </span>
              </div>
              {isError && (
                <StatusMessage
                  kind="error"
                  title={t("adminOps.prints.failed")}
                />
              )}
              {isLoading && (
                <StatusMessage
                  kind="loading"
                  title={t("adminOps.prints.loadingShiftPlanEmployments")}
                />
              )}
              <div className="admin-chip-grid">
                {choices.map((item) => (
                  <label
                    key={item.id}
                    className={`admin-chip admin-chip--checkbox ${selectedIds.includes(item.id) ? "admin-chip--active" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(item.id)}
                      disabled={item.is_active_in_month === false}
                      onChange={() => toggle(item.id)}
                    />
                    <strong>{item.user_name}</strong>
                    <span>{item.title}</span>
                    <small>{item.display_label ?? item.employment_type}</small>
                  </label>
                ))}
              </div>
            </div>
            <div className="full action-row">
              <Button disabled={selectedIds.length === 0} onClick={openPreview}>
                <Printer />
                {t("adminOps.prints.openPreview")}
              </Button>
            </div>
          </div>
        </Panel>
        <Panel title={t("adminOps.prints.previewContains")}>
          <div className="panel-body stack">
            <p>
              {type === "shift_plan"
                ? t("adminOps.prints.shiftPlanDescription")
                : kind === "summary"
                  ? t("adminOps.prints.summaryDescription")
                  : t("adminOps.prints.detailDescription")}
            </p>
            <p>{t("adminOps.prints.previewHelp")}</p>
          </div>
        </Panel>
      </div>
    </div>
  );
}

export function AdminPrintPreviewPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const month = params.get("month") ?? currentMonth();
  const type = (params.get("type") ?? "attendance") as PrintType;
  const kind = (params.get("kind") ?? "summary") as "summary" | "detail";
  const selectedIds = (params.get("employments") ?? "")
    .split(",")
    .map(Number)
    .filter((id) => id > 0);
  const { year, month: monthNumber } = monthParts(month);
  const attendance = useQuery({
    queryKey: ["print-attendance-month", year, monthNumber],
    queryFn: () =>
      api.admin<{ data: AttendanceMonth[] }>(
        `/api/v1/admin/attendance/month?year=${year}&month=${monthNumber}`,
      ),
    enabled: type === "attendance",
  });
  const report = useQuery({
    queryKey: ["print-shift-plan-report", year, monthNumber, selectedIds],
    queryFn: () =>
      api.admin<ShiftPlanReport>("/api/v1/admin/export/shift-plan/report", {
        method: "POST",
        body: JSON.stringify({
          year,
          month: monthNumber,
          employment_ids: selectedIds,
        }),
      }),
    enabled: type === "shift_plan" && selectedIds.length > 0,
  });
  const sheets = (attendance.data?.data ?? []).filter(
    (sheet) =>
      selectedIds.length === 0 || selectedIds.includes(sheet.employment_id),
  );
  const downloadPdf = async () => {
    const response = await api.adminBlob(
      "/api/v1/admin/export/shift-plan/pdf",
      {
        method: "POST",
        body: JSON.stringify({
          year,
          month: monthNumber,
          employment_ids: selectedIds,
        }),
      },
    );
    downloadBlob(response.blob, response.filename ?? `plan_smen_${month}.pdf`);
  };
  return (
    <div className="page">
      <header className="page-heading no-print">
        <div>
          <p>{t("adminOps.prints.previewEyebrow")}</p>
          <h1>
            {type === "shift_plan"
              ? t("adminOps.prints.shiftPlanPreviewTitle")
              : t("adminOps.prints.previewTitle")}
          </h1>
        </div>
        <div className="action-row">
          <Button variant="quiet" onClick={() => window.print()}>
            <Printer />
            {t("adminOps.prints.printPdf")}
          </Button>
          {type === "shift_plan" && (
            <Button onClick={downloadPdf}>
              <Download />
              {t("adminOps.prints.downloadPdf")}
            </Button>
          )}
        </div>
      </header>
      {type === "attendance" ? (
        attendance.isPending ? (
          <StatusMessage
            kind="loading"
            title={t("adminOps.prints.preparing")}
          />
        ) : attendance.isError ? (
          <StatusMessage kind="error" title={t("adminOps.prints.failed")} />
        ) : (
          <AttendancePrint sheets={sheets} kind={kind} />
        )
      ) : report.isPending ? (
        <StatusMessage
          kind="loading"
          title={t("adminOps.prints.generatingPdf")}
        />
      ) : report.isError ? (
        <StatusMessage kind="error" title={t("adminOps.prints.failed")} />
      ) : report.data ? (
        <ShiftPlanPreview report={report.data} />
      ) : (
        <StatusMessage kind="empty" title={t("adminOps.prints.failed")} />
      )}
    </div>
  );
}

type ShiftPlanReport = {
  year: number;
  month: number;
  month_label: string;
  generated_at_label: string;
  day_headers: Array<{
    date_iso: string;
    day_number: number;
    weekday_short: string;
    holiday_label: string | null;
    tone: string;
  }>;
  pages: Array<{
    page_number: number;
    employments: Array<{
      employment_id: number;
      display_label: string;
      user_name: string;
      title: string;
      employment_type: string;
      display_metrics: MetricKey[];
      planned_metrics: Partial<
        Record<MetricKey, { minutes: number; tenths: number; hours: number }>
      >;
      scheduled_days: number;
      holiday_days: number;
      off_days: number;
      cells: Array<{
        date_iso: string;
        interval_label: string;
        planned_metrics: Partial<
          Record<MetricKey, { minutes: number; tenths: number; hours: number }>
        >;
        status_label: string | null;
        tone: string;
        is_within_employment_period: boolean;
      }>;
    }>;
  }>;
  legend: string[];
};

function ShiftPlanPreview({ report }: { report: ShiftPlanReport }) {
  return (
    <div className="print-report-pages">
      {report.pages.map((page) => (
        <article
          className="print-sheet print-sheet--shift-plan"
          key={page.page_number}
        >
          <header>
            <h2>Plán služeb · {report.month_label}</h2>
            <small>
              Vygenerováno {report.generated_at_label} · Strana{" "}
              {page.page_number} z {report.pages.length}
            </small>
          </header>
          <table className="print-shift-plan-table">
            <thead>
              <tr>
                <th>Úvazek</th>
                <th>Součet</th>
                {report.day_headers.map((day) => (
                  <th key={day.date_iso}>
                    <strong>{day.day_number}.</strong>
                    <span>{day.weekday_short}</span>
                    {day.holiday_label && <small>{day.holiday_label}</small>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {page.employments.map((employment) => (
                <tr key={employment.employment_id}>
                  <td>
                    <strong>{employment.user_name}</strong>
                    <span>{employment.display_label}</span>
                    <small>
                      {employment.employment_type} · {employment.title}
                    </small>
                  </td>
                  <td>
                    {employment.display_metrics.map((key) =>
                      employment.planned_metrics[key] ? (
                        <strong key={key}>
                          {metricLabels[key]}{" "}
                          {formatHoursValue(
                            employment.planned_metrics[key]!.hours,
                            "cs-CZ",
                          )}
                        </strong>
                      ) : null,
                    )}
                    <span>{employment.scheduled_days} směn</span>
                    <small>
                      D {employment.holiday_days} · V {employment.off_days}
                    </small>
                  </td>
                  {employment.cells.map((cell) => (
                    <td key={cell.date_iso}>
                      <strong>{cell.interval_label}</strong>
                      {employment.display_metrics.map((key) =>
                        cell.planned_metrics[key] ? (
                          <span key={key}>
                            {metricLabels[key]}{" "}
                            {formatHoursValue(
                              cell.planned_metrics[key]!.hours,
                              "cs-CZ",
                            )}
                          </span>
                        ) : null,
                      )}
                      {cell.status_label && <small>{cell.status_label}</small>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <footer>
            <strong>Legenda</strong>
            <ul>
              {report.legend.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </footer>
        </article>
      ))}
    </div>
  );
}

export function AdminSettingsPage() {
  const { t } = useTranslation();
  return (
    <Panel title={t("adminOps.settings.title")}>
      <div className="panel-body">
        <Settings aria-hidden="true" />
        <p>
          {t(
            "adminOps.settings.employmentProfileOnly",
            "Časová nastavení se upravují na konkrétním úvazku.",
          )}
        </p>
      </div>
    </Panel>
  );
}

export function AdminIntegrationsPage() {
  const { t } = useTranslation();
  return (
    <Panel title={t("adminOps.integrations.title")}>
      <div className="panel-body">
        <ShieldCheck aria-hidden="true" />
        <p>
          {t(
            "adminOps.integrations.description",
            "Integrační API používá samostatné scoped tokeny.",
          )}
        </p>
      </div>
    </Panel>
  );
}
