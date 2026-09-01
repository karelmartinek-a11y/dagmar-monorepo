import type { AttendanceDay, AttendanceEvent, MetricKey } from "../api/types";

export type ChronologicalEvent = {
  id: number;
  time: string;
  event: AttendanceEvent;
};

export function maxEventColumns(days: Pick<AttendanceDay, "events">[]): number {
  return Math.max(4, ...days.map((day) => day.events.length));
}

export function chronologicalEvents(
  day: Pick<AttendanceDay, "events">,
  formatTime: (event: AttendanceEvent) => string,
): ChronologicalEvent[] {
  return [...day.events]
    .sort((left, right) => left.occurred_at.localeCompare(right.occurred_at))
    .map((event) => ({ id: event.id, time: formatTime(event), event }));
}

export function firstAppendPosition(events: readonly unknown[]): number {
  return events.length;
}

export function isEditableAppendPosition(
  position: number,
  eventCount: number,
): boolean {
  return position === firstAppendPosition(Array.from({ length: eventCount }));
}

export function edgeEvents<T>(events: readonly T[]): {
  first: T | undefined;
  last: T | undefined;
  middleCount: number;
} {
  return {
    first: events[0],
    last: events.length > 1 ? events[events.length - 1] : undefined,
    middleCount: Math.max(0, events.length - 2),
  };
}

export function chronologicalPlanBoundaries(day: {
  planned_arrival_time?: string | null;
  planned_departure_time?: string | null;
  arrival_time?: string | null;
  departure_time?: string | null;
}): string[] {
  return [
    day.planned_arrival_time ?? day.arrival_time,
    day.planned_departure_time ?? day.departure_time,
  ].filter((value): value is string => Boolean(value));
}

export function formatPragueTime(value: string | Date): string {
  return new Intl.DateTimeFormat("cs-CZ", {
    timeZone: "Europe/Prague",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(typeof value === "string" ? new Date(value) : value);
}

export function humanEventHeaders(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `PRŮCHOD ${index + 1}`);
}

export function attendancePrintLayout(maxEventsPerDay: number) {
  return {
    landscape: true,
    eventColumns: 8,
    capacityExceeded: maxEventsPerDay > 8,
  };
}

export function isPrintCapacityExceeded(
  daysInMonth: number,
  maxEventsPerDay: number,
  displayMetrics: readonly MetricKey[],
  options: { maxDays?: number; maxEvents?: number; maxMetrics?: number } = {},
): boolean {
  return (
    daysInMonth > (options.maxDays ?? 31) ||
    maxEventsPerDay > (options.maxEvents ?? 4) ||
    displayMetrics.length > (options.maxMetrics ?? 5)
  );
}
