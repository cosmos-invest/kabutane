const { test, expect } = require("@playwright/test");

test.use({
  viewport: { width: 390, height: 844 },
  userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/150.0.0.0 Mobile Safari/537.36",
  isMobile: true,
  hasTouch: true,
});

test("mobile user selects a stock, opens replay and starts practice", async ({ page }) => {
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
  await page.screenshot({ path: "test-results/replay-practice-mobile.png", fullPage: true });

  const relevantErrors = pageErrors.filter((message) => !/favicon|service worker|chart\.js/i.test(message));
  expect(relevantErrors).toEqual([]);
});
