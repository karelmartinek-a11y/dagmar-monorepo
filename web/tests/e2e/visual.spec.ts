import { expect, test } from "@playwright/test";

const viewports = [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 390, height: 844 }, { width: 360, height: 800 }];
for (const viewport of viewports) {
  test(`employee login ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/app");
    await expect(page).toHaveScreenshot(`employee-login-${viewport.width}.png`, { fullPage: true, animations: "disabled", maxDiffPixelRatio: 0.015 });
  });
}
