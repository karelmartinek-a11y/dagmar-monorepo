import { describe, expect, it } from "vitest";
import { planStatusInputPlaceholder, planStatusLabel } from "../src/utils/planStatus";

describe("planStatus helpers", () => {
  it("vraci cesky popisek pro dovolenou a volno", () => {
    expect(planStatusLabel("HOLIDAY")).toBe("dovolená");
    expect(planStatusLabel("OFF")).toBe("volno");
    expect(planStatusLabel(null)).toBeNull();
  });

  it("vraci uppercase placeholder pro input pole", () => {
    expect(planStatusInputPlaceholder("HOLIDAY")).toBe("DOVOLENÁ");
    expect(planStatusInputPlaceholder("OFF")).toBe("VOLNO");
    expect(planStatusInputPlaceholder(undefined)).toBeNull();
  });
});
