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

for (const width of [360, 390]) {
  test(`employee mobile attendance row fits and edits at ${width}px`, async ({ page }) => {
    const days = julyAttendance();
    await page.setViewportSize({ width, height: 780 });
    await page.addInitScript((value) => {
      localStorage.setItem("kajovodagmar.portal.session.v1", JSON.stringify(value));
    }, session);
    await page.route("**/api/v1/attendance?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ employment_id: 41, employment_label: "Testovací uživatel · Denní provoz", locked: false, days }),
      });
    });
    await page.route("**/api/v1/attendance", async (route) => {
      const payload = await route.request().postDataJSON() as { date: string; arrival_time: string | null };
      const target = days.find((day) => day.date === payload.date);
      if (target) target.arrival_time = payload.arrival_time;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });

    await page.goto("/app");
    await expect(page.locator(".employee-day").first()).toBeVisible();

    const metrics = await page.evaluate(() => {
      const row = document.querySelector(".employee-day");
      const inputs = [...document.querySelectorAll<HTMLInputElement>(".employee-day:first-of-type .time-cell:not(.time-cell--mobile-hidden) input")];
      const button = document.querySelector<HTMLButtonElement>(".employee-day:first-of-type .employee-day__status .icon-button");
      const inputRects = inputs.map((input) => input.getBoundingClientRect());
      const buttonRect = button?.getBoundingClientRect();
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
        alignTop: Math.abs(inputRects[0].top - (buttonRect?.top ?? 0)),
        alignBottom: Math.abs(inputRects[0].bottom - (buttonRect?.bottom ?? 0)),
        nameDay: document.querySelector(".employee-day:first-of-type .employee-day__date small")?.textContent,
        weekendDate: document.querySelector(".employee-day--weekend .employee-day__date strong")?.textContent,
        holidayText: document.querySelector(".employee-day--holiday .employee-day__date small")?.textContent,
      };
    });
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
    expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
    expect(metrics.rowWidth).toBeLessThanOrEqual(metrics.innerWidth);
    expect(metrics.visibleInputs).toBe(2);
    expect(metrics.inputWidths.every((value) => value <= 56)).toBe(true);
    expect(metrics.inputGap).toBeGreaterThanOrEqual(4);
    expect(metrics.alignTop).toBeLessThanOrEqual(1);
    expect(metrics.alignBottom).toBeLessThanOrEqual(1);
    expect(metrics.inputMode).toBe("numeric");
    expect(metrics.enterKeyHint).toBe("done");
    expect(metrics.fontSize).toBe("16px");
    expect(metrics.nameDay).toBe("svátek má Jaroslava");
    expect(metrics.holidayText).toBe("Cyril a Metoděj");
    expect(metrics.weekendDate).toBe("04.07.2026");

    const arrival = page.locator(".employee-day:first-of-type input[name=\"arrival_time\"]");
    await arrival.click();
    await arrival.fill("815");
    await arrival.press("Enter");
    await expect(arrival).toHaveValue("08:15");

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
    expect(focusedMetrics.gap).toBeGreaterThanOrEqual(4);
    expect(focusedMetrics.overlap).toBe(0);
  });
}
