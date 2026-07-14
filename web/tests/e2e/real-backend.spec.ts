import { expect, test } from "@playwright/test";

const employeeEmail = process.env.DAGMAR_E2E_USER_EMAIL ?? "employee.e2e@example.test";
const employeePassword = process.env.DAGMAR_E2E_USER_PASSWORD ?? "EmployeeE2E-Strong-123";
const adminEmail = "provoz@hotelchodovasc.cz";
const adminPassword = process.env.DAGMAR_E2E_ADMIN_PASSWORD ?? "AdminE2E-Strong-123";

test.describe("real backend workflows", () => {
  test.skip(!process.env.DAGMAR_E2E_REAL_BACKEND, "Requires the isolated PostgreSQL E2E environment.");

  test("employee login, attendance write, offline queue and logout", async ({ page }) => {
    await page.goto("/app");
    await page.getByLabel("Pracovní e-mail").fill(employeeEmail);
    await page.getByLabel("Heslo").fill(employeePassword);
    await page.getByRole("button", { name: "Otevřít docházku" }).click();
    await expect(page.getByRole("heading", { name: "Měsíční docházka" })).toBeVisible();

    const arrival = page.locator('input[aria-label$="příchod"]:enabled').first();
    await arrival.fill("08:15");
    await arrival.locator("xpath=ancestor::article").getByRole("button", { name: "Uložit" }).click();
    await expect(page.getByText("Docházka byla uložena.")).toBeVisible();

    await page.route("**/api/v1/attendance", route => route.abort("internetdisconnected"));
    await arrival.fill("08:16");
    await arrival.locator("xpath=ancestor::article").getByRole("button", { name: "Uložit" }).click();
    await expect(page.getByText("Změna čeká v bezpečné frontě na obnovení připojení.")).toBeVisible();
    await expect(page.getByText("Docházka byla uložena.")).not.toBeVisible();
    await page.unroute("**/api/v1/attendance");
    await page.getByRole("button", { name: "Odhlásit", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Přihlášení zaměstnance" })).toBeVisible();
  });

  test("admin session, protected routes, export and print preview", async ({ page }) => {
    await page.goto("/admin/login");
    await page.getByLabel("E-mail administrátora").fill(adminEmail);
    await page.getByLabel("Heslo").fill(adminPassword);
    await page.getByRole("button", { name: "Přihlásit do administrace" }).click();
    await expect(page.getByRole("heading", { name: "Přehled systému" })).toBeVisible();

    for (const path of ["/admin/users", "/admin/dochazka", "/admin/plan-sluzeb", "/admin/export", "/admin/tisky", "/admin/settings", "/admin/instances", "/admin/integrace"]) {
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
