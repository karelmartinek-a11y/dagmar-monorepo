import "fake-indexeddb/auto";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmployeePage } from "../src/pages/EmployeePage";

const session = {
  instance_token: "test-token",
  display_name: "Testovací uživatel",
  employment_id: 41,
  selected_employment_id: 41,
  available_employments: [{
    id: 41,
    title: "Denní provoz",
    employment_type: "HPP",
    start_date: "2026-01-01",
    end_date: null,
    is_active: true,
    is_current: true,
    label: "Testovací uživatel · Denní provoz",
  }],
  afternoon_cutoff: null,
};

type AttendanceDay = {
  date: string;
  arrival_time: string | null;
  departure_time: string | null;
  arrival_time_2: string | null;
  departure_time_2: string | null;
  planned_arrival_time: string | null;
  planned_departure_time: string | null;
  planned_status: string | null;
  is_within_employment_period: boolean;
};

function jsonResponse(payload: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(payload), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

function renderEmployeePage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <EmployeePage />
    </QueryClientProvider>,
  );
}

function buildDays(): AttendanceDay[] {
  return [{
    date: "2026-07-01",
    arrival_time: "08:00",
    departure_time: "16:00",
    arrival_time_2: null,
    departure_time_2: null,
    planned_arrival_time: "08:00",
    planned_departure_time: "16:00",
    planned_status: null,
    is_within_employment_period: true,
  }];
}

describe("employee time editing", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    localStorage.setItem("kajovodagmar.portal.session.v1", JSON.stringify(session));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("restores the original attendance time on Escape after an immediate Delete", async () => {
    const days = buildDays();
    const calls: Array<{ path: string; body?: string | null }> = [];
    fetchMock.mockImplementation(async (input, init) => {
      const path = String(input);
      calls.push({ path, body: typeof init?.body === "string" ? init.body : null });
      if (path.startsWith("/api/v1/attendance?")) {
        return jsonResponse({ employment_id: 41, employment_label: "Testovací uživatel · Denní provoz", locked: false, attendance_locked: false, shift_plan_locked: false, shift_plan_editable: true, days });
      }
      if (path === "/api/v1/attendance") {
        throw new Error("Attendance save should not be called");
      }
      throw new Error(`Unhandled fetch ${path}`);
    });

    const user = userEvent.setup();
    renderEmployeePage();

    const arrival = await screen.findByDisplayValue("08:00");
    await user.click(arrival);
    await user.keyboard("{Delete}{Escape}");

    expect(await screen.findByDisplayValue("08:00")).toBeInTheDocument();
    expect(calls.filter((call) => call.path === "/api/v1/attendance")).toHaveLength(0);
  });

  it("saves an empty attendance time on Escape after further edits following Delete", async () => {
    const days = buildDays();
    const calls: Array<{ path: string; body?: string | null }> = [];
    fetchMock.mockImplementation(async (input, init) => {
      const path = String(input);
      calls.push({ path, body: typeof init?.body === "string" ? init.body : null });
      if (path.startsWith("/api/v1/attendance?")) {
        return jsonResponse({ employment_id: 41, employment_label: "Testovací uživatel · Denní provoz", locked: false, attendance_locked: false, shift_plan_locked: false, shift_plan_editable: true, days });
      }
      if (path === "/api/v1/attendance") {
        const payload = JSON.parse(String(init?.body ?? "{}")) as { arrival_time: string | null };
        days[0].arrival_time = payload.arrival_time;
        return jsonResponse({ ok: true });
      }
      throw new Error(`Unhandled fetch ${path}`);
    });

    const user = userEvent.setup();
    renderEmployeePage();

    const arrival = await screen.findByDisplayValue("08:00");
    await user.click(arrival);
    await user.keyboard("{Delete}7{Backspace}{Escape}");

    await waitFor(() => {
      const payloads = calls.filter((call) => call.path === "/api/v1/attendance").map((call) => JSON.parse(call.body ?? "{}"));
      expect(payloads).toContainEqual(expect.objectContaining({
        employment_id: 41,
        date: "2026-07-01",
        arrival_time: null,
        departure_time: "16:00",
      }));
    });
    await waitFor(() => expect((document.querySelector('input[name="arrival_time"]') as HTMLInputElement | null)?.value).toBe(""));
  });

  it("restores the original shift plan time on Escape after an immediate Delete", async () => {
    const days = buildDays();
    const calls: Array<{ path: string; body?: string | null }> = [];
    fetchMock.mockImplementation(async (input, init) => {
      const path = String(input);
      calls.push({ path, body: typeof init?.body === "string" ? init.body : null });
      if (path.startsWith("/api/v1/attendance?")) {
        return jsonResponse({ employment_id: 41, employment_label: "Testovací uživatel · Denní provoz", locked: false, attendance_locked: false, shift_plan_locked: false, shift_plan_editable: true, days });
      }
      if (path === "/api/v1/shift-plan") {
        throw new Error("Shift plan save should not be called");
      }
      throw new Error(`Unhandled fetch ${path}`);
    });

    const user = userEvent.setup();
    renderEmployeePage();

    await user.click(await screen.findByRole("tab", { name: "Plán služeb" }));
    const plannedArrival = await screen.findByDisplayValue("08:00");
    await user.click(plannedArrival);
    await user.keyboard("{Delete}{Escape}");

    expect(await screen.findByDisplayValue("08:00")).toBeInTheDocument();
    expect(calls.filter((call) => call.path === "/api/v1/shift-plan")).toHaveLength(0);
  });

  it("saves an empty shift plan time on Escape after further edits following Delete", async () => {
    const days = buildDays();
    const calls: Array<{ path: string; body?: string | null }> = [];
    fetchMock.mockImplementation(async (input, init) => {
      const path = String(input);
      calls.push({ path, body: typeof init?.body === "string" ? init.body : null });
      if (path.startsWith("/api/v1/attendance?")) {
        return jsonResponse({ employment_id: 41, employment_label: "Testovací uživatel · Denní provoz", locked: false, attendance_locked: false, shift_plan_locked: false, shift_plan_editable: true, days });
      }
      if (path === "/api/v1/shift-plan") {
        const payload = JSON.parse(String(init?.body ?? "{}")) as { arrival_time: string | null };
        days[0].planned_arrival_time = payload.arrival_time;
        return jsonResponse({ ok: true });
      }
      throw new Error(`Unhandled fetch ${path}`);
    });

    const user = userEvent.setup();
    renderEmployeePage();

    await user.click(await screen.findByRole("tab", { name: "Plán služeb" }));
    const plannedArrival = await screen.findByDisplayValue("08:00");
    await user.click(plannedArrival);
    await user.keyboard("{Delete}7{Backspace}{Escape}");

    await waitFor(() => {
      const payloads = calls.filter((call) => call.path === "/api/v1/shift-plan").map((call) => JSON.parse(call.body ?? "{}"));
      expect(payloads).toContainEqual(expect.objectContaining({
        employment_id: 41,
        date: "2026-07-01",
        arrival_time: null,
        departure_time: "16:00",
        status: null,
      }));
    });
    await waitFor(() => expect((document.querySelector('input[name="planned_arrival_time"]') as HTMLInputElement | null)?.value).toBe(""));
  });
});
