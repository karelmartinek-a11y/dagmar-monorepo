import type { EmploymentTemplate } from "../types/employment";

export function employmentTemplateLabel(value: EmploymentTemplate | string | null | undefined): string {
  if (value === "HPP") return "Hlavní pracovní poměr";
  if (value === "DPP_DPC") return "Dohoda mimo pracovní poměr";
  return "Neuvedeno";
}

export function instanceStatusLabel(value: string | null | undefined): string {
  if (value === "ACTIVE") return "Aktivní";
  if (value === "PENDING") return "Čeká na aktivaci";
  if (value === "REVOKED") return "Zneplatněno";
  if (value === "DEACTIVATED") return "Vypnuto";
  return "Neznámý stav";
}

export function timeFieldPlaceholder(): string {
  return "Zadejte čas";
}
