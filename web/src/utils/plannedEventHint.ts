import type { AttendanceDay } from "../api/types";

type PlannedHintDay = Pick<
  AttendanceDay,
  | "events"
  | "planned_arrival_time"
  | "planned_departure_time"
  | "planned_carryover_departure_time"
>;

export function plannedHintForEvent(
  day: PlannedHintDay,
  eventIndex: number,
): string | null {
  const event = day.events[eventIndex];
  if (!event) return null;
  if (event.event_type === "IN") return day.planned_arrival_time ?? null;
  if (eventIndex === 0 && day.planned_carryover_departure_time) {
    return day.planned_carryover_departure_time;
  }
  return day.planned_departure_time ?? null;
}
