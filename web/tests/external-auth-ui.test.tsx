import "fake-indexeddb/auto";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountMethods } from "../src/components/AccountMethods";
import { AdminLoginPage } from "../src/pages/AuthPages";
import { EmployeePage } from "../src/pages/EmployeePage";

function renderApp(node: React.ReactNode, path = "/app") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}>{node}</MemoryRouter></QueryClientProvider>);
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("external authentication UI", () => {
  it("keeps employee password login and shows both configured provider buttons", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ google: true, apple: true }), { status: 200, headers: { "Content-Type": "application/json" } })));
    renderApp(<EmployeePage />);
    expect(screen.getByLabelText("Pracovní e-mail")).toBeInTheDocument();
    expect(screen.getByLabelText("Heslo")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Přihlásit se přes Google" })).toHaveAttribute("href", expect.stringContaining("/api/v1/auth/employee/google/start"));
    expect(screen.getByRole("link", { name: "Přihlásit se přes Apple" })).toBeInTheDocument();
    expect(screen.getByText("Pouze pro předem propojené účty")).toBeInTheDocument();
  });

  it("keeps admin password login and disables providers without server configuration", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ google: false, apple: false }), { status: 200, headers: { "Content-Type": "application/json" } })));
    renderApp(<AdminLoginPage />, "/admin/login");
    expect(screen.getByLabelText("Přihlašovací jméno administrátora")).toBeInTheDocument();
    expect(screen.getByLabelText("Heslo")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Přihlásit se přes Google" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Přihlásit se přes Apple" })).toBeDisabled();
  });

  it("requires a password before link and shows masked linked identity", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      password_enabled: true,
      methods: [
        { provider: "google", enabled: true, linked: false, identifier: null, linked_at: null, last_login_at: null },
        { provider: "apple", enabled: true, linked: true, identifier: "re…@privaterelay.appleid.com", linked_at: "2026-07-18T10:00:00Z", last_login_at: null },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    renderApp(<AccountMethods portal="employee" />);
    expect(await screen.findByText("re…@privaterelay.appleid.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Propojit/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Odpojit/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Aktuální interní heslo"), { target: { value: "fresh-password" } });
    expect(screen.getByRole("button", { name: /Propojit/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Odpojit/ })).toBeEnabled();
  });
});
