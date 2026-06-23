import { describe, expect, it } from "vitest";
import { isValidTimeOrEmpty, normalizeTime } from "../src/utils/timeInput";

describe("timeInput utils", () => {
  it("normalizuje bezne vstupy casu", () => {
    expect(normalizeTime("7")).toBe("07:00");
    expect(normalizeTime("730")).toBe("730");
    expect(normalizeTime("0730")).toBe("07:30");
    expect(normalizeTime("7:30")).toBe("07:30");
    expect(normalizeTime("  ")).toBe("");
  });

  it("rozpozna validni a nevalidni cas", () => {
    expect(isValidTimeOrEmpty("")).toBe(true);
    expect(isValidTimeOrEmpty("7")).toBe(true);
    expect(isValidTimeOrEmpty("23:59")).toBe(true);
    expect(isValidTimeOrEmpty("24:00")).toBe(false);
    expect(isValidTimeOrEmpty("ab:cd")).toBe(false);
  });
});
