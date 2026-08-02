import { describe, expect, it } from "vitest";
import { reconcileSelectedGroup } from "../src/utils/groupSelection";

describe("employee group month selection", () => {
  it("clears a group that is unavailable in the newly selected month", () => {
    expect(reconcileSelectedGroup(7, [{ id: 8 }, { id: 9 }])).toBeNull();
  });

  it("keeps an available group and selects a sole option", () => {
    expect(reconcileSelectedGroup(8, [{ id: 8 }])).toBe(8);
    expect(reconcileSelectedGroup(null, [{ id: 9 }])).toBe(9);
  });
});
