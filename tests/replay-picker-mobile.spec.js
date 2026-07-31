const { test, expect } = require("@playwright/test");

test.use({
  viewport: { width: 390, height: 844 },
  userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/150.0.0.0 Mobile Safari/537.36",
  isMobile: true,
  hasTouch: true,
});

test("mobile replay picker renders without a native-select freeze", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("http://127.0.0.1:4173/replay.html?code=3441", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  const picker = page.locator("#replaySymbolPicker");
  await expect(picker).toBeVisible({ timeout: 20000 });
  await expect(page.locator("#replaySymbolCurrent")).toContainText("3441");
  await expect(page.locator("#replaySymbolSelect option")).toHaveCount(1);

  const input = page.locator("#replaySymbolSearch");
  await expect(input).toBeVisible();
  await input.fill("3441");

  const result = page.locator('[data-replay-code="3441"]');
  await expect(result).toBeVisible();
  await expect(page.locator("#replaySymbolResults [data-replay-code]")).toHaveCount(1);

  const box = await picker.boundingBox();
  expect(box).not.toBeNull();
  expect(box.width).toBeGreaterThan(280);
  expect(box.width).toBeLessThanOrEqual(390);

  await page.screenshot({ path: "test-results/replay-picker-mobile.png", fullPage: true });

  const relevantErrors = pageErrors.filter((message) => !/favicon|service worker/i.test(message));
  expect(relevantErrors).toEqual([]);
});
