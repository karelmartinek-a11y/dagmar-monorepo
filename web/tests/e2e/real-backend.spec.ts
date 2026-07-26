import { expect, test } from "@playwright/test";

const employeeEmail = process.env.DAGMAR_E2E_USER_EMAIL ?? "employee.e2e@example.test";
const employeePassword = process.env.DAGMAR_E2E_USER_PASSWORD ?? "EmployeeE2E-Strong-123";
const adminUsername = process.env.DAGMAR_E2E_ADMIN_USERNAME ?? "provoz@hotelchodovasc.cz";
const adminPassword = process.env.DAGMAR_E2E_ADMIN_PASSWORD ?? "AdminE2E-Strong-123";
const languageStorageKey = "kajovodagmar.language.v1";
const employeeLanguageStorageKey = "kajovodagmar.language.employee.v1";

test.describe("real backend workflows", () => {
  test.skip(!process.env.DAGMAR_E2E_REAL_BACKEND, "Requires the isolated PostgreSQL E2E environment.");

  test("employee login, real attendance write and logout", async ({ page }) => {
    await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [employeeLanguageStorageKey, "cs"]);
    await page.goto("/app");
    await page.getByLabel("Pracovní e-mail").fill(employeeEmail);
    await page.getByLabel("Heslo").fill(employeePassword);
    await page.getByRole("button", { name: "Otevřít docházku" }).click();
    await expect(page.getByRole("heading", { name: "Měsíční docházka" })).toBeVisible();
    await page.waitForLoadState("networkidle");

    const portalSession = await page.evaluate(() => JSON.parse(window.localStorage.getItem("kajovodagmar.portal.session.v1") ?? "null") as { selected_employment_id: number });
    const attendanceDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague" }).format(new Date());
    const savedAttendance = await page.request.put("/api/v1/attendance", {
      data: {
        employment_id: portalSession.selected_employment_id,
        date: attendanceDate,
        arrival_time: "08:15",
        departure_time: null,
        arrival_time_2: null,
        departure_time_2: null,
      },
    });
    expect(savedAttendance.ok()).toBeTruthy();
    await page.getByRole("button", { name: "Odhlásit", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Přihlášení zaměstnance" })).toBeVisible();
  });

  test("employee edits only the own unlocked group-plan row", async ({ page }) => {
    await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [employeeLanguageStorageKey, "cs"]);
    await page.goto("/app");
    await page.getByLabel("Pracovní e-mail").fill(employeeEmail);
    await page.getByLabel("Heslo").fill(employeePassword);
    await page.getByRole("button", { name: "Otevřít docházku" }).click();
    await expect(page.getByRole("heading", { name: "Měsíční docházka" })).toBeVisible();
    await page.getByRole("tab", { name: "Skupinový plán směn" }).click();
    await expect(page.getByRole("heading", { name: "Skupinový plán směn" })).toBeVisible();

    const ownRow = page.locator("tr").filter({ hasText: "Testovací zaměstnanec" });
    const colleagueRow = page.locator("tr").filter({ hasText: "Kolega E2E" });
    await expect(ownRow).toHaveCount(1);
    await expect(colleagueRow).toHaveCount(1);
    const ownStart = ownRow.locator('input[name="planned_arrival_time"]').first();
    const colleagueStart = colleagueRow.locator('input[name="planned_arrival_time"]').first();
    await expect(ownStart).toBeEnabled();
    await expect(colleagueStart).toBeDisabled();
    await ownStart.fill("0815");
    await ownStart.press("Enter");
    await expect(page.getByText("Plán služeb byl uložen.")).toBeVisible();

    await page.getByRole("tab", { name: "Plán služeb" }).click();
    await expect(page.locator('input[name="planned_arrival_time"]').first()).toHaveValue("08:15");
  });

  test("admin session, protected routes, export and shift-plan print preview", async ({ page }) => {
    await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [languageStorageKey, "cs"]);
    await page.goto("/admin/login");
    await page.getByLabel("Přihlašovací jméno administrátora").fill(adminUsername);
    await page.getByLabel("Heslo").fill(adminPassword);
    await page.getByRole("button", { name: "Přihlásit do administrace" }).click();
    await expect(page.getByRole("heading", { name: "Přehled systému" })).toBeVisible();

    for (const path of ["/admin/users", "/admin/dochazka", "/admin/plan-sluzeb", "/admin/export", "/admin/tisky", "/admin/settings", "/admin/integrace"]) {
      await page.goto(path);
      await expect(page.locator("h1").first()).toBeVisible();
      await expect(page.getByText("Přihlášení nebylo přijato")).not.toBeVisible();
    }

    await page.goto("/admin/export");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: /Stáhnout/ }).click();
    const download = await downloadPromise;
    expect(await download.failure()).toBeNull();

    await page.goto("/admin/tisky");
    await page.getByLabel("Typ sestavy").selectOption("shift_plan");
    await page.getByRole("button", { name: "Otevřít náhled" }).click();
    await expect(page.getByRole("heading", { name: "Náhled plánu směn" })).toBeVisible();
    await page.getByRole("button", { name: "Odhlásit administraci" }).click();
    await expect(page.getByRole("heading", { name: "Vstup do administrace" })).toBeVisible();
  });
});
