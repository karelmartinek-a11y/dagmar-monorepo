import { expect, test } from "@playwright/test";

const variants = [
  { value: "en", heading: "Your shift. Your overview.", button: "Open attendance", title: "KájovoDagmar · Employee sign-in" },
  { value: "sk", heading: "Vaša zmena. Váš prehľad.", button: "Otvoriť dochádzku", title: "KájovoDagmar · Prihlásenie zamestnanca" },
  { value: "de", heading: "Ihre Schicht. Ihr Überblick.", button: "Zeiterfassung öffnen", title: "KájovoDagmar · Mitarbeiteranmeldung" },
  { value: "hi", heading: "आपकी शिफ़्ट। आपका विवरण।", button: "उपस्थिति खोलें", title: "KájovoDagmar · कर्मचारी लॉग इन" },
] as const;

test("employee login language switch persists after reload", async ({ page }) => {
  await page.goto("/app");

  for (const variant of variants) {
    await page.locator("select").selectOption(variant.value);
    await expect(page.getByRole("heading", { name: variant.heading })).toBeVisible();
    await expect(page.getByRole("button", { name: variant.button })).toBeVisible();
    await expect(page).toHaveTitle(variant.title);
    await expect(page.getByText(variant.value === "hi" ? "केवल पहले से जुड़े खातों के लिए" : variant.value === "en" ? "Only for previously linked accounts" : variant.value === "sk" ? "Len pre vopred prepojené účty" : "Nur für zuvor verknüpfte Konten")).toBeVisible();
  }

  await page.reload();
  await expect(page.locator("select")).toHaveValue("hi");
  await expect(page.getByRole("heading", { name: "आपकी शिफ़्ट। आपका विवरण।" })).toBeVisible();
  await expect(page).toHaveTitle("KájovoDagmar · कर्मचारी लॉग इन");
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
  await expect(page.getByText("/api/v1/integration/attendances", { exact: true }).first()).toBeVisible();
});
