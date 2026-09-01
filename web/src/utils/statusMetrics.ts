import type { StatusMetricKey } from "../api/types";

export const statusMetricKeys: StatusMetricKey[] = ["holiday", "sickness", "paragraph"];

export function statusMetricKeyForStatus(status: string | null | undefined): StatusMetricKey | null {
  if (status === "HOLIDAY") return "holiday";
  if (status === "SICKNESS") return "sickness";
  if (status === "PARAGRAPH") return "paragraph";
  return null;
}
