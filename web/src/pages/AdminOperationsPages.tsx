import { useState } from "react";
import { Download, Printer, Settings, ShieldCheck } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Button, Field, Panel, StatusMessage } from "../components/Primitives";
import { api } from "../api/client";
import type {
  AdminAttendanceSheet,
  AttendanceDay,
  MetricKey,
  StatusMetricKey,
} from "../api/types";
import { asPragueDate } from "../utils/calendar";
import { formatCalendarDate } from "../utils/format";
import { formatHours as formatHoursValue } from "../utils/hoursFormat";
import {
  chronologicalPlanBoundaries,
  humanEventHeaders,
  isPrintCapacityExceeded,
} from "../utils/presentationAdapters";
import { statusMetricKeyForStatus, statusMetricKeys } from "../utils/statusMetrics";

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

function formatEventTime(day: AttendanceDay, index: number) {
  const event = day.events[index];
  if (!event) return "";
  const time = new Intl.DateTimeFormat("cs-CZ", {
    timeZone: "Europe/Prague",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(event.occurred_at));
  return time;
}

const metricLabels: Record<MetricKey, string> = {
  total: "Celkem",
  afternoon: "Odpoledne",
  night: "Noc",
  weekend: "Víkend",
  public_holiday: "Svátek",
};
function translatedMetricLabel(t: TFunction, key: MetricKey) {
  const paths: Record<MetricKey, string> = { total: "employee.metrics.worked", afternoon: "employee.metrics.afternoon", night: "employee.metrics.night", weekend: "employee.metrics.weekendHoliday", public_holiday: "employee.metrics.weekendHoliday" };
  return t(paths[key], metricLabels[key]);
}
const formatDuration = (value: { clock?: string } | null | undefined) => {
  return value?.clock ?? "";
};

function printWeekday(date: Date, locale: string) {
  const label = new Intl.DateTimeFormat(locale, {
    timeZone: "Europe/Prague",
    weekday: "short",
  }).format(date);
  return label.replace(/\.$/, "").replace(/^./, (character) => character.toUpperCase());
}

function printMetricLabel(t: TFunction, key: MetricKey) {
  const paths: Record<MetricKey, string> = {
    total: "adminOps.prints.template.worked",
    afternoon: "adminOps.prints.template.afternoon",
    night: "adminOps.prints.template.night",
    weekend: "adminOps.prints.template.weekend",
    public_holiday: "adminOps.prints.template.publicHoliday",
  };
  return t(paths[key]);
}

function employmentTypeLabel(t: TFunction, type: string) {
  const key = type.toLowerCase().replaceAll("_", "");
  const paths: Record<string, string> = {
    workcontract: "adminOps.prints.template.types.workContract",
    dppdpc: "adminOps.prints.template.types.dppDpc",
    taskshiftbased: "adminOps.prints.template.types.taskShiftBased",
    externalhourly: "adminOps.prints.template.types.externalHourly",
  };
  return t(paths[key] ?? "adminOps.prints.template.types.unknown");
}

function printDayCode(t: TFunction, day: AttendanceDay) {
  const statusKeys: Record<string, string> = {
    HOLIDAY: "adminOps.prints.template.codes.holiday",
    SICKNESS: "adminOps.prints.template.codes.sickness",
    OFF: "adminOps.prints.template.codes.off",
    PARAGRAPH: "adminOps.prints.template.codes.paragraph",
  };
  if (day.effective_status) {
    const status = t(statusKeys[day.effective_status] ?? "adminOps.prints.template.codes.status");
    const statusKey = statusMetricKeyForStatus(day.effective_status);
    const creditedHours = statusKey ? formatDuration(day.status_metrics[statusKey]) : "";
    return creditedHours ? `${status} ${creditedHours}` : status;
  }
  if (day.calendar_tone === "weekend") return t("adminOps.prints.template.codes.weekend");
  if (day.events.length > 0 || day.worked?.total?.minutes) {
    return t("adminOps.prints.template.codes.work");
  }
  return "";
}

function printStatusMetricLabel(t: TFunction, key: StatusMetricKey) {
  const paths: Record<StatusMetricKey, string> = {
    holiday: "employee.metrics.holiday",
    sickness: "employee.metrics.sickness",
    paragraph: "employee.metrics.paragraph",
  };
  return t(paths[key]);
}

function AttendancePrint({
  sheets,
}: {
  sheets: AdminAttendanceSheet[];
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || document.documentElement.lang || "cs-CZ";
  return (
    <div className="print-report-pages">
      {sheets.map((sheet) => {
        const eventColumns = 4;
        const overflowDays = sheet.days
          .filter((day) => day.events.length > eventColumns)
          .map((day) => day.date);
        const capacityExceeded = sheet.days.some((day) =>
          isPrintCapacityExceeded(sheet.days.length, day.events.length, sheet.display_metrics),
        );
        return (
        <article
          className={`print-sheet print-sheet--attendance-detail print-attendance-metrics--${Math.min(sheet.display_metrics.length, 5)}`}
          data-testid={`print-attendance-sheet-${sheet.employment_id}`}
          key={sheet.employment_id}
        >
          <header className="print-form__header">
            <div className="print-form__brand" aria-label="KájovoDagmar">
              <strong>KÁJOVO<br />DAGMAR</strong>
            </div>
            <div className="print-form__title">
              <h1>{t("adminOps.prints.template.title")}</h1>
              <p>{t("adminOps.prints.template.subtitle")}</p>
            </div>
          </header>
          <section className="print-form__identity" aria-label={t("adminOps.prints.template.identity")}>
            <div><strong>{t("adminOps.prints.template.employee")}:</strong> {sheet.user_name}</div>
            <div><strong>{t("adminOps.prints.template.employment")}:</strong> {sheet.employment_title}</div>
            <div><strong>{t("adminOps.prints.template.period")}:</strong> {formatPrintMonth(sheet.days[0]?.date ?? "")}</div>
            <div><strong>{t("adminOps.prints.template.type")}:</strong> {employmentTypeLabel(t, sheet.employment_type)}</div>
            <div><strong>{t("adminOps.prints.template.validity")}:</strong> {formatEmploymentValidity(sheet.start_date, sheet.end_date, t)}</div>
            <div><strong>{t("adminOps.prints.template.scope")}:</strong> {t("adminOps.prints.template.scopeValue")}</div>
          </section>
          {capacityExceeded ? (
            <StatusMessage
              kind="error"
              title={t("adminOps.prints.capacityExceeded")}
            >
              {overflowDays.length > 0 ? `${t("adminOps.prints.template.overflowDays")}: ${overflowDays.join(", ")}` : null}
            </StatusMessage>
          ) : null}
          {!capacityExceeded && <table className="print-attendance-table">
            <colgroup>
              <col className="print-attendance-col-day" />
              <col className="print-attendance-col-weekday" />
              {Array.from({ length: eventColumns }, (_, index) => (
                <col className="print-attendance-col-event" key={index} />
              ))}
              {sheet.display_metrics.map((key) => (
                <col className="print-attendance-col-metric" key={key} />
              ))}
              <col className="print-attendance-col-code" />
            </colgroup>
            <thead>
              <tr>
                <th>{t("adminOps.prints.template.day")}</th>
                <th>{t("adminOps.prints.template.weekday")}</th>
                {humanEventHeaders(eventColumns).map((header) => (
                  <th aria-label={header} key={header}>{t("adminOps.prints.template.pass")}</th>
                ))}
                {sheet.display_metrics.map((key) => (
                  <th key={key}>{printMetricLabel(t, key)}</th>
                ))}
                <th>{t("adminOps.prints.template.code")}</th>
              </tr>
            </thead>
            <tbody>
              {sheet.days.map((day) => {
                const date = asPragueDate(day.date);
                return (
                  <tr
                    className={`print-day--${day.calendar_tone}`}
                    data-date={day.date}
                    key={day.date}
                  >
                    <td className="print-day-number">{date.getDate()}</td>
                    <td className="print-weekday">{printWeekday(date, locale)}</td>
                    {Array.from({ length: eventColumns }, (_, index) => (
                      <td className="print-event-cell" key={index}>
                        {formatEventTime(day, index)}
                      </td>
                    ))}
                    {sheet.display_metrics.map((key) => (
                      <td key={key}>{formatDuration(day.worked?.[key])}</td>
                    ))}
                    <td className="print-code-cell">
                      <strong>{printDayCode(t, day)}</strong>
                      {day.public_holiday_label && <small>{day.public_holiday_label}</small>}
                    </td>
                  </tr>
                );
              })}
              <tr className="print-attendance-total">
                <th colSpan={2 + eventColumns}>{t("adminOps.prints.template.monthTotal")}</th>
                {sheet.display_metrics.map((key) => (
                  <th key={key}>{formatDuration(sheet.worked?.[key])}</th>
                ))}
                <th />
              </tr>
            </tbody>
          </table>}
          {sheet.display_metrics.length > 0 && !capacityExceeded && (
            <section className="print-attendance-summary">
              <h2>{t("adminOps.prints.template.summaryTitle")}</h2>
              <div className="print-summary-grid">
                {sheet.display_metrics.map((key) => (
                  <div key={key}>
                    <span>{printMetricLabel(t, key)}</span>
                    <strong>{formatDuration(sheet.worked?.[key])}</strong>
                  </div>
                ))}
                {statusMetricKeys.map((key) => (
                  <div key={key}>
                    <span>{printStatusMetricLabel(t, key)}</span>
                    <strong>{formatDuration(sheet.status_metrics[key])}</strong>
                  </div>
                ))}
              </div>
            </section>
          )}
          <footer className="print-form__footer">
            <div className="print-signatures">
              {["employee", "approver", "payroll"].map((key) => (
                <div key={key}>
                  <span />
                  <strong>{t(`adminOps.prints.template.signatures.${key}`)}</strong>
                </div>
              ))}
            </div>
            <small>{t("adminOps.prints.template.footer", { generatedAt: new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date()) })}</small>
          </footer>
        </article>
        );
      })}
    </div>
  );
}

function formatPrintMonth(dateValue: string) {
  if (!dateValue) return "";
  const date = new Date(`${dateValue}T12:00:00`);
  return `${String(date.getMonth() + 1).padStart(2, "0")} / ${date.getFullYear()}`;
}

function formatEmploymentValidity(startDate: string, endDate: string | null, t: TFunction) {
  const locale = document.documentElement.lang || "cs-CZ";
  const start = startDate ? new Intl.DateTimeFormat(locale).format(new Date(`${startDate}T12:00:00`)) : "";
  const end = endDate ? new Intl.DateTimeFormat(locale).format(new Date(`${endDate}T12:00:00`)) : t("adminOps.prints.template.openEnded");
  return `${start} - ${end}`;
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
  const [kind, setKind] = useState<"summary" | "detail">("detail");
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
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const month = params.get("month") ?? currentMonth();
  const type = (params.get("type") ?? "attendance") as PrintType;
  const kind = (params.get("kind") ?? "detail") as "summary" | "detail";
  const selectedIds = (params.get("employments") ?? "")
    .split(",")
    .map(Number)
    .filter((id) => id > 0);
  const { year, month: monthNumber } = monthParts(month);
  const attendance = useQuery({
    queryKey: ["print-attendance-month", year, monthNumber],
    queryFn: () =>
      api.admin<{ data: AdminAttendanceSheet[] }>(
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
    <div className="page" data-report-kind={kind}>
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
          {(
            <Button variant="quiet" onClick={() => navigate(`/admin/export?month=${month}`)}>
              <Download />
              {t("adminOps.prints.completeExport")}
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
          <AttendancePrint sheets={sheets} />
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
      status_metrics: Partial<
        Record<StatusMetricKey, { minutes: number; tenths: number; hours: number }>
      >;
      scheduled_days: number;
      holiday_days: number;
      off_days: number;
      cells: Array<{
        date_iso: string;
        arrival_time: string | null;
        departure_time: string | null;
        carryover_departure_time: string | null;
        planned_metrics: Partial<
          Record<MetricKey, { minutes: number; tenths: number; hours: number }>
        >;
        status_metrics: Partial<
          Record<StatusMetricKey, { minutes: number; tenths: number; hours: number }>
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
  const { t } = useTranslation();
  const employments = report.pages.flatMap((page) => page.employments);
  return (
    <div className="print-report-pages">
      {employments.map((employment) => {
        const planColumns = Math.max(2, ...employment.cells.map((cell) => chronologicalPlanBoundaries({ planned_carryover_departure_time: cell.carryover_departure_time, planned_arrival_time: cell.arrival_time, planned_departure_time: cell.departure_time }).length));
        return <article className="print-sheet print-sheet--shift-plan" key={employment.employment_id}>
          <header>
            <h2>{employment.display_label}</h2>
            <small>Plán služeb · {report.month_label} · {report.generated_at_label}</small>
          </header>
          {isPrintCapacityExceeded(employment.cells.length, Math.max(0, ...employment.cells.map((cell) => [cell.carryover_departure_time, cell.arrival_time, cell.departure_time].filter(Boolean).length)), employment.display_metrics) ? <StatusMessage kind="error" title={t("adminOps.prints.capacityExceeded")} /> : <table className="print-shift-plan-detail-table">
            <thead><tr><th>{t("employee.page.table.date", "Datum")}</th>{Array.from({ length: planColumns }, (_, index) => <th key={index}>{t("employee.page.table.pass", "PRŮCHOD")} {index + 1}</th>)}<th>{t("employee.page.table.status", "Stav")}</th>{employment.display_metrics.map((key) => <th key={key}>{translatedMetricLabel(t, key)} (h)</th>)}<th>Celodenní stavy (h)</th></tr></thead>
            <tbody>
              {employment.cells.map((cell) => <tr key={cell.date_iso}>
                <td>{formatCalendarDate(cell.date_iso)}</td>
                {chronologicalPlanBoundaries({ planned_carryover_departure_time: cell.carryover_departure_time, planned_arrival_time: cell.arrival_time, planned_departure_time: cell.departure_time }).map((time, index) => <td key={index}>{time}</td>)}
                {Array.from({ length: planColumns - chronologicalPlanBoundaries({ planned_carryover_departure_time: cell.carryover_departure_time, planned_arrival_time: cell.arrival_time, planned_departure_time: cell.departure_time }).length }, (_, index) => <td key={`empty-${index}`} />)}
                <td>{cell.status_label ?? ""}</td>
                {employment.display_metrics.map((key) => <td key={key}>{cell.planned_metrics[key] ? formatHoursValue(cell.planned_metrics[key]!.hours, "cs-CZ") : ""}</td>)}
                <td>{statusMetricKeys.map((key) => cell.status_metrics[key] ? `${printStatusMetricLabel(t, key)} ${formatHoursValue(cell.status_metrics[key]!.hours, "cs-CZ")}` : "").filter(Boolean).join(" · ")}</td>
              </tr>)}
              <tr className="print-attendance-total"><th colSpan={2 + planColumns}>{t("employee.page.table.sum", "Součet")}</th>{employment.display_metrics.map((key) => <th key={key}>{employment.planned_metrics[key] ? formatHoursValue(employment.planned_metrics[key]!.hours, "cs-CZ") : ""}</th>)}<th>{statusMetricKeys.map((key) => employment.status_metrics[key] ? `${printStatusMetricLabel(t, key)} ${formatHoursValue(employment.status_metrics[key]!.hours, "cs-CZ")}` : "").filter(Boolean).join(" · ")}</th></tr>
            </tbody>
          </table>}
        </article>
      })}
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
