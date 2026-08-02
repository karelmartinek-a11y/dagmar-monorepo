import { describe, expect, it } from "vitest";
import type { AttendanceEvent } from "../src/api/types";
import { plannedHintForEvent } from "../src/utils/plannedEventHint";

function event(id: number, eventType: "IN" | "OUT"): AttendanceEvent {
  return {
    id,
    employment_id: 7,
    occurred_at: `2026-08-01T0${id}:00:00+02:00`,
    event_type: eventType,
  };
}

describe("planned event hints", () => {
  it("keeps carryover and direct-shift departures distinct", () => {
    const day = {
      events: [event(1, "OUT"), event(2, "IN"), event(3, "OUT")],
      planned_arrival_time: "08:00",
      planned_departure_time: "16:00",
      planned_carryover_departure_time: "02:00",
    };

    expect(plannedHintForEvent(day, 0)).toBe("02:00");
    expect(plannedHintForEvent(day, 1)).toBe("08:00");
    expect(plannedHintForEvent(day, 2)).toBe("16:00");
  });

  it("uses the direct departure when attendance starts inside the day", () => {
    const day = {
      events: [event(1, "IN"), event(2, "OUT")],
      planned_arrival_time: "08:00",
      planned_departure_time: "16:00",
      planned_carryover_departure_time: "02:00",
    };

    expect(plannedHintForEvent(day, 1)).toBe("16:00");
  });
});
