import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const output = process.env.DAGMAR_DESIGN_OUTPUT;
const employeeEmail = "employee.e2e@example.test";
const employeePassword = "EmployeeE2E-Strong-123";
const adminPassword = "AdminE2E-Strong-123";
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
];

async function employeeLogin(page: Page) {
  await page.goto("/app");
  await page.getByLabel("Pracovní e-mail").fill(employeeEmail);
  await page.getByLabel("Heslo").fill(employeePassword);
  await page.getByRole("button", { name: "Přihlásit se", exact: true }).click();
  await expect(page.getByTestId("attendance-day-2026-08-03")).toBeVisible();
}

async function adminLogin(page: Page) {
  await page.goto("/admin/login?next=%2Fadmin%2Fdochazka");
  await page.getByLabel("Přihlašovací jméno administrátora").fill("provoz@hotelchodovasc.cz");
  await page.getByLabel("Heslo").fill(adminPassword);
  await page.getByRole("button", { name: "Přihlásit do administrace", exact: true }).click();
  await expect(page.getByTestId(/admin-attendance-/).first()).toBeVisible();
}

test("capture 18 responsive design views", async ({ page }) => {
  test.skip(!output, "DAGMAR_DESIGN_OUTPUT is required.");
  await page.addInitScript(() => {
    window.localStorage.setItem("kajovodagmar.language.v1", "cs");
    window.localStorage.setItem("kajovodagmar.language.employee.v1", "cs");
  });
  await employeeLogin(page);
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const item of [
      { name: "employee-attendance", tab: "Docházka" },
      { name: "employee-shift-plan", tab: "Plán služeb" },
      { name: "employee-group-plan", tab: "Skupinový plán služeb" },
    ]) {
      await page.getByRole("tab", { name: item.tab, exact: true }).click();
      if (item.name === "employee-group-plan") await page.locator(".group-plan-table").waitFor({ state: "attached" });
      await page.screenshot({ path: path.join(output!, `${viewport.name}-${item.name}.png`) });
    }
  }

  await adminLogin(page);
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const item of [
      { name: "admin-attendance", url: "/admin/dochazka", ready: /admin-attendance-/ },
      { name: "admin-shift-plan", url: "/admin/plan-sluzeb", ready: /admin-shift-plan-/ },
      { name: "admin-users-employments", url: "/admin/users", ready: null },
    ]) {
      await page.goto(item.url);
      if (item.ready) await expect(page.getByTestId(item.ready).first()).toBeVisible();
      else await expect(page.getByRole("heading", { name: "Uživatelé a úvazky" })).toBeVisible();
      await page.screenshot({ path: path.join(output!, `${viewport.name}-${item.name}.png`) });
    }
  }
});
