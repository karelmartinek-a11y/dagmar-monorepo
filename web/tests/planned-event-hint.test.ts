import { describe, expect, it } from "vitest";
import type { AttendanceEvent } from "../src/api/types";
import { plannedHintForEvent } from "../src/utils/plannedEventHint";

function event(id: number): AttendanceEvent {
  return {
    id,
    employment_id: 7,
    occurred_at: `2026-08-01T0${id}:00:00+02:00`,
  };
}

describe("planned event hints", () => {
  it("maps hints by chronological position", () => {
    const day = {
      events: [event(1), event(2)],
      planned_arrival_time: "08:00",
      planned_departure_time: "16:00",
    };

    expect(plannedHintForEvent(day, 0)).toBe("08:00");
    expect(plannedHintForEvent(day, 1)).toBe("16:00");
  });

  it("uses the direct departure when attendance starts inside the day", () => {
    const day = {
      events: [event(1), event(2)],
      planned_arrival_time: "08:00",
      planned_departure_time: "16:00",
    };

    expect(plannedHintForEvent(day, 1)).toBe("16:00");
  });
});
