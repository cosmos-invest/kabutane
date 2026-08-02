const { test, expect } = require("@playwright/test");

test.use({
  viewport: { width: 1440, height: 900 },
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
});

async function openReplay(page, mode) {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push({ message: error.message, stack: error.stack || error.message }));
  await page.goto("http://127.0.0.1:4173/replay.html?code=3441", { waitUntil: "domcontentloaded", timeout: 30000 });
  await expect(page.locator("#replayModeSelector")).toBeVisible({ timeout: 20000 });
  await page.locator(`[data-replay-mode="${mode}"]`).click();
  const start = page.locator("#startSessionButton");
  await expect(start).toBeEnabled({ timeout: 20000 });
  await start.click();
  await expect(page.locator("#practiceArea")).toBeVisible({ timeout: 30000 });
  await expect.poll(() => page.evaluate(() => window.__kabutanePracticeV2Ready === true)).toBe(true);
  await expect.poll(() => page.evaluate(() => Boolean(window.KabutanePracticeV5))).toBe(true);
  return pageErrors;
}

test("desktop free practice keeps entry, pnl, exit and report flow beside the chart", async ({ page }) => {
  test.setTimeout(90000);
  const pageErrors = await openReplay(page, "free");

  const cockpit = page.locator("#freePracticeFlowV5");
  await expect(cockpit).toBeVisible();
  await expect(cockpit).toContainText("自由練習コックピット");
  await expect(cockpit.locator('[data-free-step="0"]')).toHaveClass(/active/);

  const cockpitBox = await cockpit.boundingBox();
  const containerBox = await page.locator(".replay-pro-container").boundingBox();
  expect(cockpitBox).not.toBeNull();
  expect(containerBox).not.toBeNull();
  expect(cockpitBox.x).toBeGreaterThan(1000);
  expect(cockpitBox.width).toBeGreaterThan(300);
  expect(containerBox.x + containerBox.width).toBeLessThanOrEqual(cockpitBox.x + 8);

  await cockpit.locator('[data-free-action="entry"]').click();
  const sheet = page.locator("#freePracticeSheetV5");
  await expect(sheet).toHaveClass(/open/);
  await expect(sheet).toContainText("エントリー");
  await expect(sheet.locator("[data-free-entry-thesis]")).toBeVisible();
  await expect(sheet.locator("[data-free-entry-event]")).toBeVisible();
  await expect(sheet.locator("[data-free-entry-plan]")).toBeVisible();
  await sheet.locator("[data-free-sheet-action='close']").click();

  await page.evaluate(() => {
    const price = Number(currentRow()?.close || 1000);
    state.account.cash = Math.max(0, state.initialCapital - price * 200);
    state.account.shares = 200;
    state.account.costBasis = price * 200;
    state.account.grossBasis = price * 200;
    state.plan.entry = price;
    state.plan.initialStop = price * 0.95;
    state.plan.activeStop = price * 0.95;
    state.plan.entryDate = currentRow()?.date;
    state.plan.tpPrices = [price * 1.1, price * 1.15, price * 1.2, price * 1.25];
    state.trades.push({ type: "BUY", date: currentRow()?.date, price, shares: 200, reason: "TEST", memo: "desktop test", decision: { thesis: "trend", eventContext: "normal", planStatus: "planned", plannedSplitCount: 1, stopAtDecision: price * 0.95, allowedRiskPct: state.riskPct, allowedAllocationPct: state.allocationPct } });
    renderAll();
  });

  await expect(cockpit.locator("[data-free-shares]")).toHaveText("200株");
  await expect(cockpit.locator('[data-free-action="exit"]')).toBeEnabled();
  await expect(cockpit.locator('[data-free-step="1"]')).toHaveClass(/active/);
  await cockpit.locator('[data-free-action="exit"]').click();
  await expect(sheet).toHaveClass(/open/);
  await expect(sheet).toContainText("利確・撤退を決める");
  await expect(sheet.locator('[data-free-exit-submit="half"]')).toContainText("100株");
  await expect(sheet.locator("[data-free-exit-reason]")).toBeVisible();
  await sheet.locator("[data-free-sheet-action='close']").click();

  await cockpit.locator('[data-free-action="finish"]').click();
  await expect(page.locator("#finishSummary")).toBeVisible();
  await expect(cockpit.locator("[data-free-result]")).toBeVisible();
  await expect(cockpit.locator("[data-free-score]")).toContainText("点");
  await expect(cockpit.locator('[data-free-action="report"]')).toBeVisible();

  await cockpit.locator('[data-free-action="report"]').click();
  await expect(page.locator("#replayShareDialog")).toHaveAttribute("open", "");
  await expect(page.locator("#replaySharePreview canvas")).toBeVisible();

  await page.screenshot({ path: "test-results/replay-free-desktop.png", fullPage: true });
  const relevantErrors = pageErrors.filter(({ message }) => !/favicon|service worker|chart\.js/i.test(message));
  if (relevantErrors.length) console.error("Replay desktop free page errors:\n" + relevantErrors.map((error) => error.stack).join("\n---\n"));
  expect(relevantErrors.map((error) => error.message)).toEqual([]);
});

test("desktop guided practice moves the floating controls to a right-side rail", async ({ page }) => {
  test.setTimeout(90000);
  const pageErrors = await openReplay(page, "guided");

  await page.evaluate(() => {
    const price = Number(currentRow()?.close || 1000);
    state.guided ||= {};
    state.guided.mode = "guided";
    state.guided.step = "observe";
    state.guided.pendingEntry = price;
    state.guided.pendingStop = price * 0.95;
    state.guided.remainingTranches = 1;
    state.account.cash = Math.max(0, state.initialCapital - price * 100);
    state.account.shares = 100;
    state.account.costBasis = price * 100;
    state.account.grossBasis = price * 100;
    state.plan.entry = price;
    state.plan.initialStop = price * 0.95;
    state.plan.activeStop = price * 0.95;
    state.plan.entryDate = currentRow()?.date;
    renderAll();
  });

  const dock = page.locator("#practiceQuickDockV4");
  await expect(dock).toBeVisible();
  const dockBox = await dock.boundingBox();
  const containerBox = await page.locator(".replay-pro-container").boundingBox();
  expect(dockBox).not.toBeNull();
  expect(containerBox).not.toBeNull();
  expect(dockBox.x).toBeGreaterThan(1000);
  expect(containerBox.x + containerBox.width).toBeLessThanOrEqual(dockBox.x + 8);
  await expect(dock.locator('[data-quick-action="step"]')).toContainText("1日");
  await expect(dock.locator('[data-quick-action="sell"]')).toContainText("利確");

  await page.screenshot({ path: "test-results/replay-guided-desktop.png", fullPage: true });
  const relevantErrors = pageErrors.filter(({ message }) => !/favicon|service worker|chart\.js/i.test(message));
  if (relevantErrors.length) console.error("Replay desktop guided page errors:\n" + relevantErrors.map((error) => error.stack).join("\n---\n"));
  expect(relevantErrors.map((error) => error.message)).toEqual([]);
});
