import { expect, test } from "@playwright/test";

test("public integration documentation is complete and navigable", async ({ page }) => {
  await page.goto("/integration-api");
  await expect(page.getByRole("heading", { name: "Integration API" })).toBeVisible();
  await expect(page.getByText("/api/v1/integration/attendance-events", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("/api/v1/integration/openapi.json", { exact: true })).toBeVisible();
  await expect(page.getByText("2026-08-11", { exact: true })).toBeVisible();
  await expect(page.getByText("next_cursor", { exact: false })).toBeVisible();
  await expect(page.getByText("400", { exact: true })).toBeVisible();
  await expect(page.getByText("422", { exact: true })).toHaveCount(0);
  await expect(page.getByText("employment_id", { exact: false }).first()).toBeVisible();
});

test("unknown route offers a safe return", async ({ page }) => {
  await page.goto("/route-does-not-exist");
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.locator('a[href="/app"]')).toBeVisible();
});
