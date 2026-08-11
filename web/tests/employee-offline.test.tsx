import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmployeePage } from "../src/pages/EmployeePage";

describe("employee offline state", () => {
  beforeEach(() => localStorage.clear());

  it("renders a dedicated offline message for failed month requests", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/v1/portal/session") {
        return new Response(JSON.stringify({
          display_name: "Offline uživatel",
          employment_id: 1,
          available_employments: [{
            id: 1,
            title: "Testovací úvazek",
            employment_type: "DPP_DPC",
            start_date: "2026-01-01",
            is_active: true,
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new TypeError("offline");
    }));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <EmployeePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Jste offline")).toBeInTheDocument();
  });
});
