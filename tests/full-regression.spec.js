const { test, expect } = require("@playwright/test");

const BASE_URL = (process.env.KABUTANE_BASE_URL || "http://127.0.0.1:4173").replace(/\/$/, "");

function watchRuntime(page) {
  const pageErrors = [];
  const badResponses = [];

  page.on("pageerror", (error) => {
    pageErrors.push(error.stack || error.message);
  });

  page.on("response", (response) => {
    const url = response.url();
    if (!url.startsWith(BASE_URL)) return;
    if (/favicon\.ico(?:\?|$)/i.test(url)) return;
    // 月次バッチ直後は data/daily をリセットするため、次の日次更新まで
    // 銘柄別日次オーバーレイが存在しないのは正常。画面は月次データへフォールバックする。
    if (response.status() === 404 && /\/data\/daily\/[^/?]+\.json(?:\?|$)/i.test(url)) return;
    if (response.status() >= 400) {
      badResponses.push(`${response.status()} ${url}`);
    }
  });

  return () => {
    expect(pageErrors, `JavaScript errors on ${page.url()}`).toEqual([]);
    expect(badResponses, `Broken same-origin resources on ${page.url()}`).toEqual([]);
  };
}

async function openPage(page, path) {
  const assertRuntime = watchRuntime(page);
  const response = await page.goto(`${BASE_URL}/${path}`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  expect(response, `No navigation response for ${path}`).not.toBeNull();
  expect(response.status(), `Navigation failed for ${path}`).toBeLessThan(400);
  await expect(page.locator("body")).toBeVisible();
  await expect.poll(() => page.title()).not.toBe("");
  return assertRuntime;
}

async function currentCandidateCode(page) {
  const response = await page.goto(`${BASE_URL}/index.html`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  expect(response).not.toBeNull();
  expect(response.status()).toBeLessThan(400);
  await expect.poll(() => page.locator("#candidateGrid > *").count(), { timeout: 20000 }).toBeGreaterThan(0);

  const detailLink = page.locator('#candidateGrid a[href*="detail.html?code="]').first();
  await expect(detailLink).toBeVisible({ timeout: 20000 });
  const href = await detailLink.getAttribute("href");
  const code = new URL(href, `${BASE_URL}/`).searchParams.get("code");
  expect(code, "Current candidate detail link has no code").toBeTruthy();
  return code;
}

async function checkIndex(page) {
  const done = await openPage(page, "index.html");
  await expect(page.locator("#heroTitle")).toBeVisible();
  await expect(page.locator("#candidateGrid")).toBeVisible();
  await expect.poll(() => page.locator("#candidateGrid > *").count(), { timeout: 20000 }).toBeGreaterThan(0);
  await expect(page.locator("#generatedAt")).not.toContainText("取得中", { timeout: 20000 });
  done();
}

async function checkDetail(page) {
  const code = await currentCandidateCode(page);
  const done = await openPage(page, `detail.html?code=${encodeURIComponent(code)}`);
  await expect(page.locator("#detailTitle")).toBeVisible();
  await expect(page.locator("#detailSubtitle")).not.toContainText("読み込んでいます", { timeout: 20000 });
  await expect(page.locator("#priceChart")).toBeVisible();
  await expect(page.locator("#rsiChart")).toBeVisible();
  await expect(page.locator(".detail-boot-warning")).toHaveCount(0);
  done();
}

async function checkRanking(page) {
  const done = await openPage(page, "ranking.html");
  await expect(page.getByRole("heading", { name: "月足RSIクロス 観察ランキング" })).toBeVisible();
  await expect.poll(() => page.locator("#rankingList > *").count(), { timeout: 20000 }).toBeGreaterThan(0);
  await expect(page.locator("#rankingDate")).not.toContainText("—", { timeout: 20000 });
  done();
}

async function checkMonthlyStrategy(page) {
  const done = await openPage(page, "monthly-strategy.html");
  await expect(page.locator("header h1")).toHaveText("月初作戦会議");
  await expect.poll(() => page.locator("#monthlySummary > *").count(), { timeout: 20000 }).toBeGreaterThan(0);
  await expect(page.locator("#reportMonth")).not.toContainText("—", { timeout: 20000 });
  done();
}

async function checkReplaySelection(page) {
  const code = await currentCandidateCode(page);
  const done = await openPage(page, `replay-select.html?selected=${encodeURIComponent(code)}`);
  const input = page.locator("#replayStockSearch");
  await expect(input).toBeVisible();
  await expect(input).toBeEnabled({ timeout: 20000 });
  await input.fill(code);
  await expect(page.locator(`[data-replay-code="${code}"]`)).toBeVisible({ timeout: 20000 });
  done();
}

async function checkReplaySetup(page) {
  const code = await currentCandidateCode(page);
  const done = await openPage(page, `replay.html?code=${encodeURIComponent(code)}`);
  await expect(page.locator("#replaySymbolCurrent")).toContainText(code, { timeout: 20000 });
  await expect(page.locator("#startSessionButton")).toBeVisible();
  await expect(page.locator("#startSessionButton")).toBeEnabled({ timeout: 20000 });
  done();
}

const criticalChecks = [
  ["home search", checkIndex],
  ["stock detail", checkDetail],
  ["ranking", checkRanking],
  ["monthly strategy", checkMonthlyStrategy],
  ["replay selection", checkReplaySelection],
  ["replay setup", checkReplaySetup],
];

for (const [name, check] of criticalChecks) {
  test(`desktop: ${name}`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await check(page);
  });
}

for (const [name, check] of criticalChecks) {
  test(`android: ${name}`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 390, height: 844 });
    await check(page);
  });
}

for (const route of ["backtest.html", "howto.html", "learn.html", "signal-method.html", "history.html", "monthly-report.html"]) {
  test(`desktop: ${route} loads without runtime errors`, async ({ page }) => {
    test.setTimeout(45000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const done = await openPage(page, route);
    await expect(page.locator("main")).toBeVisible();
    done();
  });
}
