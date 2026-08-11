import { chromium } from "@playwright/test";

const baseURL = process.env.DAGMAR_PRODUCTION_URL;
const expectedCommit = process.env.DAGMAR_EXPECTED_COMMIT;
if (baseURL !== "https://dagmar.hcasc.cz" || !/^[0-9a-f]{7}$/.test(expectedCommit || "")) {
  throw new Error("Production smoke requires the canonical URL and a seven-character commit.");
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const consoleErrors = [];
const failedRequests = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("requestfailed", (request) => failedRequests.push(request.url()));

try {
  const response = await page.goto(baseURL, { waitUntil: "networkidle" });
  if (!response?.ok()) throw new Error(`Frontend shell returned ${response?.status() ?? "no response"}.`);
  const frontendVersion = await page.request.get(`${baseURL}/frontend-version.json`);
  if (!frontendVersion.ok()) throw new Error("Frontend version endpoint is unavailable.");
  const payload = await frontendVersion.json();
  if (payload.frontend_commit !== expectedCommit) {
    throw new Error("Frontend version does not match the deployed commit.");
  }
  if (consoleErrors.length) throw new Error(`Browser console errors: ${consoleErrors.join(" | ")}`);
  if (failedRequests.length) throw new Error(`Failed browser requests: ${failedRequests.join(" | ")}`);
} finally {
  await browser.close();
}
