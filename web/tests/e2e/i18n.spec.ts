import { expect, test } from "@playwright/test";

const variants = [
  { value: "en", heading: "Your shift. Your overview.", button: "Open attendance", title: "KájovoDagmar · Employee sign-in" },
  { value: "sk", heading: "Vaša zmena. Váš prehľad.", button: "Otvoriť dochádzku", title: "KájovoDagmar · Prihlásenie zamestnanca" },
  { value: "de", heading: "Ihre Schicht. Ihr Überblick.", button: "Zeiterfassung öffnen", title: "KájovoDagmar · Mitarbeiteranmeldung" },
] as const;

test("employee login language switch persists after reload", async ({ page }) => {
  await page.goto("/app");

  for (const variant of variants) {
    await page.locator("select").selectOption(variant.value);
    await expect(page.getByRole("heading", { name: variant.heading })).toBeVisible();
    await expect(page.getByRole("button", { name: variant.button })).toBeVisible();
    await expect(page).toHaveTitle(variant.title);
  }

  await page.reload();
  await expect(page.locator("select")).toHaveValue("de");
  await expect(page.getByRole("heading", { name: "Ihre Schicht. Ihr Überblick." })).toBeVisible();
  await expect(page).toHaveTitle("KájovoDagmar · Mitarbeiteranmeldung");
});

test("admin login and integration docs respect language switch", async ({ page }) => {
  await page.goto("/admin/login");
  await page.locator("select").selectOption("en");
  await expect(page).toHaveTitle("KájovoDagmar · Admin access");
  await expect(page.getByRole("heading", { name: "Time needs order." })).toBeVisible();

  await page.goto("/integration-api");
  await page.locator("select").selectOption("sk");
  await expect(page).toHaveTitle("KájovoDagmar · Integration API");
  await expect(page.getByRole("heading", { name: "Integration API" })).toBeVisible();
  await expect(page.getByText("/api/v1/integration/attendances", { exact: true }).first()).toBeVisible();
});
