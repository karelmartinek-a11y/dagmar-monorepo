import { expect, test } from "@playwright/test";

const session = {
  instance_token: "test-token",
  display_name: "Testovací uživatel",
  employment_id: 41,
  selected_employment_id: 41,
  available_employments: [{
    id: 41,
    title: "Denní provoz",
    employment_type: "HPP",
    start_date: "2026-01-01",
    end_date: null,
    is_active: true,
    is_current: true,
    label: "Testovací uživatel · Denní provoz",
  }],
  afternoon_cutoff: null,
};

type AttendanceMockDay = {
  date: string;
  arrival_time: string | null;
  departure_time: string | null;
  arrival_time_2: string | null;
  departure_time_2: string | null;
  planned_arrival_time: string | null;
  planned_departure_time: string | null;
  planned_status: string | null;
  is_within_employment_period: boolean;
};

function julyAttendance(): AttendanceMockDay[] {
  return Array.from({ length: 31 }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return {
      date: `2026-07-${day}`,
      arrival_time: null,
      departure_time: null,
      arrival_time_2: null,
      departure_time_2: null,
      planned_arrival_time: "08:00",
      planned_departure_time: "16:30",
      planned_status: null,
      is_within_employment_period: true,
    };
  });
}

for (const { width, height } of [
  { width: 320, height: 568 },
  { width: 360, height: 800 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
]) {
  test(`employee mobile attendance row fits and edits at ${width}x${height}`, async ({ page }) => {
    const days = julyAttendance();
    days[1].arrival_time = "07:45";
    days[1].departure_time = "15:30";
    days[0].arrival_time_2 = "17:00";
    days[0].departure_time_2 = "18:00";
    await page.setViewportSize({ width, height });
    await page.addInitScript((value) => {
      localStorage.setItem("kajovodagmar.language.employee.v1", "cs");
      localStorage.setItem("kajovodagmar.portal.session.v1", JSON.stringify(value));
    }, session);
    await page.route("**/api/v1/attendance?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          employment_id: 41,
          employment_label: "Testovací uživatel · Denní provoz",
          attendance_locked: false,
          shift_plan_locked: false,
          shift_plan_editable: true,
          summary: { work_fund_minutes: 9600, work_fund_source: "calendar", planned_minutes: 0, worked_minutes: 0, vacation_days: 0, vacation_minutes: 0, sickness_days: 0, paragraph_minutes: 0, afternoon_minutes: 0, weekend_holiday_minutes: 0, plan_balance_minutes: -9600, worked_balance_minutes: 0, worked_balance_mode: "elapsed" },
          days,
        }),
      });
    });
    await page.route("**/api/v1/attendance", async (route) => {
      const payload = await route.request().postDataJSON() as { date: string; arrival_time: string | null };
      const target = days.find((day) => day.date === payload.date);
      if (target) target.arrival_time = payload.arrival_time;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });

    await page.goto("/app");
    await page.locator(".employee-topbar .language-switcher select").selectOption("cs");
    await expect(page.locator(".employee-day").first()).toBeVisible();

    const metrics = await page.evaluate(() => {
      const row = document.querySelector(".employee-day");
      const inputs = [...document.querySelectorAll<HTMLInputElement>(".employee-day:first-of-type .time-cell:not(.time-cell--mobile-hidden) input")];
      const inputRects = inputs.map((input) => input.getBoundingClientRect());
      return {
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        rowWidth: row?.getBoundingClientRect().width ?? 0,
        visibleInputs: inputs.length,
        inputMode: inputs[0]?.getAttribute("inputmode"),
        enterKeyHint: inputs[0]?.getAttribute("enterkeyhint"),
        fontSize: getComputedStyle(inputs[0]).fontSize,
        inputWidths: inputRects.map((rect) => rect.width),
        inputGap: inputRects[1].left - inputRects[0].right,
        alignTop: Math.abs(inputRects[0].top - inputRects[1].top),
        alignBottom: Math.abs(inputRects[0].bottom - inputRects[1].bottom),
        nameDay: document.querySelector(".employee-day:first-of-type .calendar-tag--nameday")?.textContent,
        weekendDate: document.querySelector(".employee-day--weekend .employee-day__date strong")?.textContent,
        holidayText: document.querySelector(".employee-day--holiday .calendar-tag--holiday")?.textContent,
        headerHeight: document.querySelector(".employee-topbar")?.getBoundingClientRect().height ?? 0,
      };
    });
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
    expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
    expect(metrics.rowWidth).toBeLessThanOrEqual(metrics.innerWidth);
    expect(metrics.visibleInputs).toBe(2);
    expect(metrics.inputWidths.every((value) => value >= 56 && value < width / 2)).toBe(true);
    expect(metrics.inputGap).toBeGreaterThanOrEqual(3);
    expect(metrics.alignTop).toBeLessThanOrEqual(1);
    expect(metrics.alignBottom).toBeLessThanOrEqual(1);
    expect(metrics.inputMode).toBe("numeric");
    expect(metrics.enterKeyHint).toBe("done");
    expect(metrics.fontSize).toBe("16px");
    expect(metrics.nameDay).toContain("Jaroslava");
    expect(metrics.holidayText).toContain("Cyrila a Metoděje");
    expect(metrics.weekendDate).toMatch(/^04\.\s?07\.\s?2026$/);
    expect(metrics.headerHeight).toBeLessThanOrEqual(height * 0.15);
    await expect(page.locator(".employee-day").nth(1).locator("input[name=\"arrival_time\"]")).toHaveValue("07:45");
    await expect(page.locator(".employee-day").nth(1).locator("input[name=\"departure_time\"]")).toHaveValue("15:30");

    const arrival = page.locator(".employee-day:first-of-type input[name=\"arrival_time\"]");
    await arrival.click();
    await arrival.fill("815");
    await arrival.press("Enter");
    await expect(arrival).toHaveValue("08:15");
    await expect(page.getByText("Docházka byla uložena.")).toHaveCount(0);
    await expect(arrival.locator("xpath=..")).toHaveClass(/time-cell--saved/);

    const focusedMetrics = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll<HTMLInputElement>(".employee-day:first-of-type .time-cell:not(.time-cell--mobile-hidden) input")];
      const first = inputs[0].getBoundingClientRect();
      const second = inputs[1].getBoundingClientRect();
      return {
        scrollWidth: document.documentElement.scrollWidth,
        gap: second.left - first.right,
        overlap: Math.max(0, first.right - second.left),
      };
    });
    expect(focusedMetrics.scrollWidth).toBeLessThanOrEqual(width);
    expect(focusedMetrics.gap).toBeGreaterThanOrEqual(3);
    expect(focusedMetrics.overlap).toBe(0);

    await arrival.click();
    await page.setViewportSize({ width, height: Math.min(height, 500) });
    await page.waitForTimeout(240);
    const keyboardNowbar = await page.locator(".employee-nowbar").boundingBox();
    const keyboardFocused = await arrival.boundingBox();
    if (keyboardNowbar && keyboardFocused)
      expect(keyboardFocused.y + keyboardFocused.height).toBeLessThanOrEqual(keyboardNowbar.y - 8);

    const intervalToggle = page.getByRole("button", { name: "Zobrazit další časový interval" }).first();
    await intervalToggle.click();
    await expect(page.locator(".employee-day").first().locator("input[name=\"arrival_time\"]")).toHaveValue("08:15");
    await expect(page.locator(".employee-day").first().locator("input[name=\"arrival_time_2\"]")).toHaveValue("17:00");
    expect(await page.locator(".employee-day").first().locator(".time-cell:not(.time-cell--mobile-hidden) input").count()).toBe(4);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.locator(".employee-topbar")).toHaveCSS("position", "sticky");
    expect(Math.abs((await page.locator(".employee-topbar").boundingBox())?.y ?? 0)).toBeLessThanOrEqual(1);

    const nowbar = await page.locator(".employee-nowbar button").boundingBox();
    const focused = await arrival.boundingBox();
    if (nowbar && focused) expect(focused.y + focused.height).toBeLessThanOrEqual(nowbar.y);
  });
}

test("employee can switch to editable shift plan and save planned time", async ({ page }) => {
  const days = julyAttendance();
  let savedPlan: { date: string; arrival_time: string | null; departure_time: string | null } | null = null;

  await page.setViewportSize({ width: 390, height: 780 });
  await page.addInitScript((value) => {
    localStorage.setItem("kajovodagmar.language.employee.v1", "cs");
    localStorage.setItem("kajovodagmar.portal.session.v1", JSON.stringify(value));
  }, session);
  await page.route("**/api/v1/attendance?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        employment_id: 41,
        employment_label: "Testovací uživatel · Denní provoz",
        attendance_locked: false,
        shift_plan_locked: false,
        shift_plan_editable: true,
        days,
      }),
    });
  });
  await page.route("**/api/v1/shift-plan", async (route) => {
    savedPlan = await route.request().postDataJSON() as typeof savedPlan;
    const target = days.find((day) => day.date === savedPlan?.date);
    if (target && savedPlan) {
      target.planned_arrival_time = savedPlan.arrival_time;
      target.planned_departure_time = savedPlan.departure_time;
      target.planned_status = null;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await page.goto("/app");
  await page.locator(".employee-topbar .language-switcher select").selectOption("cs");
  await page.getByRole("tab", { name: "Plán služeb" }).click();
  await expect(page.locator(".employee-day--plan").first()).toBeVisible();
  await expect(page.locator(".employee-nowbar")).toHaveCount(0);

  const plannedArrival = page.locator(".employee-day--plan").first().locator("input[name=\"planned_arrival_time\"]");
  await plannedArrival.click();
  await plannedArrival.fill("815");
  await plannedArrival.press("Enter");

  expect(savedPlan).toMatchObject({
    employment_id: 41,
    date: "2026-07-01",
    arrival_time: "08:15",
    departure_time: "16:30",
    status: null,
  });
  await expect(plannedArrival).toHaveValue("08:15");
});

test("employee shift plan is read-only when admin does not allow month editing", async ({ page }) => {
  const days = julyAttendance();

  await page.setViewportSize({ width: 390, height: 780 });
  await page.addInitScript((value) => {
    localStorage.setItem("kajovodagmar.language.employee.v1", "cs");
    localStorage.setItem("kajovodagmar.portal.session.v1", JSON.stringify(value));
  }, session);
  await page.route("**/api/v1/attendance?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        employment_id: 41,
        employment_label: "Testovací uživatel · Denní provoz",
        attendance_locked: false,
        shift_plan_locked: false,
        shift_plan_editable: false,
        summary: { work_fund_minutes: 9600, work_fund_source: "calendar", planned_minutes: 0, worked_minutes: 0, vacation_days: 0, vacation_minutes: 0, sickness_days: 0, paragraph_minutes: 0, afternoon_minutes: 0, weekend_holiday_minutes: 0, plan_balance_minutes: -9600, worked_balance_minutes: 0, worked_balance_mode: "elapsed" },
        days,
      }),
    });
  });

  await page.goto("/app");
  await page.locator(".employee-topbar .language-switcher select").selectOption("cs");
  await page.getByRole("tab", { name: "Plán služeb" }).click();
  await expect(page.getByTitle("Zápis plánu služeb není pro tento měsíc povolen")).toBeVisible();
  await expect(page.locator(".employee-day--plan").first().locator("input[name=\"planned_arrival_time\"]")).toBeDisabled();
});
