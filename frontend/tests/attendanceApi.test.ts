import { afterEach, describe, expect, it, vi } from "vitest";
import { getAttendanceMonth, upsertAttendance } from "../src/api/attendance";

describe("attendance API fallback", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  Object.defineProperty(globalThis, "window", {
    value: {
      location: {
        origin: "https://dagmar.hcasc.cz",
      },
    },
    configurable: true,
  });

  it("po 401 zopakuje načtení docházky bez Authorization hlavičky", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "HTTP 401" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ days: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const result = await getAttendanceMonth({
      employmentId: 17,
      year: 2026,
      month: 4,
      instanceToken: "portal-token",
    });

    expect(result).toEqual({ days: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    const secondHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;

    expect(firstHeaders.Authorization).toBe("Bearer portal-token");
    expect(secondHeaders.Authorization).toBeUndefined();
  });

  it("po 401 zopakuje uložení docházky bez Authorization hlavičky", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "HTTP 401" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const result = await upsertAttendance({
      instanceToken: "portal-token",
      body: {
        employment_id: 17,
        date: "2026-04-01",
        arrival_time: "08:00",
        departure_time: "16:00",
      },
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    const secondHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;

    expect(firstHeaders.Authorization).toBe("Bearer portal-token");
    expect(secondHeaders.Authorization).toBeUndefined();
  });
});
