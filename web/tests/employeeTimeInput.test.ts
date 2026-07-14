import { describe, expect, it } from "vitest";
import { normalizeTimeInput } from "../src/utils/timeInput";

describe("employee attendance time input", () => {
  it.each([
    ["1535", "15:35"],
    ["8", "08:00"],
    ["10", "10:00"],
    ["11", "11:00"],
    ["7.45", "07:45"],
    ["", ""],
  ])("normalizes %s to %s", (raw, normalized) => {
    expect(normalizeTimeInput(raw)).toBe(normalized);
  });

  it.each(["2460", "12:90", "abcd", "12345"])("rejects invalid time %s", (raw) => {
    expect(normalizeTimeInput(raw)).toBeNull();
  });
});
