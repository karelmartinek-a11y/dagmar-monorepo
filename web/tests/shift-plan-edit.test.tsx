import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import type { AttendanceMonth, Employment } from "../src/api/types";
import { AdminShiftPlanPage } from "../src/pages/AdminMatrixPages";
import { EmployeePage } from "../src/pages/EmployeePage";

const statuses = { holiday: null, sickness: null, paragraph: null };
const employment: Employment = {
  id: 1, title: "Plán bez hodinových metrik", employment_type: "TASK_SHIFT_BASED",
  start_date: "2026-01-01", is_active: true,
};
function renderPage(page: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter>{page}</MemoryRouter></QueryClientProvider>);
}

afterEach(() => vi.restoreAllMocks());

describe("shift plan single-time deletion and monthly total", () => {
  it("employee deletes the displayed orphan end and always sees the backend total", async () => {
    vi.spyOn(api, "portalSession").mockResolvedValue({ display_name: "Test", employment_id: 1, available_employments: [employment] });
    vi.spyOn(api, "attendanceEmployments").mockResolvedValue([employment]);
    vi.spyOn(api, "shiftPlanGroups").mockResolvedValue([]);
    const month: AttendanceMonth = {
      employment_id: 1, employment_label: "Test", display_metrics: [], planned_hours: 2.2,
      worked: null, planned: null, status_metrics: statuses, attendance_locked: false, shift_plan_locked: false,
      days: [{ date: "2026-10-08", events: [], planned_arrival_time: null, planned_departure_time: "22:00",
        calendar_tone: "work", public_holiday_label: null, is_within_employment_period: true,
        worked: null, planned: null, status_metrics: statuses, worked_state: "empty", planned_state: "empty" }],
    };
    vi.spyOn(api, "attendance").mockImplementation(async () => structuredClone(month));
    const save = vi.spyOn(api, "saveShiftPlan").mockImplementation(async () => {
      month.days[0].planned_departure_time = null;
      return { ok: true };
    });
    renderPage(<EmployeePage />);
    fireEvent.click(await screen.findByRole("tab", { name: "Plán služeb" }));
    expect(await screen.findByTestId("employee-planned-hours")).toHaveTextContent("Měsíční součet plánovaných hodin: 2,2");
    const input = screen.getByLabelText("PLÁN – PRŮCHOD 1 2026-10-08");
    expect(input).toHaveValue("22:00");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(save).toHaveBeenCalledWith({ employment_id: 1, date: "2026-10-08", arrival_time: null, departure_time: null, status: null }));
    await waitFor(() => expect(input).toHaveValue(""));
  });

  it("admin deletes the displayed orphan end and always sees the backend total", async () => {
    let departure: string | null = "22:00";
    const writes: unknown[] = [];
    vi.spyOn(api, "admin").mockImplementation(async (_path, options) => {
      if (options?.method === "PUT") {
        writes.push(JSON.parse(options.body as string));
        departure = null;
        return { ok: true } as never;
      }
      return {
        year: 2026, month: 10, selected_employment_ids: [1],
        available_employments: [{ id: 1, display_label: "Test", user_name: "Test", title: "Úvazek", is_active_in_month: true }],
        rows: [{ employment_id: 1, display_label: "Test", shift_plan_locked: false, attendance_locked: false,
          display_metrics: [], days: [{ date: "2026-10-08", arrival_time: null, departure_time: departure,
            status: null, effective_status: null, is_within_employment_period: true,
            planned_hours: 0, planned: null, planned_state: "empty", status_metrics: statuses }],
          summary: { planned_hours: 2.2, planned: null, status_metrics: statuses, scheduled_days: 0, holiday_days: 0, off_days: 0 } }],
      } as never;
    });
    renderPage(<AdminShiftPlanPage />);
    expect(await screen.findByTestId("admin-planned-hours")).toHaveTextContent("Měsíční součet plánovaných hodin: 2,2");
    const input = screen.getByLabelText("PLÁN – PRŮCHOD 1 2026-10-08");
    expect(input).toHaveValue("22:00");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    await waitFor(() => expect(writes).toEqual([{ employment_id: 1, date: "2026-10-08", arrival_time: null, departure_time: null, status: null }]));
    await waitFor(() => expect(input).toHaveValue(""));
  });
});
