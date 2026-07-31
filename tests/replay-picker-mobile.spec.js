const { test, expect } = require("@playwright/test");

test.use({
  viewport: { width: 390, height: 844 },
  userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/150.0.0.0 Mobile Safari/537.36",
  isMobile: true,
  hasTouch: true,
});

test("mobile user selects a stock, starts practice and controls the stop clearly", async ({ page }) => {
  test.setTimeout(90000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("http://127.0.0.1:4173/replay-select.html?selected=3441", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  const input = page.locator("#replayStockSearch");
  await expect(input).toBeVisible({ timeout: 20000 });
  await expect(input).toBeEnabled();
  await input.fill("3441");

  const result = page.locator('[data-replay-code="3441"]');
  await expect(result).toBeVisible();
  await expect(page.locator("#replayStockResults [data-replay-code]")).toHaveCount(1);

  const selectBox = await page.locator(".replay-stock-select-card").boundingBox();
  expect(selectBox).not.toBeNull();
  expect(selectBox.width).toBeGreaterThan(300);
  expect(selectBox.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/replay-selector-mobile.png", fullPage: true });

  await Promise.all([
    page.waitForURL(/replay\.html\?code=3441/, { waitUntil: "domcontentloaded", timeout: 20000 }),
    result.click({ noWaitAfter: true }),
  ]);

  await expect(page.locator("#replaySymbolPicker")).toBeVisible({ timeout: 20000 });
  await expect(page.locator("#replaySymbolCurrent")).toContainText("3441");
  await expect(page.locator("#replayChangeSymbol")).toBeVisible();
  const startButton = page.locator("#startSessionButton");
  await expect(startButton).toBeVisible();
  await expect(startButton).toBeEnabled();
  await page.screenshot({ path: "test-results/replay-setup-mobile.png", fullPage: true });

  await startButton.click();
  await expect(page.locator("#practiceArea")).toBeVisible({ timeout: 30000 });
  await expect(page.locator("#practiceChartTools")).toBeVisible({ timeout: 30000 });
  await expect(page.locator("#replayChart")).toBeVisible();
  expect(await page.evaluate(() => window.__kabutanePracticeV2Ready === true)).toBe(true);
  expect(await page.evaluate(() => Boolean(Chart.registry?.getPlugin?.("practiceStopHandleV3")))).toBe(true);
  expect(await page.evaluate(() => Boolean(window.KabutaneStopGuardV3))).toBe(true);

  await page.evaluate(() => {
    state.guided ||= { mode: "guided", pendingEntry: 1000, pendingStop: 900 };
    state.guided.mode = "guided";
    state.guided.pendingEntry = 1000;
    state.guided.pendingStop = 900;
    state.account.shares = 100;
    state.account.costBasis = 100000;
    state.account.grossBasis = 100000;
    state.plan.entry = 1000;
    state.plan.initialStop = 900;
    state.plan.activeStop = 900;
    state.plan.entryDate = currentRow()?.date || "2026-01-01";
    state.plan.tpPrices = [1200, 1300, 1400, 1500];
    state.plan.hitTargets = [false, false, false, false];
    els.entryPrice.value = "1000";
    els.stopPrice.value = "900";
    renderAll();
  });

  const step = page.locator("#practiceStopStep");
  await step.selectOption("pct");
  const down = page.locator('[data-stop-adjust="down"]');
  const up = page.locator('[data-stop-adjust="up"]');
  await expect(down).toHaveText("−0.1%");
  await expect(up).toHaveText("＋0.1%");
  await expect(down).toBeDisabled();
  await expect(up).toBeEnabled();
  await expect(page.locator("#practiceStopContext")).toContainText("買値から-10.00%");

  await up.click();
  await expect.poll(() => page.evaluate(() => state.plan.activeStop)).toBeCloseTo(900.9, 3);
  await expect(page.locator("#practiceStopFeedback")).toContainText("次の日も");

  const preserved = await page.evaluate(() => {
    const before = state.plan.activeStop;
    els.stopPrice.value = "999.99";
    recalculatePlan();
    const afterRecalculation = state.plan.activeStop;
    processAutomaticOrders({
      date: "2099-01-02",
      open: 1000,
      high: 1050,
      low: 950,
      close: 1000,
    });
    return {
      before,
      afterRecalculation,
      afterDay: state.plan.activeStop,
      shares: state.account.shares,
    };
  });
  expect(preserved.afterRecalculation).toBeCloseTo(preserved.before, 6);
  expect(preserved.afterDay).toBeCloseTo(preserved.before, 6);
  expect(preserved.shares).toBe(100);

  await page.evaluate(() => {
    state.guided.mode = "free";
    renderAll();
  });
  await expect(down).toBeEnabled();
  const beforeDown = await page.evaluate(() => state.plan.activeStop);
  await down.click();
  await expect.poll(() => page.evaluate(() => state.plan.activeStop)).toBeLessThan(beforeDown);

  await page.locator("#practiceChartTools").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/replay-stop-controls-mobile.png", fullPage: true });

  const relevantErrors = pageErrors.filter((message) => !/favicon|service worker|chart\.js/i.test(message));
  expect(relevantErrors).toEqual([]);
});
