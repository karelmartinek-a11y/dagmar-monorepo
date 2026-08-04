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
                        total: { hours: 10.5 },
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
                    total: { hours: 10.5 },
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
    expect(screen.getByText("12:00")).toBeInTheDocument();
    expect(screen.getAllByText("10,5 h")).toHaveLength(2);
    expect(screen.getByText("sobota")).toBeInTheDocument();
    expect(screen.getByText("Nemoc")).toBeInTheDocument();
    expect(
      screen.getByText("Den slovanských věrozvěstů Cyrila a Metoděje"),
    ).toBeInTheDocument();
    expect(screen.getByText("5. 7.").closest("tr")).toHaveClass(
      "print-day--holiday",
    );
    expect(screen.getByText("6. 7.").closest("tr")).toHaveClass(
      "print-day--holiday",
    );
    expect(screen.getByText("sobota").closest("tr")).toHaveClass(
      "print-day--weekend",
    );
  });
});
