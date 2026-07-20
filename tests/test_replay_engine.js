const assert = require("assert");
const engine = require("../assets/replay.js");

let account = { cash: 1_000_000, shares: 0, costBasis: 0, realized: 0, fees: 0 };

const firstBuy = engine.applyBuy(account, 100, 1000, 10);
assert.strictEqual(firstBuy.ok, true);
account = firstBuy.account;
assert.strictEqual(account.shares, 100);
assert.ok(account.cash < 900_000);
assert.ok(account.costBasis > 100_000);

const secondBuy = engine.applyBuy(account, 100, 1100, 10);
assert.strictEqual(secondBuy.ok, true);
account = secondBuy.account;
assert.strictEqual(account.shares, 200);

const beforeSellMetrics = engine.metrics(account, 1200, 1_000_000);
assert.ok(beforeSellMetrics.unrealized > 0);

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

assert.strictEqual(engine.roundToLot(249, 100), 200);
assert.strictEqual(engine.roundToLot(99, 100), 0);
assert.strictEqual(engine.roundToLot(37, 1), 37);

const insufficient = engine.applyBuy(account, 10_000, 1000, 10);
assert.strictEqual(insufficient.ok, false);

console.log("Replay engine tests passed");
