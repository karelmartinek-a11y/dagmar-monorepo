import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}{ext}",
  outputDir: "test-results",
  fullyParallel: true,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: process.env.DAGMAR_E2E_REAL_BACKEND ? "http://127.0.0.1:5173" : "http://127.0.0.1:4173", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: process.env.DAGMAR_E2E_REAL_BACKEND
    ? { command: "npm run dev -- --host 127.0.0.1", port: 5173, reuseExistingServer: false }
    : { command: "npm run preview", port: 4173, reuseExistingServer: !process.env.CI },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
