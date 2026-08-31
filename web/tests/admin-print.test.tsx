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
                    },
                  ],
                  worked: {
                        total: { minutes: 630, tenths: 105, hours: 10.5, clock: "10:30" },
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
    expect(screen.getByText("MĚSÍČNÍ DOCHÁZKOVÝ LIST")).toBeInTheDocument();
    const sheet = screen.getByTestId("print-attendance-sheet-22");
    const identity = sheet.querySelector<HTMLElement>(".print-form__identity");
    if (!identity) throw new Error("print identity block is missing");
    expect(identity).toHaveTextContent("Bendová Klára");
    expect(identity).toHaveTextContent("Pracovní smlouva");
    expect(screen.getByText("12:00")).toBeInTheDocument();
    expect(screen.getAllByText("10:30")).toHaveLength(3);
    expect(screen.getByText("So")).toBeInTheDocument();
    expect(screen.getByText("NEM")).toBeInTheDocument();
    expect(
      screen.getByText("Den slovanských věrozvěstů Cyrila a Metoděje"),
    ).toBeInTheDocument();
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
