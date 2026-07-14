import { describe, expect, it, vi } from "vitest";
import { api, request, setPortalToken } from "../src/api/client";

describe("API auth boundaries", () => {
  it("sends the employee token only in portal mode", async () => {
    setPortalToken("employee-test-token");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
    await request("/api/v1/attendance", {}, "portal");
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer employee-test-token");
  });

  it("normalizes backend errors and request IDs", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ detail: "Konflikt dat" }), { status: 409, headers: { "content-type": "application/json", "x-request-id": "req-1" } }));
    await expect(api.saveAttendance({})).rejects.toMatchObject({ status: 409, requestId: "req-1", conflict: true });
  });

  it("marks network failures as offline", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network"));
    await expect(request("/api/v1/time")).rejects.toMatchObject({ status: 0, code: "offline" });
  });
});
