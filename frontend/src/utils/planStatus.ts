import type { ShiftPlanDayStatus } from "../api/adminShiftPlan";

export function planStatusLabel(status: ShiftPlanDayStatus | null | undefined): string | null {
  if (status === "HOLIDAY") return "dovolená";
  if (status === "OFF") return "volno";
  return null;
}

export function planStatusInputPlaceholder(status: ShiftPlanDayStatus | null | undefined): string | null {
  const label = planStatusLabel(status);
  return label ? label.toLocaleUpperCase("cs-CZ") : null;
}
