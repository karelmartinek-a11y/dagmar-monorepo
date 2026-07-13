import { describe, expect, it } from "vitest";
import { upsertOfflineQueueItem, type QueueItem } from "../src/utils/offlineQueue";

function queueItem(date: string, arrival: string | null, departure: string | null, enqueuedAt: number): QueueItem {
  return {
    date,
    arrival_time: arrival,
    departure_time: departure,
    enqueuedAt,
  };
}

describe("upsertOfflineQueueItem", () => {
  it("ponecha jednu nejnovější změnu pro stejné datum", () => {
    const first = queueItem("2026-07-13", "08:00", null, 1);
    const replacement = queueItem("2026-07-13", "08:00", "16:00", 2);

    expect(upsertOfflineQueueItem([first], replacement)).toEqual([replacement]);
  });

  it("zachová pořadí ostatních dnů a nový záznam zařadí na konec fronty", () => {
    const first = queueItem("2026-07-12", "08:00", "16:00", 1);
    const second = queueItem("2026-07-13", "09:00", null, 2);
    const replacement = queueItem("2026-07-12", "08:15", "16:05", 3);

    expect(upsertOfflineQueueItem([first, second], replacement)).toEqual([second, replacement]);
  });
});
