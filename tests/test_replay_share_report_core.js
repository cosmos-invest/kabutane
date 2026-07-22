const assert = require("node:assert/strict");
const Core = require("../assets/replay-share-report-core.js");

const snapshot = Core.createSnapshot({
  payload: { name: "テスト工業", code: "1234.T" },
  rows: [
    { date: "2026-01-05", close: 1000 },
    { date: "2026-01-06", close: 1050 },
  ],
  startIndex: 0,
  cursor: 1,
  account: { fees: 120, shares: 100 },
  initialCapital: 1000000,
  maxDrawdown: -4,
  trades: [
    { type: "BUY", memo: "出来高を確認", date: "2026-01-05", price: 1000 },
    { type: "SELL", memo: "ルール通り部分利確", date: "2026-01-06", price: 1050 },
  ],
  plan: { activeStop: 950, ratios: [2, 3, 4, 5], ladder: { plannedLoss: 5000 } },
  metrics: { totalReturn: 5, totalProfit: 50000, totalValue: 1050000, averagePrice: 1000 },
  url: "https://cosmos-invest.github.io/kabutane/replay.html?code=1234",
});

assert.equal(snapshot.code, "1234");
assert.equal(snapshot.score, 69);
assert.equal(snapshot.learning, "ルール通り部分利確");
assert.equal(snapshot.series.length, 2);
assert.match(Core.buildShareText(snapshot), /テスト工業（1234）/);
assert.match(Core.buildShareText(snapshot), /最大DD：-4%/);
assert.equal(Core.fileName(snapshot, "wide"), "kabutane-1234-20260106-wide.png");
assert.equal(Core.riskScore(20, -5), 83);
assert.equal(Core.riskScore(-100, -50), 0);

console.log("replay share report core tests passed");
