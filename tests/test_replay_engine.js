const assert = require("assert");
const engine = require("../assets/replay.js");

let account = { cash: 1_000_000, shares: 0, costBasis: 0, grossBasis: 0, realized: 0, fees: 0 };

const firstBuy = engine.applyBuy(account, 100, 1000, 10);
assert.strictEqual(firstBuy.ok, true);
account = firstBuy.account;
assert.strictEqual(account.shares, 100);
assert.strictEqual(account.grossBasis, 100_000);
assert.ok(account.cash < 900_000);
assert.ok(account.costBasis > 100_000);

const secondBuy = engine.applyBuy(account, 100, 1100, 10);
assert.strictEqual(secondBuy.ok, true);
account = secondBuy.account;
assert.strictEqual(account.shares, 200);

const beforeSellMetrics = engine.metrics(account, 1200, 1_000_000);
assert.ok(beforeSellMetrics.unrealized > 0);
assert.strictEqual(Math.round(beforeSellMetrics.averagePrice), 1050);
assert.ok(beforeSellMetrics.averageCost > beforeSellMetrics.averagePrice);

const halfSell = engine.applySell(account, 100, 1200, 10);
assert.strictEqual(halfSell.ok, true);
assert.ok(halfSell.realizedDelta > 0);
account = halfSell.account;
assert.strictEqual(account.shares, 100);
assert.ok(account.realized > 0);

const allSell = engine.applySell(account, 100, 900, 10);
assert.strictEqual(allSell.ok, true);
account = allSell.account;
assert.strictEqual(account.shares, 0);
assert.strictEqual(account.costBasis, 0);
assert.strictEqual(account.grossBasis, 0);

assert.strictEqual(engine.roundToLot(249, 100), 200);
assert.strictEqual(engine.roundToLot(99, 100), 0);
assert.strictEqual(engine.roundToLot(37, 1), 37);
assert.strictEqual(engine.maxAffordableShares(250_000, 1000, 100, 0), 200);

assert.strictEqual(engine.restoreSlots(1, 2), 3);
assert.strictEqual(engine.restoreSlots(6, 4), 8);
assert.strictEqual(engine.restoreSlots(0, 8), 8);

const plan = engine.positionPlan({
  assets: 3_000_000,
  allocationPct: 40,
  riskPct: 1,
  entryPrice: 1000,
  stopPrice: 950,
  targetPrice: 1100,
  lotSize: 100,
  costBps: 0,
  slots: 8,
});
assert.strictEqual(plan.allocationBudget, 1_200_000);
assert.strictEqual(plan.riskBudget, 30_000);
assert.strictEqual(plan.maxByAllocation, 1200);
assert.strictEqual(plan.maxByRisk, 600);
assert.strictEqual(plan.recommendedShares, 600);
assert.strictEqual(plan.riskReward, 2);
assert.strictEqual(plan.plannedLoss, 30_000);
assert.strictEqual(plan.plannedReward, 60_000);

const rows = Array.from({ length: 80 }, (_, index) => {
  const close = 100 + index * 0.8 + Math.sin(index / 3) * 2;
  return { open: close - 0.5, high: close + 1.2, low: close - 1.1, close, volume: 1000 + index * 20 };
});
const enriched = engine.enrichRows(rows);
assert.strictEqual(enriched.length, rows.length);
assert.ok(Number.isFinite(enriched.at(-1).ema20));
assert.ok(Number.isFinite(enriched.at(-1).dailyRsi14));
assert.ok(Number.isFinite(enriched.at(-1).atrPct));
assert.ok(Number.isFinite(enriched.at(-1).macd));
assert.ok(Number.isFinite(enriched.at(-1).stochasticK));
assert.ok(Number.isFinite(enriched.at(-1).bbUpper));

const insufficient = engine.applyBuy(account, 10_000, 1000, 10);
assert.strictEqual(insufficient.ok, false);

console.log("Replay engine tests passed");
