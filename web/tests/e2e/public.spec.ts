import { expect, test } from "@playwright/test";

test("public integration documentation is complete and navigable", async ({ page }) => {
  await page.goto("/integration-api");
  await expect(page.getByRole("heading", { name: "Integration API" })).toBeVisible();
  await expect(page.getByText("/api/v1/integration/attendances", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("employment_id", { exact: true }).first()).toBeVisible();
});

test("unknown route offers a safe return", async ({ page }) => {
  await page.goto("/route-does-not-exist");
  await expect(page.getByRole("heading", { name: "Tato cesta neexistuje" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Zpět do portálu" })).toHaveAttribute("href", "/app");
});
