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

describe.each(["employee", "admin"] as const)("%s adjacent plan edits", (role) => {
  it("keeps the same day read-only until confirmed data arrives, then preserves both times", async () => {
    let times = { arrival_time: null as string | null, departure_time: null as string | null };
    let releaseRead!: () => void;
    let holdRead = false;
    let readStarted = false;
    const writes: Array<typeof times> = [];
    const read = async () => {
      if (holdRead) {
        readStarted = true;
        await new Promise<void>((resolve) => { releaseRead = () => { holdRead = false; resolve(); }; });
      }
      const hours = times.arrival_time && times.departure_time ? 8.1 : 0;
      const days = ["2026-10-08", "2026-10-09"].map((date, index) => ({
        date, arrival_time: index === 0 ? times.arrival_time : null,
        departure_time: index === 0 ? times.departure_time : null,
        status: null, effective_status: null, is_within_employment_period: true,
        planned_hours: index === 0 ? hours : 0, planned: null, planned_state: "empty", status_metrics: statuses,
      }));
      if (role === "employee") return {
        employment_id: 1, employment_label: "Test", display_metrics: [], planned_hours: hours,
        worked: null, planned: null, status_metrics: statuses, attendance_locked: false, shift_plan_locked: false,
        days: days.map((day) => ({ ...day, events: [], planned_arrival_time: day.arrival_time,
          planned_departure_time: day.departure_time, calendar_tone: "work", public_holiday_label: null,
          worked: null, worked_state: "empty" })),
      };
      return { year: 2026, month: 10, selected_employment_ids: [1],
        available_employments: [{ id: 1, display_label: "Test", user_name: "Test", title: "Úvazek", is_active_in_month: true }],
        rows: [{ employment_id: 1, display_label: "Test", shift_plan_locked: false, attendance_locked: false,
          display_metrics: [], days, summary: { planned_hours: hours, planned: null,
            status_metrics: statuses, scheduled_days: 0, holiday_days: 0, off_days: 0 } }],
      };
    };
    const write = async (body: Record<string, unknown>) => {
      times = { arrival_time: body.arrival_time as string | null, departure_time: body.departure_time as string | null };
      writes.push({ ...times });
      if (writes.length === 1) holdRead = true;
      return { ok: true };
    };
    if (role === "employee") {
      vi.spyOn(api, "portalSession").mockResolvedValue({ display_name: "Test", employment_id: 1, available_employments: [employment] });
      vi.spyOn(api, "attendanceEmployments").mockResolvedValue([employment]);
      vi.spyOn(api, "shiftPlanGroups").mockResolvedValue([]);
      vi.spyOn(api, "attendance").mockImplementation(async () => await read() as AttendanceMonth);
      vi.spyOn(api, "saveShiftPlan").mockImplementation(write);
      renderPage(<EmployeePage />);
      fireEvent.click(await screen.findByRole("tab", { name: "Plán služeb" }));
    } else {
      vi.spyOn(api, "admin").mockImplementation(async (_path, options) => options?.method === "PUT"
        ? await write(JSON.parse(options.body as string)) as never : await read() as never);
      renderPage(<AdminShiftPlanPage />);
    }
    const first = await screen.findByLabelText("PLÁN – PRŮCHOD 1 2026-10-08");
    const second = screen.getByLabelText("PLÁN – PRŮCHOD 2 2026-10-08");
    first.focus();
    fireEvent.change(first, { target: { value: "08:00" } });
    fireEvent.keyDown(first, { key: "Enter" });
    await waitFor(() => expect(readStarted).toBe(true));
    expect(first).toHaveAttribute("readonly");
    expect(second).toHaveAttribute("readonly");
    expect(first).toHaveAttribute("aria-busy", "true");
    expect(first).not.toHaveClass("clock-input--saved");
    expect(screen.getByLabelText("PLÁN – PRŮCHOD 1 2026-10-09")).not.toHaveAttribute("readonly");
    releaseRead();
    await waitFor(() => expect(second).not.toHaveAttribute("readonly"));
    expect(first).toHaveValue("08:00");
    expect(second).toHaveFocus();
    fireEvent.change(second, { target: { value: "16:03" } });
    fireEvent.keyDown(second, { key: "Enter" });
    await waitFor(() => expect(writes).toEqual([
      { arrival_time: "08:00", departure_time: null },
      { arrival_time: "08:00", departure_time: "16:03" },
    ]));
    await waitFor(() => expect(screen.getByTestId(`${role}-planned-hours`)).toHaveTextContent("8,1 h"));
  });
});
