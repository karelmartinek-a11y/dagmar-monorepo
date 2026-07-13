export type QueueItem = {
  date: string;
  arrival_time: string | null;
  departure_time: string | null;
  enqueuedAt: number;
};

export function upsertOfflineQueueItem(queue: readonly QueueItem[], item: QueueItem): QueueItem[] {
  return [...queue.filter((queued) => queued.date !== item.date), item];
}
