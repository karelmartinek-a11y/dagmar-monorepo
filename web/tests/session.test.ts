import { beforeEach, describe, expect, it } from "vitest";
import { clearPortalSession, savePortalLogin, selectEmployment } from "../src/state/portalSession";

const login = { display_name: "Test", employment_id: 7, available_employments: [{ id: 7, title: "Hlavní", employment_type: "WORK_CONTRACT" as const, start_date: "2026-01-01", end_date: null, is_active: true, is_current: true, label: "Hlavní" }, { id: 9, title: "Dohoda", employment_type: "DPP_DPC" as const, start_date: "2026-01-01", end_date: null, is_active: true, is_current: true, label: "Dohoda" }] };

describe("portal session", () => {
  beforeEach(() => localStorage.clear());
  it("keeps the explicit employment selection only in memory", () => {
    const initial = savePortalLogin(login);
    expect(selectEmployment(initial, 9).selected_employment_id).toBe(9);
    expect(localStorage.length).toBe(0);
  });
  it("removes the historical bearer record", () => {
    localStorage.setItem("kajovodagmar.portal.session.v1", "sensitive");
    clearPortalSession();
    expect(localStorage.getItem("kajovodagmar.portal.session.v1")).toBeNull();
  });
});
