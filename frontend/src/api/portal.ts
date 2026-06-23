import { apiFetch } from "./client";
import type { EmploymentTemplate } from "../types/employment";

export type PortalLoginEmployment = {
  id: number;
  title: string;
  employment_type: EmploymentTemplate;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  is_current: boolean;
  label: string;
};

export type PortalLoginResponse = {
  instance_token: string;
  display_name: string;
  employment_id: number | null;
  available_employments: PortalLoginEmployment[];
  afternoon_cutoff?: string | null;
};

export async function portalLogin(params: { email: string; password: string }): Promise<PortalLoginResponse> {
  return apiFetch<PortalLoginResponse>("/api/v1/portal/login", {
    method: "POST",
    body: params,
  });
}

export async function portalResetPassword(params: { token: string; password: string }): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>("/api/v1/portal/reset", {
    method: "POST",
    body: params,
  });
}
