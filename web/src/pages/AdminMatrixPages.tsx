import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Panel, StatusMessage } from "../components/Primitives";
import { api } from "../api/client";

function monthParts() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export function AdminAttendancePage() {
  const { t } = useTranslation();
  const initial = monthParts();
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const events = useQuery({ queryKey: ["admin-attendance-events", year, month], queryFn: () => api.admin<{ data: Array<{ id: number; employment_id: number; occurred_at: string; event_type: "IN" | "OUT" }> }>(`/api/v1/admin/attendance/events?year=${year}&month=${month}`) });
  return <Panel title={t("adminMatrix.attendance.title")}><div className="panel-body"><div className="form-grid"><label>Rok<input type="number" value={year} onChange={(event) => setYear(Number(event.target.value))} /></label><label>Měsíc<input type="number" min="1" max="12" value={month} onChange={(event) => setMonth(Number(event.target.value))} /></label></div>{events.isError && <StatusMessage kind="error" title="Docházku se nepodařilo načíst." />}{events.data?.data.length === 0 && <StatusMessage kind="empty" title="V tomto měsíci nejsou žádné průchody." />}{events.data && events.data.data.length > 0 && <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Úvazek</th><th>Čas</th><th>Typ</th></tr></thead><tbody>{events.data.data.map((event) => <tr key={event.id}><td>{event.employment_id}</td><td>{new Date(event.occurred_at).toLocaleString("cs-CZ")}</td><td>{event.event_type}</td></tr>)}</tbody></table></div>}</div></Panel>;
}

export function AdminShiftPlanPage() {
  const { t } = useTranslation();
  return <Panel title={t("adminMatrix.shiftPlan.title")}><StatusMessage kind="empty" title={t("adminMatrix.shiftPlan.empty")} /></Panel>;
}
