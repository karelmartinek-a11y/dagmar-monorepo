import { openDB } from "idb";
import { api, ApiError } from "../api/client";
import { i18n } from "../i18n";

export type QueuedOperation = {
  id?: number;
  kind: "attendance" | "day-status" | "shift-plan";
  employment_id: number;
  payload: Record<string, unknown>;
  created_at: string;
  attempts: number;
  last_error: string | null;
};

const database = openDB("kajovodagmar-offline-v1", 1, {
  upgrade(db) { db.createObjectStore("operations", { keyPath: "id", autoIncrement: true }); },
});

export async function queueOperation(operation: Omit<QueuedOperation, "id" | "created_at" | "attempts" | "last_error">) {
  return (await database).add("operations", { ...operation, created_at: new Date().toISOString(), attempts: 0, last_error: null });
}

export async function listOperations(): Promise<QueuedOperation[]> {
  return (await database).getAll("operations") as Promise<QueuedOperation[]>;
}

export async function flushOperations(allowedEmploymentIds?: ReadonlySet<number>): Promise<{ completed: number; blocked: QueuedOperation | null }> {
  const db = await database;
  const operations = await listOperations();
  let completed = 0;
  for (const operation of operations.sort((a, b) => (a.id ?? 0) - (b.id ?? 0))) {
    if (allowedEmploymentIds && !allowedEmploymentIds.has(operation.employment_id)) {
      const lastError = i18n.t("api.offlineQueueBlocked");
      await db.put("operations", { ...operation, last_error: lastError });
      return { completed, blocked: { ...operation, last_error: lastError } };
    }
    try {
      if (operation.kind === "attendance") await api.saveAttendance(operation.payload);
      else if (operation.kind === "day-status") await api.savePortalStatus(operation.payload);
      else await api.saveShiftPlan(operation.payload);
      await db.delete("operations", operation.id!);
      completed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : i18n.t("api.offlineUnknown");
      await db.put("operations", { ...operation, attempts: operation.attempts + 1, last_error: message });
      if (error instanceof ApiError && (error.conflict || error.authenticationExpired)) return { completed, blocked: { ...operation, last_error: message } };
      return { completed, blocked: null };
    }
  }
  return { completed, blocked: null };
}
