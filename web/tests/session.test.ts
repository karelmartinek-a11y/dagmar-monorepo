import { beforeEach, describe, expect, it } from "vitest";
import { clearPortalSession, loadPortalSession, savePortalLogin, selectEmployment } from "../src/state/portalSession";

const login = { instance_token: "token", display_name: "Test", employment_id: 7, afternoon_cutoff: "17:00", available_employments: [{ id: 7, title: "Hlavní", employment_type: "HPP", start_date: "2026-01-01", end_date: null, is_active: true, is_current: true, label: "Hlavní" }, { id: 9, title: "Dohoda", employment_type: "DPP_DPC", start_date: "2026-01-01", end_date: null, is_active: true, is_current: true, label: "Dohoda" }] };

describe("portal session", () => {
  beforeEach(() => localStorage.clear());
  it("persists the explicit employment selection", () => {
    const initial = savePortalLogin(login);
    expect(selectEmployment(initial, 9).selected_employment_id).toBe(9);
    expect(loadPortalSession()?.selected_employment_id).toBe(9);
  });
  it("clears bearer state on logout", () => {
    savePortalLogin(login); clearPortalSession(); expect(loadPortalSession()).toBeNull();
  });
});
