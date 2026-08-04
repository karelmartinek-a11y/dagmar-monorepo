import { expect, test, type Page } from "@playwright/test";

const realBackend = process.env.DAGMAR_E2E_REAL_BACKEND === "1";
const employeeEmail =
  process.env.DAGMAR_E2E_USER_EMAIL ?? "employee.e2e@example.test";
const employeePassword =
  process.env.DAGMAR_E2E_USER_PASSWORD ?? "EmployeeE2E-Strong-123";
const adminUsername =
  process.env.DAGMAR_E2E_ADMIN_USERNAME ?? "provoz@hotelchodovasc.cz";
const adminPassword =
  process.env.DAGMAR_E2E_ADMIN_PASSWORD ?? "AdminE2E-Strong-123";

async function loginEmployee(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("kajovodagmar.language.v1", "cs");
    window.localStorage.setItem("kajovodagmar.language.employee.v1", "cs");
  });
  await page.goto("/app");
  await page.getByLabel("Pracovní e-mail").fill(employeeEmail);
  await page.getByLabel("Heslo").fill(employeePassword);
  await page.getByRole("button", { name: "Přihlásit se", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Docházka" })).toBeVisible();
}

async function loginAdmin(page: Page, next = "/admin/dochazka") {
  await page.addInitScript(() =>
    window.localStorage.setItem("kajovodagmar.language.v1", "cs"),
  );
  await page.goto(`/admin/login?next=${encodeURIComponent(next)}`);
  await page
    .getByLabel("Přihlašovací jméno administrátora")
    .fill(adminUsername);
  await page.getByLabel("Heslo").fill(adminPassword);
  await page
    .getByRole("button", { name: "Přihlásit do administrace", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(next.replaceAll("/", "\\/")));
}

test.describe("real event backend", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!realBackend, "Requires the isolated PostgreSQL E2E backend.");

  test("employee keeps attendance, plan and group plan across June, July and August 2026", async ({
    page,
  }) => {
    await loginEmployee(page);
    await expect(page.getByText("srpen 2026", { exact: false })).toBeVisible();
    await expect(page.getByTestId("attendance-day-2026-08-03")).toContainText(
      "plán 08:30",
    );
    await expect(
      page.getByLabel("Celodenní nepřítomnost 2026-08-11"),
    ).toHaveValue("PARAGRAPH");
    await page.getByRole("tab", { name: "Plán služeb", exact: true }).click();
    await expect(page.getByLabel("PLÁN – PRŮCHOD 2 2026-08-01")).toHaveValue(
      "02:00",
    );
    await expect(page.getByLabel("PLÁN – PRŮCHOD 2 2026-08-01")).toBeDisabled();
    await page.getByRole("tab", { name: "Docházka", exact: true }).click();

    await page.getByRole("button", { name: "‹" }).click();
    await expect(
      page.getByText("červenec 2026", { exact: false }),
    ).toBeVisible();
    await expect(page.getByText("Plán zamčen")).toBeVisible();
    const overnightPass = page.getByLabel(/2026-07-02 PRŮCHOD 1/);
    await expect(overnightPass).toHaveValue("22:00");
    const julyStatus = page.getByLabel("Celodenní nepřítomnost 2026-07-03");
    await expect(julyStatus).toBeEnabled();
    await expect(julyStatus.locator('option[value="HOLIDAY"]')).toHaveAttribute(
      "disabled",
      "",
    );
    await expect(
      julyStatus.locator('option[value="SICKNESS"]'),
    ).not.toHaveAttribute("disabled", "");
    await expect(
      page.getByLabel("Celodenní nepřítomnost 2026-07-31"),
    ).toBeDisabled();

    await page.getByRole("button", { name: "‹" }).click();
    await expect(page.getByText("červen 2026", { exact: false })).toBeVisible();
    await expect(page.getByText("Docházka zamčena")).toBeVisible();
    await expect(
      page.getByLabel("Celodenní nepřítomnost 2026-06-08"),
    ).toBeDisabled();
    const juneStatus = page.getByLabel("Celodenní nepřítomnost 2026-06-15");
    await expect(juneStatus).toHaveValue("SICKNESS");
    await expect(juneStatus).toBeDisabled();

    await page.getByRole("tab", { name: "Plán služeb", exact: true }).click();
    await expect(page.getByLabel("Plánovaný PRŮCHOD 1 2026-06-08")).toHaveValue(
      "08:00",
    );
    await page.getByRole("tab", { name: "Skupinový plán služeb" }).click();
    await expect(page.getByLabel("Skupina")).not.toHaveValue("");
    await expect(
      page
        .locator(".group-plan-table")
        .getByRole("columnheader", { name: "Plán (h)" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "›" }).click();
    await page.getByRole("button", { name: "›" }).click();
    await expect(
      page
        .locator(".group-plan-table tbody tr")
        .filter({ hasText: "E2E provozní úvazek" })
        .getByText("Volno", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("Skupina").selectOption("");
    await expect(page.getByText("Načítám skupinový plán")).not.toBeVisible();
    await page.getByRole("tab", { name: "Docházka", exact: true }).click();
    for (let index = 0; index < 8; index += 1)
      await page.getByRole("button", { name: "‹" }).click();
    await expect(
      page.getByText("Ve zvoleném měsíci není aktivní žádný úvazek."),
    ).toBeVisible();
    await expect(page.getByText("Načítám měsíc")).not.toBeVisible();
  });

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ]) {
    test(`employee views have no page overflow at ${viewport.width}px`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await loginEmployee(page);
      for (const tab of ["Docházka", "Plán služeb", "Skupinový plán služeb"]) {
        await page.getByRole("tab", { name: tab, exact: true }).click();
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(1);
      }
    });
  }

  test("admin attendance and shift-plan matrices load active employments and controls", async ({
    page,
  }) => {
    await loginAdmin(page);
    await expect(
      page.getByText("E2E provozní úvazek", { exact: false }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Přidej pauzy/ }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("E2E skrytý úvazek", { exact: false }),
    ).toHaveCount(0);
    const augustAttendanceSheet = page
      .locator(".admin-attendance-matrix tbody tr")
      .filter({ hasText: "E2E provozní úvazek" });
    await augustAttendanceSheet
      .getByRole("button", { name: "Zamknout docházku" })
      .click();
    await expect(
      augustAttendanceSheet.getByRole("button", { name: "Odemknout docházku" }),
    ).toBeVisible();
    await augustAttendanceSheet
      .getByRole("button", { name: "Odemknout docházku" })
      .click();
    await expect(
      augustAttendanceSheet.getByRole("button", { name: "Zamknout docházku" }),
    ).toBeVisible();
    await augustAttendanceSheet
      .getByRole("button", { name: "Zamknout plán" })
      .click();
    await expect(
      augustAttendanceSheet.getByRole("button", { name: "Odemknout plán" }),
    ).toBeVisible();
    await augustAttendanceSheet
      .getByRole("button", { name: "Odemknout plán" })
      .click();
    await expect(
      augustAttendanceSheet.getByRole("button", { name: "Zamknout plán" }),
    ).toBeVisible();
    await page.getByLabel("Měsíc").fill("6");
    const lockedAttendanceSheet = page
      .locator(".admin-attendance-matrix tbody tr")
      .filter({ hasText: "E2E provozní úvazek" });
    await expect(
      lockedAttendanceSheet.getByLabel(/Nepřítomnost .* 2026-06-08/),
    ).toBeDisabled();
    await page.goto("/admin/plan-sluzeb");
    await expect(page.getByTestId(/admin-shift-plan-/).first()).toBeVisible();
    await expect(page.getByLabel(/2026-08-03 PRŮCHOD 1/).first()).toBeVisible();
    const ownPlan = page
      .getByTestId(/admin-shift-plan-/)
      .filter({ hasText: "E2E provozní úvazek" });
    await expect(
      ownPlan.getByRole("columnheader", { name: "Plán (h)" }),
    ).toBeVisible();
    await expect(
      ownPlan.getByRole("columnheader", { name: "Odpracováno (h)" }),
    ).toHaveCount(0);
    await ownPlan.getByRole("button", { name: "Zamknout plán" }).click();
    await expect(
      ownPlan.getByRole("button", { name: "Odemknout plán" }),
    ).toBeVisible();
    await ownPlan.getByRole("button", { name: "Odemknout plán" }).click();
    await expect(
      ownPlan.getByRole("button", { name: "Zamknout plán" }),
    ).toBeVisible();
    const externalPlan = page
      .getByTestId(/admin-shift-plan-/)
      .filter({ hasText: "E2E externí fakturace" });
    await expect(
      externalPlan.getByRole("columnheader", { name: "Noc (h)" }),
    ).toBeVisible();
    await expect(
      externalPlan.getByRole("columnheader", { name: "Odpracováno (h)" }),
    ).toHaveCount(0);
  });
});
