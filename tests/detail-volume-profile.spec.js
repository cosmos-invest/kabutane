const { test, expect } = require("@playwright/test");

async function currentCandidate(page) {
  const response = await page.request.get("http://127.0.0.1:4173/data/latest.json");
  expect(response.ok()).toBeTruthy();
  const latest = await response.json();
  const records = Array.isArray(latest.records) ? latest.records : [];
  expect(records.length).toBeGreaterThan(0);
  return String(records[0].code);
}

test("detail page renders the zero-cost estimated volume profile", async ({ page }) => {
  test.setTimeout(90000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  const code = await currentCandidate(page);
  await page.goto(`http://127.0.0.1:4173/detail.html?code=${encodeURIComponent(code)}`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  await expect(page.locator("#priceChart")).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.detail-analysis-menu a[href="#volumeProfileSection"]')).toHaveText("価格帯別出来高", { timeout: 30000 });

  const section = page.locator("#volumeProfileSection");
  await expect(section).toBeVisible({ timeout: 30000 });
  await expect(section.locator(".volume-profile-estimated-badge")).toHaveText("推定");
  await expect(section.locator(".volume-profile-summary article")).toHaveCount(4);
  await expect(section.locator(".volume-profile-row")).toHaveCount(20);
  await expect(section).toContainText("約定価格ごとの実出来高ではありません");
  await expect(section).toContainText("無料の日足OHLCV");

  const summary = section.locator("#volumeProfileSummary");
  await expect(summary).toContainText("最大出来高帯");
  await expect(summary).toContainText("主要出来高帯");
  await expect(summary).toContainText("現在値");

  const threeMonths = section.locator('[data-volume-lookback="60"]');
  const sixMonths = section.locator('[data-volume-lookback="120"]');
  const oneYear = section.locator('[data-volume-lookback="250"]');
  await expect(sixMonths).toHaveClass(/active/);
  await threeMonths.click();
  await expect(threeMonths).toHaveClass(/active/);
  await oneYear.click();
  await expect(oneYear).toHaveClass(/active/);

  await expect(page.locator("#rsiChart")).toBeVisible();
  await expect(page.locator("#replayCardLink")).toBeVisible();

  const relevant = errors.filter((message) => !/favicon|service worker/i.test(message));
  expect(relevant).toEqual([]);
});
