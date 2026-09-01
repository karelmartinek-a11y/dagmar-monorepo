import { describe, expect, it } from "vitest";
import {
  chronologicalPlanBoundaries,
  edgeEvents,
  humanEventHeaders,
  isPrintCapacityExceeded,
  maxEventColumns,
} from "../src/utils/presentationAdapters";

describe("presentation adapters", () => {
  it("uses one stable event-column geometry for the whole month", () => {
    expect(maxEventColumns([{ events: [] }, { events: [{ id: 1 } as never] }])).toBe(4);
    expect(maxEventColumns([{ events: Array.from({ length: 6 }, () => ({}) as never) }])).toBe(6);
  });

  it("keeps edge IDs and counts middle events without losing them", () => {
    expect(edgeEvents([11, 22, 33, 44])).toEqual({ first: 11, last: 44, middleCount: 2 });
    expect(edgeEvents([11])).toEqual({ first: 11, last: undefined, middleCount: 0 });
  });

  it("builds neutral human headers", () => {
    expect(humanEventHeaders(3)).toEqual(["PRŮCHOD 1", "PRŮCHOD 2", "PRŮCHOD 3"]);
  });

  it("returns only same-day plan boundaries", () => {
    expect(
      chronologicalPlanBoundaries({
        planned_arrival_time: "22:00",
        planned_departure_time: "23:00",
      }),
    ).toEqual(["22:00", "23:00"]);
  });

  it("rejects print data outside the approved capacity envelope", () => {
    expect(isPrintCapacityExceeded(31, 4, ["total", "afternoon", "night", "weekend", "public_holiday"])).toBe(false);
    expect(isPrintCapacityExceeded(31, 5, ["total"])).toBe(true);
  });
});
