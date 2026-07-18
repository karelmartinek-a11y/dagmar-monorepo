import { describe, expect, it } from "vitest";
import { asPragueDate, getCalendarDayInfo, getHolidayLabel } from "../src/utils/calendar";

describe("localized employee calendars", () => {
  it.each([
    ["cs", "2026-12-24", "Adam", "Štědrý den"],
    ["sk", "2024-02-29", "Radomír", null],
    ["de", "2026-07-18", "Arnold", null],
    ["en", "2026-02-10", "Scholastica", null],
  ] as const)("resolves the pinned %s observance", (language, iso, expectedObservance, expectedHoliday) => {
    const info = getCalendarDayInfo(asPragueDate(iso), language);
    expect(info.observance?.items.join(" ")).toContain(expectedObservance);
    expect(info.publicHoliday?.label ?? null).toBe(expectedHoliday);
  });

  it("does not invent Hindi namedays but translates Czech public holidays", () => {
    const info = getCalendarDayInfo(asPragueDate("2026-05-08"), "hi");
    expect(info.observance).toBeNull();
    expect(info.publicHoliday?.label).toBe("विजय दिवस");
  });

  it("keeps the selected English commemoration calendar complete from January", () => {
    const info = getCalendarDayInfo(asPragueDate("2026-01-10"), "en");
    expect(info.observance?.kind).toBe("commemoration");
    expect(info.observance?.items.join(" ")).toContain("William Laud");
  });

  it("keeps namedays and public holidays as independent data", () => {
    const info = getCalendarDayInfo(asPragueDate("2026-12-24"), "cs");
    expect(info.observance?.items).toEqual(["Adam", "Eva"]);
    expect(info.publicHoliday?.label).toBe("Štědrý den");
  });

  it("calculates both moving Easter holidays", () => {
    expect(getHolidayLabel(asPragueDate("2026-04-03"), "en")).toBe("Good Friday");
    expect(getHolidayLabel(asPragueDate("2026-04-06"), "de")).toBe("Ostermontag");
  });

  it("parses ISO calendar parts without a local-midnight date shift", () => {
    const value = asPragueDate("2026-01-01");
    expect(value.getUTCFullYear()).toBe(2026);
    expect(value.getUTCMonth()).toBe(0);
    expect(value.getUTCDate()).toBe(1);
  });
});
