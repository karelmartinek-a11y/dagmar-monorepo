import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminPrintPreviewPage } from "../src/pages/AdminOperationsPages";

function renderPreview() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={[
          "/admin/tisky/preview?month=2026-07&type=attendance&kind=detail&employments=22",
        ]}
      >
        <AdminPrintPreviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("attendance print layout", () => {
  it("keeps four pass columns, units, weekdays, and calendar tones", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
              JSON.stringify({
              data: [
                {
                  employment_id: 22,
                  employment_label: "Bendová Klára — pokojská",
                  user_id: 7,
                  user_name: "Bendová Klára",
                  employment_title: "pokojská",
                  employment_type: "WORK_CONTRACT",
                  start_date: "2026-01-01",
                  end_date: null,
                  is_active_in_month: true,
                  display_metrics: ["total"],
                  days: [
                    {
                      date: "2026-07-05",
                      calendar_tone: "holiday",
                      public_holiday_label:
                        "Den slovanských věrozvěstů Cyrila a Metoděje",
                      events: [
                        {
                          id: 1,
                          employment_id: 22,
                          occurred_at: "2026-07-05T08:00:00+02:00",
                          event_type: "IN",
                        },
                        {
                          id: 2,
                          employment_id: 22,
                          occurred_at: "2026-07-05T12:00:00+02:00",
                          event_type: "OUT",
                        },
                        {
                          id: 3,
                          employment_id: 22,
                          occurred_at: "2026-07-05T12:30:00+02:00",
                          event_type: "IN",
                        },
                        {
                          id: 4,
                          employment_id: 22,
                          occurred_at: "2026-07-05T19:00:00+02:00",
                          event_type: "OUT",
                        },
                      ],
                      worked: {
                        total: { minutes: 630, tenths: 105, hours: 10.5, clock: "10:30" },
                        afternoon: null,
                        night: null,
                        weekend: null,
                        public_holiday: null,
                      },
                      status_metrics: { holiday: null, sickness: null, paragraph: null },
                    },
                    {
                      date: "2026-07-06",
                      calendar_tone: "holiday",
                      public_holiday_label: "Den upálení mistra Jana Husa",
                      attendance_status: "SICKNESS",
                      effective_status: "SICKNESS",
                      events: [],
                      worked: {
                        total: null,
                        afternoon: null,
                        night: null,
                        weekend: null,
                        public_holiday: null,
                      },
                      status_metrics: {
                        holiday: null,
                        sickness: { minutes: 480, tenths: 80, hours: 8, clock: "8:00" },
                        paragraph: null,
                      },
                    },
                    {
                      date: "2026-07-18",
                      calendar_tone: "weekend",
                      public_holiday_label: null,
                      events: [],
                      worked: {
                        total: null,
                        afternoon: null,
                        night: null,
                        weekend: null,
                        public_holiday: null,
                      },
                      status_metrics: { holiday: null, sickness: null, paragraph: null },
                    },
                  ],
                  worked: {
                        total: { minutes: 630, tenths: 105, hours: 10.5, clock: "10:30" },
                    afternoon: null,
                    night: null,
                    weekend: null,
                    public_holiday: null,
                  },
                  status_metrics: {
                    holiday: null,
                    sickness: { minutes: 480, tenths: 80, hours: 8, clock: "8:00" },
                    paragraph: null,
                  },
                  planned: {
                    total: { minutes: 480, tenths: 80, hours: 8, clock: "8:00" },
                    afternoon: null,
                    night: null,
                    weekend: null,
                    public_holiday: null,
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    renderPreview();

    expect(
      await screen.findByRole("columnheader", { name: "PRŮCHOD 4" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Den" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Den v týdnu" })).toBeInTheDocument();
    expect(screen.getByText("ČERVENEC 2026")).toBeInTheDocument();
    expect(screen.getByText("MĚSÍČNÍ DOCHÁZKOVÝ LIST")).toBeInTheDocument();
    expect(screen.queryByText(/Evidence pracovní doby/)).not.toBeInTheDocument();
    const sheet = screen.getByTestId("print-attendance-sheet-22");
    expect(sheet.querySelector(".print-form__brand")).toHaveTextContent("Bendová Klára");
    expect(sheet.querySelector(".print-form__brand small")).not.toBeInTheDocument();
    const identity = sheet.querySelector<HTMLElement>(".print-form__identity");
    if (!identity) throw new Error("print identity block is missing");
    expect(identity).not.toHaveTextContent("Bendová Klára");
    expect(identity).toHaveTextContent("Pracovní smlouva");
    expect(identity).toHaveTextContent("Platnost úvazku od - do");
    expect(identity).toHaveTextContent("na dobu neurčitou");
    expect(identity.querySelector(".print-validity-open-ended")).toHaveTextContent("na dobu neurčitou");
    expect(identity).toHaveTextContent("Úvazek: pokojská");
    expect(screen.queryByText("Aktivní")).not.toBeInTheDocument();
    expect(screen.queryByText(/datum a podpis/)).not.toBeInTheDocument();
    expect(screen.getByText("Plán z kalendáře")).toBeInTheDocument();
    expect(
      screen.getByText(/Tento přehled vytiskla KájovoDagmar - Vaše virtuální asistentka \| Vzorový dokument \|/),
    ).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Odpoledne" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Celkem" })).toBeInTheDocument();
    expect(sheet.querySelectorAll(".print-attendance-total-value")).toHaveLength(5);
    expect(screen.getByRole("columnheader", { name: "Noční práce" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Práce o víkendu" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Práce ve svátku" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Kód / poznámka" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Kód / pozn." })).not.toBeInTheDocument();
    expect(screen.getByText("12:00")).toBeInTheDocument();
    expect(screen.getAllByText("10:30")).toHaveLength(3);
    expect(screen.getByText("So")).toBeInTheDocument();
    expect(screen.getByText(/NEM/)).toBeInTheDocument();
    expect(screen.getByText("NEM 08:00")).toBeInTheDocument();
    expect(
      screen.getByText("PRÁCE · SVÁTEK"),
    ).toBeInTheDocument();
    expect(sheet.querySelectorAll(".print-attendance-table col")).toHaveLength(12);
    expect(screen.queryByText("—")).not.toBeInTheDocument();
    expect(screen.getByTestId("print-attendance-sheet-22").querySelector('[data-date="2026-07-05"]')).toHaveClass(
      "print-day--holiday",
    );
    expect(screen.getByTestId("print-attendance-sheet-22").querySelector('[data-date="2026-07-06"]')).toHaveClass(
      "print-day--holiday",
    );
    expect(screen.getByTestId("print-attendance-sheet-22").querySelector('[data-date="2026-07-18"]')).toHaveClass(
      "print-day--weekend",
    );
    expect(screen.queryByText(/Příchod|Odchod/)).not.toBeInTheDocument();
  });
});
