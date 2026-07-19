import "fake-indexeddb/auto";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { App } from "../src/App";
import { normalizeAdminNextPath } from "../src/utils/adminAuth";

function jsonResponse(payload: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(payload), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

function renderAdminApp(initialEntry: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function LocationProbe() {
    const location = useLocation();
    return <output aria-label="Aktuální cesta">{location.pathname + location.search}</output>;
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <LocationProbe />
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("admin authentication flow", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refetches admin session after login from /admin and lands on /admin/prehled", async () => {
    let authenticated = false;
    const meCalls: string[] = [];
    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(String(input), window.location.origin);
      if (url.pathname === "/api/v1/admin/me") {
        meCalls.push(url.pathname);
        return jsonResponse({ authenticated, username: authenticated ? "provoz@hotelchodovasc.cz" : null });
      }
      if (url.pathname === "/api/v1/admin/csrf") return jsonResponse({ csrf_token: "csrf-token" });
      if (url.pathname === "/api/v1/admin/login" && init?.method === "POST") {
        authenticated = true;
        return jsonResponse({ ok: true, csrf_token: "csrf-token" });
      }
      if (url.pathname === "/api/v1/admin/users") return jsonResponse({ users: [] });
      if (url.pathname === "/api/v1/admin/integrations/clients") return jsonResponse([]);
      if (url.pathname === "/api/version") return jsonResponse({ backend_deploy_tag: "test", environment: "test" });
      throw new Error(`Unhandled fetch ${url.pathname}`);
    });

    const user = userEvent.setup();
    renderAdminApp("/admin");

    await screen.findByRole("heading", { name: "Vstup do administrace" });
    expect(screen.getByLabelText("Aktuální cesta")).toHaveTextContent("/admin/login?next=%2Fadmin");

    await user.type(screen.getByLabelText("Přihlašovací jméno administrátora"), "provoz@hotelchodovasc.cz");
    await user.type(screen.getByLabelText("Heslo"), "StrongPass123");
    await user.click(screen.getByRole("button", { name: "Přihlásit do administrace" }));

    await screen.findByRole("heading", { name: "Přehled systému" });
    expect(screen.getByLabelText("Aktuální cesta")).toHaveTextContent("/admin/prehled");
    expect(screen.queryByRole("heading", { name: "Vstup do administrace" })).not.toBeInTheDocument();
    expect(meCalls).toHaveLength(2);
  });

  it("uses /admin/prehled after login without next", async () => {
    let authenticated = false;
    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(String(input), window.location.origin);
      if (url.pathname === "/api/v1/admin/me") {
        return jsonResponse({ authenticated, username: authenticated ? "provoz@hotelchodovasc.cz" : null });
      }
      if (url.pathname === "/api/v1/admin/csrf") return jsonResponse({ csrf_token: "csrf-token" });
      if (url.pathname === "/api/v1/admin/login" && init?.method === "POST") {
        authenticated = true;
        return jsonResponse({ ok: true, csrf_token: "csrf-token" });
      }
      if (url.pathname === "/api/v1/admin/users") return jsonResponse({ users: [] });
      if (url.pathname === "/api/v1/admin/integrations/clients") return jsonResponse([]);
      if (url.pathname === "/api/version") return jsonResponse({ backend_deploy_tag: "test", environment: "test" });
      throw new Error(`Unhandled fetch ${url.pathname}`);
    });

    const user = userEvent.setup();
    renderAdminApp("/admin/login");

    await user.type(await screen.findByLabelText("Přihlašovací jméno administrátora"), "provoz@hotelchodovasc.cz");
    await user.type(screen.getByLabelText("Heslo"), "StrongPass123");
    await user.click(screen.getByRole("button", { name: "Přihlásit do administrace" }));

    await screen.findByRole("heading", { name: "Přehled systému" });
    expect(screen.getByLabelText("Aktuální cesta")).toHaveTextContent("/admin/prehled");
  });

  it("opens protected admin overview directly with a valid session", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input), window.location.origin);
      if (url.pathname === "/api/v1/admin/me") return jsonResponse({ authenticated: true, username: "provoz@hotelchodovasc.cz" });
      if (url.pathname === "/api/v1/admin/users") return jsonResponse({ users: [] });
      if (url.pathname === "/api/v1/admin/integrations/clients") return jsonResponse([]);
      if (url.pathname === "/api/version") return jsonResponse({ backend_deploy_tag: "test", environment: "test" });
      throw new Error(`Unhandled fetch ${url.pathname}`);
    });

    renderAdminApp("/admin/prehled");

    await screen.findByRole("heading", { name: "Přehled systému" });
    expect(screen.getByLabelText("Aktuální cesta")).toHaveTextContent("/admin/prehled");
  });

  it("redirects protected admin overview without session to login with an internal next", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input), window.location.origin);
      if (url.pathname === "/api/v1/admin/me") return jsonResponse({ authenticated: false, username: null });
      throw new Error(`Unhandled fetch ${url.pathname}`);
    });

    renderAdminApp("/admin/prehled");

    await screen.findByRole("heading", { name: "Vstup do administrace" });
    expect(screen.getByLabelText("Aktuální cesta")).toHaveTextContent("/admin/login?next=%2Fadmin%2Fprehled");
  });

  it("falls back to /admin/prehled for unsafe next values", async () => {
    expect(normalizeAdminNextPath("https://evil.example/admin/prehled")).toBe("/admin/prehled");
    expect(normalizeAdminNextPath("//evil.example/admin/prehled")).toBe("/admin/prehled");
    expect(normalizeAdminNextPath("/app")).toBe("/admin/prehled");
    expect(normalizeAdminNextPath("/admin/login?next=%2Fadmin%2Fprehled")).toBe("/admin/prehled");
    expect(normalizeAdminNextPath("/admin/users?month=2026-07#top")).toBe("/admin/users?month=2026-07#top");
  });

  it("shows Czech error for invalid admin credentials and stays on login", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(String(input), window.location.origin);
      if (url.pathname === "/api/v1/admin/csrf") return jsonResponse({ csrf_token: "csrf-token" });
      if (url.pathname === "/api/v1/admin/login" && init?.method === "POST") {
        return jsonResponse({ detail: { code: "admin_login_invalid_credentials", message: "Neplatné přihlašovací údaje" } }, { status: 401 });
      }
      throw new Error(`Unhandled fetch ${url.pathname}`);
    });

    const user = userEvent.setup();
    renderAdminApp("/admin/login?next=%2Fadmin%2Fprehled");

    await user.type(await screen.findByLabelText("Přihlašovací jméno administrátora"), "provoz@hotelchodovasc.cz");
    await user.type(screen.getByLabelText("Heslo"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Přihlásit do administrace" }));

    expect(await screen.findByText("Neplatné přihlašovací údaje.")).toBeInTheDocument();
    expect(screen.getByLabelText("Aktuální cesta")).toHaveTextContent("/admin/login?next=%2Fadmin%2Fprehled");
  });
});
