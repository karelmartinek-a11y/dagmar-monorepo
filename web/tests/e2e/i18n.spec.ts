import { expect, test } from "@playwright/test";

const variants = [
  { value: "en" },
  { value: "sk" },
  { value: "de" },
  { value: "hi" },
] as const;

test("employee login language switch persists after reload", async ({ page }) => {
  await page.goto("/app");

  for (const variant of variants) {
    await page.locator("select").selectOption(variant.value);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator("form")).toBeVisible();
  }

  await page.reload();
  await expect(page.locator("select")).toHaveValue("hi");
  await expect(page.locator("h1")).toBeVisible();
});

test("admin login and integration docs respect language switch", async ({ page }) => {
  await page.goto("/admin/login");
  await page.locator("select").selectOption("en");
  await expect(page).toHaveTitle("KájovoDagmar · Admin access");
  await expect(page.getByRole("heading", { name: "Time needs order." })).toBeVisible();
  await expect(page.getByText("Only for previously linked administrator accounts")).toBeVisible();

  await page.goto("/integration-api");
  await page.locator("select").selectOption("sk");
  await expect(page).toHaveTitle("KájovoDagmar · Integration API");
  await expect(page.getByRole("heading", { name: "Integration API" })).toBeVisible();
  await expect(page.getByText("/api/v1/integration/attendance-events", { exact: true }).first()).toBeVisible();
});
