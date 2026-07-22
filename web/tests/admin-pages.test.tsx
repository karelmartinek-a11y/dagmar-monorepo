import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminAttendancePage, AdminShiftPlanPage } from "../src/pages/AdminMatrixPages";
import { AdminPrintPreviewPage, AdminSettingsPage } from "../src/pages/AdminOperationsPages";

function jsonResponse(payload: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(payload), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

function renderWithProviders(ui: ReactNode, initialEntries = ["/"]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="*" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("admin pages", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("print", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("locks only attendance employments that overlap the selected range and closes the dialog on success", async () => {
    const calls: Array<{ path: string; body?: string | null }> = [];
    let firstEmploymentLocked = false;
    fetchMock.mockImplementation(async (input, init) => {
      const path = String(input);
      calls.push({ path, body: typeof init?.body === "string" ? init.body : null });
      if (path.startsWith("/api/v1/admin/attendance/month?")) {
        return jsonResponse({
          year: 2026,
          month: 7,
          rows: [
            {
              employment_id: 1,
              user_name: "Aktivní",
              employment_label: "Aktivní úvazek",
              employment_type: "HPP",
              start_date: "2026-01-01",
              end_date: null,
              is_active_in_month: true,
              locked: firstEmploymentLocked,
              attendance_locked: firstEmploymentLocked,
              shift_plan_locked: false,
              days: [{ date: "2026-07-01", arrival_time: "08:00", departure_time: "16:00", planned_status: null, is_within_employment_period: true }],
            },
            {
              employment_id: 2,
              user_name: "Neaktivní",
              employment_label: "Neaktivní úvazek",
              employment_type: "DPP",
              start_date: "2025-01-01",
              end_date: "2026-06-30",
              is_active_in_month: false,
              locked: false,
              attendance_locked: false,
              shift_plan_locked: false,
              days: [{ date: "2026-07-01", arrival_time: null, departure_time: null, planned_status: null, is_within_employment_period: false }],
            },
          ],
        });
      }
      if (path === "/api/v1/admin/csrf") return jsonResponse({ csrf_token: "csrf-token" });
      if (path === "/api/v1/admin/locks") {
        const payload = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
        if (payload.employment_ids.includes(1)) firstEmploymentLocked = Boolean(payload.locked);
        return jsonResponse({
          ok: true,
          updated_count: 1,
          lock_type: payload.lock_type,
          year: 2026,
          month: 7,
          locked: payload.locked,
          month_count: 1,
          months: payload.months,
        });
      }
      throw new Error(`Unhandled fetch ${path}`);
    });

    const user = userEvent.setup();
    renderWithProviders(<AdminAttendancePage />);

    await screen.findByRole("button", { name: "Uzamknout všechny úvazky v měsíci" });
    expect(screen.getByRole("button", { name: "Uzamknout všechny úvazky v měsíci" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /2 úvazků ve výběru/i }));
    await user.click(screen.getByRole("button", { name: "Zobrazit jen aktivní úvazky" }));
    expect(screen.getAllByText("Aktivní úvazek").length).toBeGreaterThan(0);
    expect(screen.queryByText("Neaktivní úvazek")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Uzamknout všechny úvazky v měsíci" }));
    await user.click(await screen.findByRole("button", { name: "Uzamknout vybrané měsíce" }));

    await waitFor(() => {
      const payloads = calls
        .filter((call) => call.path === "/api/v1/admin/locks")
        .map((call) => JSON.parse(call.body ?? "{}"));
      expect(payloads).toContainEqual(expect.objectContaining({
        employment_ids: [1],
        lock_type: "attendance",
        locked: true,
        months: [{ year: 2026, month: 7 }],
      }));
    });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Uzamknout vybrané měsíce" })).not.toBeInTheDocument());
    expect(await screen.findByText(/Uzamčení bylo provedeno pro 1 měsíčních zámků/i)).toBeInTheDocument();
    expect((await screen.findAllByRole("button", { name: /Aktivní úvazek: uzamčeno, kliknutím odemknete/i })).length).toBeGreaterThan(0);
  });

  it("shows SMTP test progress and success target in Czech", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const path = String(input);
      if (path === "/api/v1/admin/settings") return jsonResponse({ afternoon_cutoff: "12:00" });
      if (path === "/api/v1/admin/smtp") return jsonResponse({ host: "smtp.example.cz", port: 465, security: "SSL", username: "mailer", from_email: "noreply@example.cz", from_name: "Dagmar", password_set: true });
      if (path === "/api/version") return jsonResponse({ backend_deploy_tag: "test", environment: "test" });
      if (path === "/api/v1/admin/csrf") return jsonResponse({ csrf_token: "csrf-token" });
      if (path === "/api/v1/admin/smtp/test" && init?.method === "POST") {
        return jsonResponse({
          ok: true,
          target_email: "admin@example.cz",
          error: null,
          steps: [
            { key: "input_validation", label: "Validace vstupu", status: "success", detail: "Formulář je konzistentní." },
            { key: "connect", label: "Navázání spojení se serverem", status: "success", detail: "Server odpověděl." },
            { key: "send", label: "Odeslání na e-mail administrátora", status: "success", detail: "Zpráva byla předána SMTP serveru." },
          ],
        });
      }
      throw new Error(`Unhandled fetch ${path}`);
    });

    const user = userEvent.setup();
    renderWithProviders(<AdminSettingsPage />);

    await screen.findByDisplayValue("smtp.example.cz");
    await user.click(screen.getByRole("button", { name: "TEST" }));

    expect(await screen.findByRole("heading", { name: "SMTP test" })).toBeInTheDocument();
    expect(await screen.findByText(/Zpráva byla odeslána na admin@example.cz/i)).toBeInTheDocument();
    expect(screen.getByText("Validace vstupu")).toBeInTheDocument();
    expect(screen.getByText("Odeslání na e-mail administrátora")).toBeInTheDocument();
  });

  it("restores the original admin attendance time on Escape after an immediate Delete", async () => {
    const calls: Array<{ path: string; body?: string | null }> = [];
    fetchMock.mockImplementation(async (input, init) => {
      const path = String(input);
      calls.push({ path, body: typeof init?.body === "string" ? init.body : null });
      if (path.startsWith("/api/v1/admin/attendance/month?")) {
        return jsonResponse({
          year: 2026,
          month: 7,
          rows: [{
            employment_id: 17,
            user_id: 4,
            user_name: "Dagmar Kájová",
            employment_label: "Dagmar Kájová · HPP",
            employment_title: "Osobní asistence",
            employment_type: "HPP",
            user_is_active: true,
            employment_is_active: true,
            start_date: "2026-01-01",
            end_date: null,
            is_active_in_month: true,
            locked: false,
            attendance_locked: false,
            shift_plan_locked: false,
            days: [{ date: "2026-07-01", arrival_time: "08:00", departure_time: "16:00", planned_status: null, is_within_employment_period: true }],
          }],
        });
      }
      if (path === "/api/v1/admin/attendance") throw new Error("Admin attendance save should not be called");
      throw new Error(`Unhandled fetch ${path}`);
    });

    const user = userEvent.setup();
    renderWithProviders(<AdminAttendancePage />, ["/admin/dochazka?month=2026-07"]);

    await user.click((await screen.findByText("08:00")).closest("button") as HTMLButtonElement);
    const arrival = await screen.findByDisplayValue("08:00");
    await user.click(arrival);
    await user.keyboard("{Delete}{Escape}");

    expect(await screen.findByText("08:00")).toBeInTheDocument();
    expect(calls.filter((call) => call.path === "/api/v1/admin/attendance")).toHaveLength(0);
  });

  it("restores the original admin shift plan time on Escape after an immediate Delete", async () => {
    const calls: Array<{ path: string; body?: string | null }> = [];
    fetchMock.mockImplementation(async (input, init) => {
      const path = String(input);
      calls.push({ path, body: typeof init?.body === "string" ? init.body : null });
      if (path.startsWith("/api/v1/admin/shift-plan?")) {
        return jsonResponse({
          year: 2026,
          month: 7,
          employee_plan_edit_default: true,
          selected_employment_ids: [17],
          available_employments: [{ id: 17, display_label: "Dagmar Kájová · HPP", employment_type: "HPP", start_date: "2026-01-01", end_date: null, is_active_in_month: true }],
          rows: [{
            employment_id: 17,
            user_id: 4,
            user_name: "Dagmar Kájová",
            title: "Osobní asistence",
            employment_type: "HPP",
            display_label: "Dagmar Kájová · HPP",
            start_date: "2026-01-01",
            end_date: null,
            is_active_in_month: true,
            locked: false,
            attendance_locked: false,
            shift_plan_locked: false,
            employee_plan_edit_allowed: true,
            employee_plan_edit_override: null,
            days: [{ date: "2026-07-01", arrival_time: "08:00", departure_time: "16:00", status: null, is_within_employment_period: true }],
          }],
        });
      }
      if (path === "/api/v1/admin/shift-plan") throw new Error("Admin shift plan save should not be called");
      throw new Error(`Unhandled fetch ${path}`);
    });

    const user = userEvent.setup();
    renderWithProviders(<AdminShiftPlanPage />, ["/admin/plan-sluzeb?month=2026-07"]);

    await user.click((await screen.findByText("08:00")).closest("button") as HTMLButtonElement);
    const arrival = await screen.findByDisplayValue("08:00");
    await user.click(arrival);
    await user.keyboard("{Delete}{Escape}");

    expect(await screen.findByText("08:00")).toBeInTheDocument();
    expect(calls.filter((call) => call.path === "/api/v1/admin/shift-plan")).toHaveLength(0);
  });

  it("renders detail print preview as a payroll attendance sheet with footer note", async () => {
    fetchMock.mockImplementation(async (input) => {
      const path = String(input);
      if (path === "/api/v1/admin/attendance/month?year=2026&month=7") {
        return jsonResponse({
          year: 2026,
          month: 7,
          rows: [
            {
              employment_id: 17,
              user_name: "Dagmar Kájová",
              employment_label: "Dagmar Kájová · HPP",
              employment_title: "Osobní asistence",
              employment_type: "HPP",
              locked: false,
              attendance_locked: false,
              shift_plan_locked: false,
              days: [
                {
                  date: "2026-07-01",
                  arrival_time: "08:00",
                  departure_time: "16:00",
                  arrival_time_2: null,
                  departure_time_2: null,
                  planned_arrival_time: "08:00",
                  planned_departure_time: "16:00",
                  planned_status: null,
                  is_within_employment_period: true,
                },
              ],
            },
          ],
        });
      }
      if (path === "/api/v1/admin/shift-plan?year=2026&month=7") {
        return jsonResponse({
          year: 2026,
          month: 7,
          selected_employment_ids: [],
          rows: [
            {
              employment_id: 17,
              user_id: 4,
              user_name: "Dagmar Kájová",
              title: "Osobní asistence",
              employment_type: "HPP",
              display_label: "Dagmar Kájová · HPP",
              days: [{ date: "2026-07-01", arrival_time: "08:00", departure_time: "16:00", status: null }],
            },
          ],
        });
      }
      if (path === "/api/v1/admin/settings") return jsonResponse({ afternoon_cutoff: "12:00" });
      throw new Error(`Unhandled fetch ${path}`);
    });

    renderWithProviders(<AdminPrintPreviewPage />, ["/admin/tisky/preview?month=2026-07&kind=detail"]);

    expect(await screen.findByText("Osobní asistence")).toBeInTheDocument();
    expect(screen.getByText("Dagmar Kájová")).toBeInTheDocument();
    expect(screen.getByText("Docházkový list pro mzdový podklad")).toBeInTheDocument();
    expect(screen.getAllByText("Fond 8 h")).toHaveLength(2);
    expect(screen.getAllByText("Pauza").length).toBeGreaterThan(0);
    expect(screen.getByText("Rozdíl vůči fondu")).toBeInTheDocument();
    expect(screen.getByText("Sváteční hodiny")).toBeInTheDocument();
    expect(screen.getByText("Vytištěno Dagmar Kájovo osobní asistentkou")).toBeInTheDocument();
  });
});
