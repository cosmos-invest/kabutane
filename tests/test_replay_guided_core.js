const assert = require("node:assert/strict");
const Guide = require("../assets/replay-guided-core.js");

const rows = [
  { date: "2026-01-01", low: 100, close: 105 },
  { date: "2026-01-02", low: 98, close: 103 },
  { date: "2026-01-03", low: 101, close: 106 },
  { date: "2026-01-04", low: 102, close: 108 },
  { date: "2026-01-05", low: 104, close: 110 },
];
const hint = Guide.recentLowHint(rows, 4, 20);
assert.equal(hint.price, 98);
assert.equal(hint.date, "2026-01-02");
assert.equal(hint.method, "pivot");

assert.equal(Guide.targetPrice(1000, 950, 2), 1100);
assert.equal(Guide.rewardRatio(1000, 950, 1100), 2);
assert.equal(Guide.rewardRatio(1000, 950, 1040), 0.8);

const sizing = Guide.riskSizing({
  assets: 3000000,
  riskPct: 1,
  allocationPct: 20,
  entry: 1000,
  stop: 950,
  cash: 3000000,
  lotSize: 100,
  costBps: 10,
});
assert.equal(sizing.riskBudget, 30000);
assert.equal(sizing.riskPerShare, 50);
assert.equal(sizing.maxByRisk, 600);
assert.equal(sizing.maxByAllocation, 500);
assert.equal(sizing.recommendedShares, 500);
assert.equal(sizing.plannedLoss, 25000);
assert.equal(Guide.trancheShares(500, 2, 100), 200);
assert.equal(Guide.trancheShares(500, 4, 100), 100);

const additional = Guide.riskSizing({
  assets: 3000000,
  riskPct: 1,
  allocationPct: 20,
  entry: 980,
  stop: 950,
  cash: 2800000,
  lotSize: 100,
  currentShares: 200,
  currentAveragePrice: 1000,
});
assert.equal(additional.currentRisk, 10000);
assert.equal(additional.remainingRisk, 20000);
assert.ok(additional.recommendedShares >= 100);

const progress = Guide.priceProgress(975, 1000, 950, 1100);
assert.equal(progress.toStop, 0.5);
assert.equal(progress.unrealizedR, -0.5);
assert.match(Guide.coachMessage({ daysHeld: 3, current: 960, entry: 1000, stop: 950, target: 1100 })?.text, /損切りが近づいてるよ/);
assert.match(Guide.coachMessage({ daysHeld: 5, current: 1020, entry: 1000, stop: 950, target: 1100 })?.text, /動かない日/);

const score = Guide.complianceScore({ a: true, b: false, c: true });
assert.deepEqual(score, { achieved: 2, total: 3, ratio: 2 / 3 });

console.log("guided replay core tests passed");
