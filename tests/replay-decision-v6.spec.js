const { test, expect } = require("@playwright/test");

test.use({
  viewport: { width: 390, height: 844 },
  userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/150.0.0.0 Mobile Safari/537.36",
  hasTouch: true,
  isMobile: true,
});

async function startReplay(page, mode = "guided") {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:4173/replay.html?code=5942", { waitUntil: "domcontentloaded", timeout: 30000 });
  await expect(page.locator("#replayModeSelector")).toBeVisible({ timeout: 20000 });
  await page.locator(`[data-replay-mode="${mode}"]`).click();
  const start = page.locator("#startSessionButton");
  await expect(start).toBeEnabled({ timeout: 20000 });
  await start.click();
  await expect(page.locator("#practiceArea")).toBeVisible({ timeout: 30000 });
  await expect.poll(() => page.evaluate(() => window.__kabutanePracticeV2Ready === true), { timeout: 30000 }).toBe(true);
  await expect(page.locator("#replayDecisionSurfaceV6")).toBeVisible({ timeout: 20000 });
  return errors;
}

test("mobile replay follows oscillator-chart-monthly judgment flow and keeps day controls reachable", async ({ page }) => {
  test.setTimeout(90000);
  const errors = await startReplay(page, "guided");

  const oscillator = page.locator(".replay-decision-oscillator-v6");
  const main = page.locator(".replay-decision-main-v6");
  const monthly = page.locator(".replay-decision-monthly-v6");
  const oscillatorBox = await oscillator.boundingBox();
  const mainBox = await main.boundingBox();
  const monthlyBox = await monthly.boundingBox();
  expect(oscillatorBox).not.toBeNull();
  expect(mainBox).not.toBeNull();
  expect(monthlyBox).not.toBeNull();
  expect(oscillatorBox.y).toBeLessThan(mainBox.y);
  expect(mainBox.y).toBeLessThan(monthlyBox.y);

  await expect(page.locator("#replayVolumeProfileV6")).toBeVisible();
  await expect.poll(async () => (await page.locator("#replayVolumeProfileDetailV6").textContent()) || "", { timeout: 10000 }).toContain("POC");

  const chartSettings = page.locator("#replayChartSettingsV6");
  await expect(chartSettings).toBeVisible();
  await chartSettings.locator("summary").click();
  await expect(chartSettings).toHaveAttribute("open", "");

  const oscillatorSettings = page.locator(".oscillator-settings-v6");
  await oscillatorSettings.locator("summary").click();
  const select = page.locator("#oscillatorSelect");
  await expect(select).toBeVisible();
  const options = await select.locator("option").count();
  if (options > 1) await select.selectOption({ index: 1 });
  await expect(oscillatorSettings).not.toHaveAttribute("open", "", { timeout: 3000 });

  const chart = page.locator(".replay-decision-main-v6 .pro-main-chart");
  await chart.scrollIntoViewIfNeeded();
  const dock = page.locator("#replayDecisionDockV6");
  await expect(dock).toBeVisible();
  await expect(dock.locator("#stepOneButton")).toBeVisible();
  await expect(dock.locator("#stepFiveButton")).toBeVisible();
  await expect(dock.locator("#finishButton")).toBeVisible();
  await expect(dock.locator("#playButton")).toBeHidden();
  const dockBox = await dock.boundingBox();
  expect(dockBox).not.toBeNull();
  expect(dockBox.y).toBeGreaterThanOrEqual(0);
  expect(dockBox.y + dockBox.height).toBeLessThanOrEqual(844);

  const monthlyCanvasBox = await page.locator("#monthlyRsiChart").boundingBox();
  expect(monthlyCanvasBox).not.toBeNull();
  expect(monthlyCanvasBox.height).toBeLessThanOrEqual(190);

  await page.screenshot({ path: "test-results/replay-decision-v6-mobile.png", fullPage: true });
  expect(errors.filter((message) => !/favicon|service worker|chart\.js/i.test(message))).toEqual([]);
});
