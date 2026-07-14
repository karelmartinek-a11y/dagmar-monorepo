import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { flushOperations, listOperations, queueOperation } from "../src/state/offlineQueue";

describe("offline queue", () => {
  it("preserves order and never replays another account's employment", async () => {
    const save = vi.spyOn(api, "saveAttendance").mockResolvedValue({ ok: true });
    await queueOperation({ kind: "attendance", employment_id: 41, payload: { employment_id: 41, date: "2026-07-01" } });

    const blocked = await flushOperations(new Set([99]));
    expect(blocked.completed).toBe(0);
    expect(blocked.blocked?.employment_id).toBe(41);
    expect(save).not.toHaveBeenCalled();
    expect(await listOperations()).toHaveLength(1);

    const replayed = await flushOperations(new Set([41]));
    expect(replayed).toEqual({ completed: 1, blocked: null });
    expect(save).toHaveBeenCalledOnce();
    expect(await listOperations()).toHaveLength(0);
  });
});
