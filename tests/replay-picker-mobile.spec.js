const { test, expect } = require("@playwright/test");

test.use({
  viewport: { width: 390, height: 844 },
  userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/150.0.0.0 Mobile Safari/537.36",
  isMobile: true,
  hasTouch: true,
});

test("mobile user selects a stock on a separate screen and opens replay", async ({ page }) => {
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
    page.waitForURL(/replay\.html\?code=3441/, { timeout: 20000 }),
    result.click(),
  ]);

  await expect(page.locator("#replaySymbolPicker")).toBeVisible({ timeout: 20000 });
  await expect(page.locator("#replaySymbolCurrent")).toContainText("3441");
  await expect(page.locator("#replayChangeSymbol")).toBeVisible();
  await expect(page.locator("#startSessionButton")).toBeVisible();
  await page.screenshot({ path: "test-results/replay-setup-mobile.png", fullPage: true });

  await Promise.all([
    page.waitForURL(/replay-select\.html\?selected=3441/, { timeout: 20000 }),
    page.locator("#replayChangeSymbol").click(),
  ]);
  await expect(page.locator("#replayStockSearch")).toBeVisible({ timeout: 20000 });

  const relevantErrors = pageErrors.filter((message) => !/favicon|service worker|chart\.js/i.test(message));
  expect(relevantErrors).toEqual([]);
});
