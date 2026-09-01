import type { AttendanceDay } from "../api/types";

type PlannedHintDay = Pick<
  AttendanceDay,
  "events" | "planned_arrival_time" | "planned_departure_time"
>;

export function plannedHintForEvent(
  day: PlannedHintDay,
  eventIndex: number,
): string | null {
  const event = day.events[eventIndex];
  if (!event) return null;
  return eventIndex % 2 === 0
    ? day.planned_arrival_time ?? null
    : day.planned_departure_time ?? null;
}
