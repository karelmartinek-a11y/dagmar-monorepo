import { expect, test } from "@playwright/test";

const employeeEmail = process.env.DAGMAR_E2E_USER_EMAIL ?? "employee.e2e@example.test";
const employeePassword = process.env.DAGMAR_E2E_USER_PASSWORD ?? "EmployeeE2E-Strong-123";
const adminUsername = process.env.DAGMAR_E2E_ADMIN_USERNAME ?? "provoz@hotelchodovasc.cz";
const adminPassword = process.env.DAGMAR_E2E_ADMIN_PASSWORD ?? "AdminE2E-Strong-123";
const languageStorageKey = "kajovodagmar.language.v1";
const employeeLanguageStorageKey = "kajovodagmar.language.employee.v1";

test.describe("real backend workflows", () => {
  test.skip(!process.env.DAGMAR_E2E_REAL_BACKEND, "Requires the isolated PostgreSQL E2E environment.");

  test("employee login, attendance write, offline queue and logout", async ({ page }) => {
    await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [employeeLanguageStorageKey, "cs"]);
    await page.goto("/app");
    await page.getByLabel("Pracovní e-mail").fill(employeeEmail);
    await page.getByLabel("Heslo").fill(employeePassword);
    await page.getByRole("button", { name: "Otevřít docházku" }).click();
    await expect(page.getByRole("heading", { name: "Měsíční docházka" })).toBeVisible();

    const arrival = page.locator('input[name="arrival_time"]:enabled').first();
    await arrival.dblclick();
    await arrival.fill("0815");
    const refreshedAttendance = page.waitForResponse(response => response.request().method() === "GET" && new URL(response.url()).pathname === "/api/v1/attendance");
    await arrival.press("Enter");
    await expect(page.getByText("Docházka byla uložena.")).toHaveCount(0);
    await expect(arrival.locator("xpath=..")).toHaveClass(/time-cell--saved/);
    await refreshedAttendance;
    await expect(arrival).toHaveValue("08:15");

    await page.route("**/api/v1/attendance", route => route.abort("internetdisconnected"));
    const currentArrival = page.locator('input[name="arrival_time"]:enabled').first();
    await currentArrival.dblclick();
    await currentArrival.fill("0816");
    await currentArrival.press("Enter");
    await expect(page.getByText("Změna čeká v bezpečné frontě na obnovení připojení.")).toBeVisible();
    await expect(page.getByText("Docházka byla uložena.")).not.toBeVisible();
    await page.unroute("**/api/v1/attendance");
    await page.getByRole("button", { name: "Odhlásit", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Přihlášení zaměstnance" })).toBeVisible();
  });

  test("admin session, protected routes, export and print preview", async ({ page }) => {
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

    await page.goto("/admin/tisky/preview");
    await expect(page.getByRole("heading", { name: "Náhled sestavy" })).toBeVisible();
    await page.getByRole("button", { name: "Odhlásit administraci" }).click();
    await expect(page.getByRole("heading", { name: "Vstup do administrace" })).toBeVisible();
  });
});
