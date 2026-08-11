import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const output = process.env.DAGMAR_DESIGN_OUTPUT;
const employeeEmail = "employee.e2e@example.test";
const employeePassword = "EmployeeE2E-Strong-123";
const adminPassword = "AdminE2E-Strong-123";
const languages = ["cs", "en", "sk", "de", "hi"] as const;
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
];

async function setLanguage(page: Page, language: string) {
  await page.evaluate((value) => {
    window.localStorage.setItem("kajovodagmar.language.v1", value);
    window.localStorage.setItem("kajovodagmar.language.employee.v1", value);
    window.localStorage.setItem("kajovodagmar.language.admin.v1", value);
  }, language);
  await page.reload();
}

async function employeeLogin(page: Page, language: string) {
  await page.goto("/app");
  await setLanguage(page, language);
  await page.locator('input[type="email"]').fill(employeeEmail);
  await page.locator('input[type="password"]').fill(employeePassword);
  await page.locator("form button[type=submit]").click();
  await expect(page.getByTestId("attendance-day-2026-08-03")).toBeVisible();
}

async function adminLogin(page: Page, language: string) {
  await page.goto("/admin/login?next=%2Fadmin%2Fdochazka");
  await setLanguage(page, language);
  await page.locator("form input").nth(0).fill("provoz@hotelchodovasc.cz");
  await page.locator('form input[type="password"]').fill(adminPassword);
  await page.locator("form button").click();
  await expect(page.getByTestId(/admin-attendance-/).first()).toBeVisible();
}

for (const language of languages) test(`capture ${language} responsive design views`, async ({ page }) => {
  test.setTimeout(60_000);
  test.skip(!output, "DAGMAR_DESIGN_OUTPUT is required.");
  await employeeLogin(page, language);
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const item of [
      { name: "employee-attendance", tab: 0 },
      { name: "employee-shift-plan", tab: 1 },
      { name: "employee-group-plan", tab: 2 },
    ]) {
      await page.getByRole("tab").nth(item.tab).click();
      if (item.name === "employee-group-plan") await page.locator(".group-plan-table-wrap").waitFor({ state: "attached" });
      await page.screenshot({ path: path.join(output!, `${language}-${viewport.name}-${item.name}.png`) });
    }
  }

  await page.context().clearCookies();
  await page.evaluate(() => window.localStorage.clear());
  await adminLogin(page, language);
  await page.goto("/admin/tisky");
  await page.locator(".admin-chip-grid").waitFor({ state: "attached" });
  await page.locator(".full.action-row button").last().click();
  await page.locator(".print-sheet").first().waitFor({ state: "visible" });
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.screenshot({ path: path.join(output!, `${language}-${viewport.name}-admin-print-preview.png`), fullPage: true });
  }
  await page.setViewportSize(viewports[0]);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".print-sheet").first()).toBeVisible();
  await page.locator(".print-sheet").first().screenshot({
    path: path.join(output!, `${language}-desktop-admin-print-media.png`),
  });
  await page.emulateMedia({ media: "screen" });
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const item of [
      { name: "admin-attendance", url: "/admin/dochazka", ready: /admin-attendance-/ },
      { name: "admin-shift-plan", url: "/admin/plan-sluzeb", ready: /admin-shift-plan-/ },
      { name: "admin-users-employments", url: "/admin/users", ready: null },
    ]) {
      await page.goto(item.url);
      if (item.ready) await expect(page.getByTestId(item.ready).first()).toBeVisible();
      else await expect(page.locator(".admin-layout")).toBeVisible();
      await page.screenshot({ path: path.join(output!, `${language}-${viewport.name}-${item.name}.png`) });
    }
  }
});
