const assert = require("assert");
const ladder = require("../assets/replay-risk-ladder.js");

assert.strictEqual(ladder.normalizeStages(0), 1);
assert.strictEqual(ladder.normalizeStages(3), 3);
assert.strictEqual(ladder.normalizeStages(99), 8);

assert.deepStrictEqual(ladder.distributeLots(500, 3, 100), [100, 200, 200]);
assert.deepStrictEqual(ladder.distributeLots(300, 2, 100), [100, 200]);

const plan = ladder.buildEntryLadder({
  assets: 3_000_000,
  allocationPct: 20,
  riskPct: 1,
  prices: [1000, 970, 940],
  stop: 900,
  lotSize: 100,
  costBps: 10,
});
assert.strictEqual(plan.valid, true);
assert.strictEqual(plan.stages, 3);
assert.strictEqual(plan.tranches.length, 3);
assert.ok(plan.totalShares > 0);
assert.ok(plan.plannedLoss <= plan.riskBudget + 0.01);
assert.ok(plan.capitalUsed <= plan.allocationBudget + 0.01);
assert.ok(Math.abs(plan.averageEntry - plan.tranches.reduce((sum, item) => sum + item.price * item.shares, 0) / plan.totalShares) < 1e-9);

const invalid = ladder.buildEntryLadder({
  assets: 1_000_000,
  allocationPct: 20,
  riskPct: 1,
  prices: [900, 880],
  stop: 920,
  lotSize: 100,
});
assert.strictEqual(invalid.valid, false);

assert.strictEqual(ladder.restoreSlots({ maxSlots: 3, availableSlots: 0, beforeShares: 300, afterShares: 200 }), 1);
assert.strictEqual(ladder.restoreSlots({ maxSlots: 3, availableSlots: 1, beforeShares: 200, afterShares: 0 }), 3);
assert.strictEqual(ladder.restoreSlots({ maxSlots: 8, availableSlots: 0, beforeShares: 800, afterShares: 400 }), 4);

assert.strictEqual(ladder.limitBuyFillPrice({ open: 950, low: 940, high: 970 }, 960), 950);
assert.strictEqual(ladder.limitBuyFillPrice({ open: 980, low: 950, high: 990 }, 960), 960);
assert.strictEqual(ladder.limitBuyFillPrice({ open: 980, low: 970, high: 990 }, 960), null);

console.log("Replay risk ladder tests passed");
