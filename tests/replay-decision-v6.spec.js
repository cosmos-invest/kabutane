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

async function ensureDetailsOpen(details) {
  if (!(await details.evaluate((element) => element.open))) await details.locator("summary").click();
  await expect.poll(() => details.evaluate((element) => element.open)).toBe(true);
}

test("mobile replay follows oscillator-chart-monthly judgment flow and keeps day controls reachable", async ({ page }) => {
  test.setTimeout(90000);
  const errors = await startReplay(page, "guided");

  const oscillator = page.locator(".replay-decision-oscillator-v6");
  const main = page.locator(".replay-decision-main-v6");
  const monthly = page.locator(".replay-decision-monthly-v6");
  await expect(page.locator("body")).toHaveAttribute("data-guided-analysis", "false");
  await expect(main).toBeVisible();
  await expect(oscillator).toBeHidden();
  await expect(monthly).toBeVisible();
  await expect(page.locator("#monthlyRsiChart")).toBeVisible();
  const beginnerLabels = await page.evaluate(() => Chart.getChart("replayChart").data.datasets.map((dataset) => dataset.label));
  expect(beginnerLabels).toEqual(expect.arrayContaining(["ローソク足", "SMA25", "SMA75", "SMA200", "直近安値"]));
  expect(beginnerLabels).not.toEqual(expect.arrayContaining(["Supertrend"]));

  await page.locator('[data-guided-view="analysis"]').click();
  await expect(page.locator("body")).toHaveAttribute("data-guided-analysis", "true");
  const oscillatorBox = await oscillator.boundingBox();
  const mainBox = await main.boundingBox();
  const monthlyBox = await monthly.boundingBox();
  expect(oscillatorBox).not.toBeNull();
  expect(mainBox).not.toBeNull();
  expect(monthlyBox).not.toBeNull();
  expect(oscillatorBox.y).toBeLessThan(mainBox.y);
  expect(mainBox.y).toBeLessThan(monthlyBox.y);

  await expect(page.locator("#replayVolumeProfileV6")).toBeVisible();
  await expect(page.locator("#replayVolumeToggleV6")).not.toBeChecked();
  await page.locator("#replayVolumeToggleV6").check();
  await expect.poll(async () => (await page.locator("#replayVolumeProfileDetailV6").textContent()) || "", { timeout: 10000 }).toContain("POC");

  const chartSettings = page.locator("#replayChartSettingsV6");
  await expect(chartSettings).toBeHidden();
  await page.locator('[data-guided-view="settings"]').click();
  await expect(chartSettings).toBeVisible();
  await ensureDetailsOpen(chartSettings);
  const chartSettingControl = chartSettings.locator("input:not([disabled]), button:not([disabled])").first();
  if (await chartSettingControl.count()) {
    await chartSettingControl.click();
    await expect.poll(() => chartSettings.evaluate((element) => element.open), { timeout: 3000 }).toBe(false);
  }

  const advancedTools = page.locator("#replayAdvancedToolsV6");
  await expect(advancedTools).toBeVisible();
  await expect.poll(() => advancedTools.evaluate((element) => element.open)).toBe(false);
  await expect(advancedTools.locator("#chartViewportToolbar")).toHaveCount(1);
  await expect(advancedTools.locator("#practiceChartTools")).toHaveCount(1);
  const legacyIndicatorDetails = page.locator("#unifiedIndicatorDetails");
  if (await legacyIndicatorDetails.count()) await expect(legacyIndicatorDetails).toBeHidden();

  const oscillatorSettings = page.locator(".oscillator-settings-v6");
  await page.locator('[data-guided-view="analysis"]').click();
  await ensureDetailsOpen(oscillatorSettings);
  const select = page.locator("#oscillatorSelect");
  await expect(select).toBeVisible();
  const options = await select.locator("option").count();
  if (options > 1) await select.selectOption({ index: 1 });
  await expect.poll(() => oscillatorSettings.evaluate((element) => element.open), { timeout: 3000 }).toBe(false);

  const chart = page.locator(".replay-decision-main-v6 .pro-main-chart");
  await chart.scrollIntoViewIfNeeded();
  const dock = page.locator("#replayDecisionDockV6");
  const actions = dock.locator(".replay-decision-actions-v6");
  await expect(dock).toBeVisible();
  await expect(actions.locator('[data-decision-action="step-one"]')).toBeVisible();
  await expect(actions.locator('[data-decision-action="step-five"]')).toBeVisible();
  await expect(actions.locator('[data-decision-action="choose-entry"]')).toBeVisible();
  await expect(actions.locator('[data-decision-action="finish"]')).toBeVisible();
  await expect(dock.locator(".playback-controls-v6-source")).toBeHidden();

  await page.evaluate(() => {
    const input = document.getElementById("entryPrice");
    if (input) input.value = "123.45";
    state.toolMode = "entry";
    state.plan.armed = true;
  });
  const profileTap = await page.evaluate(() => {
    const chartInstance = Chart.getChart("replayChart");
    const canvas = document.getElementById("replayChart");
    const rect = canvas.getBoundingClientRect();
    const area = window.KabutaneReplayProfileGuardV6.geometry(chartInstance);
    if (!area) throw new Error("replay volume profile gutter is unavailable");
    const x = (area.left + area.right) / 2;
    const y = (area.top + area.bottom) / 2;
    return {
      x: rect.left + (x / chartInstance.width) * rect.width,
      y: rect.top + (y / chartInstance.height) * rect.height,
      chartRight: chartInstance.chartArea.right,
      profileLeft: area.left,
    };
  });
  expect(profileTap.profileLeft).toBeGreaterThan(profileTap.chartRight);
  await page.touchscreen.tap(profileTap.x, profileTap.y);
  await page.waitForTimeout(250);
  await expect(page.locator("#entryPrice")).toHaveValue("123.45");
  await expect.poll(() => page.evaluate(() => state.plan.armed)).toBe(true);
  await expect(page.locator("#replayVolumeProfileDetailV6")).toContainText("株");

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
