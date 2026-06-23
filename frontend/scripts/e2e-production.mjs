import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const baseUrl = process.env.DAGMAR_E2E_BASE_URL || "https://dagmar.hcasc.cz";
const adminEmail = process.env.DAGMAR_E2E_ADMIN_EMAIL || "";
const adminPassword = process.env.DAGMAR_E2E_ADMIN_PASSWORD || "";
const portalEmail = process.env.DAGMAR_E2E_PORTAL_EMAIL || "";
const portalPassword = process.env.DAGMAR_E2E_PORTAL_PASSWORD || "";
const outputDir = path.resolve("output/playwright");
const screenshotDir = path.join(outputDir, "screenshots");
const traceDir = path.join(outputDir, "traces");
const videoDir = path.join(outputDir, "videos");

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function sanitize(name) {
  return name.replace(/[^a-z0-9-_]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

function normalizeText(value) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

async function readJson(url, init = undefined) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { response, body };
}

class AuditFailure extends Error {
  constructor(message) {
    super(message);
    this.name = "AuditFailure";
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new AuditFailure(message);
  }
}

async function runStep(name, fn, runtime) {
  const safeName = sanitize(name);
  const stepTrace = path.join(traceDir, `${safeName}.zip`);
  try {
    await runtime.context.tracing.start({ screenshots: true, snapshots: true });
    await fn();
    await runtime.context.tracing.stop();
    runtime.results.push({ name, ok: true });
  } catch (error) {
    const screenshot = path.join(screenshotDir, `${safeName}.png`);
    await runtime.page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
    await runtime.context.tracing.stop({ path: stepTrace }).catch(() => {});
    runtime.results.push({
      name,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      screenshot,
      trace: stepTrace,
    });
    throw error;
  }
}

async function main() {
  await ensureDir(outputDir);
  await ensureDir(screenshotDir);
  await ensureDir(traceDir);
  await ensureDir(videoDir);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL: baseUrl,
    ignoreHTTPSErrors: false,
    recordVideo: { dir: videoDir, size: { width: 1440, height: 1200 } },
    viewport: { width: 1440, height: 1200 },
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const requestFailures = [];
  const responseIssues = [];
  const runtime = { browser, context, page, results: [], consoleErrors, requestFailures, responseIssues };

  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      const text = msg.text();
      if (text.includes("status of 401")) {
        return;
      }
      consoleErrors.push({ type: msg.type(), text });
    }
  });
  page.on("requestfailed", (request) => {
    requestFailures.push({
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText || "unknown",
    });
  });
  page.on("response", (response) => {
    const status = response.status();
    if (status < 400) {
      return;
    }
    const url = response.url();
    const allowedAuthFailures = ["/api/v1/admin/login", "/api/v1/portal/login", "/api/v1/admin/me"];
    if (status === 401 && allowedAuthFailures.some((pathName) => url.includes(pathName))) {
      return;
    }
    responseIssues.push({ status, url });
  });

  let fatalError = null;
  try {
    await runStep("http-redirect", async () => {
      const response = await fetch(baseUrl.replace("https://", "http://"), { redirect: "manual" });
      assert(response.status === 301 || response.status === 308, `HTTP redirect status je ${response.status}`);
      assert((response.headers.get("location") || "").startsWith(baseUrl), "HTTP redirect nemiri na HTTPS kanonickou domenu.");
    }, runtime);

    await runStep("public-health-and-version", async () => {
      const health = await readJson(`${baseUrl}/api/v1/health`);
      assert(health.response.ok, "API health endpoint nevratil 200.");
      assert(health.body?.ok === true, "API health endpoint nevratil {ok:true}.");
      const version = await readJson(`${baseUrl}/api/version`);
      assert(version.response.ok, "API version endpoint nevratil 200.");
      assert(typeof version.body?.backend_deploy_tag === "string" && version.body.backend_deploy_tag.length > 0, "API version nevratil backend_deploy_tag.");
      const publicHealth = await fetch(`${baseUrl}/health`);
      const publicHealthText = await publicHealth.text();
      assert(publicHealth.ok, "/health nevratil 200.");
      assert(publicHealthText.trim() === "ok", "/health nevratil ok.");
    }, runtime);

    await runStep("root-and-assets", async () => {
      await page.goto("/", { waitUntil: "networkidle" });
      await page.waitForURL(`${baseUrl}/app`, { timeout: 15000 });
      const bodyText = normalizeText(await page.locator("body").innerText());
      assert(bodyText.includes("prihlaseni"), "Root neprevedl na zamestnaneckou aplikaci.");
      assert(await page.locator("link[rel='icon']").count() >= 1, "Chybi favicon.");
      assert(await page.locator("link[rel='manifest']").count() >= 1, "Chybi manifest.");
    }, runtime);

    await runStep("admin-protected-and-invalid-login", async () => {
      await context.clearCookies();
      await page.goto("/admin/prehled", { waitUntil: "networkidle" });
      assert(await page.getByPlaceholder("jmeno@domena.cz", { exact: true }).count() === 1, "Protected admin route bez session neskoncila na loginu.");
      assert(page.url().includes("/admin/login"), "Protected admin route bez session nevede na /admin/login.");
      await page.getByPlaceholder("jmeno@domena.cz", { exact: true }).fill("provoz@hotelchodovasc.cz");
      await page.getByPlaceholder("••••••••", { exact: true }).fill("spatne-heslo");
      await page.getByRole("button", { name: "Přihlásit", exact: true }).click();
      await page.waitForTimeout(1200);
      assert(page.url().includes("/admin/login"), "Neplatny admin login neocekavane zmenil route.");
    }, runtime);

    await runStep("portal-invalid-login", async () => {
      await page.goto("/app", { waitUntil: "networkidle" });
      await page.getByPlaceholder("name@hotelchodovasc.cz", { exact: true }).fill("invalid@example.invalid");
      await page.getByPlaceholder("Zadejte heslo", { exact: true }).fill("spatne-heslo");
      await page.getByRole("button", { name: "Přihlásit", exact: true }).click();
      await page.waitForTimeout(1200);
      const bodyText = normalizeText(await page.locator("body").innerText());
      assert(bodyText.includes("neplatne") || bodyText.includes("prihlaseni"), "Neplatny portal login neukazal ocekavany stav.");
    }, runtime);

    if (portalEmail && portalPassword) {
      await runStep("portal-valid-login-and-logout", async () => {
        await page.goto("/app", { waitUntil: "networkidle" });
        await page.getByPlaceholder("name@hotelchodovasc.cz", { exact: true }).fill(portalEmail);
        await page.getByPlaceholder("Zadejte heslo", { exact: true }).fill(portalPassword);
        await page.getByRole("button", { name: "Přihlásit", exact: true }).click();
        await page.waitForTimeout(1800);
        const bodyText = normalizeText(await page.locator("body").innerText());
        assert(bodyText.includes("dochazkovy list"), "Portal validni login nenacetl dochazkovy list.");
        const authState = await page.evaluate(() => window.localStorage.getItem("dagmar_portal_auth_v2"));
        assert(Boolean(authState), "Portal login neulozil auth stav do localStorage.");
        await page.getByRole("button", { name: "Přepnout na plán směn", exact: true }).click().catch(() => {});
        await page.waitForTimeout(600);
        await page.getByRole("button", { name: "Odhlásit", exact: true }).click();
        await page.waitForTimeout(800);
        assert(normalizeText(await page.locator("body").innerText()).includes("prihlaseni"), "Portal logout nevratil login stranku.");
      }, runtime);
    }

    if (adminEmail && adminPassword) {
      await runStep("admin-valid-login-and-logout", async () => {
        await page.goto("/admin/login", { waitUntil: "networkidle" });
        await page.getByPlaceholder("jmeno@domena.cz", { exact: true }).fill(adminEmail);
        await page.getByPlaceholder("••••••••", { exact: true }).fill(adminPassword);
        await page.getByRole("button", { name: "Přihlásit", exact: true }).click();
        await page.waitForTimeout(1800);
        const bodyText = normalizeText(await page.locator("body").innerText());
        assert(bodyText.includes("prehled administrace"), "Admin validni login nenacetl prehled.");
        const sessionCookie = (await context.cookies()).find((cookie) => cookie.name.includes("dagmar_admin_session"));
        assert(Boolean(sessionCookie), "Admin login nenastavil session cookie.");
        for (const adminPath of ["/admin/users", "/admin/dochazka", "/admin/plan-sluzeb", "/admin/export", "/admin/tisky", "/admin/settings", "/admin/instances"]) {
          await page.goto(adminPath, { waitUntil: "networkidle" });
          assert(page.url().startsWith(`${baseUrl}/admin`), `Admin route ${adminPath} se nenacetla pod /admin.`);
        }
        await page.goto("/Admin", { waitUntil: "networkidle" });
        assert(
          page.url().startsWith(`${baseUrl}/admin`) ||
            page.url().startsWith(`${baseUrl}/Admin`) ||
            page.url().startsWith(`${baseUrl}/app`),
          "/Admin skoncilo na neocekavane route.",
        );
        await page.goto("/admin/login", { waitUntil: "networkidle" });
        assert(page.url().startsWith(`${baseUrl}/admin/`), "/admin/login po session neskoncilo v admin sekci.");
        await page.getByRole("button", { name: "Odhlásit", exact: true }).click();
        await page.waitForTimeout(800);
        assert(page.url().includes("/admin/login"), "Admin logout nevratil login stranku.");
      }, runtime);
    }

    if (consoleErrors.length > 0) {
      throw new AuditFailure(`Console errors/warnings: ${JSON.stringify(consoleErrors.slice(0, 10))}`);
    }
    if (requestFailures.length > 0) {
      throw new AuditFailure(`Request failures: ${JSON.stringify(requestFailures.slice(0, 10))}`);
    }
    if (responseIssues.length > 0) {
      throw new AuditFailure(`Unexpected HTTP responses: ${JSON.stringify(responseIssues.slice(0, 10))}`);
    }
  } catch (error) {
    fatalError = error instanceof Error ? error : new Error(String(error));
  } finally {
    const reportPath = path.join(outputDir, "report.json");
    await fs.writeFile(
      reportPath,
      JSON.stringify(
        {
          baseUrl,
          generatedAt: new Date().toISOString(),
          results: runtime.results,
          consoleErrors,
          requestFailures,
          responseIssues,
          fatalError: fatalError ? { name: fatalError.name, message: fatalError.message } : null,
        },
        null,
        2,
      ),
      "utf-8",
    );
    await context.close();
    await browser.close();
  }

  const reportPath = path.join(outputDir, "report.json");
  const failed = runtime.results.filter((item) => !item.ok);
  if (failed.length > 0) {
    console.error(JSON.stringify({ ok: false, reportPath, failed }, null, 2));
    process.exitCode = 1;
    return;
  }
  if (fatalError) {
    console.error(JSON.stringify({ ok: false, reportPath, fatalError: { name: fatalError.name, message: fatalError.message } }, null, 2));
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify({ ok: true, reportPath, results: runtime.results }, null, 2));
}

await main();
