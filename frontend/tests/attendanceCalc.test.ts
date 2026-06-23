import { describe, expect, it } from "vitest";
import { computeMonthStats } from "../src/utils/attendanceCalc";

describe("attendanceCalc", () => {
  it("zapocte dovolenou do mesicniho souctu jako 8 hodin", () => {
    const stats = computeMonthStats(
      [
        {
          date: "2026-04-01",
          arrival_time: "08:00",
          departure_time: "16:30",
          planned_status: null,
        },
        {
          date: "2026-04-02",
          arrival_time: null,
          departure_time: null,
          planned_status: "HOLIDAY",
        },
      ],
      "HPP",
      17 * 60,
    );

    expect(stats.holidayMins).toBe(8 * 60);
    expect(stats.totalMins).toBe((8 * 60) + (8 * 60));
  });
});
